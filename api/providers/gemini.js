// Gemini 3.8 Flash provider for VER-DÉ /api/chat
// Input:  films[]  — catalog fields only (no invented data)
//         userMessage — the raw user query string
//         context  — { isOpenDiscovery, isShorter, conceptNames[] }
//         apiKey   — GEMINI_API_KEY from Vercel env
// Output: { chatMessage: string, reasons: [{ filmId, reason }] }

'use strict';

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent';

// Strict JSON schema so the model cannot return a malformed shape.
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    chatMessage: { type: 'STRING' },
    reasons: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          filmId: { type: 'STRING' },
          reason: { type: 'STRING' }
        },
        required: ['filmId', 'reason']
      }
    }
  },
  required: ['chatMessage', 'reasons']
};

const SYSTEM_PROMPT = `You are VER-DÉ, a decisive film recommendation engine for an independent catalog of released works by filmmaker Green Ralph (Nabua, Camarines Sur, Philippines).

STRICT RULES — follow every one exactly:

1. You receive films already chosen by the discovery engine. Your only job is to write the text.
2. chatMessage — exactly one sentence. No hedging. No "try", "maybe", "perhaps", "you could". No questions.
   • Single film:   "Watch [TITLE]. [One reason drawn only from the film's subject or synopsis]."
   • Multiple films: "These are the closest published matches for what you described."
3. For each film write a reason — 1 to 2 sentences. Use ONLY these fields: title, subject, synopsis, themes, runtime, language, format, access, award. Do NOT invent any fact not present in those fields.
4. Every filmId in the reasons array must exactly match the id value you receive. No substitutions.
5. Return only the JSON object. No markdown. No explanation. No extra keys.`;

async function geminiProvider(films, userMessage, context, apiKey) {
  const userContent = JSON.stringify({ films, userMessage, context });

  const body = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ parts: [{ text: userContent }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      thinking_level: "low",
      maxOutputTokens: 512
    }
  };

  const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Gemini ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned empty content');

  return JSON.parse(text);
}

module.exports = geminiProvider;
