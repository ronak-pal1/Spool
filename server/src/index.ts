import { env } from './config/env.js';
import { createApp } from './app.js';
import { db } from './db/index.js';
import { checkFfmpeg } from './services/ffmpeg.service.js';
import { cleanupAbandonedUploads, resumeInterruptedJobs } from './services/pipeline.service.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  const ffmpegVersion = await checkFfmpeg();
  if (!ffmpegVersion) {
    logger.warn(`FFmpeg was not found at "${env.ffmpegPath}". Uploads will fail to process until it is installed.`);
  } else {
    logger.info(ffmpegVersion);
  }
  if (!env.ai.transcriptionProvider) logger.warn('No transcription provider configured (set OPENAI_API_KEY or DEEPGRAM_API_KEY).');
  if (!env.ai.llmProvider) logger.warn('No LLM configured (set OPENAI_API_KEY or GEMINI_API_KEY). Summaries and AI chat are disabled.');

  await cleanupAbandonedUploads();
  resumeInterruptedJobs();
  const cleanupTimer = setInterval(() => {
    cleanupAbandonedUploads().catch((error: unknown) => logger.warn({ err: error }, 'cleanup failed'));
  }, 3600 * 1000);
  cleanupTimer.unref();

  const app = createApp();
  const server = app.listen(env.port, () => {
    logger.info(`Spool API listening on ${env.publicApiUrl} (storage: ${env.storage.driver})`);
  });
  server.requestTimeout = 0;
  server.headersTimeout = 65_000;

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'failed to start');
  process.exit(1);
});
