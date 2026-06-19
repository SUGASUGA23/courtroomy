// server/src/llm.js
// Courtroom — provider-agnostic OpenAI-compatible chat client.
//
// A tiny wrapper over any OpenAI-compatible /chat/completions endpoint, using
// Node 18+'s global `fetch` (no extra npm deps). By default it targets Google
// Gemini's OpenAI-compatible endpoint, but it works with any provider that
// speaks the same protocol (Groq, OpenRouter, …) via LLM_BASE_URL / LLM_MODEL.
//
// Config is resolved from env at call time:
//   key     = GEMINI_API_KEY || LLM_API_KEY
//   baseUrl = LLM_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai'
//   model   = LLM_MODEL || GEMINI_MODEL || 'gemini-2.0-flash'
//
// Exports:
//   isConfigured()                              -> boolean (a key is present)
//   modelName()                                 -> the model string (for logs)
//   chat({ system, messages, maxTokens })       -> Promise<string fullText>   (non-stream)
//   streamChat({ system, messages, maxTokens }, onToken)
//                                               -> Promise<string fullText>   (streams)
//
// EDUCATIONAL SIMULATION ONLY — not real legal advice.

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
const DEFAULT_MODEL = 'gemini-2.0-flash';

function getKey() {
  return process.env.GEMINI_API_KEY || process.env.LLM_API_KEY || '';
}

function getBaseUrl() {
  return process.env.LLM_BASE_URL || DEFAULT_BASE_URL;
}

/** True when an API key is configured (Gemini or a generic LLM provider). */
export function isConfigured() {
  return Boolean(getKey());
}

/** The resolved model string, for logging. */
export function modelName() {
  return process.env.LLM_MODEL || process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

// Build the OpenAI-style messages array: system turn first, then the caller's
// already-shaped { role: 'user' | 'assistant', content } messages.
function buildBody({ system, messages, maxTokens, stream }) {
  return {
    model: modelName(),
    max_tokens: maxTokens,
    messages: [{ role: 'system', content: system }, ...(messages || [])],
    stream: Boolean(stream),
  };
}

// Read the response body and produce a clear, diagnosable Error. This is how we
// surface bad-key / quota / billing / wrong-model problems in the server log
// instead of a cryptic "Premature close".
async function errorFrom(res) {
  let body = '';
  try {
    body = await res.text();
  } catch (_) {
    body = '';
  }
  let message = body;
  try {
    const j = JSON.parse(body);
    message = (j && j.error && (j.error.message || j.error.status)) || (j && j.message) || body;
  } catch (_) {
    // Not JSON — keep the raw body text.
  }
  const trimmed = String(message || '').trim().slice(0, 500);
  return new Error('LLM ' + res.status + ': ' + (trimmed || res.statusText || 'request failed'));
}

function buildUrl() {
  return getBaseUrl().replace(/\/+$/, '') + '/chat/completions';
}

function authHeaders() {
  return {
    'content-type': 'application/json',
    Authorization: 'Bearer ' + getKey(),
  };
}

const RETRY_STATUSES = new Set([500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// POST to the chat endpoint, retrying transient 5xx overloads (e.g. Gemini's
// "503 high demand") a couple of times with backoff. A SUCCESS response is
// returned with its body stream untouched (so streamChat can read it). A
// non-retryable status (e.g. 401 bad key, 429 quota) throws a clear errorFrom().
async function postChat(body) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let res;
    try {
      res = await fetch(buildUrl(), { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
    } catch (netErr) {
      lastErr = netErr;
      if (attempt < 2) {
        await sleep(600 * (attempt + 1));
        continue;
      }
      throw netErr;
    }
    if (res.ok) return res;
    if (RETRY_STATUSES.has(res.status) && attempt < 2) {
      lastErr = await errorFrom(res);
      await sleep(600 * (attempt + 1));
      continue;
    }
    throw await errorFrom(res);
  }
  throw lastErr || new Error('LLM request failed');
}

/**
 * Non-streaming chat completion.
 * @returns {Promise<string>} The full assistant message text.
 */
export async function chat({ system, messages, maxTokens }) {
  const res = await postChat(buildBody({ system, messages, maxTokens, stream: false }));
  const json = await res.json();
  const content =
    json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
  return typeof content === 'string' ? content : '';
}

/**
 * Streaming chat completion. Calls onToken(delta) for each content chunk.
 * @returns {Promise<string>} The full assistant message text.
 */
export async function streamChat({ system, messages, maxTokens }, onToken) {
  const cb = typeof onToken === 'function' ? onToken : () => {};
  const res = await postChat(buildBody({ system, messages, maxTokens, stream: true }));

  let full = '';
  let buffer = '';
  const dec = new TextDecoder();
  for await (const chunk of res.body) {
    buffer += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const d = line.slice(5).trim();
      if (d === '[DONE]') continue;
      try {
        const j = JSON.parse(d);
        const t = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
        if (t) {
          full += t;
          cb(t);
        }
      } catch (_) {
        // Ignore non-JSON / keep-alive lines.
      }
    }
  }
  return full;
}

export default { isConfigured, modelName, chat, streamChat };
