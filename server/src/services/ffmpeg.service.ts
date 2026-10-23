import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { keptRanges, ZOOM_RAMP_SECONDS, type EditConfig, type StoryboardMeta } from '@spool/shared';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export interface ProbeResult {
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  hasVideo: boolean;
  videoCodec: string | null;
}

export interface AudioChunk {
  path: string;
  offset: number;
}

interface RunOptions {
  timeoutMs?: number;
}

export class FfmpegError extends Error {
  constructor(message: string, readonly stderr: string) {
    super(message);
    this.name = 'FfmpegError';
  }
}

function run(binary: string, args: string[], options: RunOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000);
    });
    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGKILL');
        }, options.timeoutMs)
      : null;
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      reject(new FfmpegError(`Failed to start ${binary}: ${error.message}. Is FFmpeg installed and on PATH?`, ''));
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else {
        const tail = stderr.trim().split('\n').slice(-6).join('\n');
        reject(new FfmpegError(`${path.basename(binary)} exited with ${signal ?? code}: ${tail}`, stderr));
      }
    });
  });
}

const even = (value: number) => Math.max(2, Math.floor(value / 2) * 2);
const fixed = (value: number) => Number(value.toFixed(3)).toString();

interface FfprobeOutput {
  format?: { duration?: string };
  streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; duration?: string }[];
}

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await run(env.ffprobePath, [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,duration',
    '-of', 'json',
    file,
  ]);
  const data = JSON.parse(stdout) as FfprobeOutput;
  const video = data.streams?.find((s) => s.codec_type === 'video');
  const audio = data.streams?.find((s) => s.codec_type === 'audio');
  const durationCandidates = [data.format?.duration, video?.duration, audio?.duration]
    .map((d) => Number(d))
    .filter((d) => Number.isFinite(d) && d > 0);
  return {
    duration: durationCandidates[0] ?? 0,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    hasAudio: Boolean(audio),
    hasVideo: Boolean(video),
    videoCodec: video?.codec_name ?? null,
  };
}

/**
 * Converts any uploaded container (WebM/VP9 from MediaRecorder, MPEG-TS from the desktop
 * recorder, user files) into a streamable H.264/AAC MP4 with a constant 30 fps clock and a
 * guaranteed audio track, which keeps every downstream filter graph uniform.
 */
