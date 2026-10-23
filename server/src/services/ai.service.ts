import { formatTimestamp, type ChatMessage, type Transcript, type VideoSummary } from '@spool/shared';
import { z } from 'zod';
import { env } from '../config/env.js';
import { getLlmClient } from './openai-client.js';

export function llmAvailable(): boolean {
  return env.ai.llmProvider !== null;
}

export function embeddingsAvailable(): boolean {
  return env.ai.llmProvider !== null;
}

const summarySchema = z.object({
  suggestedTitle: z.string().default(''),
  tldr: z.string().default(''),
  takeaways: z.array(z.string()).default([]),
  topics: z.array(z.string()).default([]),
  actionItems: z
    .array(
      z.object({
        text: z.string(),
        timestamp: z.union([z.string(), z.number(), z.null()]).optional(),
        owner: z.string().nullable().optional(),
      }),
    )
    .default([]),
  chapters: z
    .array(z.object({ title: z.string(), start: z.union([z.string(), z.number()]), summary: z.string().default('') }))
    .default([]),
});

function toSeconds(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = value.replace(/[[\]\s]/g, '');
  if (/^\d+(\.\d+)?$/.test(cleaned)) return Number(cleaned);
  const parts = cleaned.split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return null;
  return parts.reduce((acc, part) => acc * 60 + part, 0);
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('The model did not return JSON');
  return JSON.parse(candidate.slice(start, end + 1));
}

export function transcriptForPrompt(
  transcript: Transcript,
  maxChars: number,
  mapTime: (source: number) => number | null = (t) => t,
): string {
  const lines: string[] = [];
  let total = 0;
  for (const segment of transcript.segments) {
    const time = mapTime(segment.start);
    if (time === null) continue;
    const line = `[${formatTimestamp(time)}] ${segment.text}`;
    total += line.length + 1;
    if (total > maxChars) {
      lines.push('[transcript truncated]');
      break;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/** Generates TL;DR, takeaways, action items and chapters. Timestamps are returned in source seconds. */
export async function summarize(transcript: Transcript, duration: number, title: string): Promise<VideoSummary> {
  const client = getLlmClient();
  const body = transcriptForPrompt(transcript, 120_000);
  const completion = await client.chat.completions.create({
    model: env.ai.llmModel,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: [
          'You are Spool, an assistant that turns async video recordings into crisp, skimmable notes.',
          'Respond with a single JSON object using exactly these keys:',
          '{"suggestedTitle": string (max 70 chars, specific, no quotes or emoji),',
          ' "tldr": string (2-3 sentences),',
          ' "takeaways": string[] (3-6 concise bullets),',
          ' "topics": string[] (1-5 short topic keywords),',
          ' "actionItems": {"text": string, "timestamp": "mm:ss" | null, "owner": string | null}[] (only real follow-ups; [] if none),',
          ' "chapters": {"title": string (max 6 words), "start": "mm:ss", "summary": string (1 sentence)}[]}',
          'Chapters must be chronological, the first starts at 00:00, and they should mark genuine topic shifts',
          `(aim for one chapter every 45-120 seconds; the video is ${formatTimestamp(duration)} long).`,
          'Only use timestamps that appear in the transcript. Write in the transcript language.',
        ].join('\n'),
      },
      { role: 'user', content: `Current title: ${title}\n\nTranscript:\n${body}` },
    ],
  });
  const content = completion.choices[0]?.message?.content ?? '';
  const parsed = summarySchema.parse(extractJson(content));
  const clampTime = (t: number | null) => (t === null ? null : Math.max(0, Math.min(duration, t)));
  const chapters = parsed.chapters
    .map((c) => ({ title: c.title.trim(), start: clampTime(toSeconds(c.start)) ?? 0, summary: c.summary.trim() }))
    .filter((c) => c.title.length > 0)
    .sort((a, b) => a.start - b.start)
    .filter((c, i, all) => i === 0 || c.start - (all[i - 1] as { start: number }).start >= 5);
  if (chapters[0]) chapters[0].start = 0;
  return {
    suggestedTitle: parsed.suggestedTitle.trim().replace(/^["']|["']$/g, '').slice(0, 90),
    tldr: parsed.tldr.trim(),
    takeaways: parsed.takeaways.map((t) => t.trim()).filter(Boolean).slice(0, 8),
    topics: parsed.topics.map((t) => t.trim()).filter(Boolean).slice(0, 6),
    actionItems: parsed.actionItems.slice(0, 12).map((item) => ({
      text: item.text.trim(),
      timestamp: clampTime(toSeconds(item.timestamp ?? null)),
      owner: item.owner?.trim() || null,
    })),
    chapters,
  };
}

export async function embed(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const client = getLlmClient();
  const vectors: Float32Array[] = [];
  const batchSize = env.ai.llmProvider === 'gemini' ? 20 : 96;
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map((t) => t.slice(0, 8000));
    const response = await client.embeddings.create({ model: env.ai.embeddingModel, input: batch });
    const ordered = [...response.data].sort((a, b) => a.index - b.index);
    for (const item of ordered) vectors.push(normalizeVector(Float32Array.from(item.embedding)));
  }
  return vectors;
}

function normalizeVector(vector: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < vector.length; i++) norm += (vector[i] as number) ** 2;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < vector.length; i++) vector[i] = (vector[i] as number) / norm;
  return vector;
}

/** Cosine similarity for pre-normalised vectors. */
export function similarity(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < length; i++) dot += (a[i] as number) * (b[i] as number);
  return dot;
}

export function vectorToBuffer(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

export function bufferToVector(buffer: Buffer): Float32Array {
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return new Float32Array(copy.buffer);
}

export interface AnswerContext {
  title: string;
  durationLabel: string;
  summary: VideoSummary | null;
  transcriptContext: string;
  contextMode: 'full' | 'retrieved';
  history: ChatMessage[];
  question: string;
}

/** Streams a grounded answer. Every claim is cited with `[mm:ss]` markers on the viewer's (edited) timeline. */
export async function* answerStream(context: AnswerContext, signal: AbortSignal): AsyncGenerator<string> {
  const client = getLlmClient();
  const system = [
    'You are "Ask Spool", an assistant that answers questions about a single recorded video.',
    'Ground every answer ONLY in the transcript excerpts provided. If the video does not cover the question, say so briefly.',
    'Cite the moments you rely on with timestamps in square brackets exactly like [02:14] (or [1:02:14] for long videos),',
    'using only timestamps that appear in the excerpts. Place citations right after the sentence they support.',
    'Keep answers concise: prefer 1-4 short paragraphs or a tight bullet list. Use Markdown bold for key terms sparingly.',
    `Video title: ${context.title}. Length: ${context.durationLabel}.`,
    context.summary ? `Video summary: ${context.summary.tldr}` : '',
    context.contextMode === 'retrieved'
      ? 'The excerpts below are the most relevant portions retrieved from a longer transcript.'
      : 'The excerpts below are the full transcript.',
    `Transcript:\n${context.transcriptContext}`,
  ]
    .filter(Boolean)
    .join('\n');

  const stream = await client.chat.completions.create(
    {
      model: env.ai.llmModel,
      temperature: 0.2,
      stream: true,
      messages: [
        { role: 'system', content: system },
        ...context.history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: context.question },
      ],
    },
    { signal },
  );
  for await (const part of stream) {
    const delta = part.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}
