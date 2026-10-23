import { createApi, errorMessage } from '@/lib/api';
import { isExtensionMessage, type MessageResponse, type RecorderBootstrap, type StartOptions } from '@/lib/messages';
import { readSettings, type ExtensionSettings } from '@/lib/settings';
import {
  IDLE_STATE,
  isActive,
  readRecordingState,
  resetRecordingState,
  subscribeRecordingState,
  writeRecordingState,
  type RecordingState,
} from '@/lib/state';

const BOOTSTRAP_KEY = 'spool:bootstrap';
const CAPTURABLE_URL = /^(https?|file):/i;

let settingsSnapshot: ExtensionSettings | null = null;
const api = createApi(() => {
  if (!settingsSnapshot) throw new Error('Settings are not loaded');
  return settingsSnapshot;
});

// Content scripts are "untrusted contexts" and need explicit access to session storage.
void chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });

function ok<T>(data: T): MessageResponse<T> {
  return { ok: true, data };
}

function fail(error: unknown): MessageResponse<never> {
  return { ok: false, error: errorMessage(error) };
}

function getTabStreamId(targetTabId: number): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId }, (streamId) => {
      const lastError = chrome.runtime.lastError;
      if (lastError || !streamId) {
        reject(new Error(lastError?.message ?? 'Chrome did not allow capturing this tab. Click the Spool icon on the tab you want to record and try again.'));
        return;
      }
      resolve(streamId);
    });
  });
}

async function tabExists(tabId: number | null): Promise<boolean> {
  if (tabId === null) return false;
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch {
    return false;
  }
}

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'spool:ping' });
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    } catch {
      // Browser-internal pages (chrome://, the Web Store, PDFs) refuse injection; the popup and recorder tab still offer controls.
    }
  }
}

async function resolveTargetTab(tabId: number | null): Promise<chrome.tabs.Tab | null> {
  if (tabId !== null) {
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      return null;
    }
  }
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return active ?? null;
}

async function startRecording(options: StartOptions, tabId: number | null): Promise<void> {
  const current = await readRecordingState();
  if (isActive(current)) {
    if (await tabExists(current.recorderTabId)) {
      await chrome.tabs.update(current.recorderTabId as number, { active: true });
      throw new Error('A recording is already in progress.');
    }
    await resetRecordingState();
  }

  settingsSnapshot = await readSettings();
  if (!settingsSnapshot.token) throw new Error('Sign in to Spool before recording.');

  const target = await resolveTargetTab(tabId);
  if (options.mode === 'tab') {
    if (!target?.id) throw new Error('Open the tab you want to record, then start again.');
    if (!CAPTURABLE_URL.test(target.url ?? '')) {
      throw new Error('Tab recording works on regular web pages. Switch to a website or use Screen mode.');
    }
  }

  const bootstrap: RecorderBootstrap = { options, originTabId: target?.id ?? null, tabStreamId: null };
  await chrome.storage.session.set({ [BOOTSTRAP_KEY]: bootstrap });

  await writeRecordingState({
    ...IDLE_STATE,
    phase: 'preparing',
    mode: options.mode,
    targetTabId: target?.id ?? null,
    micEnabled: options.micEnabled,
    cameraBubble: options.mode !== 'camera' && options.cameraBubble,
    cameraId: options.cameraId,
  });

  try {
    const recorderTab = await chrome.tabs.create({
      url: chrome.runtime.getURL('recorder.html'),
      pinned: true,
      index: 0,
      active: options.mode !== 'tab',
      windowId: target?.windowId,
    });
    const latest = await readRecordingState();
    if (latest.phase === 'preparing' && latest.recorderTabId === null) {
      await writeRecordingState({ ...latest, recorderTabId: recorderTab.id ?? null });
    }
  } catch (error) {
    await chrome.storage.session.remove(BOOTSTRAP_KEY);
    await resetRecordingState();
    throw error;
  }

  if (target?.id !== undefined && options.mode !== 'camera') await ensureContentScript(target.id);
}

async function consumeBootstrap(recorderTabId: number | undefined): Promise<RecorderBootstrap> {
  const stored = await chrome.storage.session.get(BOOTSTRAP_KEY);
  const bootstrap = stored[BOOTSTRAP_KEY] as RecorderBootstrap | undefined;
  if (!bootstrap) throw new Error('This recorder tab has no pending recording. Start a new one from the Spool popup.');
  await chrome.storage.session.remove(BOOTSTRAP_KEY);

  const state = await readRecordingState();
  if (recorderTabId !== undefined && state.recorderTabId !== recorderTabId) {
    await writeRecordingState({ ...state, recorderTabId });
  }
  if (bootstrap.options.mode === 'tab') {
    if (bootstrap.originTabId === null) throw new Error('The tab to record is no longer available.');
    // Stream ids expire within seconds, so they are minted only once the recorder is ready to consume them.
    return { ...bootstrap, tabStreamId: await getTabStreamId(bootstrap.originTabId) };
  }
  return bootstrap;
}

