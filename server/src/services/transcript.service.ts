import fs from 'node:fs';
import fsp from 'node:fs/promises';
import type { Transcript, TranscriptSegment, WordTimestamp } from '@spool/shared';
import { env } from '../config/env.js';
import type { AudioChunk } from './ffmpeg.service.js';
import { getWhisperClient } from './openai-client.js';

export function transcriptionAvailable(): boolean {
  return env.ai.transcriptionProvider !== null;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

interface WhisperSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

interface WhisperVerbose {
  language?: string;
  segments?: WhisperSegment[];
  words?: WhisperWord[];
}

async function transcribeWithWhisper(chunks: AudioChunk[]): Promise<Transcript> {
  const client = getWhisperClient();
  const segments: TranscriptSegment[] = [];
  let language = 'en';
  for (const chunk of chunks) {
    const result = (await client.audio.transcriptions.create({
      file: fs.createReadStream(chunk.path),
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['word', 'segment'],
    })) as unknown as WhisperVerbose;
    if (result.language) language = result.language;
    const words = (result.words ?? []).map((w) => ({
      word: w.word.trim(),
      start: round(w.start + chunk.offset),
      end: round(w.end + chunk.offset),
    }));
    let wordIndex = 0;
    for (const segment of result.segments ?? []) {
      const start = round(segment.start + chunk.offset);
      const end = round(segment.end + chunk.offset);
      const segmentWords: WordTimestamp[] = [];
      while (wordIndex < words.length && (words[wordIndex] as WordTimestamp).start < end + 0.05) {
        segmentWords.push(words[wordIndex] as WordTimestamp);
        wordIndex++;
      }
      const text = segment.text.trim();
      if (!text) continue;
      segments.push({ id: segments.length, start, end, text, words: segmentWords });
    }
    const last = segments[segments.length - 1];
    if (last && wordIndex < words.length) last.words.push(...words.slice(wordIndex));
  }
  return { language: normalizeLanguage(language), provider: 'openai-whisper', segments };
}

interface DeepgramWord {
  word: string;
  punctuated_word?: string;
  start: number;
  end: number;
  confidence: number;
}

interface DeepgramResponse {
  results?: {
    channels?: { detected_language?: string; alternatives?: { transcript: string; words?: DeepgramWord[] }[] }[];
    utterances?: { start: number; end: number; transcript: string; words?: DeepgramWord[] }[];
  };
}

async function transcribeWithDeepgram(chunks: AudioChunk[]): Promise<Transcript> {
  const segments: TranscriptSegment[] = [];
  let language = 'en';
  const params = new URLSearchParams({
    model: 'nova-2',
    smart_format: 'true',
    punctuate: 'true',
    utterances: 'true',
    utt_split: '0.9',
    detect_language: 'true',
  });
  for (const chunk of chunks) {
    const body = await fsp.readFile(chunk.path);
    const response = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
      method: 'POST',
      headers: { Authorization: `Token ${env.ai.deepgramApiKey}`, 'Content-Type': 'audio/mpeg' },
      body,
    });
    if (!response.ok) throw new Error(`Deepgram request failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    const data = (await response.json()) as DeepgramResponse;
    const channel = data.results?.channels?.[0];
    if (channel?.detected_language) language = channel.detected_language;
    const toWord = (w: DeepgramWord): WordTimestamp => ({
      word: (w.punctuated_word ?? w.word).trim(),
      start: round(w.start + chunk.offset),
      end: round(w.end + chunk.offset),
      confidence: round(w.confidence),
    });
    const utterances = data.results?.utterances ?? [];
    if (utterances.length > 0) {
      for (const utterance of utterances) {
        const text = utterance.transcript.trim();
        if (!text) continue;
        segments.push({
          id: segments.length,
          start: round(utterance.start + chunk.offset),
          end: round(utterance.end + chunk.offset),
          text,
          words: (utterance.words ?? []).map(toWord),
        });
      }
    } else {
      const words = (channel?.alternatives?.[0]?.words ?? []).map(toWord);
      segments.push(...groupWordsIntoSegments(words, segments.length));
    }
  }
  return { language: normalizeLanguage(language), provider: 'deepgram-nova-2', segments };
}

function groupWordsIntoSegments(words: WordTimestamp[], startId: number): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let bucket: WordTimestamp[] = [];
  const flush = () => {
    if (bucket.length === 0) return;
    segments.push({
      id: startId + segments.length,
      start: (bucket[0] as WordTimestamp).start,
      end: (bucket[bucket.length - 1] as WordTimestamp).end,
      text: bucket.map((w) => w.word).join(' '),
      words: bucket,
    });
    bucket = [];
  };
  for (const word of words) {
    const previous = bucket[bucket.length - 1];
    if (previous && (word.start - previous.end > 0.9 || bucket.length >= 24 || /[.!?]$/.test(previous.word))) flush();
    bucket.push(word);
  }
  flush();
  return segments;
}

function normalizeLanguage(language: string): string {
  const map: Record<string, string> = { english: 'en', spanish: 'es', french: 'fr', german: 'de', hindi: 'hi', portuguese: 'pt' };
  const lower = language.toLowerCase();
  return map[lower] ?? lower.slice(0, 8);
}

export async function transcribe(chunks: AudioChunk[]): Promise<Transcript> {
  if (chunks.length === 0) return { language: 'en', provider: env.ai.transcriptionProvider ?? 'none', segments: [] };
  if (env.ai.transcriptionProvider === 'deepgram') return transcribeWithDeepgram(chunks);
  if (env.ai.transcriptionProvider === 'openai') return transcribeWithWhisper(chunks);
  throw new Error('No transcription provider configured');
}

export function transcriptText(transcript: Transcript): string {
  return transcript.segments.map((s) => s.text).join(' ');
}

export interface TranscriptChunk {
  start: number;
  end: number;
  text: string;
}

/** Groups segments into ~45 second retrieval windows used for embeddings and AI grounding. */
export function chunkTranscript(transcript: Transcript, targetSeconds = 45, maxChars = 1200): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = [];
  let current: TranscriptSegment[] = [];
  let chars = 0;
  const flush = () => {
    if (current.length === 0) return;
    chunks.push({
      start: (current[0] as TranscriptSegment).start,
      end: (current[current.length - 1] as TranscriptSegment).end,
      text: current.map((s) => s.text).join(' '),
    });
    current = [];
    chars = 0;
  };
  for (const segment of transcript.segments) {
    const first = current[0];
    if (first && (segment.end - first.start > targetSeconds || chars + segment.text.length > maxChars)) flush();
    current.push(segment);
    chars += segment.text.length + 1;
  }
  flush();
  return chunks;
}
