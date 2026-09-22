// VER-DÉ — /api/chat  (Vercel serverless function)
//
// Supports two actions:
// 1. Natural language understanding & conversation grounding:
//    POST { action: 'understand', userMessage, conversationState }
//    Returns: 200 { intent, request, chatMessage }
//
// 2. Response & reason generation for selected catalog films:
//    POST { action: 'enrich', films, userMessage, context }
//    Returns: 200 { chatMessage, reasons[] }

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

  const { action, userMessage, conversationState, films, context } = body || {};

  if (typeof userMessage !== 'string' || !userMessage.trim()) {
    return res.status(400).json({ error: 'userMessage must be a non-empty string' });
  }

  const provider = (process.env.AI_PROVIDER || 'gemini').trim().toLowerCase();

  try {
    // Action 1: Intent understanding & conversation state interpretation
    if (action === 'understand' || (conversationState && !films)) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('GEMINI_API_KEY is not set in environment variables');

      const result = await geminiProvider.understand(userMessage, conversationState || {}, apiKey);
      if (!result || typeof result.intent !== 'string' || !result.request) {
        throw new Error('Gemini returned an unexpected understand schema');
      }
      return res.status(200).json(result);
    }

    // Action 2: Film enrichment for deterministic matches
    if (!Array.isArray(films) || films.length === 0) {
      return res.status(400).json({ error: 'films must be a non-empty array' });
    }

    let result;
    if (provider === 'nebius') {
      const apiKey = process.env.NEBIUS_API_KEY;
      if (!apiKey) throw new Error('NEBIUS_API_KEY is not set in environment variables');
      result = await nebiusProvider(
        films,
        userMessage,
        context || {},
        apiKey,
        process.env.NEBIUS_MODEL
      );
    } else {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('GEMINI_API_KEY is not set in environment variables');
      result = await geminiProvider.enrich(films, userMessage, context || {}, apiKey);
    }

    // Validate provider output shape before returning it to the browser.
    if (typeof result.chatMessage !== 'string' || !Array.isArray(result.reasons)) {
      throw new Error(`Provider (${provider}) returned an unexpected response shape`);
    }

    return res.status(200).json({
      chatMessage: result.chatMessage,
      reasons: result.reasons
    });

  } catch (err) {
    console.error(`[VER-DÉ /api/chat] provider=${provider}`, err.message);
    return res.status(500).json({ error: 'AI provider error — falling back to keyword engine' });
  }
};
