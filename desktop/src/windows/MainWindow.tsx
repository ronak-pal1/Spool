import { SpoolApi, formatRelativeTime, type VideoListItem } from '@spool/shared';
import { listen } from '@tauri-apps/api/event';
import { motion } from 'framer-motion';
import { MonitorSmartphone, RectangleHorizontal, RefreshCw, Video } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { errorMessage, inTauri, openExternal, recorder, useRecording, type AudioInventory, type SourceInfo } from '../lib/bridge';
import { currentSettings, updatePrefs, updateSettings, useSettings, type AreaRect } from '../lib/settings';
import { Button, Field, Logo, Segmented, Select, TextInput, Toggle } from '../ui';

export function MainWindow() {
  const settings = useSettings();
  const snapshot = useRecording();
  const [health, setHealth] = useState<'unknown' | 'ok' | 'down'>('unknown');
  const [webUrl, setWebUrl] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [audio, setAudio] = useState<AudioInventory | null>(null);
  const [videos, setVideos] = useState<VideoListItem[]>([]);
  const [level, setLevel] = useState(0);
  const meter = useRef<MediaStream | null>(null);

  const api = useMemo(
    () =>
      new SpoolApi({
        baseUrl: settings.apiUrl,
        getToken: () => currentSettings().token,
        getWorkspaceId: () => currentSettings().workspaceId,
        onUnauthorized: () => updateSettings({ token: null, user: null }),
      }),
    [settings.apiUrl],
  );

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      void api
        .health()
        .then((status) => {
          if (cancelled) return;
          setHealth('ok');
          setWebUrl(status.webUrl);
        })
        .catch(() => {
          if (!cancelled) setHealth('down');
        });
    };
    check();
    const timer = window.setInterval(check, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api]);

  useEffect(() => {
    if (!settings.token || !inTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen<AreaRect>('area-selected', (event) => {
      updatePrefs({ area: event.payload, mode: 'area' });
    }).then((stop) => {
      unlisten = stop;
    });
    return () => unlisten?.();
  }, [settings.token]);

  useEffect(() => {
    if (!audio) return;
    const patch: Partial<typeof settings.prefs> = {};
    if (settings.prefs.micEnabled && !settings.prefs.micDeviceId && audio.microphones[0]) patch.micDeviceId = audio.microphones[0].id;
    if (settings.prefs.systemEnabled && !settings.prefs.systemDeviceId && audio.system[0]) patch.systemDeviceId = audio.system[0].id;
    if (Object.keys(patch).length > 0) updatePrefs(patch);
  }, [audio, settings.prefs.micDeviceId, settings.prefs.micEnabled, settings.prefs.systemDeviceId, settings.prefs.systemEnabled]);

  useEffect(() => {
    if (!settings.token) return;
    void refreshLibrary(api, setVideos, setError);
    if (!inTauri()) return;
    void loadDevices(setSources, setAudio, setError);
  }, [api, settings.token, settings.workspaceId]);

  useEffect(() => {
    if (!settings.prefs.micEnabled || snapshot.phase !== 'idle') {
      stopMeter(meter.current);
      meter.current = null;
      setLevel(0);
      return;
    }
    let cancelled = false;
    let audioContext: AudioContext | null = null;
    void navigator.mediaDevices
      ?.getUserMedia({ audio: settings.prefs.micDeviceId ? { deviceId: { exact: settings.prefs.micDeviceId } } : true, video: false })
      .then((stream) => {
        if (cancelled) {
          stopMeter(stream);
          return;
        }
        meter.current = stream;
        audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        audioContext.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const tick = () => {
          if (cancelled) return;
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (const value of data) {
            const sample = (value - 128) / 128;
            sum += sample * sample;
          }
          setLevel(Math.min(1, Math.sqrt(sum / data.length) * 3));
          requestAnimationFrame(tick);
        };
        tick();
      })
      .catch(() => setLevel(0));
    return () => {
      cancelled = true;
      void audioContext?.close();
      stopMeter(meter.current);
      meter.current = null;
    };
  }, [settings.prefs.micEnabled, settings.prefs.micDeviceId, snapshot.phase]);

  const monitors = sources.filter((source) => source.kind === 'monitor');
  const windows = sources.filter((source) => source.kind === 'window');
  const visible = settings.prefs.mode === 'window' ? windows : monitors;
  const selected = sources.find((source) => source.id === settings.prefs.sourceId) ?? null;

  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response =
        authMode === 'register'
          ? await api.register({ name: name.trim(), email: email.trim(), password })
          : await api.login({ email: email.trim(), password });
      updateSettings({
        token: response.token,
        user: response.user,
        workspaces: response.workspaces,
        workspaceId: response.workspaces[0]?.id ?? null,
      });
      setPassword('');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function record() {
    if (!settings.token || !selected) return;
    setError(null);
    stopMeter(meter.current);
    meter.current = null;
    try {
      await recorder.start({
        mode: settings.prefs.mode,
        sourceId: selected.id,
        area: settings.prefs.mode === 'area' ? settings.prefs.area : null,
        micEnabled: settings.prefs.micEnabled,
        micDeviceId: settings.prefs.micDeviceId,
        systemEnabled: settings.prefs.systemEnabled && Boolean(audio?.systemAvailable),
        systemDeviceId: settings.prefs.systemDeviceId,
        cameraEnabled: settings.prefs.cameraEnabled,
        cameraDeviceId: settings.prefs.cameraDeviceId,
        apiUrl: settings.apiUrl,
        token: settings.token,
        workspaceId: settings.workspaceId,
        title: selected.name,
      });
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  return (
    <div className="flex h-full flex-col bg-ink-900 bg-accent-radial">
      <header className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-3">
        <Logo />
        <div className="mr-auto">
          <p className="text-sm font-semibold tracking-tight">Spool</p>
          <p className="text-xs text-white/40">Desktop recorder</p>
        </div>
        <span className={`h-2 w-2 rounded-full ${health === 'ok' ? 'bg-accent' : health === 'down' ? 'bg-danger' : 'bg-white/30'}`} />
        <TextInput
          aria-label="API URL"
          value={settings.apiUrl}
          onChange={(event) => updateSettings({ apiUrl: event.target.value })}
          className="w-64"
        />
        {settings.user ? (
          <>
            {settings.workspaces.length > 1 ? (
              <Select value={settings.workspaceId ?? ''} onChange={(event) => updateSettings({ workspaceId: event.target.value })}>
                {settings.workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </Select>
            ) : null}
            <span className="text-sm text-white/70">{settings.user.name}</span>
            <Button onClick={() => updateSettings({ token: null, user: null })}>Sign out</Button>
          </>
        ) : null}
      </header>

      {settings.token && settings.user ? (
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-80 shrink-0 flex-col border-r border-white/[0.06]">
            <div className="flex items-center justify-between px-4 py-3">
              <h2 className="text-sm font-medium">Recent</h2>
              <button type="button" aria-label="Refresh" className="text-white/40 hover:text-white" onClick={() => void refreshLibrary(api, setVideos, setError)}>
                <RefreshCw size={14} />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-auto px-2 pb-4">
              {videos.length === 0 ? <p className="px-2 py-6 text-sm text-white/40">Recordings you upload will show up here.</p> : null}
              {videos.map((video) => (
                <button
                  key={video.id}
                  type="button"
                  className="flex w-full gap-3 rounded-xl px-2 py-2 text-left hover:bg-white/[0.04]"
                  onClick={() => {
                    if (webUrl) void openExternal(`${webUrl}/s/${video.shareId}`);
                  }}
                >
                  {video.thumbnailUrl ? (
                    <img src={video.thumbnailUrl} alt="" className="h-12 w-20 rounded-lg object-cover" />
                  ) : (
                    <span className="flex h-12 w-20 items-center justify-center rounded-lg bg-white/5 text-white/30">
                      <Video size={16} />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{video.title}</span>
                    <span className="text-xs text-white/40">
                      {video.status} · {formatRelativeTime(video.createdAt)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <main className="min-w-0 flex-1 overflow-auto p-6">
            <div className="mx-auto flex max-w-3xl flex-col gap-5">
              {snapshot.phase === 'error' ? (
                <div className="surface flex items-center justify-between gap-3 p-4">
                  <p className="text-sm text-danger">{snapshot.error ?? 'The recording failed.'}</p>
                  <div className="flex gap-2">
                    {snapshot.canRetry ? (
                      <Button variant="primary" onClick={() => void recorder.retry().catch((caught) => setError(errorMessage(caught)))}>
                        Retry upload
                      </Button>
                    ) : null}
                    <Button onClick={() => void recorder.discard()}>Dismiss</Button>
                  </div>
                </div>
              ) : null}
              {error ? <p className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p> : null}

              <Segmented
                value={settings.prefs.mode}
                onChange={(mode) => updatePrefs({ mode, sourceId: null, area: mode === 'area' ? settings.prefs.area : null })}
                options={[
                  { id: 'screen', label: 'Screen' },
                  { id: 'window', label: 'Window' },
                  { id: 'area', label: 'Area' },
                ]}
              />

              <div className="grid grid-cols-2 gap-3">
                {visible.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => updatePrefs({ sourceId: source.id, area: null })}
                    className={`overflow-hidden rounded-2xl border text-left transition ${settings.prefs.sourceId === source.id ? 'border-accent shadow-glow' : 'border-white/10 hover:border-white/20'}`}
                  >
                    {source.thumbnail ? (
                      <img src={source.thumbnail} alt="" className="aspect-video w-full object-cover" />
                    ) : (
                      <span className="flex aspect-video items-center justify-center bg-black/40 text-white/30">
                        {source.kind === 'window' ? <RectangleHorizontal /> : <MonitorSmartphone />}
                      </span>
                    )}
                    <span className="block truncate px-3 py-2 text-sm">{source.name}</span>
                  </button>
                ))}
                {visible.length === 0 ? <p className="col-span-2 text-sm text-white/40">No {settings.prefs.mode === 'window' ? 'windows' : 'displays'} yet. Refresh after the desktop session is ready.</p> : null}
              </div>
              <div className="flex gap-2">
                <Button onClick={() => void loadDevices(setSources, setAudio, setError)}>Refresh sources</Button>
                {settings.prefs.mode === 'area' && selected ? (
                  <Button variant="primary" onClick={() => void recorder.prepareArea(selected.id).catch((caught) => setError(errorMessage(caught)))}>
                    Drag to select
                  </Button>
                ) : null}
                {settings.prefs.area ? (
                  <span className="self-center font-mono text-xs text-accent">
                    {Math.round(settings.prefs.area.width)}×{Math.round(settings.prefs.area.height)}
                  </span>
                ) : null}
              </div>

              <section className="surface space-y-4 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">Microphone</p>
                    <div className="mt-2 h-1.5 w-36 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full bg-accent" style={{ width: `${Math.round(level * 100)}%` }} />
                    </div>
                  </div>
                  <Toggle checked={settings.prefs.micEnabled} label="Microphone" onChange={(micEnabled) => updatePrefs({ micEnabled })} />
                </div>
                <Select
                  value={settings.prefs.micDeviceId ?? ''}
                  onChange={(event) => updatePrefs({ micDeviceId: event.target.value || null })}
                  disabled={!settings.prefs.micEnabled}
                >
                  <option value="">Default device</option>
                  {audio?.microphones.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.name}
                    </option>
                  ))}
                </Select>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">System audio</p>
                    {audio?.note ? <p className="mt-1 max-w-md text-xs text-white/45">{audio.note}</p> : null}
                  </div>
                  <Toggle
                    checked={settings.prefs.systemEnabled && Boolean(audio?.systemAvailable)}
                    label="System audio"
                    onChange={(systemEnabled) => updatePrefs({ systemEnabled })}
                  />
                </div>
                <Select
                  value={settings.prefs.systemDeviceId ?? ''}
                  onChange={(event) => updatePrefs({ systemDeviceId: event.target.value || null })}
                  disabled={!settings.prefs.systemEnabled || !audio?.systemAvailable}
                >
                  <option value="">Choose a loopback device</option>
                  {audio?.system.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.name}
                    </option>
                  ))}
                </Select>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Camera bubble</p>
                  <Toggle
                    checked={settings.prefs.cameraEnabled}
                    label="Camera bubble"
                    onChange={(cameraEnabled) => {
                      void enableCamera(cameraEnabled).catch((caught) => setError(errorMessage(caught)));
                    }}
                  />
                </div>
                <div className="flex gap-2">
                  <Select
                    value={settings.prefs.cameraDeviceId ?? ''}
                    onChange={(event) => updatePrefs({ cameraDeviceId: event.target.value || null })}
                    disabled={!settings.prefs.cameraEnabled}
                  >
                    <option value="">Default camera</option>
                    <CameraOptions />
                  </Select>
                  <Select
                    value={settings.prefs.cameraSize}
                    onChange={(event) => {
                      const cameraSize = event.target.value as typeof settings.prefs.cameraSize;
                      updatePrefs({ cameraSize });
                      if (inTauri()) void recorder.setCameraSize(cameraSize);
                    }}
                  >
                    <option value="s">S</option>
                    <option value="m">M</option>
                    <option value="l">L</option>
                    <option value="full">Full</option>
                  </Select>
                </div>
              </section>

              <div className="flex items-center gap-4">
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.96 }}
                  disabled={!selected || (settings.prefs.mode === 'area' && !settings.prefs.area) || snapshot.phase !== 'idle'}
                  onClick={() => void record()}
                  className="relative flex h-16 w-16 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-glow disabled:opacity-40"
                >
                  <span className="absolute inset-0 animate-pulse-ring rounded-full bg-accent/30" />
                  <span className="relative h-5 w-5 rounded-full bg-danger" />
                </motion.button>
                <div>
                  <p className="text-sm font-medium">{selected ? selected.name : 'Choose what to record'}</p>
                  <p className="text-xs text-white/40">
                    {webUrl ? `Opens in ${webUrl} when the upload finishes.` : 'Connect the API to share the video.'} Limit {Math.round(snapshot.limitMs / 60000)} min.
                  </p>
                </div>
              </div>
            </div>
          </main>
        </div>
      ) : (
        <form onSubmit={(event) => void submitAuth(event)} className="mx-auto my-auto flex w-full max-w-sm flex-col gap-3 p-6">
          <Logo className="h-12 w-12" />
          <h1 className="text-2xl font-semibold tracking-tight">{authMode === 'login' ? 'Welcome back' : 'Create your workspace'}</h1>
          {authMode === 'register' ? <Field label="Name"><TextInput value={name} onChange={(event) => setName(event.target.value)} required /></Field> : null}
          <Field label="Email"><TextInput type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></Field>
          <Field label="Password"><TextInput type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={authMode === 'register' ? 8 : 1} /></Field>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <Button variant="primary" type="submit" disabled={busy || health === 'down'}>
            {busy ? 'Working…' : authMode === 'login' ? 'Sign in' : 'Create account'}
          </Button>
          <button type="button" className="text-sm text-white/50 hover:text-white" onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>
            {authMode === 'login' ? 'Need an account?' : 'Already have an account?'}
          </button>
        </form>
      )}
    </div>
  );
}

