# Spool

Spool is an asynchronous video messaging platform: record a screen, window, or camera, upload it, and share a link whose viewer can follow the transcript, chapters, and a timestamped Q&A.

The repo is an npm workspace with five packages.

| Package | Role |
| --- | --- |
| `shared` | Types, the API client, and the streaming multipart uploader |
| `server` | Express API, SQLite, local or S3 storage, FFmpeg pipeline, transcription and summaries |
| `client` | React web app |
| `extension` | Chrome MV3 recorder (screen, tab, camera) |
| `desktop` | Tauri desktop recorder with a floating control bar |

## Requirements

- Node.js 20.10 or newer
- FFmpeg and FFprobe on `PATH`
- Rust (stable) and a WebKitGTK 4.1 / GTK 3 toolchain to build the desktop app on Linux
- Chrome, to load the extension

## Setup

```bash
npm install
cp server/.env.example server/.env
npm run dev:server
npm run dev:client
```

The API listens on `http://localhost:4000`. The web app listens on `http://localhost:5173`. Sign up in the web app, then record from the browser, the extension, or the desktop app. A finished recording opens `${CLIENT_URL}/s/<shareId>`.

`server/.env.example` lists every setting. `JWT_SECRET` must be a long random string in production. `STORAGE_DRIVER=local` keeps media on disk and is enough for development. Set `STORAGE_DRIVER=s3` and the `S3_*` / AWS variables to use S3, R2, or MinIO.

S3-compatible buckets must expose the `ETag` response header to the browser. Without it, multipart completion fails:

```json
{ "AllowedHeaders": ["*"], "ExposeHeaders": ["ETag"], "AllowedMethods": ["PUT", "GET", "HEAD"], "AllowedOrigins": ["http://localhost:5173"] }
```

The server also allows `tauri://localhost`, `http://tauri.localhost`, `https://tauri.localhost`, and any `chrome-extension://` origin.

Leave `TRANSCRIPTION_PROVIDER` and `LLM_PROVIDER` empty to auto-detect `OPENAI_API_KEY`, `DEEPGRAM_API_KEY`, or `GEMINI_API_KEY`. With no key, videos still transcode and play; transcripts and summaries stay unavailable.

## Chrome extension

```bash
npm run build -w @spool/extension
```

Load `extension/dist` as an unpacked extension. The popup signs in against the API URL (default `http://localhost:4000`), then records a screen, a browser tab, or the camera. System and microphone audio are mixed in the recorder tab. The popup can pause, mute, restart, and discard. When the upload completes, the watch page opens and the recorder tab closes.

`Alt+Shift+S` opens the popup, `Alt+Shift+R` toggles recording, and `Alt+Shift+P` pauses.

## Desktop app

```bash
npm run dev:desktop
```

`npm run dev:desktop` starts the Vite dev server on `127.0.0.1:1420` and the Tauri shell. Sign in with the same API account. Pick a display, a window, or drag an area. Thumbnails come from a native capture. The main window hides while recording so it is not in the video.

The floating bar pauses, stops, mutes the microphone and system audio, draws on a transparent overlay, restarts, and discards. Drawing and the camera bubble are not content-protected, so they appear in the capture. The camera bubble can be resized and dragged. Click-through for the bubble is the camera button on the bar.

Capture is ffmpeg writing MPEG-TS segments. Pause ends the encoder process and resume starts a new segment; the bytes are concatenated and the server transcodes them to MP4. Live mute sends ffmpeg's terminal filter command (`cvolume@mic -1 volume 0`) through a PTY. A pipe cannot do that.

Microphone and system-audio device lists are honest:

- Linux uses PulseAudio / PipeWire sources. Monitor sources are system audio. If Pulse is not running, both lists are empty and the UI says so.
- macOS uses AVFoundation. System audio is offered only when a loopback device such as BlackHole, Loopback, or Soundflower is installed.
- Windows uses DirectShow for microphones and WASAPI loopback for system audio. Hardware encoders are used when ffmpeg lists them; otherwise libx264.

Clicks during the take (except while drawing) are stored and become zoom chapters. The default length limit is `MAX_RECORDING_SECONDS` (420). The bar stops the take when the limit is reached.

## Checks

```bash
npm run typecheck
npm run build -w @spool/server
npm run build -w @spool/client
npm run build -w @spool/extension
npm run build -w @spool/desktop
cargo test --manifest-path desktop/src-tauri/Cargo.toml
```
