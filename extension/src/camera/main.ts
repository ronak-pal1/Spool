import { describeMediaError, openCamera, stopStream } from '@/lib/media';
import './camera.css';

const video = document.getElementById('video') as HTMLVideoElement;
const state = document.getElementById('state') as HTMLDivElement;
const message = document.getElementById('message') as HTMLSpanElement;

const params = new URLSearchParams(location.search);
const deviceId = params.get('deviceId');
let stream: MediaStream | null = null;

function show(kind: 'loading' | 'error' | 'live', text = ''): void {
  state.dataset.kind = kind;
  message.textContent = text;
}

async function start(): Promise<void> {
  show('loading');
  try {
    try {
      stream = await openCamera(deviceId, { width: 720, height: 720 });
    } catch (error) {
      // A remembered camera may have been unplugged; fall back to the default device.
      if (deviceId && (error as DOMException).name === 'OverconstrainedError') stream = await openCamera(null, { width: 720, height: 720 });
      else throw error;
    }
    video.srcObject = stream;
    await video.play().catch(() => undefined);
    stream.getVideoTracks()[0]?.addEventListener('ended', () => show('error', 'Camera disconnected'));
    show('live');
  } catch (error) {
    const name = (error as DOMException | undefined)?.name;
    show('error', name === 'NotAllowedError' ? 'Allow camera access in the Spool popup' : describeMediaError(error));
  }
}

window.addEventListener('pagehide', () => stopStream(stream));
void start();
