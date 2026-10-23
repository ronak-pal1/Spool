import {
  formatDurationLabel,
  formatTimestamp,
  isTimeKept,
  sourceToEdited,
  editedDuration,
  type ChatMessage,
  type EditConfig,
  type Transcript,
} from '@spool/shared';
import { db, nowIso } from '../db/index.js';
import { createId } from '../utils/ids.js';
import { bufferToVector, embed, embeddingsAvailable, similarity, transcriptForPrompt } from './ai.service.js';
import { editFor, getSummary, getTranscript, type VideoRow } from './video.service.js';

const FULL_CONTEXT_CHARS = 60_000;

interface ChunkRow {
  start_time: number;
  end_time: number;
  text: string;
  embedding: Buffer | null;
}

export function conversationKey(userId: string | undefined, viewerSession: string): string {
  return userId ? `u:${userId}` : `s:${viewerSession}`;
}

export function history(videoId: string, key: string): ChatMessage[] {
  const rows = db
    .prepare('SELECT id, role, content, created_at FROM chat_messages WHERE video_id = ? AND conversation_key = ? ORDER BY created_at ASC')
    .all(videoId, key) as { id: string; role: 'user' | 'assistant'; content: string; created_at: string }[];
  return rows.map((r) => ({ id: r.id, role: r.role, content: r.content, createdAt: r.created_at }));
}

export function clearHistory(videoId: string, key: string): void {
  db.prepare('DELETE FROM chat_messages WHERE video_id = ? AND conversation_key = ?').run(videoId, key);
}

export function saveMessage(videoId: string, key: string, role: 'user' | 'assistant', content: string): ChatMessage {
  const message: ChatMessage = { id: createId(), role, content, createdAt: nowIso() };
  db.prepare('INSERT INTO chat_messages (id, video_id, conversation_key, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    message.id,
    videoId,
    key,
    role,
    content,
    message.createdAt,
  );
  return message;
}

function mapper(edit: EditConfig) {
  return (source: number): number | null => (isTimeKept(edit, source + 0.05) ? sourceToEdited(edit, source) : null);
}

async function retrieveContext(row: VideoRow, transcript: Transcript, edit: EditConfig, question: string): Promise<string> {
  const chunks = db
    .prepare('SELECT start_time, end_time, text, embedding FROM transcript_chunks WHERE video_id = ? ORDER BY start_time')
    .all(row.id) as ChunkRow[];
  let ranked: ChunkRow[];
  if (embeddingsAvailable() && chunks.some((c) => c.embedding)) {
    const [queryVector] = await embed([question]);
    ranked = chunks
      .filter((c) => c.embedding)
      .map((c) => ({ c, score: queryVector ? similarity(queryVector, bufferToVector(c.embedding as Buffer)) : 0 }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.c);
  } else {
    const tokens = question.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 2);
    ranked = chunks
      .map((c) => ({ c, score: tokens.filter((t) => c.text.toLowerCase().includes(t)).length }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.c);
  }
  const selected = ranked.slice(0, 10).sort((a, b) => a.start_time - b.start_time);
  const map = mapper(edit);
  const blocks = selected.map((chunk) => {
    const segments = transcript.segments.filter((s) => s.start >= chunk.start_time - 0.01 && s.start <= chunk.end_time + 0.01);
    return segments
      .map((s) => {
        const time = map(s.start);
        return time === null ? null : `[${formatTimestamp(time)}] ${s.text}`;
      })
      .filter(Boolean)
      .join('\n');
  });
  return blocks.filter(Boolean).join('\n…\n');
}

export async function buildAnswerContext(row: VideoRow, question: string) {
  const transcript = getTranscript(row.id);
  if (!transcript || transcript.segments.length === 0) throw new Error('This video has no transcript yet');
  const edit = editFor(row);
  const map = mapper(edit);
  const full = transcriptForPrompt(transcript, FULL_CONTEXT_CHARS + 1, map);
  const truncated = full.endsWith('[transcript truncated]');
  const transcriptContext = truncated ? await retrieveContext(row, transcript, edit, question) : full;
  return {
    title: row.title,
    durationLabel: formatDurationLabel(editedDuration(edit)),
    summary: getSummary(row.id),
    transcriptContext: transcriptContext || full,
    contextMode: truncated ? ('retrieved' as const) : ('full' as const),
  };
}
