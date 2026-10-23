import { StreamingMultipartUploader, type ClickEvent, type CreateUploadResponse, type SpoolApi, type UploadProgress } from '@spool/shared';
import { createApi, errorMessage } from '@/lib/api';
import { describeMediaError, openCamera, openMicrophone, pickMimeType, stopStream } from '@/lib/media';
import { isExtensionMessage, request, type MessageResponse, type RecorderBootstrap, type RecorderCommand } from '@/lib/messages';
import { readSettings, type ExtensionSettings } from '@/lib/settings';
import { DEFAULT_MAX_SECONDS, IDLE_STATE, elapsedMs, readRecordingState, resetRecordingState, writeRecordingState, type RecordingState } from '@/lib/state';

const COUNTDOWN_MS = 3000;
const MAX_CLICK_EVENTS = 4000;

export interface EngineFailure {
  message: string;
  canRetryUpload: boolean;
  canDownload: boolean;
}

export interface EngineView {
  state: RecordingState;
  previewStream: MediaStream | null;
  failure: EngineFailure | null;
  completed: boolean;
}

class CancelledError extends Error {
  constructor() {
    super('Recording was cancelled');
    this.name = 'CancelledError';
  }
}

interface DesktopChoice {
  streamId: string;
  canRequestAudio: boolean;
}

function chooseDesktopMedia(): Promise<DesktopChoice> {
  return new Promise((resolve) => {
    chrome.desktopCapture.chooseDesktopMedia(['screen', 'window', 'tab', 'audio'], (streamId, options) => {
      resolve({ streamId, canRequestAudio: Boolean(options?.canRequestAudioTrack) });
    });
  });
}

/** Chrome-specific `mandatory` constraints are required to consume desktop/tab stream ids. */
function chromeSourceConstraints(source: 'desktop' | 'tab', streamId: string, withAudio: boolean): MediaStreamConstraints {
  const video = { mandatory: { chromeMediaSource: source, chromeMediaSourceId: streamId, maxWidth: 2560, maxHeight: 1600, maxFrameRate: 30 } };
  const audio = withAudio ? { mandatory: { chromeMediaSource: source, chromeMediaSourceId: streamId } } : false;
  return { video, audio } as unknown as MediaStreamConstraints;
}

/**
 * Runs inside the pinned recorder tab. It owns the capture streams, the MediaRecorder and the
 * streaming multipart upload, and publishes its state to `chrome.storage.session`.
 */
export class RecorderEngine {
  private view: EngineView = { state: { ...IDLE_STATE }, previewStream: null, failure: null, completed: false };
  private readonly listeners = new Set<() => void>();

  private bootstrap: RecorderBootstrap | null = null;
  private settings: ExtensionSettings | null = null;
  private readonly api: SpoolApi;
  private webUrl = '';
  private selfTabId: number | null = null;

  private captureStream: MediaStream | null = null;
  private cameraStream: MediaStream | null = null;
  private micStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private micGain: GainNode | null = null;
  private recordStream: MediaStream | null = null;
  private mimeType = '';

  private recorder: MediaRecorder | null = null;
  private recorderStopped: Promise<void> | null = null;
  private uploader: StreamingMultipartUploader | null = null;
  private upload: CreateUploadResponse | null = null;
  private pendingUpload: Promise<CreateUploadResponse> | null = null;
  private chunks: Blob[] = [];
  private clickEvents: ClickEvent[] = [];
  private finalDurationSec = 0;

  private countdownTimer: number | null = null;
  private countdownCancel: (() => void) | null = null;
  private limitTimer: number | null = null;
  private progressTimer: number | null = null;
  private latestProgress: UploadProgress | null = null;
  private finishing = false;
  private disposed = false;