async function focusRecorder(): Promise<void> {
  const state = await readRecordingState();
  if (state.recorderTabId === null) throw new Error('No recording is in progress.');
  const tab = await chrome.tabs.update(state.recorderTabId, { active: true });
  if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
}

async function abandonRecording(state: RecordingState): Promise<void> {
  await resetRecordingState();
  if (!state.videoId) return;
  try {
    settingsSnapshot = await readSettings();
    if (settingsSnapshot.token) await api.abortUpload(state.videoId);
  } catch {
    // The server garbage-collects stale multipart uploads, so a failed abort is harmless.
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isExtensionMessage(message)) return false;
  switch (message.type) {
    case 'spool:start':
      startRecording(message.options, message.tabId).then(
        () => sendResponse(ok(undefined)),
        (error: unknown) => sendResponse(fail(error)),
      );
      return true;
    case 'spool:recorder-init':
      consumeBootstrap(sender.tab?.id).then(
        (bootstrap) => sendResponse(ok(bootstrap)),
        (error: unknown) => sendResponse(fail(error)),
      );
      return true;
    case 'spool:whoami':
      sendResponse(ok({ tabId: sender.tab?.id ?? null }));
      return false;
    case 'spool:focus-recorder':
      focusRecorder().then(
        () => sendResponse(ok(undefined)),
        (error: unknown) => sendResponse(fail(error)),
      );
      return true;
    case 'spool:open':
      chrome.tabs.create({ url: message.url, active: true }).then(
        () => sendResponse(ok(undefined)),
        (error: unknown) => sendResponse(fail(error)),
      );
      return true;
    default:
      // Commands and click events are handled by the recorder page.
      return false;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void readRecordingState().then((state) => {
    if (state.phase !== 'idle' && state.recorderTabId === tabId) return abandonRecording(state);
    return undefined;
  });
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void readRecordingState().then((state) => {
    if (!isActive(state) || state.mode === 'tab' || tabId === state.recorderTabId) return;
    return ensureContentScript(tabId);
  });
});

chrome.commands.onCommand.addListener((command, tab) => {
  void (async () => {
    const state = await readRecordingState();
    if (command === 'toggle-pause') {
      if (state.phase === 'recording' || state.phase === 'paused') {
        await chrome.runtime.sendMessage({ type: 'spool:command', command: 'toggle-pause' }).catch(() => undefined);
      }
      return;
    }
    if (command !== 'toggle-recording') return;
    if (state.phase === 'recording' || state.phase === 'paused') {
      await chrome.runtime.sendMessage({ type: 'spool:command', command: 'stop' }).catch(() => undefined);
      return;
    }
    if (isActive(state)) return;
    const settings = await readSettings();
    if (!settings.token) {
      await chrome.action.openPopup().catch(() => undefined);
      return;
    }
    const { prefs } = settings;
    try {
      await startRecording(
        { mode: prefs.mode, micEnabled: prefs.micEnabled, micId: prefs.micId, cameraBubble: prefs.cameraBubble, cameraId: prefs.cameraId },
        tab?.id ?? null,
      );
    } catch {
      await chrome.action.openPopup().catch(() => undefined);
    }
  })();
});

function paintBadge(state: RecordingState): void {
  const label: Record<RecordingState['phase'], string> = {
    idle: '',
    preparing: '•••',
    countdown: '•••',
    recording: 'REC',
    paused: '❚❚',
    finalizing: '↑',
    error: '!',
  };
  const color = state.phase === 'recording' ? '#FF3B4E' : state.phase === 'error' ? '#FF5C6C' : '#30353E';
  void chrome.action.setBadgeText({ text: label[state.phase] });
  void chrome.action.setBadgeBackgroundColor({ color });
  void chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
}

subscribeRecordingState(paintBadge);

// A restarted browser or a crashed recorder can leave stale state behind; reconcile on every wake-up.
void readRecordingState().then(async (state) => {
  const stalePreparing = state.phase === 'preparing' && Date.now() - state.updatedAt > 30_000;
  if (isActive(state) && !(await tabExists(state.recorderTabId)) && (state.phase !== 'preparing' || stalePreparing)) {
    await abandonRecording(state);
    paintBadge({ ...IDLE_STATE });
    return;
  }
  paintBadge(state);
});
