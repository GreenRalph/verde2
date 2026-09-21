// VER-DÉ — /api/chat  (Vercel serverless function)
// Receives: POST { films[], userMessage, context }
// Returns:  200 { chatMessage, reasons[] }  |  4xx/5xx { error }
//
// Provider is selected by the AI_PROVIDER environment variable:
//   "gemini"  (default) — requires GEMINI_API_KEY
//   "nebius"            — requires NEBIUS_API_KEY, optionally NEBIUS_MODEL
//
// To swap providers: change AI_PROVIDER in Vercel env vars and redeploy.
// Zero code changes required.

'use strict';

const geminiProvider = require('./providers/gemini.js');
const nebiusProvider = require('./providers/nebius.js');

module.exports = async function handler(req, res) {
  // Only POST is accepted.
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Parse body — Vercel provides req.body already parsed for JSON content-type.
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { films, userMessage, context } = body || {};

  if (!Array.isArray(films) || films.length === 0) {
    return res.status(400).json({ error: 'films must be a non-empty array' });
  }
  if (typeof userMessage !== 'string' || !userMessage.trim()) {
    return res.status(400).json({ error: 'userMessage must be a non-empty string' });
  }

  const provider = (process.env.AI_PROVIDER || 'gemini').trim().toLowerCase();

  try {
    let result;

    if (provider === 'nebius') {
      const apiKey = process.env.NEBIUS_API_KEY;
      if (!apiKey) throw new Error('NEBIUS_API_KEY is not set in environment variables');
      result = await nebiusProvider(
        films,
        userMessage,
        context || {},
        apiKey,
        process.env.NEBIUS_MODEL   // optional — falls back to default model in provider
      );
    } else {
      // Default: Gemini 3.8 Flash
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('GEMINI_API_KEY is not set in environment variables');
      result = await geminiProvider(films, userMessage, context || {}, apiKey);
    }

    // Validate provider output shape before returning it to the browser.
    if (typeof result.chatMessage !== 'string' || !Array.isArray(result.reasons)) {
      throw new Error(`Provider (${provider}) returned an unexpected response shape`);
    }

    return res.status(200).json({
      chatMessage: result.chatMessage,
      reasons: result.reasons          // [{ filmId, reason }, …]
    });

  } catch (err) {
    // Log server-side; return a generic error so the browser can fall back gracefully.
    console.error(`[VER-DÉ /api/chat] provider=${provider}`, err.message);
    return res.status(500).json({ error: 'AI provider error — falling back to keyword engine' });
  }
};
