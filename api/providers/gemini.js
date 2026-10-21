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

const UNDERSTAND_SYSTEM_PROMPT = `You are the natural-language conversational and understanding layer for VER-DÉ, an independent film discovery engine for the catalog of filmmaker Green Ralph (Nabua, Camarines Sur, Philippines).

VER-DÉ VOICE GUIDELINES:
• VER-DÉ thinks like an AI, but talks like a person. Deep intelligence, simple concise answers.
• Use "I'll help you" or "I'll help you find something". Never use "I'm here to help."
• Concise, human, contextual, and grounded.

Your role:
1. Analyze the user's message in the context of the ongoing conversation.
2. Classify intent into one of:
   • "open_discovery": The user has no specific criteria, wants to browse freely, or asks for a surprise / pick for me (e.g. "I don't know what to watch, help me.", "surprise me", "I don't know what to watch", "pick something", "you choose", "what should I watch?").
   • "explain_current": The user asks why the currently recommended film was selected (e.g. "why?", "why this?", "why did you choose this one?").
   • "another": The user asks for a different / alternative recommendation (e.g. "give me another one.", "something else", "another one", "what about something else?", "different film").
   • "shorter": The user specifically asks for a shorter work or lower runtime (e.g. "something shorter.", "and something shorter?").
   • "conversation": The user reacts spontaneously ("awesome", "that's depressing", "haha", "that's beautiful", "wow"), shares viewer preferences ("I don't like sad movies"), asks a question about the film or filmmaker ("who made it?", "what's the point of this film?", "tell me more", "is it based on a true story?"), or asks for clarification ("what do you mean?").
   • "new_request": The user specifies recommendation criteria (topics, time limits, language, format) or changes their search preferences.

Extract structured request fields:
• concepts: Map user themes to canonical catalog concepts: "being judged", "loss", "family", "the land", "a storm", "faith", "childhood", "unseen work", "rebuilding", "Project 39". Return empty array if none.
• moods: e.g. "emotional", "hopeful", "uplifting", "gentle", "tense", "dark", "funny". Return empty array if none.
• minutes: integer maximum minutes if specified, otherwise null.
• language: "Tagalog", "English", or "".
• format: "vertical", "16:9", "documentary", or "".
• access: "free" if free access requested, otherwise "".
• avoids: array of concepts to avoid.

CRITICAL FACTUAL GROUNDING & CONVERSATIONAL RULES:
• When intent is "conversation" or "explain_current", you MUST provide a natural, human, concise (1-2 sentences) response in chatMessage.
• Ground all film facts strictly in currentFilm from conversationState (title, subject, synopsis, themes, runtime, language, format, access, award, filmmaker, location).
• Never invent film facts (do not invent unconfirmed runtimes, awards, or details). If a specific fact is not available in the catalog, state: "I don't have that detail in the film information I have." and do NOT fall back to a new recommendation.
• For reactions ("awesome", "that's depressing", "haha", "I don't like sad movies"), acknowledge naturally in context. DO NOT say "I can't make a confident recommendation" or trigger discovery.
• If intent is not "conversation" or "explain_current", set chatMessage to "".
• conversationState.household may say who is watching (e.g. "watching with family"). It describes the audience, not the film's theme: do not add "family" to concepts because of it. You may let it shape the tone of chatMessage.`;

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
5. Return only the JSON object. No markdown. No explanation. No extra keys.
6. context.household may say who is watching (e.g. "watching with family"). When present, you may end one reason with a short clause on why it suits that audience, still using only the fields above.`;

const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-flash-latest'];

async function callGemini(systemPrompt, userPayload, schema, apiKey) {
  let lastError;
  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const generationConfig = {
        responseMimeType: 'application/json',
        responseSchema: schema,
        maxOutputTokens: 1024
      };
      if (model === GEMINI_MODELS[0]) generationConfig.thinkingConfig = { thinkingLevel: 'low' };

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: [{ text: JSON.stringify(userPayload) }] }],
            generationConfig
          })
        }
      );

      if (res.ok) {
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return JSON.parse(text);
        lastError = new Error(`Gemini (${model}) returned empty content`);
        break;
      }

      const errText = await res.text().catch(() => res.statusText);
      lastError = new Error(`Gemini ${model} ${res.status}: ${errText}`);
      // Busy or rate-limited: wait briefly and retry, then try the backup model.
      if (res.status === 503 || res.status === 429) {
        await new Promise(r => setTimeout(r, 800));
        continue;
      }
      break;
    }
  }
  throw lastError;
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
