/**
 * Ollama provider — local, private, free.
 *
 * Uses Ollama's OpenAI-compatible endpoint (/v1/chat/completions) so the same
 * message shape (including `image_url` parts) works for both providers.
 */
'use strict';

const config = require('../config');

const VISION_HINTS = [
  'llava', 'bakllava', 'moondream', 'minicpm-v', 'llama3.2-vision', 'llama-3.2-vision',
  'llama4', 'qwen2-vl', 'qwen2.5vl', 'qwen2.5-vl', 'qwen3-vl', 'gemma3', 'mistral-small3',
  'granite3.2-vision', 'internvl', 'pixtral', 'cogvlm',
];

/** Models that are text-only despite matching a broad hint above. */
const VISION_EXCLUDE = ['gemma3n', 'gemma3:1b'];

const showCache = new Map(); // model name -> { vision, context, at }
const SHOW_TTL = 5 * 60 * 1000;

function guessVision(name) {
  const n = String(name || '').toLowerCase();
  if (VISION_EXCLUDE.some((x) => n.includes(x))) return false;
  return VISION_HINTS.some((x) => n.includes(x));
}

async function request(pathname, { method = 'GET', body, timeout = 8000, signal } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  try {
    return await fetch(config.ollamaUrl + pathname, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Is the daemon reachable? Fast, with a short timeout so the UI never hangs. */
async function status() {
  try {
    const res = await request('/api/tags', { timeout: 2500 });
    if (!res.ok) return { online: false, error: `Ollama replied ${res.status}` };
    const data = await res.json();
    return { online: true, modelCount: (data.models || []).length, url: config.ollamaUrl };
  } catch (err) {
    return {
      online: false,
      url: config.ollamaUrl,
      error: err.name === 'AbortError' ? 'Ollama did not respond in time' : 'Ollama is not reachable',
    };
  }
}

/** Ask Ollama about one model's capabilities (cached; falls back to name hints). */
async function describeModel(name) {
  const cached = showCache.get(name);
  if (cached && Date.now() - cached.at < SHOW_TTL) return cached;

  let info = { vision: guessVision(name), context: null, at: Date.now() };
  try {
    const res = await request('/api/show', { method: 'POST', body: { model: name }, timeout: 6000 });
    if (res.ok) {
      const data = await res.json();
      const caps = Array.isArray(data.capabilities) ? data.capabilities.map(String) : null;
      if (caps) info.vision = caps.includes('vision');
      const details = data.model_info || {};
      const ctxKey = Object.keys(details).find((k) => k.endsWith('.context_length'));
      if (ctxKey) info.context = Number(details[ctxKey]) || null;
    }
  } catch {
    /* keep the heuristic */
  }
  showCache.set(name, info);
  return info;
}

/** All locally installed models, annotated with vision + context info. */
async function listModels() {
  const res = await request('/api/tags', { timeout: 5000 });
  if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
  const data = await res.json();
  const models = data.models || [];

  const described = await Promise.all(
    models.map(async (m) => {
      const info = await describeModel(m.name);
      return {
        id: m.name,
        name: m.name,
        provider: 'ollama',
        free: true,
        vision: info.vision,
        context: info.context,
        sizeBytes: m.size || null,
        parameterSize: m.details?.parameter_size || null,
        quantization: m.details?.quantization_level || null,
        modifiedAt: m.modified_at || null,
      };
    })
  );

  described.sort((a, b) => a.name.localeCompare(b.name));
  return described;
}

/**
 * Chat completion. Returns the raw fetch Response so the server can stream the
 * body straight through without buffering.
 */
async function chat({ model, messages, temperature, maxTokens, stream = true, signal }) {
  const body = {
    model,
    messages,
    stream,
    ...(temperature !== undefined && temperature !== null ? { temperature: Number(temperature) } : {}),
    ...(maxTokens ? { max_tokens: Number(maxTokens) } : {}),
  };

  return fetch(`${config.ollamaUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

/** Human-readable explanation for a failed local call. */
function explainError(err) {
  if (err?.name === 'AbortError') return 'The local model took too long to respond.';
  return (
    "Couldn't connect to Ollama.\n\n" +
    'Make sure Ollama is running and try again.\n' +
    `Endpoint: ${config.ollamaUrl}`
  );
}

module.exports = { status, listModels, describeModel, chat, guessVision, explainError };
