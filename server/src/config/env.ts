import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined));

const booleanString = z
  .string()
  .optional()
  .transform((value) => value === 'true' || value === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  CORS_ORIGINS: optionalString,
  JWT_SECRET: optionalString,
  DATA_DIR: z.string().default('./data'),
  DATABASE_PATH: optionalString,
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  S3_BUCKET: optionalString,
  S3_REGION: z.string().default('us-east-1'),
  S3_ENDPOINT: optionalString,
  S3_FORCE_PATH_STYLE: booleanString,
  UPLOAD_PART_SIZE_MB: z.coerce.number().int().min(5).max(512).default(8),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  PIPELINE_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  MAX_RECORDING_SECONDS: z.coerce.number().int().min(60).default(420),
  TRANSCRIPTION_PROVIDER: z
    .enum(['openai', 'deepgram', ''])
    .optional()
    .transform((value) => (value ? value : undefined)),
  LLM_PROVIDER: z
    .enum(['openai', 'gemini', ''])
    .optional()
    .transform((value) => (value ? value : undefined)),
  OPENAI_API_KEY: optionalString,
  DEEPGRAM_API_KEY: optionalString,
  GEMINI_API_KEY: optionalString,
  LLM_MODEL: optionalString,
  EMBEDDING_MODEL: optionalString,
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const raw = parsed.data;

if (raw.NODE_ENV === 'production' && (!raw.JWT_SECRET || raw.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be set to at least 32 characters in production');
}
if (raw.STORAGE_DRIVER === 's3' && !raw.S3_BUCKET) {
  throw new Error('S3_BUCKET is required when STORAGE_DRIVER=s3');
}

const transcriptionProvider: 'openai' | 'deepgram' | null =
  raw.TRANSCRIPTION_PROVIDER ?? (raw.DEEPGRAM_API_KEY ? 'deepgram' : raw.OPENAI_API_KEY ? 'openai' : null);
if (transcriptionProvider === 'openai' && !raw.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for Whisper transcription');
if (transcriptionProvider === 'deepgram' && !raw.DEEPGRAM_API_KEY) throw new Error('DEEPGRAM_API_KEY is required for Deepgram transcription');

const llmProvider: 'openai' | 'gemini' | null =
  raw.LLM_PROVIDER ?? (raw.OPENAI_API_KEY ? 'openai' : raw.GEMINI_API_KEY ? 'gemini' : null);
if (llmProvider === 'openai' && !raw.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for LLM_PROVIDER=openai');
if (llmProvider === 'gemini' && !raw.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required for LLM_PROVIDER=gemini');

const dataDir = path.resolve(raw.DATA_DIR);

export const env = {
  nodeEnv: raw.NODE_ENV,
  isProduction: raw.NODE_ENV === 'production',
  port: raw.PORT,
  publicApiUrl: raw.PUBLIC_API_URL.replace(/\/+$/, ''),
  clientUrl: raw.CLIENT_URL.replace(/\/+$/, ''),
  corsOrigins: (raw.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  jwtSecret: raw.JWT_SECRET ?? 'spool-development-secret-do-not-use-in-production',
  dataDir,
  databasePath: path.resolve(raw.DATABASE_PATH ?? path.join(dataDir, 'spool.db')),
  storage: {
    driver: raw.STORAGE_DRIVER,
    localDir: path.join(dataDir, 'storage'),
    uploadsDir: path.join(dataDir, 'multipart'),
    bucket: raw.S3_BUCKET ?? '',
    region: raw.S3_REGION,
    endpoint: raw.S3_ENDPOINT,
    forcePathStyle: raw.S3_FORCE_PATH_STYLE,
    partSize: raw.UPLOAD_PART_SIZE_MB * 1024 * 1024,
  },
  tempDir: path.join(dataDir, 'tmp'),
  ffmpegPath: raw.FFMPEG_PATH,
  ffprobePath: raw.FFPROBE_PATH,
  pipelineConcurrency: raw.PIPELINE_CONCURRENCY,
  maxRecordingSeconds: raw.MAX_RECORDING_SECONDS,
  ai: {
    transcriptionProvider,
    llmProvider,
    openaiApiKey: raw.OPENAI_API_KEY,
    deepgramApiKey: raw.DEEPGRAM_API_KEY,
    geminiApiKey: raw.GEMINI_API_KEY,
    llmModel: raw.LLM_MODEL ?? (llmProvider === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4o'),
    embeddingModel: raw.EMBEDDING_MODEL ?? (llmProvider === 'gemini' ? 'gemini-embedding-001' : 'text-embedding-3-small'),
  },
} as const;

export type Env = typeof env;
