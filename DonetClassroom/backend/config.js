/**
 * DonetClassroom — configuration.
 *
 * Loads `.env` with a tiny built-in parser so the project keeps a single
 * runtime dependency (express). Nothing in here is ever sent to the browser
 * except the values explicitly listed in `publicConfig()`.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** Minimal .env parser: KEY=VALUE, `#` comments, optional quotes. */
function loadEnvFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Real environment variables always win over the file.
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(path.join(ROOT, '.env'));

const bool = (v, fallback) => {
  if (v === undefined || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(v));
};

const stripSlash = (u) => String(u || '').replace(/\/+$/, '');

const config = {
  root: ROOT,
  port: Number(process.env.PORT || 5173),
  host: process.env.HOST || '127.0.0.1',

  ollamaUrl: stripSlash(process.env.OLLAMA_URL || 'http://localhost:11434'),

  openrouterUrl: stripSlash(process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1'),
  openrouterKey: (process.env.OPENROUTER_API_KEY || '').trim(),
  geminiUrl: stripSlash(process.env.GEMINI_URL || 'https://generativelanguage.googleapis.com/v1beta'),
  geminiKey: (process.env.GEMINI_API_KEY || '').trim(),

  appUrl: process.env.APP_URL || 'http://localhost:5173',
  appTitle: process.env.APP_TITLE || 'DonetClassroom',

  /** Zero-cost protection. When true the server refuses paid models outright. */
  freeOnly: bool(process.env.FREE_ONLY, true),

  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 120000),

  chatsDir: path.join(ROOT, 'data', 'chats'),
  frontendDir: path.join(ROOT, 'frontend'),
  publicDir: path.join(ROOT, 'public'),

  defaultSystemPrompt:
    'You are DonetClassroom, a helpful AI assistant. Give accurate, clear, useful answers. ' +
    'When analyzing images, carefully inspect the provided image and explicitly distinguish ' +
    'visible facts from assumptions. Do not claim to see information that is not present.',
};

/**
 * Recommended local models, grouped for older hardware (the reference machine
 * is a 2014 Mac mini, 2.6 GHz). Sizes are approximate download sizes for the
 * default quantisation and can change upstream — they are hints, not promises.
 */
config.recommendedModels = [
  {
    tier: 'FAST',
    blurb: 'Small model, best for older hardware.',
    models: [
      { name: 'qwen2.5:0.5b', size: '~400 MB', ram: '2 GB+', note: 'Tiny. Instant replies, basic reasoning.' },
      { name: 'llama3.2:1b', size: '~1.3 GB', ram: '4 GB+', note: 'Good all-round tiny model.' },
      { name: 'qwen2.5:1.5b', size: '~1 GB', ram: '4 GB+', note: 'Stronger than its size suggests.' },
    ],
  },
  {
    tier: 'BALANCED',
    blurb: 'Better reasoning but slower.',
    models: [
      { name: 'llama3.2:3b', size: '~2 GB', ram: '8 GB+', note: 'Solid default if you have the RAM.' },
      { name: 'qwen2.5:3b', size: '~1.9 GB', ram: '8 GB+', note: 'Strong at code and structured output.' },
      { name: 'phi3:mini', size: '~2.2 GB', ram: '8 GB+', note: 'Compact reasoning model.' },
    ],
  },
  {
    tier: 'VISION',
    blurb: 'Model capable of understanding images.',
    models: [
      { name: 'moondream', size: '~1.7 GB', ram: '4 GB+', note: 'Smallest practical vision model.' },
      { name: 'llava:7b', size: '~4.7 GB', ram: '8 GB+', note: 'Classic image understanding model.' },
      { name: 'llama3.2-vision:11b', size: '~7.9 GB', ram: '16 GB+', note: 'Best quality, needs real RAM.' },
    ],
  },
  {
    tier: 'ADVANCED',
    blurb: 'Large model, only recommended when enough RAM is available.',
    models: [
      { name: 'qwen2.5:7b', size: '~4.7 GB', ram: '16 GB+', note: 'Noticeably smarter, noticeably slower.' },
      { name: 'llama3.1:8b', size: '~4.9 GB', ram: '16 GB+', note: 'General purpose workhorse.' },
    ],
  },
];

/** Values that are safe to hand to the browser. Never expose the API key. */
config.publicConfig = () => ({
  mode: 'server',
  ollamaUrl: config.ollamaUrl,
  hasOpenRouterKey: Boolean(config.openrouterKey),
  hasGeminiKey: Boolean(config.geminiKey),
  freeOnly: config.freeOnly,
  defaultSystemPrompt: config.defaultSystemPrompt,
  recommendedModels: config.recommendedModels,
});

module.exports = config;
