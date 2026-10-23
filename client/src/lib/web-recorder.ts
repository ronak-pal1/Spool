import { StreamingMultipartUploader, type UploadProgress } from '@spool/shared';
import { api } from './api';

export type CaptureMode = 'screen' | 'screen-camera' | 'camera';

export interface CaptureOptions {
  mode: CaptureMode;
  micEnabled: boolean;
  micId: string | null;
  cameraId: string | null;
}

const MIME_CANDIDATES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1,mp4a', 'video/mp4'];

export function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser does not support recording. Try Chrome, Edge or Firefox.');
  for (const mime of MIME_CANDIDATES) if (MediaRecorder.isTypeSupported(mime)) return mime;
  return '';
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export async function openMicrophone(deviceId: string | null): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
}

export async function openCamera(deviceId: string | null): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    },
  });
}

export function describeMediaError(error: unknown): string {
  const name = (error as DOMException | undefined)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Permission was denied. Allow access in your browser settings and try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'The selected device is not available.';
  if (name === 'NotReadableError') return 'The device is in use by another application.';
  if (name === 'AbortError') return 'Capture was cancelled.';
  return error instanceof Error ? error.message : 'Could not start capture.';
}

interface RecorderEvents {
  onSourceEnded: () => void;
  onUploadProgress: (progress: UploadProgress) => void;
  onError: (error: Error) => void;
}

/**
 * Captures screen and/or camera with mixed microphone + system audio, and streams 1-second
 * MediaRecorder chunks straight into an S3 multipart upload while recording.
 */
export class WebRecorder {
  displayStream: MediaStream | null = null;
  cameraStream: MediaStream | null = null;
  private micStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private micGain: GainNode | null = null;
  private recordStream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private uploader: StreamingMultipartUploader | null = null;
  private mimeType = '';
  private stopped: Promise<void> | null = null;
  videoId: string | null = null;
  shareId: string | null = null;

  constructor(private readonly events: RecorderEvents) {}

  async acquire(options: CaptureOptions, existingCamera: MediaStream | null): Promise<void> {
    this.mimeType = pickMimeType();
    if (options.mode !== 'camera') {
      const displayOptions: DisplayMediaStreamOptions & Record<string, unknown> = {
        video: { frameRate: { ideal: 30, max: 30 }, width: { max: 2560 }, height: { max: 1600 } },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
        systemAudio: 'include',
      };
      this.displayStream = await navigator.mediaDevices.getDisplayMedia(displayOptions);
      this.displayStream.getVideoTracks()[0]?.addEventListener('ended', () => this.events.onSourceEnded());
    }
    if (options.mode !== 'screen') {
      this.cameraStream = existingCamera && existingCamera.getVideoTracks().some((t) => t.readyState === 'live') ? existingCamera : await openCamera(options.cameraId);
    }
    if (options.micEnabled) {
      try {
        this.micStream = await openMicrophone(options.micId);
      } catch (error) {
        this.releaseAll();
        throw error;
      }
    }

    const videoTrack = options.mode === 'camera' ? this.cameraStream?.getVideoTracks()[0] : this.displayStream?.getVideoTracks()[0];
    if (!videoTrack) throw new Error('No video source was selected.');

    const audioSources = [this.micStream, this.displayStream].filter((s): s is MediaStream => Boolean(s && s.getAudioTracks().length > 0));
    const tracks: MediaStreamTrack[] = [videoTrack];
    if (audioSources.length > 0) {
      this.audioContext = new AudioContext();
      const destination = this.audioContext.createMediaStreamDestination();
      if (this.micStream && this.micStream.getAudioTracks().length > 0) {
        this.micGain = this.audioContext.createGain();
        this.audioContext.createMediaStreamSource(this.micStream).connect(this.micGain).connect(destination);
      }
      if (this.displayStream && this.displayStream.getAudioTracks().length > 0) {
        this.audioContext.createMediaStreamSource(this.displayStream).connect(destination);
      }
      const mixed = destination.stream.getAudioTracks()[0];
      if (mixed) tracks.push(mixed);
    }
    this.recordStream = new MediaStream(tracks);
  }

  get hasSystemAudio(): boolean {
    return Boolean(this.displayStream && this.displayStream.getAudioTracks().length > 0);
  }

  get hasMic(): boolean {
    return Boolean(this.micStream);
  }

  async start(): Promise<void> {
    if (!this.recordStream) throw new Error('Capture has not been started');
    if (this.audioContext?.state === 'suspended') await this.audioContext.resume();
    const baseMime = (this.mimeType || 'video/webm').split(';')[0] as string;
    const created = await api.createUpload({ mimeType: baseMime, source: 'web' });
    this.videoId = created.videoId;
    this.shareId = created.shareId;
    this.uploader = new StreamingMultipartUploader({
      api,
      videoId: created.videoId,
      partSize: created.partSize,
      concurrency: 3,
      onProgress: this.events.onUploadProgress,
    });

    const recorder = new MediaRecorder(this.recordStream, {
      mimeType: this.mimeType || undefined,
      videoBitsPerSecond: 5_000_000,
      audioBitsPerSecond: 128_000,
    });
    const uploader = this.uploader;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) uploader.append(event.data);
    };
    recorder.onerror = (event) => {
      const error = (event as unknown as { error?: DOMException }).error;
      this.events.onError(new Error(error?.message ?? 'The recorder stopped unexpectedly'));
    };
    this.stopped = new Promise<void>((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true });
    });
    this.recorder = recorder;
    recorder.start(1000);
  }

  pause(): void {
    if (this.recorder?.state === 'recording') this.recorder.pause();
  }

  resume(): void {
    if (this.recorder?.state === 'paused') this.recorder.resume();
  }

  setMicMuted(muted: boolean): void {
    if (this.micGain && this.audioContext) this.micGain.gain.setTargetAtTime(muted ? 0 : 1, this.audioContext.currentTime, 0.015);
  }

  private async stopRecorder(): Promise<void> {
    const recorder = this.recorder;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      await this.stopped;
    }
    this.recorder = null;
  }

  /** Stops recording, flushes the remaining parts and completes the upload. */
  async finish(durationSeconds: number): Promise<string> {
    await this.stopRecorder();
    const uploader = this.uploader;
    const shareId = this.shareId;
    if (!uploader || !shareId) throw new Error('Nothing was recorded');
    this.releaseAll();
    await uploader.finish({ durationHint: Math.max(0, Math.round(durationSeconds * 10) / 10) });
    this.uploader = null;
    return shareId;
  }

  /** Drops the current take (and its upload) but keeps capture sources alive for a fresh take. */
  async discardTake(): Promise<void> {
    if (this.recorder) this.recorder.ondataavailable = null;
    await this.stopRecorder();
    const uploader = this.uploader;
    this.uploader = null;
    this.videoId = null;
    this.shareId = null;
    if (uploader) await uploader.abort();
  }

  async cancel(): Promise<void> {
    await this.discardTake();
    this.releaseAll();
  }

  releaseAll(): void {
    stopStream(this.displayStream);
    stopStream(this.micStream);
    stopStream(this.cameraStream);
    this.displayStream = null;
    this.micStream = null;
    this.cameraStream = null;
    if (this.audioContext && this.audioContext.state !== 'closed') void this.audioContext.close();
    this.audioContext = null;
    this.micGain = null;
    this.recordStream?.getTracks().forEach((t) => t.stop());
    this.recordStream = null;
  }
}
