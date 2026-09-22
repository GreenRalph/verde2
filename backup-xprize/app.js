const promptForm = document.querySelector('#promptForm');
const promptInput = document.querySelector('#prompt');
const messages = document.querySelector('#messages');
const recommendations = document.querySelector('#recommendations');
const resultCount = document.querySelector('#resultCount');
const watchDialog = document.querySelector('#watchDialog');

// Each term below is grounded in wording already published for the relevant work.
const concepts = [
  { name: 'being judged', queries: ['judged', 'judgement', 'judgment', 'sentenced', 'sentence'], evidence: ['judgement', 'sentenced'] },
  { name: 'loss', queries: ['loss', 'lose', 'lost', 'grief'], evidence: ['loss', 'loses', 'lost'] },
  { name: 'family', queries: ['family', 'father', 'relatives', 'inheritance'], evidence: ['family', 'father', 'relatives', 'inheritance'] },
  { name: 'the land', queries: ['land', 'farm', 'field', 'farming', 'nature'], evidence: ['land', 'farm', 'field', 'farming'] },
  { name: 'a storm', queries: ['storm', 'typhoon'], evidence: ['storm', 'typhoon'] },
  { name: 'faith', queries: ['faith', 'god'], evidence: ['faith', 'god'] },
  { name: 'childhood', queries: ['child', 'childhood'], evidence: ['childhood', 'child'] },
  { name: 'unseen work', queries: ['unseen', 'work', 'working', 'presence'], evidence: ['work', 'working', 'presence'] },
  { name: 'rebuilding', queries: ['rebuild', 'rebuilding', 'starting over'], evidence: ['rebuild', 'rebuilding'] },
  { name: 'Project 39', queries: ['project 39'], evidence: ['project 39'] }
];

const openDiscoveryIds = [
  'bagsak',
  'sentensyador',
  'project-39-rebuild',
  'the-storm-answers',
  'maraming-kamay',
  'the-wilderness-original',
  'proof-of-presence',
  'project-39-four-movements'
];

let openDiscoveryCursor = 0;
let lastRecommendation = null;
let lastRequest = null;
const recommendedIds = new Set();
const conversationHistory = [
  { role: 'assistant', text: 'What are you looking for right now?' }
];

function parseSeconds(runtime) {
  if (!runtime) return null;
  const parts = runtime.split(':').map(Number);
  return parts.length === 2 ? parts[0] * 60 + parts[1] : null;
}

function parseMinutes(text) {
  const match = text.match(/(\d+)\s*(?:min|minute)/i);
  return match ? Number(match[1]) : null;
}

function textFor(film) {
  return [film.title, film.genre.join(' '), film.themes.join(' '), film.subject, film.setting, film.synopsis]
    .join(' ')
    .toLowerCase();
}

function requestedConcepts(text) {
  return concepts.filter(concept => concept.queries.some(term => text.includes(term)));
}

