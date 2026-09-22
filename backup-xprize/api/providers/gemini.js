// Gemini 3.8 Flash provider for VER-DÉ /api/chat
// Provides:
//   1. understand(userMessage, conversationState, apiKey) — NLU intent classification & follow-up grounding
//   2. enrich(films, userMessage, context, apiKey)        — response & reason generation for selected catalog films

'use strict';

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent';

// Schema for understanding user intent and context
const UNDERSTAND_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    intent: {
      type: 'STRING',
      enum: ['open_discovery', 'new_request', 'explain_current', 'another', 'shorter', 'conversation']
    },
    request: {
      type: 'OBJECT',
      properties: {
        concepts: {
          type: 'ARRAY',
          items: { type: 'STRING' }
        },
        moods: {
          type: 'ARRAY',
          items: { type: 'STRING' }
        },
        minutes: {
          type: 'INTEGER',
          nullable: true
        },
        language: { type: 'STRING' },
        format: { type: 'STRING' },
        access: { type: 'STRING' },
        avoids: {
          type: 'ARRAY',
          items: { type: 'STRING' }
        }
      },
      required: ['concepts', 'moods', 'language', 'format', 'access', 'avoids']
    },
    chatMessage: { type: 'STRING' }
  },
  required: ['intent', 'request', 'chatMessage']
};

const UNDERSTAND_SYSTEM_PROMPT = `You are the natural-language understanding layer for VER-DÉ, an independent film discovery engine for the catalog of filmmaker Green Ralph (Nabua, Camarines Sur, Philippines).

Your role:
1. Analyze the user's message in the context of the ongoing conversation.
2. Classify intent into one of:
   • "open_discovery": The user has no specific criteria, wants to browse freely, or asks for a surprise / pick for me (e.g. "surprise me", "I don't know what to watch", "pick something", "what should I watch tonight?").
   • "explain_current": The user asks why the currently recommended film was selected (e.g. "why?", "why this?", "why did you choose this one?").
   • "another": The user asks for a different / alternative recommendation (e.g. "something else", "another one", "what about something else?", "different film").
   • "shorter": The user specifically asks for a shorter work or lower runtime (e.g. "something shorter", "and something shorter?").
   • "conversation": The user reacts to the current film, expresses doubt, or asks a follow-up question about it (e.g. "I don't think I'll like it", "tell me more about it", "is it sad?", "who is in this?").
   • "new_request": The user specifies criteria (topics, time limits, language, format) or changes their preferences.

Extract structured request fields:
• concepts: Map user themes to canonical catalog concepts: "being judged", "loss", "family", "the land", "a storm", "faith", "childhood", "unseen work", "rebuilding", "Project 39". Return empty array if none.
• moods: e.g. "emotional", "hopeful", "uplifting", "gentle", "tense", "dark", "funny". Return empty array if none.
• minutes: integer maximum minutes if specified, otherwise null.
• language: "Tagalog", "English", or "".
• format: "vertical", "16:9", "documentary", or "".
• access: "free" if free access requested, otherwise "".
• avoids: array of concepts to avoid.

CRITICAL FACTUAL GROUNDING RULE:
• When intent is "explain_current" or "conversation", you MUST base chatMessage ONLY on the factual details of currentFilm provided in conversationState (title, subject, synopsis, themes, runtime, language, format, access, award).
• Do NOT invent or assume facts, plotlines, or awards not in currentFilm.
• Make chatMessage decisive, concise (1-2 sentences), and respectful. No hedging.
• If intent is not "explain_current" or "conversation", set chatMessage to "".`;

// Schema for enriching already-selected films
const ENRICH_RESPONSE_SCHEMA = {
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

const ENRICH_SYSTEM_PROMPT = `You are VER-DÉ, a decisive film recommendation engine for an independent catalog of released works by filmmaker Green Ralph (Nabua, Camarines Sur, Philippines).

STRICT RULES — follow every one exactly:

1. You receive films already chosen by the discovery engine. Your only job is to write the text.
2. chatMessage — exactly one sentence. No hedging. No "try", "maybe", "perhaps", "you could". No questions.
   • Single film:   "Watch [TITLE]. [One reason drawn only from the film's subject or synopsis]."
   • Multiple films: "These are the closest published matches for what you described."
3. For each film write a reason — 1 to 2 sentences. Use ONLY these fields: title, subject, synopsis, themes, runtime, language, format, access, award. Do NOT invent any fact not present in those fields.
4. Every filmId in the reasons array must exactly match the id value you receive. No substitutions.
5. Return only the JSON object. No markdown. No explanation. No extra keys.`;

async function callGemini(systemPrompt, userPayload, schema, apiKey) {
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts: [{ text: JSON.stringify(userPayload) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      thinking_level: 'low',
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

async function geminiUnderstand(userMessage, conversationState, apiKey) {
  return callGemini(UNDERSTAND_SYSTEM_PROMPT, { userMessage, conversationState }, UNDERSTAND_RESPONSE_SCHEMA, apiKey);
}

async function geminiEnrich(films, userMessage, context, apiKey) {
  return callGemini(ENRICH_SYSTEM_PROMPT, { films, userMessage, context }, ENRICH_RESPONSE_SCHEMA, apiKey);
}

// Backward compatibility: calling geminiProvider(...) directly runs enrichment
async function geminiProvider(films, userMessage, context, apiKey) {
  return geminiEnrich(films, userMessage, context, apiKey);
}

geminiProvider.understand = geminiUnderstand;
geminiProvider.enrich = geminiEnrich;

module.exports = geminiProvider;
