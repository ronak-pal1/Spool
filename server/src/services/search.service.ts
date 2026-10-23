import type { SearchMatch, SearchResult, TranscriptSegment } from '@spool/shared';
import { db, parseJson } from '../db/index.js';
import { logger } from '../utils/logger.js';
import { bufferToVector, embed, embeddingsAvailable, similarity } from './ai.service.js';
import { toFtsQuery, toListItems, type VideoRow } from './video.service.js';

interface FtsRow {
  video_id: string;
  rank: number;
  title_snip: string;
  summary_snip: string;
}

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);
}

function transcriptMatches(videoId: string, tokens: string[], limit = 3): SearchMatch[] {
  const row = db.prepare('SELECT segments FROM transcripts WHERE video_id = ?').get(videoId) as { segments: string } | undefined;
  if (!row || tokens.length === 0) return [];
  const segments = parseJson<TranscriptSegment[]>(row.segments, []);
  const scored = segments
    .map((segment) => {
      const text = segment.text.toLowerCase();
      const hits = tokens.filter((t) => text.includes(t)).length;
      return { segment, hits };
    })
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.segment.start - b.segment.start)
    .slice(0, limit);
  return scored.map(({ segment, hits }) => ({
    kind: 'transcript' as const,
    text: segment.text,
    start: segment.start,
    score: hits / tokens.length,
  }));
}

async function semanticMatches(workspaceId: string, query: string): Promise<Map<string, SearchMatch[]>> {
  const results = new Map<string, SearchMatch[]>();
  if (!embeddingsAvailable()) return results;
  let queryVector: Float32Array;
  try {
    const [vector] = await embed([query]);
    if (!vector) return results;
    queryVector = vector;
  } catch (error) {
    logger.warn({ err: error }, 'semantic search embedding failed');
    return results;
  }
  const rows = db
    .prepare(
      `SELECT c.video_id, c.start_time, c.text, c.embedding FROM transcript_chunks c
         JOIN videos v ON v.id = c.video_id
        WHERE v.workspace_id = ? AND c.embedding IS NOT NULL`,
    )
    .iterate(workspaceId) as IterableIterator<{ video_id: string; start_time: number; text: string; embedding: Buffer }>;
  const scored: { videoId: string; match: SearchMatch }[] = [];
  for (const row of rows) {
    const score = similarity(queryVector, bufferToVector(row.embedding));
    if (score >= 0.28) {
      scored.push({ videoId: row.video_id, match: { kind: 'semantic', text: row.text, start: row.start_time, score } });
    }
  }
  scored.sort((a, b) => b.match.score - a.match.score);
  for (const { videoId, match } of scored.slice(0, 40)) {
    const list = results.get(videoId) ?? [];
    if (list.length < 3) list.push({ ...match, text: match.text.length > 220 ? `${match.text.slice(0, 220)}…` : match.text });
    results.set(videoId, list);
  }
  return results;
}

/** Hybrid search: BM25 over titles/transcripts/summaries merged with embedding similarity over transcript chunks. */
export async function searchWorkspace(workspaceId: string, query: string): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const tokens = tokenize(trimmed);
  const fts = toFtsQuery(trimmed);
  const scores = new Map<string, { score: number; matches: SearchMatch[] }>();

  if (fts) {
    const ftsRows = db
      .prepare(
        `SELECT video_search.video_id AS video_id, bm25(video_search, 0, 6.0, 1.0, 2.0) AS rank,
                snippet(video_search, 1, '', '', '…', 12) AS title_snip,
                snippet(video_search, 3, '', '', '…', 18) AS summary_snip
           FROM video_search JOIN videos v ON v.id = video_search.video_id
          WHERE video_search MATCH ? AND v.workspace_id = ?
          ORDER BY rank LIMIT 30`,
      )
      .all(fts, workspaceId) as FtsRow[];
    ftsRows.forEach((row, index) => {
      const matches = transcriptMatches(row.video_id, tokens);
      const titleHit = tokens.some((t) => row.title_snip.toLowerCase().includes(t));
      if (titleHit) matches.unshift({ kind: 'title', text: row.title_snip, start: null, score: 1 });
      if (matches.length === 0 && row.summary_snip.trim()) {
        matches.push({ kind: 'summary', text: row.summary_snip, start: null, score: 0.5 });
      }
      scores.set(row.video_id, { score: 1 / (1 + index * 0.35), matches });
    });
  }

  const semantic = await semanticMatches(workspaceId, trimmed);
  for (const [videoId, matches] of semantic) {
    const entry = scores.get(videoId) ?? { score: 0, matches: [] };
    const best = Math.max(...matches.map((m) => m.score));
    entry.score += best * 1.4;
    for (const match of matches) {
      const duplicate = entry.matches.some((m) => m.start !== null && match.start !== null && Math.abs(m.start - match.start) < 10);
      if (!duplicate) entry.matches.push(match);
    }
    scores.set(videoId, entry);
  }

  const ids = [...scores.keys()];
  if (ids.length === 0) return [];
  const rows = db
    .prepare(`SELECT * FROM videos WHERE workspace_id = ? AND id IN (${ids.map(() => '?').join(',')})`)
    .all(workspaceId, ...ids) as VideoRow[];
  const items = await toListItems(rows);
  return items
    .map((video) => {
      const entry = scores.get(video.id) as { score: number; matches: SearchMatch[] };
      return { video, score: entry.score, matches: entry.matches.slice(0, 4) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}