function avoidedConcepts(text) {
  const avoidChunks = [...text.matchAll(/(?:avoid(?:ing)?|without|no|don't want(?: anything)?(?: about)?|not about)\s+([^,.!?]+)/g)]
    .map(match => match[1]);
  return concepts.filter(concept => avoidChunks.some(chunk => concept.queries.some(term => chunk.includes(term))));
}

function requestFrom(text) {
  const lower = text.toLowerCase();
  return {
    query: text,
    minutes: parseMinutes(lower),
    short: /\bshort\b/.test(lower),
    concepts: requestedConcepts(lower),
    avoids: avoidedConcepts(lower),
    moods: ['emotional', 'hopeful', 'uplifting', 'gentle', 'tense', 'dark', 'funny'].filter(word => lower.includes(word)),
    language: lower.includes('tagalog') ? 'Tagalog' : lower.includes('english') ? 'English' : '',
    format: lower.includes('vertical') ? 'vertical' : lower.includes('16:9') || lower.includes('widescreen') ? '16:9' : lower.includes('documentary') ? 'documentary' : '',
    access: lower.includes('free') ? 'free' : '',
    explicitTitle: catalog.find(film => lower.includes(film.title.toLowerCase()))
  };
}

function requestFromStructured(aiRequest, query) {
  const lower = query.toLowerCase();
  const rawConcepts = aiRequest && Array.isArray(aiRequest.concepts) ? aiRequest.concepts : [];
  const rawAvoids = aiRequest && Array.isArray(aiRequest.avoids) ? aiRequest.avoids : [];

  let matchedConcepts = concepts.filter(c =>
    rawConcepts.some(rc => rc.toLowerCase() === c.name.toLowerCase())
  );
  if (!matchedConcepts.length) {
    matchedConcepts = requestedConcepts(lower);
  }

  let matchedAvoids = concepts.filter(c =>
    rawAvoids.some(ra => ra.toLowerCase() === c.name.toLowerCase())
  );
  if (!matchedAvoids.length) {
    matchedAvoids = avoidedConcepts(lower);
  }

  const minutes = (aiRequest && typeof aiRequest.minutes === 'number')
    ? aiRequest.minutes
    : parseMinutes(lower);

  const moods = (aiRequest && Array.isArray(aiRequest.moods) && aiRequest.moods.length)
    ? aiRequest.moods
    : ['emotional', 'hopeful', 'uplifting', 'gentle', 'tense', 'dark', 'funny'].filter(word => lower.includes(word));

  const language = (aiRequest && aiRequest.language)
    ? aiRequest.language
    : lower.includes('tagalog') ? 'Tagalog' : lower.includes('english') ? 'English' : '';

  const format = (aiRequest && aiRequest.format)
    ? aiRequest.format
    : lower.includes('vertical') ? 'vertical' : lower.includes('16:9') || lower.includes('widescreen') ? '16:9' : lower.includes('documentary') ? 'documentary' : '';

  const access = (aiRequest && aiRequest.access)
    ? aiRequest.access
    : lower.includes('free') ? 'free' : '';

  return {
    query,
    minutes,
    short: /\bshort\b/.test(lower) || (minutes !== null && minutes <= 10),
    concepts: matchedConcepts,
    avoids: matchedAvoids,
    moods,
    language,
    format,
    access,
    explicitTitle: catalog.find(film => lower.includes(film.title.toLowerCase()))
  };
}

function buildConversationState() {
  return {
    originalRequest: lastRequest ? {
      query: lastRequest.query || '',
      concepts: (lastRequest.concepts || []).map(c => c.name || c),
      moods: lastRequest.moods || [],
      minutes: lastRequest.minutes || null,
      language: lastRequest.language || '',
      format: lastRequest.format || '',
      access: lastRequest.access || '',
      avoids: (lastRequest.avoids || []).map(c => c.name || c)
    } : null,
    currentRecommendation: lastRecommendation ? {
      id: lastRecommendation.film.id,
      title: lastRecommendation.film.title
    } : null,
    currentFilm: lastRecommendation ? {
      id: lastRecommendation.film.id,
      title: lastRecommendation.film.title,
      subject: lastRecommendation.film.subject || '',
      synopsis: lastRecommendation.film.synopsis || '',
      themes: lastRecommendation.film.themes || [],
      runtime: lastRecommendation.film.runtime || '',
      language: lastRecommendation.film.language || [],
      format: lastRecommendation.film.format || '',
      access: lastRecommendation.film.access || '',
      award: lastRecommendation.film.award || ''
    } : null,
    history: conversationHistory.slice(-6)
  };
}

// Check if request has explicit constraints (theme/concepts, duration, language, format, access, explicit title)
function hasConstraints(request) {
  if (!request) return false;
  return Boolean(
    (request.concepts && request.concepts.length > 0) ||
    (request.minutes !== null && request.minutes !== undefined) ||
    request.language ||
    request.format ||
    request.access ||
    request.explicitTitle ||
    (request.avoids && request.avoids.length > 0)
  );
}

// Open discovery detection: matches open-ended discovery intent separately from constrained discovery
function isOpenDiscovery(text) {
  const lower = text.toLowerCase().trim();
  return [
    /\bsurprise(?:\s+me)?\b/,
    /\bi\s+don'?t\s+know\s+what\s+(?:i\s+)?(?:want\s+to\s+watch|to\s+watch)\b/,
    /\bi\s+don'?t\s+know\b/,
    /\b(?:i\s+)?have\s+no\s+idea\s+what\s+(?:i\s+)?(?:want\s+to\s+watch|to\s+watch)\b/,
    /\bwhat\s+should\s+i\s+watch\b/,
    /\byou\s+choose\b/,
    /\bchoose\s+(?:for\s+me|something|one|a\s+film)\b/,
    /\bpick\s+(?:something|a\s+film|one)(?:\s+for\s+me)?\b/,
    /\bpick\s+for\s+me\b/,
    /\b(?:just\s+)?recommend\s+(?:something|a\s+film|one)\b/,
    /\bjust\s+recommend\b/,
    /\b(?:i\s+)?(?:just\s+)?want\s+to\s+watch\s+something\b/,
    /\b(?:show|give)\s+me\s+something(?:\s+to\s+watch)?\b/,
    /\b(?:show|give)\s+me\s+anything\b/,
    /^anything[.!?]*$/
  ].some(pattern => pattern.test(lower));
}

function isWhyFollowUp(text) {
  return /^why\b(?:[^a-z]|$)/i.test(text.trim());
}

function isAnotherFollowUp(text) {
  return /\b(?:something else|another (?:one|film)|pick another)\b[.!?]*$/i.test(text.trim());
}

function isShorterFollowUp(text) {
  return /\b(?:something shorter|a? ?shorter (?:one|film))\b[.!?]*$/i.test(text.trim());
}

function isMoreFollowUp(text) {
  return /\b(?:tell me more|more about (?:this|it|that)|details)\b/i.test(text.trim());
}

function tellMeMoreText(film) {
  const parts = [];
  if (film.synopsis) {
    parts.push(film.synopsis.trim());
  } else if (film.subject) {
    parts.push(film.subject.trim());
  }

  if (film.award) {
    const award = film.award.trim();
    parts.push(award.endsWith('.') ? award : `${award}.`);
  } else if (film.setting) {
    const setting = film.setting.trim();
    parts.push(setting.endsWith('.') ? setting : `${setting}.`);
  }

  if (!parts.length) {
    parts.push(film.format || 'A catalogued work by Green Ralph.');
  }

  return `${film.title}: ${parts.join(' ')}`;
}

function publishedReason(film) {
  return film.subject || film.synopsis;
}

function openDiscoveryMatch(excludedIds = []) {
  const excluded = new Set(excludedIds);
  for (let offset = 0; offset < openDiscoveryIds.length; offset += 1) {
    const index = (openDiscoveryCursor + offset) % openDiscoveryIds.length;
    const film = catalog.find(item => item.id === openDiscoveryIds[index]);
    if (film && !excluded.has(film.id)) {
      openDiscoveryCursor = (index + 1) % openDiscoveryIds.length;
      return { film, matched: [], durationFits: false, score: 0, openDiscovery: true };
    }
  }
  const fallback = catalog.find(film => !excluded.has(film.id) && publishedReason(film));
  if (fallback) return { film: fallback, matched: [], durationFits: false, score: 0, openDiscovery: true };
  const anyFilm = catalog.find(film => publishedReason(film));
  if (anyFilm) return { film: anyFilm, matched: [], durationFits: false, score: 0, openDiscovery: true };
  return null;
}

function shorterMatch() {
  if (!lastRecommendation) return null;
  const currentDuration = parseSeconds(lastRecommendation.film.runtime);
  const choices = catalog
    .filter(film => film.id !== lastRecommendation.film.id && publishedReason(film) && parseSeconds(film.runtime) !== null)
    .filter(film => currentDuration === null || parseSeconds(film.runtime) < currentDuration)
    .sort((a, b) => parseSeconds(a.runtime) - parseSeconds(b.runtime));
  if (!choices.length) return null;
  return { film: choices[0], matched: [], durationFits: false, score: 0, shorter: true };
}

function hasReliableDiscoveryInfo(film, request) {
  return Boolean(film.synopsis || film.subject || request.explicitTitle === film || request.concepts.some(item => item.name === 'Project 39' && film.title.includes('PROJECT 39')));
}

function matchFilm(film, request) {
  const source = textFor(film);
  const matched = request.concepts.filter(concept => concept.evidence.some(term => source.includes(term)));
  const excluded = request.avoids.some(concept => concept.evidence.some(term => source.includes(term)));
  const duration = parseSeconds(film.runtime);
  const durationFits = request.minutes && duration !== null && duration <= request.minutes * 60;
  const durationTooLong = request.minutes && duration !== null && duration > request.minutes * 60;
  const shortFits = !request.short || duration !== null;
  const languageFits = !request.language || film.language.includes(request.language);
  const formatFits = !request.format || (film.format || '').toLowerCase().includes(request.format);
  const accessFits = !request.access || film.access === request.access;
  const exactTitle = request.explicitTitle === film;
  const evidence = matched.length || exactTitle || durationFits || request.format || request.language;

  if (!hasReliableDiscoveryInfo(film, request) || excluded || durationTooLong || !shortFits || !languageFits || !formatFits || !accessFits || !evidence) return null;

  let score = exactTitle ? 40 : 0;
  score += matched.length * 12;
  if (durationFits) score += 14;
  if (request.language) score += 5;
  if (request.format) score += 5;
  if (film.access === 'free') score += 0.1;
  return { film, matched, durationFits, score };
}

function describeRequest(request) {
  const pieces = [];
  if (request.concepts.length) pieces.push(request.concepts.map(item => item.name).join(' and '));
  if (request.moods.length) pieces.push(request.moods.join(' and ') + ' tone');
  if (request.minutes) pieces.push(`${request.minutes}-minute limit`);
  if (request.language) pieces.push(`${request.language} language`);
  if (request.format) pieces.push(`${request.format} format`);
  return pieces.join(', ') || 'that request';
}

function reasonFor(match, request) {
  const { film, matched, durationFits } = match;
  if (match.aiReason) return match.aiReason;
  if (match.openDiscovery) return publishedReason(film);
  if (match.shorter) return `Its ${film.runtime} runtime is the shortest published runtime available after the previous recommendation.`;
  const parts = [];
  if (durationFits) parts.push(`Its ${film.runtime} runtime fits your ${request.minutes}-minute window.`);
  if (matched.length) {
    const label = matched.map(item => item.name).join(' and ');
    parts.push(`It is the clearest published match for ${label}: ${film.synopsis || film.subject}`);
  } else if (request.format || request.language) {
    parts.push(`${film.synopsis || film.subject || 'This is a released Project 39 episode.'}`);
  } else {
    parts.push(film.synopsis || film.subject);
  }
  return parts.join(' ');
}

function addMessage(role, text) {
  conversationHistory.push({ role, text });
  const item = document.createElement('article');
  item.className = `message ${role}-message`;
  item.innerHTML = role === 'assistant'
    ? `<div class="avatar">V</div><div><p class="speaker">VER-DÉ</p><p>${text}</p></div>`
    : `<div><p>${text}</p></div>`;
  messages.append(item);
  messages.scrollTop = messages.scrollHeight;
}

function detailsFor(film) {
  return [film.runtime, film.language.join(' / '), film.format].filter(Boolean).join(' · ');
}

function renderRecommendations(matches, request) {
  recommendations.innerHTML = matches.map((match, index) => {
    const { film } = match;
    const details = detailsFor(film);
    return `<article class="film-card">
      <div class="film-number">${String(index + 1).padStart(2, '0')}</div>
      <div class="film-content">
        ${details ? `<p class="film-meta">${details}</p>` : ''}
        <h2>${film.title}</h2>
        <p class="access ${film.access}">${film.access === 'free' ? 'WATCH FREE' : 'FOUNDING ACCESS'}</p>
        ${film.award ? `<p class="award">${film.award}</p>` : ''}
        <p class="fit"><b>WHY THIS FITS</b>${reasonFor(match, request)}</p>
        <button class="watch" data-id="${film.id}">${film.access === 'free' ? 'Watch free' : 'Watch'} <span>→</span></button>
      </div>
    </article>`;
  }).join('');
  resultCount.textContent = `${matches.length} ${matches.length === 1 ? 'RECOMMENDATION' : 'RECOMMENDATIONS'}`;
}

function showNoConfidentMatch(request) {
  recommendations.innerHTML = `<p class="empty-state">VER-DÉ does not have enough published detail to confidently match ${describeRequest(request)} without guessing.</p>`;
  resultCount.textContent = 'NO CONFIDENT MATCH';
}

function responseFor(matches, request) {
  const publishedMoodNotes = request.moods.length > 0;
  const moodCaution = publishedMoodNotes ? ' VER-DÉ does not have published mood notes, so I won’t promise that tone.' : '';
  if (!matches.length) return `I can’t make a confident recommendation for ${describeRequest(request)} from the published information.${moodCaution}`;
  if (request.minutes && matches.every(match => !match.durationFits)) return `I found close subject matches, but VER-DÉ does not list a runtime for them, so I can’t confirm your time window.${moodCaution}`;
  return `These are the closest published matches for what you asked for.${moodCaution}`;
}

function remember(match, request) {
  lastRecommendation = match;
  lastRequest = request;
  recommendedIds.add(match.film.id);
}

// ── AI enrichment ──────────────────────────────────────────────────────────
// Calls /api/chat with the already-selected film(s) and the user's message.
// On success, patches each match with match.aiReason and returns { matches, chatMessage }.
// On any failure returns the originals + null chatMessage.
async function enrichWithAI(matches, userMessage, request) {
  if (typeof aiEnhance !== 'function' || !matches.length) {
    return { matches, chatMessage: null };
  }
  const films = matches.map(m => ({
    id:       m.film.id,
    title:    m.film.title,
    subject:  m.film.subject   || '',
    synopsis: m.film.synopsis  || '',
    themes:   m.film.themes,
    runtime:  m.film.runtime   || '',
    language: m.film.language,
    format:   m.film.format    || '',
    access:   m.film.access,
    award:    m.film.award     || ''
  }));
  const context = {
    isOpenDiscovery: matches.length === 1 && !!matches[0].openDiscovery,
    isShorter:       !!(matches[0] && matches[0].shorter),
    conceptNames:    request ? request.concepts.map(c => c.name) : []
  };
  const result = await aiEnhance(films, userMessage, context);
  if (!result) return { matches, chatMessage: null };
  const reasonMap = {};
  for (const r of result.reasons) reasonMap[r.filmId] = r.reason;
  for (const match of matches) {
    if (reasonMap[match.film.id]) match.aiReason = reasonMap[match.film.id];
  }
  return { matches, chatMessage: result.chatMessage || null };
}

function setLoading(on) {
  const btn = promptForm.querySelector('button[type="submit"]');
  btn.textContent  = on ? 'Asking…' : 'Ask';
  btn.disabled     = on;
  promptInput.disabled = on;
}
// ── /AI enrichment ─────────────────────────────────────────────────────────

// Fallback logic when AI understanding service is unreachable
async function handleFollowUpFallback(query) {
  if (isWhyFollowUp(query) && lastRecommendation) {
    const reason = publishedReason(lastRecommendation.film);
    const aiText = lastRecommendation.aiReason
      ? lastRecommendation.aiReason
      : reason.charAt(0).toLowerCase() + reason.slice(1);
    addMessage('assistant', `I chose ${lastRecommendation.film.title} because it centres on ${aiText}`);
    renderRecommendations([lastRecommendation], lastRequest);
    return true;
  }
  if (isAnotherFollowUp(query) && lastRecommendation) {
    const excludedId = lastRecommendation.film.id;
    const previousRequest = lastRequest || requestFrom(query);
    let next = null;
    if (previousRequest && hasConstraints(previousRequest)) {
      const intentMatches = catalog
        .map(film => matchFilm(film, previousRequest))
        .filter(Boolean)
        .filter(m => m.film.id !== excludedId)
        .sort((a, b) => b.score - a.score);
      if (intentMatches.length) {
        next = intentMatches[0];
        next.openDiscovery = false;
      }
    }
    if (!next) {
      next = openDiscoveryMatch([excludedId]);
      if (next) next.openDiscovery = true;
    }
    if (!next) {
      addMessage('assistant', 'VER-DÉ does not have another published work to suggest right now.');
      return true;
    }
    const { matches: [enriched], chatMessage } = await enrichWithAI([next], query, previousRequest);
    const film = (enriched && enriched.film) || next.film;
    addMessage('assistant', chatMessage || `Try ${film.title}. ${publishedReason(film)}`);
    renderRecommendations([enriched || next], previousRequest || requestFrom(query));
    lastRecommendation = enriched || next;
    recommendedIds.add(film.id);
    return true;
  }
  if (isShorterFollowUp(query) && lastRecommendation) {
    const shorter = shorterMatch();
    if (!shorter) {
      addMessage('assistant', 'VER-DÉ does not have a confirmed shorter runtime than the last recommendation. Most works in the catalog do not yet have a published runtime.');
      return true;
    }
    const preservedRequest = lastRequest;
    const { matches: [enriched], chatMessage } = await enrichWithAI([shorter], query, preservedRequest);
    const film = (enriched && enriched.film) || shorter.film;
    addMessage('assistant', chatMessage || `Watch ${film.title}. Its ${film.runtime} runtime is the shortest confirmed runtime available, shorter than the previous recommendation.`);
    renderRecommendations([enriched || shorter], preservedRequest || requestFrom(query));
    lastRecommendation = enriched || shorter;
    recommendedIds.add(film.id);
    return true;
  }
  if (isMoreFollowUp(query) && lastRecommendation) {
    addMessage('assistant', tellMeMoreText(lastRecommendation.film));
    renderRecommendations([lastRecommendation], lastRequest);
    return true;
  }
  return false;
}

async function recommendOpenDiscovery(query, structuredReq = null) {
  const request = structuredReq ? requestFromStructured(structuredReq, query) : requestFrom(query);
  const match = openDiscoveryMatch(recommendedIds);
  if (!match) {
    addMessage('assistant', 'I have run out of published recommendations to rotate through. Try a theme, time, language, or format.');
    showNoConfidentMatch(request);
    return;
  }
  const { matches: [enriched] } = await enrichWithAI([match], query, request);
  const film = (enriched && enriched.film) || match.film;
  const reason = publishedReason(film);
  addMessage('assistant', `Try ${film.title}. ${reason}`);
  renderRecommendations([enriched || match], request);
  remember(enriched || match, request);
}

// ── Main recommendation orchestrator ───────────────────────────────────────
// Flow:
// 1. User message is recorded in conversation history.
// 2. Gemini interprets the user's intent in light of conversation state.
// 3. The deterministic catalog engine selects actual catalog record(s).
// 4. Gemini generates natural language using only catalog facts.
// 5. Fallback keyword matching activates if Gemini is unavailable.
async function recommend(query) {
  expandMainAssistant();
  addMessage('user', query);

  // 1. Natural language understanding layer via Gemini
  let aiResult = null;
  if (typeof aiUnderstand === 'function') {
    const conversationState = buildConversationState();
    aiResult = await aiUnderstand(query, conversationState);
  }

  // 2. Process recognized conversational intent
  if (aiResult && aiResult.intent) {
    const { intent, request: structuredReq, chatMessage } = aiResult;

    // A. Explain why the current recommendation was chosen
    if (intent === 'explain_current' && lastRecommendation) {
      const reason = publishedReason(lastRecommendation.film);
      const fallbackText = lastRecommendation.aiReason
        ? lastRecommendation.aiReason
        : reason.charAt(0).toLowerCase() + reason.slice(1);
      const message = chatMessage || `I chose ${lastRecommendation.film.title} because it centres on ${fallbackText}`;
      addMessage('assistant', message);
      renderRecommendations([lastRecommendation], lastRequest);
      return;
    }

    // B. Natural follow-up / reaction to the current film
    if (intent === 'conversation' && lastRecommendation) {
      const message = chatMessage || tellMeMoreText(lastRecommendation.film);
      addMessage('assistant', message);
      renderRecommendations([lastRecommendation], lastRequest);
      return;
    }

    // C. Request for another film
    if (intent === 'another' && lastRecommendation) {
      const excludedId = lastRecommendation.film.id;
      const effectiveRequest = lastRequest || requestFromStructured(structuredReq, query);
      let next = null;
      if (effectiveRequest && hasConstraints(effectiveRequest)) {
        const intentMatches = catalog
          .map(film => matchFilm(film, effectiveRequest))
          .filter(Boolean)
          .filter(m => m.film.id !== excludedId)
          .sort((a, b) => b.score - a.score);
        if (intentMatches.length) {
          next = intentMatches[0];
          next.openDiscovery = false;
        }
      }
      if (!next) {
        next = openDiscoveryMatch([excludedId]);
        if (next) next.openDiscovery = true;
      }
      if (!next) {
        addMessage('assistant', 'VER-DÉ does not have another published work to suggest right now.');
        return;
      }
      const { matches: [enriched], chatMessage: aiChat } = await enrichWithAI([next], query, effectiveRequest);
      const film = (enriched && enriched.film) || next.film;
      addMessage('assistant', aiChat || `Try ${film.title}. ${publishedReason(film)}`);
      renderRecommendations([enriched || next], effectiveRequest);
      remember(enriched || next, effectiveRequest);
      return;
    }

    // D. Request for something shorter
    if (intent === 'shorter' && lastRecommendation) {
      const shorter = shorterMatch();
      if (!shorter) {
        addMessage('assistant', 'VER-DÉ does not have a confirmed shorter runtime than the last recommendation. Most works in the catalog do not yet have a published runtime.');
        return;
      }
      const effectiveRequest = lastRequest || requestFromStructured(structuredReq, query);
      const { matches: [enriched], chatMessage: aiChat } = await enrichWithAI([shorter], query, effectiveRequest);
      const film = (enriched && enriched.film) || shorter.film;
      addMessage('assistant', aiChat || `Watch ${film.title}. Its ${film.runtime} runtime is the shortest confirmed runtime available, shorter than the previous recommendation.`);
      renderRecommendations([enriched || shorter], effectiveRequest);
      remember(enriched || shorter, effectiveRequest);
      return;
    }

    // E. Open discovery / surprise me
    const reqFromAI = requestFromStructured(structuredReq, query);
    if (intent === 'open_discovery' || (isOpenDiscovery(query) && !hasConstraints(reqFromAI))) {
      await recommendOpenDiscovery(query, structuredReq);
      return;
    }

    // F. New recommendation request or changed preferences
    const request = reqFromAI;
    const rawMatches = catalog
      .map(film => matchFilm(film, request))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    const { matches, chatMessage: aiChat } = await enrichWithAI(rawMatches, query, request);
    addMessage('assistant', aiChat || responseFor(matches, request));
    if (matches.length) {
      renderRecommendations(matches, request);
      remember(matches[0], request);
    } else {
      showNoConfidentMatch(request);
    }
    return;
  }

  // 3. Fallback path if AI layer is unavailable
  if (await handleFollowUpFallback(query)) return;
  const fallbackReq = requestFrom(query);
  if (isOpenDiscovery(query) && !hasConstraints(fallbackReq)) {
    await recommendOpenDiscovery(query);
    return;
  }
  const request = fallbackReq;
  const rawMatches = catalog
    .map(film => matchFilm(film, request))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const { matches, chatMessage } = await enrichWithAI(rawMatches, query, request);
  addMessage('assistant', chatMessage || responseFor(matches, request));
  if (matches.length) {
    renderRecommendations(matches, request);
    remember(matches[0], request);
  } else {
    showNoConfidentMatch(request);
  }
}

promptForm.addEventListener('submit', async event => {
  event.preventDefault();
  const query = promptInput.value.trim();
  if (!query) return;
  setLoading(true);
  try {
    await recommend(query);
  } finally {
    setLoading(false);
    promptInput.value = '';
  }
});

// Keep the existing quick prompts unchanged; each simply submits its supplied text.
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => {
  expandMainAssistant();
  promptInput.value = button.dataset.prompt;
  promptForm.requestSubmit();
}));

const conversationSection = document.querySelector('#conversationSection');
const aiLauncher = document.querySelector('#aiLauncher');
const aiLauncherWrap = document.querySelector('#aiLauncherWrap');
const collapseAiBtn = document.querySelector('#collapseAi');
const filmCompanion = document.querySelector('#filmCompanion');
const companionLauncher = document.querySelector('#companionLauncher');
const companionLauncherBadge = document.querySelector('#companionLauncherBadge');
const collapseCompanionBtn = document.querySelector('#collapseCompanion');

function expandMainAssistant() {
  if (conversationSection) {
    conversationSection.classList.remove('is-collapsed');
    conversationSection.classList.add('is-expanded');
  }
  if (aiLauncherWrap) {
    aiLauncherWrap.classList.add('is-hidden');
  }
  if (aiLauncher) {
    aiLauncher.setAttribute('aria-expanded', 'true');
  }
}

function collapseMainAssistant() {
  if (conversationSection) {
    conversationSection.classList.add('is-collapsed');
    conversationSection.classList.remove('is-expanded');
  }
  if (aiLauncherWrap) {
    aiLauncherWrap.classList.remove('is-hidden');
  }
  if (aiLauncher) {
    aiLauncher.setAttribute('aria-expanded', 'false');
  }
}

if (aiLauncher) {
  aiLauncher.addEventListener('click', () => {
    expandMainAssistant();
    promptInput.focus();
  });
}

if (collapseAiBtn) {
  collapseAiBtn.addEventListener('click', () => {
    collapseMainAssistant();
  });
}

function expandCompanion() {
  if (filmCompanion) {
    filmCompanion.classList.remove('is-collapsed');
    filmCompanion.classList.add('is-expanded');
  }
  if (companionLauncher) {
    companionLauncher.setAttribute('aria-expanded', 'true');
  }
  if (companionInput) {
    companionInput.focus();
  }
}

function collapseCompanion() {
  if (filmCompanion) {
    filmCompanion.classList.add('is-collapsed');
    filmCompanion.classList.remove('is-expanded');
  }
  if (companionLauncher) {
    companionLauncher.setAttribute('aria-expanded', 'false');
  }
}

if (companionLauncher) {
  companionLauncher.addEventListener('click', () => {
    expandCompanion();
  });
}

if (collapseCompanionBtn) {
  collapseCompanionBtn.addEventListener('click', () => {
    collapseCompanion();
  });
}

const companionMessages = document.querySelector('#companionMessages');
const companionForm = document.querySelector('#companionForm');
const companionInput = document.querySelector('#companionInput');
const companionSuggestions = document.querySelector('#companionSuggestions');
const companionFilmBadge = document.querySelector('#companionFilmBadge');
let currentWatchedFilm = null;

function addCompanionMessage(role, text) {
  const item = document.createElement('article');
  item.className = `message ${role}-message`;
  item.innerHTML = role === 'assistant'
    ? `<div class="avatar">V</div><div><p class="speaker">VER-DÉ</p><p>${text}</p></div>`
    : `<div><p>${text}</p></div>`;
  companionMessages.append(item);
  companionMessages.scrollTop = companionMessages.scrollHeight;
}

function getSuggestedQuestionsFor(film) {
  const suggestions = ['What is this film about?'];
  if (film.setting || film.countryLocation) {
    suggestions.push('Where was this filmed?');
  }
  if (film.award) {
    suggestions.push('Has this won awards?');
  } else if (film.themes && film.themes.length > 0) {
    suggestions.push('What are the themes?');
  }
  if (film.runtime) {
    suggestions.push('What is the runtime?');
  } else if (film.language && film.language.length > 0) {
    suggestions.push('What language is this in?');
  }
  return suggestions.slice(0, 4);
}

function answerFilmQuestion(film, question) {
  const q = question.toLowerCase();

  // Director / Filmmaker
  if (/\b(?:who\s+(?:directed|made|created|wrote)|director|filmmaker|creator)\b/.test(q)) {
    return `${film.title} is directed by ${film.filmmaker || 'Green Ralph'} from ${film.countryLocation || 'Nabua, Camarines Sur, Philippines'}.`;
  }

  // Location / Setting
  if (/\b(?:where\s+(?:was\s+this|is\s+this|filmed|shot)|setting|location|place)\b/.test(q)) {
    if (film.setting) {
      return `${film.title} is set in ${film.setting}, based in ${film.countryLocation || 'Nabua, Camarines Sur, Philippines'}.`;
    }
    return `${film.title} is rooted in ${film.countryLocation || 'Nabua, Camarines Sur, Philippines'}.`;
  }

  // Awards / Festival recognition
  if (/\b(?:award|awards|won|festival|recognition|finalist|nominee|entry)\b/.test(q)) {
    if (film.award) {
      return `Published recognition for ${film.title}: ${film.award}.`;
    }
    return `VER-DÉ does not list official award or festival entry details for ${film.title} in the catalog.`;
  }

  // Runtime / Duration
  if (/\b(?:how\s+long|runtime|duration|minutes|length|time)\b/.test(q)) {
    if (film.runtime) {
      return `The confirmed runtime for ${film.title} is ${film.runtime}.`;
    }
    return `VER-DÉ does not have a confirmed runtime published for ${film.title} yet.`;
  }

  // Language
  if (/\b(?:language|dialect|spoken|tagalog|english|bikol)\b/.test(q)) {
    if (film.language && film.language.length) {
      return `The spoken language for ${film.title} is ${film.language.join(' and ')}.`;
    }
    return `VER-DÉ does not list a published spoken language for ${film.title}.`;
  }

  // Themes / Subject
  if (/\b(?:theme|themes|topic|subject|focus)\b/.test(q)) {
    if (film.themes && film.themes.length) {
      return `Catalogued themes for ${film.title}: ${film.themes.join(', ')}.`;
    }
    if (film.subject) {
      return `Documented subject for ${film.title}: ${film.subject}`;
    }
    return `Specific themes are not documented in the catalog for this entry.`;
  }

  // Format / Cut
  if (/\b(?:format|cut|aspect|ratio|vertical|16:9|9:16|documentary)\b/.test(q)) {
    if (film.format) {
      return `${film.title} is formatted as ${film.format}.`;
    }
    return `Specific format details are not listed in the catalog for this work.`;
  }

  // Access / How to watch
  if (/\b(?:access|cost|price|subscription|pay|payment|free|founding|how\s+(?:can|do)?\s*i\s+watch|how\s+to\s+watch)\b/.test(q)) {
    if (film.access === 'free') {
      return `${film.title} is free to watch directly on VER-DÉ.`;
    }
    return `${film.title} is available through Founding Access (one payment, lifetime access, no subscription).`;
  }

  // Synopsis / Story / Plot / Premise / What is this about
  if (/\b(?:what(?:'s|\s+is)\s+(?:this|it)\s+about|about|story|synopsis|plot|premise|what\s+happens)\b/.test(q)) {
    if (film.synopsis) {
      if (film.subject && !film.synopsis.toLowerCase().includes('sentenced') && !film.synopsis.toLowerCase().includes(film.subject.toLowerCase().slice(0, 15))) {
        return `${film.subject} ${film.synopsis}`;
      }
      return film.synopsis;
    }
    return film.subject || 'This is an official episode in the Project 39 vertical series.';
  }

  // General fallback grounded strictly in catalog facts
  const details = [
    film.synopsis || film.subject,
    film.award ? `Recognition: ${film.award}.` : '',
    film.runtime ? `Runtime: ${film.runtime}.` : '',
    film.language && film.language.length ? `Language: ${film.language.join('/')}.` : ''
  ].filter(Boolean).join(' ');

  return details || `${film.title} is a catalogued work by ${film.filmmaker || 'Green Ralph'}.`;
}

function setupFilmCompanion(film) {
  currentWatchedFilm = film;
  collapseCompanion();
  if (companionLauncherBadge) companionLauncherBadge.textContent = film.title;
  if (companionFilmBadge) companionFilmBadge.textContent = film.title;
  if (companionMessages) {
    companionMessages.innerHTML = '';
    addCompanionMessage('assistant', `I’m here with you for ${film.title}. Ask me anything about this film.`);
  }
  if (companionSuggestions) {
    const suggestions = getSuggestedQuestionsFor(film);
    companionSuggestions.innerHTML = suggestions
      .map(q => `<button type="button" data-companion-prompt="${q}">${q}</button>`)
      .join('');
  }
}

recommendations.addEventListener('click', event => {
  const button = event.target.closest('.watch');
  if (!button) return;
  const film = catalog.find(item => item.id === button.dataset.id);
  if (!film) return;
  document.querySelector('#dialogTitle').textContent = film.title;
  const text = document.querySelector('#dialogText');
  const player = document.querySelector('#dialogPlayer');
  const action = document.querySelector('#dialogAction');
  if (film.access === 'free') {
    text.textContent = 'Free to watch on VER-DÉ.';
    player.src = `https://www.youtube-nocookie.com/embed/${film.videoId}?autoplay=1&rel=0&playsinline=1`;
    player.hidden = false;
    action.hidden = true;
  } else {
    text.textContent = 'This film is part of Founding Access. One payment. Lifetime access. No subscription.';
    player.src = '';
    player.hidden = true;
    action.href = 'https://ver-de.com/#offer';
    action.hidden = false;
  }
  setupFilmCompanion(film);
  watchDialog.showModal();
});

if (companionForm) {
  companionForm.addEventListener('submit', event => {
    event.preventDefault();
    const question = companionInput.value.trim();
    if (!question || !currentWatchedFilm) return;
    companionInput.value = '';
    addCompanionMessage('user', question);
    const answer = answerFilmQuestion(currentWatchedFilm, question);
    addCompanionMessage('assistant', answer);
  });
}

if (companionSuggestions) {
  companionSuggestions.addEventListener('click', event => {
    const btn = event.target.closest('[data-companion-prompt]');
    if (!btn || !currentWatchedFilm) return;
    companionInput.value = btn.dataset.companionPrompt;
    companionForm.requestSubmit();
  });
}

document.querySelector('.close-dialog').addEventListener('click', () => {
  document.querySelector('#dialogPlayer').src = '';
  currentWatchedFilm = null;
  collapseCompanion();
  watchDialog.close();
});

// Stop playback when the user dismisses the dialog via the Escape key.
watchDialog.addEventListener('cancel', () => {
  document.querySelector('#dialogPlayer').src = '';
  currentWatchedFilm = null;
  collapseCompanion();
});