export async function normalize(input: string, output: string, source: ProbeResult): Promise<void> {
  const args = ['-hide_banner', '-y', '-fflags', '+genpts', '-i', input];
  if (!source.hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000');
  args.push(
    '-map', '0:v:0',
    '-map', source.hasAudio ? '0:a:0' : '1:a:0',
    '-vf', "scale='trunc(min(2560,iw)/2)*2':-2:flags=lanczos,fps=30,format=yuv420p",
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '22',
    '-profile:v', 'high',
    '-af', 'aresample=async=1:first_pts=0',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '48000',
    '-ac', '2',
    '-movflags', '+faststart',
  );
  if (!source.hasAudio) args.push('-shortest');
  args.push(output);
  await run(env.ffmpegPath, args);
}

export async function thumbnail(input: string, output: string, duration: number): Promise<void> {
  const at = Math.min(Math.max(duration * 0.1, 0), Math.max(duration - 0.1, 0), 3);
  await run(env.ffmpegPath, [
    '-hide_banner', '-y',
    '-ss', fixed(at),
    '-i', input,
    '-frames:v', '1',
    '-vf', 'scale=960:-2:flags=lanczos',
    '-q:v', '3',
    output,
  ]);
}

export async function storyboard(
  input: string,
  output: string,
  duration: number,
  width: number,
  height: number,
): Promise<Omit<StoryboardMeta, 'url'>> {
  const frames = Math.max(1, Math.min(60, Math.round(duration / 2)));
  const frameWidth = 192;
  const frameHeight = even(frameWidth * (height > 0 ? height / width : 9 / 16));
  const interval = duration / frames;
  await run(env.ffmpegPath, [
    '-hide_banner', '-y',
    '-i', input,
    '-vf', `fps=1/${fixed(Math.max(interval, 0.04))},scale=${frameWidth}:${frameHeight}:flags=lanczos,tile=${frames}x1`,
    '-frames:v', '1',
    '-q:v', '5',
    output,
  ]);
  return { frames, frameWidth, frameHeight, interval };
}

/** Extracts 16 kHz mono speech audio, split so each chunk stays well below the 25 MB Whisper limit. */
export async function extractAudio(input: string, outputDir: string, duration: number): Promise<AudioChunk[]> {
  await fsp.mkdir(outputDir, { recursive: true });
  const chunkSeconds = 1200;
  const chunks: AudioChunk[] = [];
  for (let offset = 0, index = 0; offset < Math.max(duration, 0.1); offset += chunkSeconds, index++) {
    const file = path.join(outputDir, `audio-${index}.mp3`);
    await run(env.ffmpegPath, [
      '-hide_banner', '-y',
      '-ss', fixed(offset),
      '-t', fixed(chunkSeconds),
      '-i', input,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-c:a', 'libmp3lame',
      '-b:a', '48k',
      file,
    ]);
    const stats = await fsp.stat(file);
    if (stats.size > 1024) chunks.push({ path: file, offset });
  }
  return chunks;
}

function zoomExpressions(edit: EditConfig): { z: string; x: string; y: string } | null {
  if (edit.zooms.length === 0) return null;
  const terms: string[] = [];
  let focusX = '0.5';
  let focusY = '0.5';
  for (const zoom of [...edit.zooms].reverse()) {
    const ramp = Math.min(ZOOM_RAMP_SECONDS, (zoom.end - zoom.start) / 2);
    const s = fixed(zoom.start);
    const e = fixed(zoom.end);
    const r = fixed(ramp);
    const progress = `clip(min((it-${s})/${r}\\,(${e}-it)/${r})\\,0\\,1)`;
    terms.push(`${fixed(zoom.scale - 1)}*(${progress})*(${progress})*(3-2*(${progress}))`);
    focusX = `if(between(it\\,${s}\\,${e})\\,${fixed(zoom.focus.x)}\\,${focusX})`;
    focusY = `if(between(it\\,${s}\\,${e})\\,${fixed(zoom.focus.y)}\\,${focusY})`;
  }
  return {
    z: `1+${terms.join('+')}`,
    x: `(iw-iw/zoom)*${focusX}`,
    y: `(ih-ih/zoom)*${focusY}`,
  };
}

/**
 * Bakes the edit decision list into a new MP4: blur boxes are composited first, then the
 * zoompan camera move (same smoothstep curve as the web player), then trimmed/cut ranges are
 * concatenated with their audio.
 */
export async function render(input: string, output: string, edit: EditConfig, meta: ProbeResult): Promise<void> {
  const ranges = keptRanges(edit);
  if (ranges.length === 0) throw new Error('The edit removes the entire video');
  const width = even(meta.width);
  const height = even(meta.height);
  const filters: string[] = [];
  let current = '0:v';
  let label = 0;
  const next = () => `v${label++}`;

  edit.blurs.forEach((blur) => {
    const bw = even(blur.rect.width * width);
    const bh = even(blur.rect.height * height);
    const bx = Math.min(width - bw, Math.max(0, Math.round(blur.rect.x * width)));
    const by = Math.min(height - bh, Math.max(0, Math.round(blur.rect.y * height)));
    const smallest = Math.min(bw, bh);
    const lumaRadius = Math.max(1, Math.min(Math.floor(smallest / 2) - 1, 4 + blur.intensity * 4));
    const chromaRadius = Math.max(1, Math.min(lumaRadius, Math.floor(smallest / 4) - 1));
    const power = Math.max(1, Math.ceil(blur.intensity / 3));
    const base = next();
    const crop = next();
    const blurred = next();
    const out = next();
    filters.push(`[${current}]split=2[${base}][${crop}]`);
    filters.push(
      `[${crop}]crop=${bw}:${bh}:${bx}:${by},boxblur=luma_radius=${lumaRadius}:luma_power=${power}:chroma_radius=${chromaRadius}:chroma_power=${power}[${blurred}]`,
    );
    filters.push(
      `[${base}][${blurred}]overlay=${bx}:${by}:enable='between(t\\,${fixed(blur.start)}\\,${fixed(blur.end)})'[${out}]`,
    );
    current = out;
  });

  const zoom = zoomExpressions(edit);
  if (zoom) {
    const out = next();
    filters.push(`[${current}]zoompan=z='${zoom.z}':x='${zoom.x}':y='${zoom.y}':d=1:s=${width}x${height}:fps=30[${out}]`);
    current = out;
  }

  const videoBranches = ranges.map(() => next());
  const audioBranches = ranges.map((_, i) => `a${i}`);
  filters.push(`[${current}]split=${ranges.length}${videoBranches.map((b) => `[${b}]`).join('')}`);
  filters.push(`[0:a]asplit=${ranges.length}${audioBranches.map((b) => `[${b}]`).join('')}`);
  const concatInputs: string[] = [];
  ranges.forEach((range, i) => {
    filters.push(`[${videoBranches[i]}]trim=start=${fixed(range.start)}:end=${fixed(range.end)},setpts=PTS-STARTPTS[tv${i}]`);
    filters.push(`[${audioBranches[i]}]atrim=start=${fixed(range.start)}:end=${fixed(range.end)},asetpts=PTS-STARTPTS[ta${i}]`);
    concatInputs.push(`[tv${i}][ta${i}]`);
  });
  filters.push(`${concatInputs.join('')}concat=n=${ranges.length}:v=1:a=1[vout][aout]`);

  logger.debug({ filters: filters.length }, 'rendering edit');
  await run(env.ffmpegPath, [
    '-hide_banner', '-y',
    '-i', input,
    '-filter_complex', filters.join(';'),
    '-map', '[vout]',
    '-map', '[aout]',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '21',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '160k',
    '-movflags', '+faststart',
    output,
  ]);
}

export async function checkFfmpeg(): Promise<string | null> {
  try {
    const { stdout } = await run(env.ffmpegPath, ['-hide_banner', '-version'], { timeoutMs: 5000 });
    return stdout.split('\n')[0] ?? 'ffmpeg';
  } catch {
    return null;
  }
}
