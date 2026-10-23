import OpenAI from 'openai';
import { env } from '../config/env.js';

let whisperClient: OpenAI | null = null;
let llmClient: OpenAI | null = null;

export function getWhisperClient(): OpenAI {
  if (!env.ai.openaiApiKey) throw new Error('OPENAI_API_KEY is not configured');
  whisperClient ??= new OpenAI({ apiKey: env.ai.openaiApiKey, maxRetries: 3, timeout: 10 * 60 * 1000 });
  return whisperClient;
}

/** OpenAI SDK client for the configured LLM; Gemini is reached through its OpenAI-compatible endpoint. */
export function getLlmClient(): OpenAI {
  if (llmClient) return llmClient;
  if (env.ai.llmProvider === 'gemini') {
    llmClient = new OpenAI({
      apiKey: env.ai.geminiApiKey,
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      maxRetries: 3,
      timeout: 5 * 60 * 1000,
    });
  } else if (env.ai.llmProvider === 'openai') {
    llmClient = new OpenAI({ apiKey: env.ai.openaiApiKey, maxRetries: 3, timeout: 5 * 60 * 1000 });
  } else {
    throw new Error('No LLM provider configured. Set OPENAI_API_KEY or GEMINI_API_KEY.');
  }
  return llmClient;
}