function CameraOptions() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    void navigator.mediaDevices?.enumerateDevices().then((list) => setDevices(list.filter((device) => device.kind === 'videoinput'))).catch(() => setDevices([]));
  }, []);
  return (
    <>
      {devices.map((device) => (
        <option key={device.deviceId} value={device.deviceId}>
          {device.label || 'Camera'}
        </option>
      ))}
    </>
  );
}

async function enableCamera(cameraEnabled: boolean) {
  if (cameraEnabled) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      stream.getTracks().forEach((track) => track.stop());
    } catch (caught) {
      updatePrefs({ cameraEnabled: false });
      throw caught;
    }
  }
  updatePrefs({ cameraEnabled });
}

async function refreshLibrary(api: SpoolApi, setVideos: (videos: VideoListItem[]) => void, setError: (message: string | null) => void) {
  try {
    setVideos(await api.listVideos({ sort: 'newest' }));
  } catch (caught) {
    setError(errorMessage(caught));
  }
}

async function loadDevices(
  setSources: (sources: SourceInfo[]) => void,
  setAudio: (audio: AudioInventory) => void,
  setError: (message: string | null) => void,
) {
  try {
    const [sources, audio] = await Promise.all([recorder.listSources(), recorder.listAudio()]);
    setSources(sources);
    setAudio(audio);
    setError(null);
  } catch (caught) {
    setError(errorMessage(caught));
  }
}

function stopMeter(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}
