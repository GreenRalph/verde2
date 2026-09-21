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

function isOpenDiscovery(text) {
  const lower = text.toLowerCase().trim();
  return [
    /\bsurprise me\b/,
    // "I don't know what to watch", "I don't know what I want to watch tonight", etc.
    /\bi don'?t know (?:(?:what )?(i )?want to watch|what (?:i want )?to watch)(?: \w+)*\b/,
    // "I have no idea what to watch" / "no idea what I want to watch"
    /\bi have no idea what (?:i want )?to watch\b/,
    // "What should I watch?" / "What should I watch tonight?"
    /\bwhat should i watch\b/,
    /\byou choose(?: something)? for me\b/,
    /\bpick (?:something|a film)? ?for me\b/,
    /\bjust recommend something\b/,
    /^i just want to watch something[.!?]*$/
  ].some(pattern => pattern.test(lower));
}

function isWhyFollowUp(text) {
  // Matches: "why?", "why that?", "why this one?", "why did you choose that?", "why did you pick this?", etc.
  return /^why\b(?:[^a-z]|$)/i.test(text.trim());
}

function isAnotherFollowUp(text) {
  // Matches: "something else", "something else?", "another one", "pick another", etc.
  return /\b(?:something else|another (?:one|film)|pick another)\b[.!?]*$/i.test(text.trim());
}

function isShorterFollowUp(text) {
  // Matches: "something shorter", "something shorter?", "a shorter one", etc.
  return /\b(?:something shorter|a? ?shorter (?:one|film))\b[.!?]*$/i.test(text.trim());
}

function publishedReason(film) {
  return film.subject || film.synopsis;
}

function openDiscoveryMatch(excludedIds = []) {
  const excluded = new Set(excludedIds);
  // First pass: rotate through the curated open-discovery list.
  for (let offset = 0; offset < openDiscoveryIds.length; offset += 1) {
    const index = (openDiscoveryCursor + offset) % openDiscoveryIds.length;
    const film = catalog.find(item => item.id === openDiscoveryIds[index]);
    if (film && !excluded.has(film.id)) {
      openDiscoveryCursor = (index + 1) % openDiscoveryIds.length;
      return { film, matched: [], durationFits: false, score: 0, openDiscovery: true };
    }
  }
  // Fallback: the curated list is exhausted for this session; pick any catalog
  // film that has published discovery information and has not been recommended.
  const fallback = catalog.find(film => !excluded.has(film.id) && publishedReason(film));
  if (fallback) return { film: fallback, matched: [], durationFits: false, score: 0, openDiscovery: true };
  // Absolute last resort: ignore exclusions so the session never hard-stops.
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
  // AI-written reason takes priority when available; keyword-engine text is the fallback.
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
// On any failure (no API key, network error, bad shape) returns the originals + null chatMessage.
// The keyword-engine text in reasonFor() and the fallback chat strings remain the safety net.
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
  // Build a filmId → reason map and patch each match object.
  const reasonMap = {};
  for (const r of result.reasons) reasonMap[r.filmId] = r.reason;
  for (const match of matches) {
    if (reasonMap[match.film.id]) match.aiReason = reasonMap[match.film.id];
  }
  return { matches, chatMessage: result.chatMessage || null };
}

// Disable the form while waiting for AI; restore when done.
function setLoading(on) {
  const btn = promptForm.querySelector('button[type="submit"]');
  btn.textContent  = on ? 'Asking…' : 'Ask';
  btn.disabled     = on;
  promptInput.disabled = on;
}
// ── /AI enrichment ─────────────────────────────────────────────────────────

async function recommendOpenDiscovery(query) {
  const request = requestFrom(query);
  const match = openDiscoveryMatch(recommendedIds);
  addMessage('user', query);
  if (!match) {
    addMessage('assistant', 'I have run out of published recommendations to rotate through. Try a theme, time, language, or format.');
    showNoConfidentMatch(request);
    return;
  }
  const { matches: [enriched], chatMessage } = await enrichWithAI([match], query, request);
  addMessage('assistant', chatMessage || `Watch ${enriched.film.title}. ${publishedReason(enriched.film)}`);
  renderRecommendations([enriched], request);
  remember(enriched, request);
}

async function handleFollowUp(query) {
  if (isWhyFollowUp(query) && lastRecommendation) {
    addMessage('user', query);
    const reason = publishedReason(lastRecommendation.film);
    // Re-use the stored aiReason if available; otherwise fall back to published text.
    const aiText = lastRecommendation.aiReason
      ? lastRecommendation.aiReason
      : reason.charAt(0).toLowerCase() + reason.slice(1);
    addMessage('assistant', `I chose ${lastRecommendation.film.title} because it centres on ${aiText}`);
    renderRecommendations([lastRecommendation], lastRequest);
    return true;
  }
  if (isAnotherFollowUp(query) && lastRecommendation) {
    addMessage('user', query);
    // Re-use the original search intent so preferences are preserved.
    const excludedId = lastRecommendation.film.id;
    const previousRequest = lastRequest || requestFrom(query);
    let next = null;
    if (previousRequest) {
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
    addMessage('assistant', chatMessage || `Watch ${enriched.film.title}. ${publishedReason(enriched.film)}`);
    renderRecommendations([enriched], previousRequest || requestFrom(query));
    lastRecommendation = enriched;
    recommendedIds.add(enriched.film.id);
    // lastRequest intentionally unchanged so intent is preserved across follow-ups.
    return true;
  }
  if (isShorterFollowUp(query) && lastRecommendation) {
    const shorter = shorterMatch();
    addMessage('user', query);
    if (!shorter) {
      addMessage('assistant', 'VER-DÉ does not have a confirmed shorter runtime than the last recommendation. Most works in the catalog do not yet have a published runtime.');
      return true;
    }
    const preservedRequest = lastRequest;
    const { matches: [enriched], chatMessage } = await enrichWithAI([shorter], query, preservedRequest);
    addMessage('assistant', chatMessage || `Watch ${enriched.film.title}. Its ${enriched.film.runtime} runtime is the shortest confirmed runtime available, shorter than the previous recommendation.`);
    renderRecommendations([enriched], preservedRequest || requestFrom(query));
    // Update the immediate recommendation; keep lastRequest (original intent) unchanged.
    lastRecommendation = enriched;
    recommendedIds.add(enriched.film.id);
    return true;
  }
  return false;
}

async function recommend(query) {
  if (await handleFollowUp(query)) return;
  if (isOpenDiscovery(query)) {
    await recommendOpenDiscovery(query);
    return;
  }
  const request = requestFrom(query);
  const rawMatches = catalog
    .map(film => matchFilm(film, request))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  addMessage('user', query);
  const { matches, chatMessage } = await enrichWithAI(rawMatches, query, request);
  addMessage('assistant', chatMessage || responseFor(matches, request));
  if (matches.length) {
    renderRecommendations(matches, request);
    remember(matches[0], request);
  }
  else showNoConfidentMatch(request);
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
  promptInput.value = button.dataset.prompt;
  promptForm.requestSubmit();
}));

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
  watchDialog.showModal();
});

document.querySelector('.close-dialog').addEventListener('click', () => {
  document.querySelector('#dialogPlayer').src = '';
  watchDialog.close();
});

// Stop playback when the user dismisses the dialog via the Escape key.
watchDialog.addEventListener('cancel', () => {
  document.querySelector('#dialogPlayer').src = '';
});
