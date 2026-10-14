/**
 * Google Gemini provider — free-tier cloud models.
 *
 * Gemini is served from generativelanguage.googleapis.com, a different domain
 * to OpenRouter, which helps on networks that block one of them. The key is
 * sent as the x-goog-api-key header, never in the URL, so it stays out of
 * proxy and server logs.
 */
'use strict';

const config = require('../config');

/** Curated line-up. Every model here is on Gemini's free tier and multimodal. */
function listModels() {
  const mk = (id, name, desc) => ({
    id, name, provider: 'gemini', free: true, vision: true, context: 1048576,
    pricing: { prompt: '0', completion: '0' }, description: desc,
  });
  return [
    mk('gemini-flash-latest', 'Gemini Flash (latest)', 'Always points at the current Flash release. Fast, multimodal, best default.'),
    mk('gemini-2.5-flash', 'Gemini 2.5 Flash', 'Stable mid-size multimodal model.'),
    mk('gemini-2.5-pro', 'Gemini 2.5 Pro', 'Most capable stable model. Slower, better reasoning.'),
    mk('gemini-pro-latest', 'Gemini Pro (latest)', 'Always points at the current Pro release.'),
    mk('gemini-flash-lite-latest', 'Gemini Flash Lite', 'Lightest and fastest. Good for quick questions.'),
  ];
}

const DEFAULT_MODEL = 'gemini-flash-latest';

async function testKey(key) {
  const apiKey = (key || config.geminiKey || '').trim();
  if (!apiKey) return { ok: false, error: 'No Gemini API key configured.' };
  try {
    const res = await fetch(`${config.geminiUrl}/models`, {
      headers: { 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(10000),
    });
    if ([400, 401, 403].includes(res.status)) return { ok: false, error: `That Gemini key was rejected (${res.status}).` };
    if (!res.ok) return { ok: false, error: `Gemini replied ${res.status}` };
    return { ok: true };
  } catch {
    return { ok: false, error: 'Network error reaching Gemini.' };
  }
}

/** OpenAI-shaped messages -> Gemini generateContent body. */
function toGeminiBody({ messages, temperature, maxTokens }) {
  const contents = [];
  let systemText = '';
  for (const m of messages) {
    if (m.role === 'system') {
      systemText += (systemText ? '\n\n' : '') + (typeof m.content === 'string' ? m.content : '');
      continue;
    }
    const parts = [];
    if (typeof m.content === 'string') {
      if (m.content) parts.push({ text: m.content });
    } else if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p.type === 'text' && p.text) parts.push({ text: p.text });
        else if (p.type === 'image_url') {
          const match = /^data:([^;]+);base64,(.*)$/.exec(p.image_url?.url || '');
          if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
        }
      }
    }
    if (parts.length) contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
  }
  const body = { contents };
  if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
  const gen = {};
  if (temperature !== undefined && temperature !== null) gen.temperature = Number(temperature);
  if (maxTokens) gen.maxOutputTokens = Number(maxTokens);
  if (Object.keys(gen).length) body.generationConfig = gen;
  return body;
}

/** Starts a streaming completion; returns the raw fetch Response (SSE). */
async function chat({ model, messages, temperature, maxTokens, signal, apiKey }) {
  const key = (apiKey || config.geminiKey || '').trim();
  if (!key) {
    const err = new Error('NO_API_KEY');
    err.code = 'NO_API_KEY';
    throw err;
  }
  return fetch(`${config.geminiUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(toGeminiBody({ messages, temperature, maxTokens })),
    signal,
  });
}

function explainError(status) {
  if ([400, 401, 403].includes(status)) return `Gemini rejected the request (${status}).\n\nCheck GEMINI_API_KEY in your .env file.`;
  if (status === 429) return 'Rate limited by Gemini (429).\n\nThe free tier shares a limited pool — wait a moment and try again.';
  if (status === 503) return 'This Gemini model is busy right now (503).\n\nTry again in a moment, or pick another Gemini model.';
  return `Gemini returned ${status}.`;
}

module.exports = { listModels, testKey, chat, toGeminiBody, explainError, DEFAULT_MODEL };
