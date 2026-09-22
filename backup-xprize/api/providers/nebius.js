// Nebius AI provider for VER-DÉ /api/chat (OpenAI-compatible API)
// Activate by setting AI_PROVIDER=nebius in Vercel environment variables.
// Also requires: NEBIUS_API_KEY, optionally NEBIUS_MODEL.
//
// Input/output contract is identical to gemini.js — the router in chat.js
// selects the provider; callers never need to know which one is active.

'use strict';

const NEBIUS_API_URL = 'https://api.tokenfactory.nebius.com/v1/chat/completions';
const DEFAULT_MODEL  = 'meta-llama/Llama-3.3-70B-Instruct';

const SYSTEM_PROMPT = `You are VER-DÉ, a decisive film recommendation engine for an independent catalog of released works by filmmaker Green Ralph (Nabua, Camarines Sur, Philippines).

STRICT RULES — follow every one exactly:

1. You receive films already chosen by the discovery engine. Your only job is to write the text.
2. chatMessage — exactly one sentence. No hedging. No "try", "maybe", "perhaps", "you could". No questions.
   • Single film:   "Watch [TITLE]. [One reason drawn only from the film's subject or synopsis]."
   • Multiple films: "These are the closest published matches for what you described."
3. For each film write a reason — 1 to 2 sentences. Use ONLY these fields: title, subject, synopsis, themes, runtime, language, format, access, award. Do NOT invent any fact not present in those fields.
4. Every filmId in the reasons array must exactly match the id value you receive. No substitutions.
5. Return ONLY valid JSON matching this exact schema — no markdown, no explanation, no extra keys:
   { "chatMessage": "<string>", "reasons": [{ "filmId": "<string>", "reason": "<string>" }] }`;

async function nebiusProvider(films, userMessage, context, apiKey, model) {
  const userContent = JSON.stringify({ films, userMessage, context });

  const body = {
    model: model || DEFAULT_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: userContent }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.35,
    max_tokens: 512
  };

  const res = await fetch(NEBIUS_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Nebius ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Nebius returned empty content');

  return JSON.parse(text);
}

module.exports = nebiusProvider;
