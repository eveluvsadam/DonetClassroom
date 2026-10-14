/**
 * OpenRouter provider — free cloud models.
 *
 * Zero-cost protection lives here: pricing is read from the live /models
 * endpoint, never hard-coded, and a model only counts as free when every
 * pricing field it reports is zero.
 */
'use strict';

const config = require('../config');

const MODELS_TTL = 10 * 60 * 1000; // pricing changes; re-check every 10 minutes
let modelsCache = { at: 0, models: null, promise: null };

/** The zero-cost router. Cost is enforced by pricing checks, not by this id. */
const FREE_ROUTER_ID = 'openrouter/auto';

function headers(key) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
    'HTTP-Referer': config.appUrl,
    'X-Title': config.appTitle,
  };
}

/**
 * A model is free only when every numeric pricing field is exactly 0.
 * OpenRouter reports prices as strings like "0" or "0.0000006".
 */
function isFreePricing(pricing) {
  if (!pricing || typeof pricing !== 'object') return false;
  const relevant = ['prompt', 'completion', 'image', 'request', 'input_cache_read', 'input_cache_write'];
  let sawNumber = false;
  for (const field of relevant) {
    if (pricing[field] === undefined || pricing[field] === null || pricing[field] === '') continue;
    const value = Number(pricing[field]);
    if (!Number.isFinite(value)) return false;
    if (value !== 0) return false;
    sawNumber = true;
  }
  return sawNumber;
}

function normalize(m) {
  const modalities = m.architecture?.input_modalities || [];
  const pricing = m.pricing || {};
  return {
    id: m.id,
    name: m.name || m.id,
    provider: 'openrouter',
    free: isFreePricing(pricing),
    vision: modalities.includes('image'),
    context: m.context_length || m.top_provider?.context_length || null,
    maxCompletion: m.top_provider?.max_completion_tokens || null,
    pricing: { prompt: pricing.prompt ?? null, completion: pricing.completion ?? null },
    description: m.description ? String(m.description).slice(0, 240) : '',
    reasoning: Boolean(m.supported_parameters?.includes('reasoning')),
    created: m.created || 0,
  };
}

/** Live model catalogue (cached). Works without an API key. */
async function listModels({ force = false } = {}) {
  if (!force && modelsCache.models && Date.now() - modelsCache.at < MODELS_TTL) {
    return modelsCache.models;
  }
  if (modelsCache.promise) return modelsCache.promise;

  modelsCache.promise = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(`${config.openrouterUrl}/models`, {
        headers: config.openrouterKey
          ? { Authorization: `Bearer ${config.openrouterKey}` }
          : undefined,
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`OpenRouter models request failed (${res.status})`);
      const data = await res.json();
      const models = (data.data || []).map(normalize);

      // Synthetic entry for the zero-cost router so it is always selectable.
      models.unshift({
        id: FREE_ROUTER_ID,
        name: 'Free Router (auto-pick)',
        provider: 'openrouter',
        free: true,
        router: true,
        vision: true,
        context: null,
        pricing: { prompt: '0', completion: '0' },
        description:
          'Lets OpenRouter pick a currently available model. Subject to their live rate limits and availability.',
        reasoning: false,
        created: 0,
      });

      modelsCache = { at: Date.now(), models, promise: null };
      return models;
    } finally {
      clearTimeout(timer);
      modelsCache.promise = null;
    }
  })();

  return modelsCache.promise;
}

/** Look a model up in the live catalogue. */
async function findModel(id) {
  try {
    const models = await listModels();
    return models.find((m) => m.id === id) || null;
  } catch {
    return null;
  }
}

/** Verify a key without spending anything (auth endpoint is free). */
async function testKey(key) {
  const apiKey = (key || config.openrouterKey || '').trim();
  if (!apiKey) return { ok: false, error: 'No API key configured.' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(`${config.openrouterUrl}/auth/key`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
    });
    if (res.status === 401) return { ok: false, error: 'That API key was rejected (401).' };
    if (!res.ok) return { ok: false, error: `OpenRouter replied ${res.status}.` };
    const data = await res.json();
    const d = data.data || {};
    return {
      ok: true,
      label: d.label || null,
      isFreeTier: d.is_free_tier ?? null,
      usage: d.usage ?? null,
      limit: d.limit ?? null,
      rateLimit: d.rate_limit ?? null,
    };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'OpenRouter timed out.' : 'Network error reaching OpenRouter.' };
  } finally {
    clearTimeout(timer);
  }
}

async function chat({ model, messages, temperature, maxTokens, stream = true, signal, apiKey }) {
  const key = (apiKey || config.openrouterKey || '').trim();
  if (!key) {
    const err = new Error('NO_API_KEY');
    err.code = 'NO_API_KEY';
    throw err;
  }

  const body = {
    model,
    messages,
    stream,
    ...(temperature !== undefined && temperature !== null ? { temperature: Number(temperature) } : {}),
    ...(maxTokens ? { max_tokens: Number(maxTokens) } : {}),
  };

  return fetch(`${config.openrouterUrl}/chat/completions`, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify(body),
    signal,
  });
}

function explainError(status) {
  const base =
    'OpenRouter request failed.\n\nCheck:\n• API key\n• Internet connection\n• Free-model availability\n• Rate limits';
  if (status === 401) return 'OpenRouter rejected the API key (401).\n\nAdd a valid key in Settings → Cloud.';
  if (status === 402) return 'OpenRouter says this request needs credits (402).\n\nPick a free model, or enable paid models deliberately in Settings.';
  if (status === 429) return 'Rate limited by OpenRouter (429).\n\nFree models share a limited pool — wait a moment or pick another free model.';
  return base;
}

module.exports = { listModels, findModel, testKey, chat, isFreePricing, explainError, FREE_ROUTER_ID };