  constructor() {
    this.api = createApi(() => {
      if (!this.settings) throw new Error('Settings are not loaded');
      return this.settings;
    });
    this.handleMessage = this.handleMessage.bind(this);
    this.handleBeforeUnload = this.handleBeforeUnload.bind(this);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getView = (): EngineView => this.view;

  private setView(patch: Partial<EngineView>): void {
    this.view = { ...this.view, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private commit(patch: Partial<RecordingState>): void {
    const next = { ...this.view.state, ...patch, updatedAt: Date.now() };
    this.setView({ state: next });
    if (!this.disposed) void writeRecordingState(next);
  }

  async start(): Promise<void> {
    chrome.runtime.onMessage.addListener(this.handleMessage);
    window.addEventListener('beforeunload', this.handleBeforeUnload);
    try {
      const self = await chrome.tabs.getCurrent();
      this.selfTabId = self?.id ?? null;
      if (this.selfTabId !== null) await chrome.tabs.update(this.selfTabId, { autoDiscardable: false }).catch(() => undefined);
      this.bootstrap = await request<RecorderBootstrap>({ type: 'spool:recorder-init' });
      this.settings = await readSettings();
      const initial = await readRecordingState();
      this.setView({ state: { ...initial, recorderTabId: this.selfTabId } });

      const health = await this.api.health();
      this.webUrl = health.webUrl.replace(/\/+$/, '');
      this.commit({ maxSeconds: health.maxRecordingSeconds || DEFAULT_MAX_SECONDS });

      await this.acquire();
      if (this.bootstrap.options.mode === 'screen') await this.focusOrigin();
      await this.beginTake();
    } catch (error) {
      if (error instanceof CancelledError) {
        await this.closeQuietly();
        return;
      }
      this.releaseCapture();
      this.fail(describeMediaError(error), { canRetryUpload: false, canDownload: false });
    }
  }

  private async acquire(): Promise<void> {
    const bootstrap = this.bootstrap as RecorderBootstrap;
    const { options } = bootstrap;
    this.mimeType = pickMimeType();
    const audioInputs: MediaStream[] = [];
    let playbackSource: MediaStream | null = null;

    if (options.mode === 'screen') {
      const choice = await chooseDesktopMedia();
      if (!choice.streamId) throw new CancelledError();
      this.captureStream = await navigator.mediaDevices.getUserMedia(chromeSourceConstraints('desktop', choice.streamId, choice.canRequestAudio));
    } else if (options.mode === 'tab') {
      if (!bootstrap.tabStreamId) throw new Error('Chrome did not provide a stream for this tab.');
      this.captureStream = await navigator.mediaDevices.getUserMedia(chromeSourceConstraints('tab', bootstrap.tabStreamId, true));
      // Tab capture mutes the tab locally; its audio is played back so the user still hears it.
      playbackSource = this.captureStream;
    } else {
      this.cameraStream = await openCamera(options.cameraId);
      this.setView({ previewStream: this.cameraStream });
    }

    if (this.captureStream && this.captureStream.getAudioTracks().length > 0) audioInputs.push(this.captureStream);
    this.commit({ hasSystemAudio: audioInputs.length > 0 });

    if (options.micEnabled) {
      this.micStream = await openMicrophone(options.micId);
    }

    const videoTrack = (this.captureStream ?? this.cameraStream)?.getVideoTracks()[0];
    if (!videoTrack) throw new Error('No video source was selected.');
    videoTrack.addEventListener('ended', () => {
      if (this.view.state.phase === 'recording' || this.view.state.phase === 'paused') void this.finish();
      else if (this.view.state.phase === 'countdown') void this.discard();
    });

    const tracks: MediaStreamTrack[] = [videoTrack];
    if (audioInputs.length > 0 || this.micStream) {
      const context = new AudioContext();
      this.audioContext = context;
      const destination = context.createMediaStreamDestination();
      for (const input of audioInputs) context.createMediaStreamSource(input).connect(destination);
      if (playbackSource && playbackSource.getAudioTracks().length > 0) context.createMediaStreamSource(playbackSource).connect(context.destination);
      if (this.micStream) {
        this.micGain = context.createGain();
        context.createMediaStreamSource(this.micStream).connect(this.micGain).connect(destination);
      }
      if (context.state === 'suspended') await context.resume();
      const mixed = destination.stream.getAudioTracks()[0];
      if (mixed) tracks.push(mixed);
    }
    this.recordStream = new MediaStream(tracks);
  }

  private async focusOrigin(): Promise<void> {
    const origin = this.bootstrap?.originTabId;
    if (origin === null || origin === undefined) return;
    try {
      const tab = await chrome.tabs.update(origin, { active: true });
      if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
    } catch {
      // The origin tab was closed while the picker was open; the recorder tab stays in front.
    }
  }

  private requestUpload(): Promise<CreateUploadResponse> {
    const baseMime = (this.mimeType || 'video/webm').split(';')[0] as string;
    return this.api.createUpload({ mimeType: baseMime, source: 'extension' });
  }

  private waitForCountdown(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.countdownTimer = window.setTimeout(() => {
        this.countdownTimer = null;
        this.countdownCancel = null;
        resolve();
      }, COUNTDOWN_MS);
      this.countdownCancel = () => {
        if (this.countdownTimer !== null) window.clearTimeout(this.countdownTimer);
        this.countdownTimer = null;
        this.countdownCancel = null;
        reject(new CancelledError());
      };
    });
  }

  private async beginTake(): Promise<void> {
    this.chunks = [];
    this.clickEvents = [];
    this.upload = null;
    this.commit({ phase: 'countdown', countdownEndsAt: Date.now() + COUNTDOWN_MS, startedAt: null, accumulatedMs: 0, micMuted: false, videoId: null, upload: null, error: null });
    this.setMicGain(false);
    const uploadRequest = this.requestUpload();
    this.pendingUpload = uploadRequest;
    uploadRequest.catch(() => undefined);
    try {
      await this.waitForCountdown();
    } catch (error) {
      if (error instanceof CancelledError) {
        void uploadRequest.then((created) => this.api.abortUpload(created.videoId)).catch(() => undefined);
        return;
      }
      throw error;
    }

    let created: CreateUploadResponse;
    try {
      created = await uploadRequest;
    } catch (error) {
      this.releaseCapture();
      this.fail(errorMessage(error), { canRetryUpload: false, canDownload: false });
      return;
    } finally {
      this.pendingUpload = null;
    }
    if (this.disposed || this.view.state.phase !== 'countdown') {
      void this.api.abortUpload(created.videoId).catch(() => undefined);
      return;
    }
    this.upload = created;
    this.uploader = this.createUploader(created);
    this.startRecorder();
    this.commit({ phase: 'recording', startedAt: Date.now(), accumulatedMs: 0, countdownEndsAt: null, videoId: created.videoId });
    this.startLimitWatch();
  }

  private createUploader(created: CreateUploadResponse): StreamingMultipartUploader {
    return new StreamingMultipartUploader({
      api: this.api,
      videoId: created.videoId,
      partSize: created.partSize,
      concurrency: 4,
      onProgress: (progress) => this.queueProgress(progress),
    });
  }

  private startRecorder(): void {
    const stream = this.recordStream;
    const uploader = this.uploader;
    if (!stream || !uploader) throw new Error('Capture is not ready');
    const recorder = new MediaRecorder(stream, {
      mimeType: this.mimeType || undefined,
      videoBitsPerSecond: 4_500_000,
      audioBitsPerSecond: 128_000,
    });
    recorder.ondataavailable = (event) => {
      if (event.data.size === 0) return;
      this.chunks.push(event.data);
      uploader.append(event.data);
    };
    recorder.onerror = () => {
      void this.finish();
    };
    this.recorderStopped = new Promise<void>((resolve) => recorder.addEventListener('stop', () => resolve(), { once: true }));
    this.recorder = recorder;
    recorder.start(1000);
  }

  private async stopRecorder(keepData: boolean): Promise<void> {
    const recorder = this.recorder;
    if (!recorder) return;
    if (!keepData) recorder.ondataavailable = null;
    if (recorder.state !== 'inactive') {
      recorder.stop();
      await this.recorderStopped;
    }
    this.recorder = null;
    this.recorderStopped = null;
  }

  private startLimitWatch(): void {
    this.stopLimitWatch();
    this.limitTimer = window.setInterval(() => {
      const state = this.view.state;
      if (state.phase === 'recording' && elapsedMs(state) >= state.maxSeconds * 1000) void this.finish();
    }, 250);
  }

  private stopLimitWatch(): void {
    if (this.limitTimer !== null) window.clearInterval(this.limitTimer);
    this.limitTimer = null;
  }

  private queueProgress(progress: UploadProgress): void {
    this.latestProgress = progress;
    if (this.progressTimer !== null) return;
    this.progressTimer = window.setTimeout(() => {
      this.progressTimer = null;
      const latest = this.latestProgress;
      if (latest) this.commit({ upload: { uploadedBytes: latest.uploadedBytes, queuedBytes: latest.queuedBytes } });
    }, 400);
  }

  private setMicGain(muted: boolean): void {
    if (this.micGain && this.audioContext) this.micGain.gain.setTargetAtTime(muted ? 0 : 1, this.audioContext.currentTime, 0.015);
  }

  pause(): void {
    const state = this.view.state;
    if (state.phase !== 'recording' || this.recorder?.state !== 'recording') return;
    this.recorder.pause();
    this.commit({ phase: 'paused', accumulatedMs: elapsedMs(state), startedAt: null });
  }

  resume(): void {
    if (this.view.state.phase !== 'paused' || this.recorder?.state !== 'paused') return;
    this.recorder.resume();
    this.commit({ phase: 'recording', startedAt: Date.now() });
  }

  toggleMic(): void {
    if (!this.micGain) return;
    const muted = !this.view.state.micMuted;
    this.setMicGain(muted);
    this.commit({ micMuted: muted });
  }

  async restart(): Promise<void> {
    const phase = this.view.state.phase;
    if (phase !== 'recording' && phase !== 'paused' && phase !== 'countdown') return;
    if (phase === 'countdown') {
      this.countdownCancel?.();
    } else {
      await this.dropTake();
    }
    await this.beginTake();
  }

  /** Throws away the current take's recorder and upload, keeping capture sources alive. */
  private async dropTake(): Promise<void> {
    this.stopLimitWatch();
    await this.stopRecorder(false);
    const uploader = this.uploader;
    this.uploader = null;
    this.upload = null;
    this.chunks = [];
    if (uploader) await uploader.abort();
  }

  async discard(): Promise<void> {
    if (this.finishing) return;
    const phase = this.view.state.phase;
    if (phase === 'countdown') this.countdownCancel?.();
    const pending = this.pendingUpload;
    await this.dropTake();
    if (pending) void pending.then((created) => this.api.abortUpload(created.videoId)).catch(() => undefined);
    this.releaseCapture();
    await this.closeQuietly();
  }

  async finish(): Promise<void> {
    const state = this.view.state;
    if (this.finishing || (state.phase !== 'recording' && state.phase !== 'paused')) return;
    this.finishing = true;
    this.stopLimitWatch();
    this.finalDurationSec = Math.max(0, Math.round(elapsedMs(state) / 100) / 10);
    this.commit({ phase: 'finalizing', accumulatedMs: elapsedMs(state), startedAt: null });
    await this.stopRecorder(true);
    this.releaseCapture();
    const uploader = this.uploader;
    if (!uploader || !this.upload) {
      this.finishing = false;
      this.fail('Nothing was recorded.', { canRetryUpload: false, canDownload: false });
      return;
    }
    try {
      await uploader.finish({ durationHint: this.finalDurationSec, clickEvents: this.clickEvents });
      this.uploader = null;
      await this.complete(this.upload.shareId);
    } catch (error) {
      this.uploader = null;
      this.finishing = false;
      this.fail(`Upload failed: ${errorMessage(error)}`, { canRetryUpload: this.chunks.length > 0, canDownload: this.chunks.length > 0 });
    }
  }

  /** Re-uploads the locally buffered recording as a brand-new upload after a failed finish. */
  async retryUpload(): Promise<void> {
    if (this.finishing || this.chunks.length === 0) return;
    this.finishing = true;
    const failed = this.upload;
    this.setView({ failure: null });
    this.commit({ phase: 'finalizing', error: null, upload: { uploadedBytes: 0, queuedBytes: 0 } });
    if (failed) void this.api.abortUpload(failed.videoId).catch(() => undefined);
    try {
      const created = await this.requestUpload();
      this.upload = created;
      this.commit({ videoId: created.videoId });
      const uploader = this.createUploader(created);
      uploader.append(new Blob(this.chunks, { type: this.mimeType || 'video/webm' }));
      await uploader.finish({ durationHint: this.finalDurationSec, clickEvents: this.clickEvents });
      await this.complete(created.shareId);
    } catch (error) {
      this.finishing = false;
      this.fail(`Upload failed: ${errorMessage(error)}`, { canRetryUpload: true, canDownload: true });
    }
  }

  downloadRecording(): void {
    if (this.chunks.length === 0) return;
    const blob = new Blob(this.chunks, { type: this.mimeType || 'video/webm' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `spool-recording-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  private async complete(shareId: string): Promise<void> {
    this.chunks = [];
    this.setView({ completed: true });
    const url = `${this.webUrl}/s/${shareId}`;
    await chrome.tabs.create({ url, active: true });
    await this.closeQuietly();
  }

  private fail(message: string, failure: Omit<EngineFailure, 'message'>): void {
    this.stopLimitWatch();
    this.setView({ failure: { message, ...failure } });
    this.commit({ phase: 'error', error: message, countdownEndsAt: null, startedAt: null });
  }

  /** Resets shared state and closes the recorder tab (state is cleared before the tab disappears). */
  async closeQuietly(): Promise<void> {
    this.disposed = true;
    window.removeEventListener('beforeunload', this.handleBeforeUnload);
    chrome.runtime.onMessage.removeListener(this.handleMessage);
    this.releaseCapture();
    await resetRecordingState();
    const origin = this.bootstrap?.originTabId;
    if (!this.view.completed && origin !== null && origin !== undefined && this.bootstrap?.options.mode !== 'tab') {
      await chrome.tabs.update(origin, { active: true }).catch(() => undefined);
    }
    if (this.selfTabId !== null) await chrome.tabs.remove(this.selfTabId).catch(() => window.close());
    else window.close();
  }

  private releaseCapture(): void {
    stopStream(this.captureStream);
    stopStream(this.cameraStream);
    stopStream(this.micStream);
    this.captureStream = null;
    this.cameraStream = null;
    this.micStream = null;
    if (this.audioContext && this.audioContext.state !== 'closed') void this.audioContext.close();
    this.audioContext = null;
    this.micGain = null;
    this.recordStream?.getTracks().forEach((track) => track.stop());
    this.recordStream = null;
    if (this.view.previewStream) this.setView({ previewStream: null });
  }

  runCommand(command: RecorderCommand): void {
    switch (command) {
      case 'pause':
        this.pause();
        break;
      case 'resume':
        this.resume();
        break;
      case 'toggle-pause':
        if (this.view.state.phase === 'paused') this.resume();
        else this.pause();
        break;
      case 'toggle-mic':
        this.toggleMic();
        break;
      case 'stop':
        void this.finish();
        break;
      case 'restart':
        void this.restart();
        break;
      case 'discard':
        void this.discard();
        break;
    }
  }

  private handleMessage(message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: MessageResponse<undefined>) => void): boolean {
    if (!isExtensionMessage(message)) return false;
    if (message.type === 'spool:command') {
      this.runCommand(message.command);
      sendResponse({ ok: true, data: undefined });
      return false;
    }
    if (message.type === 'spool:click') {
      const state = this.view.state;
      const fromTarget = sender.tab?.id !== undefined && sender.tab.id === state.targetTabId;
      if (state.mode === 'tab' && fromTarget && state.phase === 'recording' && this.clickEvents.length < MAX_CLICK_EVENTS) {
        const x = Math.min(1, Math.max(0, message.x));
        const y = Math.min(1, Math.max(0, message.y));
        this.clickEvents.push({ t: Math.round(elapsedMs(state) / 10) / 100, x, y });
      }
      return false;
    }
    return false;
  }

  private handleBeforeUnload(event: BeforeUnloadEvent): void {
    const phase = this.view.state.phase;
    if (phase === 'recording' || phase === 'paused' || phase === 'finalizing' || (phase === 'error' && this.chunks.length > 0)) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
}
