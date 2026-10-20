// VER-DÉ for TV — the 10-foot, remote-first presentation of the VER-DÉ 2.0 engine.
//
// Reuses the engine as-is:
//   • catalog.js     — the 17 catalogued VER-DÉ works
//   • ai-client.js   — aiUnderstand() / aiEnhance() → /api/chat (Gemini, server-side key)
// Adds what a television needs:
//   • D-pad spatial navigation (no pointer, no typing)
//   • "Who's watching" households with on-device memory that re-ranks recommendations
//   • a Back-key bridge for the Fire OS app (window.verdeBack)
//   • full-screen playback for free films, scan-to-unlock QR for Founding Access films
// If the AI layer is unreachable, every path falls back to the deterministic keyword engine.

'use strict';

// ── Engine vocabulary (mirrors app.js so web and TV interpret requests the same way) ──
const CONCEPTS = [
  { name: 'being judged', queries: ['judged', 'judgement', 'judgment', 'sentenced', 'sentence'], evidence: ['judgement', 'sentenced'] },
  { name: 'loss', queries: ['loss', 'lose', 'lost', 'losing', 'grief'], evidence: ['loss', 'loses', 'lost'] },
  { name: 'family', queries: ['family', 'father', 'relatives', 'inheritance'], evidence: ['family', 'father', 'relatives', 'inheritance'] },
  { name: 'the land', queries: ['land', 'farm', 'field', 'farming', 'nature'], evidence: ['land', 'farm', 'field', 'farming'] },
  { name: 'a storm', queries: ['storm', 'typhoon'], evidence: ['storm', 'typhoon'] },
  { name: 'faith', queries: ['faith', 'god'], evidence: ['faith', 'god'] },
  { name: 'childhood', queries: ['child', 'childhood'], evidence: ['childhood', 'child'] },
  { name: 'unseen work', queries: ['unseen', 'work', 'working', 'presence'], evidence: ['work', 'working', 'presence'] },
  { name: 'rebuilding', queries: ['rebuild', 'rebuilding', 'starting over'], evidence: ['rebuild', 'rebuilding'] },
  { name: 'Project 39', queries: ['project 39'], evidence: ['project 39'] }
];

const OPEN_DISCOVERY_IDS = [
  'bagsak', 'sentensyador', 'project-39-rebuild', 'the-storm-answers',
  'maraming-kamay', 'the-wilderness-original', 'proof-of-presence', 'project-39-four-movements'
];

// Mood → works whose published descriptions carry that tone (same curation as the web engine's reasons).
const MOOD_AFFINITY = {
  hopeful: ['project-39-rebuild', 'the-wilderness-original', 'bagsak'],
  uplifting: ['project-39-rebuild', 'the-wilderness-original'],
  emotional: ['project-39-rebuild', 'bagsak', 'the-wilderness-original'],
  gentle: ['maraming-kamay', 'the-wilderness-original'],
  dark: ['the-storm-answers', 'sentensyador'],
  tense: ['the-storm-answers', 'sentensyador']
};

const HOUSEHOLDS = {
  solo: { label: 'Just me', tag: 'watching alone', last: 'Last time on your own' },
  family: { label: 'With family', tag: 'watching with family', last: 'Last time with family' },
  together: { label: 'With someone', tag: 'watching with someone', last: 'Last time together' }
};

const OFFER_URL = 'https://ver-de.com/#offer';
const AI_TIMEOUT_MS = 12000;
const STORE_KEY = 'verde.tv.households.v1';

// ── State ──
const state = {
  household: null,
  request: null,       // last structured request
  query: '',
  shown: [],           // film ids shown in the current thread (for "another")
  results: [],         // current matches on screen
  focusFilm: null,     // film under the remote's focus on the results screen
  returnFocus: null,
  busy: false
};

// ── Household memory (on-device) ──
function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
function saveStore(store) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* storage unavailable: memory is a convenience */ }
}
function memoryFor(household) {
  const store = loadStore();
  return store[household] || { watched: [], passed: [], cursor: 0 };
}
function updateMemory(household, fn) {
  const store = loadStore();
  const mem = store[household] || { watched: [], passed: [], cursor: 0 };
  fn(mem);
  mem.watched = mem.watched.slice(0, 12);
  mem.passed = [...new Set(mem.passed)].slice(-24);
  store[household] = mem;
  saveStore(store);
}
function recordWatched(film) {
  if (!state.household) return;
  updateMemory(state.household, mem => {
    mem.watched = [{ id: film.id, at: Date.now() }, ...mem.watched.filter(w => w.id !== film.id)];
  });
}
function recordPassed(ids) {
  if (!state.household) return;
  updateMemory(state.household, mem => { mem.passed.push(...ids); });
}
function lastWatched(household) {
  const mem = memoryFor(household);
  return mem.watched.map(w => filmById(w.id)).filter(Boolean);
}

// ── Catalog helpers ──
function filmById(id) { return catalog.find(f => f.id === id) || null; }
function textFor(film) {
  return [film.title, film.genre.join(' '), film.themes.join(' '), film.subject, film.setting, film.synopsis].join(' ').toLowerCase();
}
function parseSeconds(runtime) {
  if (!runtime) return null;
  const parts = runtime.split(':').map(Number);
  return parts.length === 2 ? parts[0] * 60 + parts[1] : null;
}
function parseMinutes(text) {
  const m = text.match(/(\d+)\s*(?:min|minute)/i);
  return m ? Number(m[1]) : null;
}
function conceptsIn(film) {
  const source = textFor(film);
  return CONCEPTS.filter(c => c.evidence.some(term => source.includes(term)));
}
function hasPublishedDescription(film) { return Boolean(film.subject || film.synopsis); }

function requestFromStructured(aiRequest, query) {
  const lower = query.toLowerCase();
  const raw = aiRequest && Array.isArray(aiRequest.concepts) ? aiRequest.concepts : [];
  const rawAvoids = aiRequest && Array.isArray(aiRequest.avoids) ? aiRequest.avoids : [];
  let concepts = CONCEPTS.filter(c => raw.some(r => String(r).toLowerCase() === c.name.toLowerCase()));
  if (!concepts.length) concepts = CONCEPTS.filter(c => c.queries.some(t => lower.includes(t)));
  const avoids = CONCEPTS.filter(c => rawAvoids.some(r => String(r).toLowerCase() === c.name.toLowerCase()));
  const minutes = aiRequest && typeof aiRequest.minutes === 'number' ? aiRequest.minutes : parseMinutes(lower);
  const moods = aiRequest && Array.isArray(aiRequest.moods) && aiRequest.moods.length
    ? aiRequest.moods.map(m => String(m).toLowerCase())
    : Object.keys(MOOD_AFFINITY).filter(m => lower.includes(m));
  return {
    query,
    concepts,
    avoids,
    minutes,
    moods,
    language: (aiRequest && aiRequest.language) || (lower.includes('tagalog') ? 'Tagalog' : lower.includes('english') ? 'English' : ''),
    format: (aiRequest && aiRequest.format) || (lower.includes('vertical') ? 'vertical' : lower.includes('documentary') ? 'documentary' : ''),
    access: (aiRequest && aiRequest.access) || (/\bfree\b/.test(lower) ? 'free' : ''),
    explicitTitle: catalog.find(f => lower.includes(f.title.toLowerCase())) || null
  };
}

function hasConstraints(req) {
  return Boolean(req.concepts.length || req.minutes || req.language || req.format || req.access || req.explicitTitle || req.moods.some(m => MOOD_AFFINITY[m]));
}

function isOpenDiscovery(text) {
  return /(don'?t know what|surprise me|pick (something|for me)|you choose|anything|what should (i|we) watch|help me)/i.test(text);
}

// Household taste: concepts of what this household chose before.
function householdTaste() {
  if (!state.household) return { watchedIds: new Set(), concepts: new Set(), byConcept: {} };
  const films = lastWatched(state.household).slice(0, 5);
  const concepts = new Set();
  const byConcept = {};
  for (const film of films) {
    for (const c of conceptsIn(film)) {
      concepts.add(c.name);
      if (!byConcept[c.name]) byConcept[c.name] = film;
    }
  }
  return { watchedIds: new Set(films.map(f => f.id)), concepts, byConcept };
}

function scoreFilm(film, req, taste) {
  if (!hasPublishedDescription(film) && req.explicitTitle !== film) return null;
  const source = textFor(film);
  const matched = req.concepts.filter(c => c.evidence.some(t => source.includes(t)));
  if (req.avoids.some(c => c.evidence.some(t => source.includes(t)))) return null;
  const seconds = parseSeconds(film.runtime);
  if (req.minutes) {
    if (seconds === null || seconds > req.minutes * 60) return null;
  }
  if (req.language && !film.language.includes(req.language)) return null;
  if (req.format && !(film.format || '').toLowerCase().includes(req.format)) return null;
  if (req.access && film.access !== req.access) return null;

  const moodHit = req.moods.some(m => (MOOD_AFFINITY[m] || []).includes(film.id));
  const exact = req.explicitTitle === film;
  if (!matched.length && !moodHit && !exact && !req.minutes && !req.language && !req.format && !req.access) return null;

  let score = (exact ? 40 : 0) + matched.length * 12 + (moodHit ? 8 : 0) + (req.minutes ? 14 : 0);
  // Household memory: lean toward what this household gravitates to; prefer something new to them.
  const shared = conceptsIn(film).filter(c => taste.concepts.has(c.name));
  score += shared.length * 2;
  if (taste.watchedIds.has(film.id)) score -= 6;
  return { film, matched, score, sharedWith: shared.length ? taste.byConcept[shared[0].name] : null };
}

function rank(req, excludeIds) {
  const taste = householdTaste();
  return catalog
    .filter(f => !excludeIds.has(f.id))
    .map(f => scoreFilm(f, req, taste))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
}

function openPicks(n, excludeIds) {
  const taste = householdTaste();
  const mem = state.household ? memoryFor(state.household) : { cursor: 0 };
  const pool = OPEN_DISCOVERY_IDS.map(filmById).filter(f => f && !excludeIds.has(f.id));
  // New-to-this-household first, then rotate so "surprise me" never repeats the same opening.
  const fresh = pool.filter(f => !taste.watchedIds.has(f.id));
  const seen = pool.filter(f => taste.watchedIds.has(f.id));
  const rotated = fresh.length ? [...fresh.slice(mem.cursor % fresh.length), ...fresh.slice(0, mem.cursor % fresh.length)] : [];
  if (state.household) updateMemory(state.household, m => { m.cursor = (m.cursor || 0) + 1; });
  return [...rotated, ...seen].slice(0, n).map(film => {
    const shared = conceptsIn(film).filter(c => taste.concepts.has(c.name));
    return { film, matched: [], score: 0, open: true, sharedWith: shared.length ? taste.byConcept[shared[0].name] : null };
  });
}

function fallbackReason(film) {
  return film.subject || film.synopsis || 'An official work in the VER-DÉ catalog by Green Ralph.';
}

function conversationState() {
  const film = state.focusFilm || (state.results[0] && state.results[0].film) || null;
  return {
    household: state.household ? HOUSEHOLDS[state.household].tag : '',
    originalRequest: state.request ? {
      query: state.request.query,
      concepts: state.request.concepts.map(c => c.name),
      moods: state.request.moods,
      minutes: state.request.minutes || null,
      language: state.request.language,
      format: state.request.format,
      access: state.request.access,
      avoids: state.request.avoids.map(c => c.name)
    } : null,
    currentRecommendation: film ? { id: film.id, title: film.title } : null,
    currentFilm: film ? {
      id: film.id, title: film.title, subject: film.subject || '', synopsis: film.synopsis || '',
      themes: film.themes || [], runtime: film.runtime || '', language: film.language || [],
      format: film.format || '', access: film.access || '', award: film.award || '',
      filmmaker: film.filmmaker || 'Green Ralph', countryLocation: film.countryLocation || '', setting: film.setting || ''
    } : null,
    history: []
  };
}

function withTimeout(promise) {
  return Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(null), AI_TIMEOUT_MS))]);
}
async function understand(query) {
  if (typeof aiUnderstand !== 'function') return null;
  try { return await withTimeout(aiUnderstand(query, conversationState())); } catch { return null; }
}
async function enhance(matches, query, extra = {}) {
  if (typeof aiEnhance !== 'function' || !matches.length) return null;
  const films = matches.map(m => ({
    id: m.film.id, title: m.film.title, subject: m.film.subject || '', synopsis: m.film.synopsis || '',
    themes: m.film.themes, runtime: m.film.runtime || '', language: m.film.language,
    format: m.film.format || '', access: m.film.access, award: m.film.award || ''
  }));
  const context = {
    household: state.household ? HOUSEHOLDS[state.household].tag : '',
    isOpenDiscovery: matches.every(m => m.open),
    conceptNames: state.request ? state.request.concepts.map(c => c.name) : [],
    ...extra
  };
  try { return await withTimeout(aiEnhance(films, query, context)); } catch { return null; }
}

// ── DOM ──
const $ = sel => document.querySelector(sel);
const screens = { who: $('#screenWho'), moment: $('#screenMoment'), results: $('#screenResults') };
let current = 'who';

function show(name) {
  for (const [key, el] of Object.entries(screens)) el.classList.toggle('is-active', key === name);
  current = name;
}

function setBackdrop(film) {
  const el = $('#backdrop');
  if (!film) { el.classList.remove('is-on'); return; }
  el.style.backgroundImage = `url("https://i.ytimg.com/vi/${film.videoId}/hqdefault.jpg")`;
  el.classList.add('is-on');
}

function paintArt(el, film) {
  const hq = `https://i.ytimg.com/vi/${film.videoId}/hqdefault.jpg`;
  const max = `https://i.ytimg.com/vi/${film.videoId}/maxresdefault.jpg`;
  el.style.backgroundImage = `url("${hq}")`;
  const probe = new Image();
  probe.onload = () => { if (probe.naturalWidth > 120) el.style.backgroundImage = `url("${max}")`; };
  probe.src = max;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Spatial navigation for the remote ──
function activeLayer() {
  if (!$('#access').hidden) return $('#access');
  if (!$('#player').hidden) return $('#player');
  return screens[current];
}
function focusables() {
  return [...activeLayer().querySelectorAll('.f')].filter(el => el.offsetParent !== null && !el.disabled);
}
function focusFirst(selector) {
  const target = (selector && activeLayer().querySelector(selector)) || focusables()[0];
  if (target) target.focus({ preventScroll: true });
}
function move(dir) {
  const items = focusables();
  if (!items.length) return;
  const from = document.activeElement;
  if (!items.includes(from)) { items[0].focus({ preventScroll: true }); return; }
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  // Gap between two ranges on the cross axis (0 when they overlap, i.e. same row/column).
  const gap = (s1, e1, s2, e2) => Math.max(0, Math.max(s1, s2) - Math.min(e1, e2));
  let best = null, bestScore = Infinity;
  for (const el of items) {
    if (el === from) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2, by = b.top + b.height / 2;
    let edge, cross, drift;
    if (dir === 'right') { if (b.left <= ax) continue; edge = Math.max(0, b.left - a.right); cross = gap(a.top, a.bottom, b.top, b.bottom); drift = Math.abs(by - ay); }
    if (dir === 'left') { if (b.right >= ax) continue; edge = Math.max(0, a.left - b.right); cross = gap(a.top, a.bottom, b.top, b.bottom); drift = Math.abs(by - ay); }
    if (dir === 'down') { if (b.top <= ay) continue; edge = Math.max(0, b.top - a.bottom); cross = gap(a.left, a.right, b.left, b.right); drift = Math.abs(bx - ax); }
    if (dir === 'up') { if (b.bottom >= ay) continue; edge = Math.max(0, a.top - b.bottom); cross = gap(a.left, a.right, b.left, b.right); drift = Math.abs(bx - ax); }
    const score = edge + cross * 4 + drift * 0.25;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) best.focus({ preventScroll: true });
}

document.addEventListener('keydown', event => {
  const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  if (map[event.key]) { event.preventDefault(); move(map[event.key]); return; }
  if (event.key === 'Escape' || event.key === 'Backspace' || event.key === 'GoBack' || event.key === 'BrowserBack') {
    event.preventDefault();
    window.verdeBack();
  }
});

document.addEventListener('focusin', event => {
  const card = event.target.closest('.card, .mini');
  if (card && card.dataset.id) {
    const film = filmById(card.dataset.id);
    if (current === 'results') state.focusFilm = film;
    setBackdrop(film);
  }
});

// Called by the Fire OS app when the remote's Back button is pressed.
// Returns true when VER-DÉ handled it, false when the app should exit.
window.verdeBack = function verdeBack() {
  if (!$('#access').hidden) { closeAccess(); return true; }
  if (!$('#player').hidden) { closePlayer(); return true; }
  if (current === 'results') { openMoment(); return true; }
  if (current === 'moment') { openWho(); return true; }
  return false;
};

// ── Screen 1: who's watching ──
function openWho() {
  state.household = null;
  $('#householdBadge').hidden = true;
  setBackdrop(null);
  for (const el of document.querySelectorAll('[data-memory-for]')) {
    const films = lastWatched(el.dataset.memoryFor);
    el.textContent = films.length ? `Last time: ${films[0].title}` : (el.dataset.memoryFor === 'solo' ? 'Nothing watched yet' : 'Nothing watched together yet');
  }
  show('who');
  focusFirst(state.lastHousehold ? `[data-household="${state.lastHousehold}"]` : null);
}

document.querySelectorAll('[data-household]').forEach(btn => btn.addEventListener('click', () => {
  state.household = btn.dataset.household;
  state.lastHousehold = btn.dataset.household;
  $('#householdBadge').textContent = HOUSEHOLDS[state.household].label;
  $('#householdBadge').hidden = false;
  openMoment();
}));

// ── Screen 2: the moment ──
function openMoment() {
  state.shown = [];
  state.results = [];
  state.focusFilm = null;
  const films = lastWatched(state.household);
  const line = $('#momentLine');
  const chips = $('#moodChips');
  chips.querySelector('[data-like]')?.remove();

  if (films.length) {
    const h = HOUSEHOLDS[state.household].last.toLowerCase();
    line.textContent = `Welcome back. ${h.charAt(0).toUpperCase() + h.slice(1)}, you watched ${films[0].title}. Something like it, or something new?`;
    const like = document.createElement('button');
    like.className = 'chip chip-accent f';
    like.dataset.like = films[0].id;
    like.textContent = `Something like ${films[0].title}`;
    like.addEventListener('click', () => askLike(films[0]));
    chips.prepend(like);

    $('#memoryTitle').innerHTML = `${escapeHtml(HOUSEHOLDS[state.household].last)} <em>· remembered on this TV</em>`;
    const rail = $('#memoryCards');
    rail.innerHTML = '';
    for (const film of films.slice(0, 4)) {
      const mini = document.createElement('button');
      mini.className = 'mini f';
      mini.dataset.id = film.id;
      mini.innerHTML = `<span class="art" style="display:block"></span><span class="mini-title">${escapeHtml(film.title)}</span>`;
      paintArt(mini.querySelector('.art'), film);
      mini.addEventListener('click', () => openFilm(film, mini));
      rail.append(mini);
    }
    $('#memoryRail').hidden = false;
    setBackdrop(films[0]);
  } else {
    line.textContent = `I'll help you find something. What does the moment call for?`;
    $('#memoryRail').hidden = true;
    setBackdrop(null);
  }
  show('moment');
  focusFirst('.chip');
}

document.querySelectorAll('#moodChips [data-query]').forEach(btn => btn.addEventListener('click', () => {
  ask(btn.dataset.query, btn.textContent.trim());
}));

// ── Screen 3: listening → results ──
function beginResults(echo) {
  show('results');
  $('#echoLabel').textContent = state.household ? `YOU ASKED · ${HOUSEHOLDS[state.household].tag.toUpperCase()}` : 'YOU ASKED';
  $('#echoText').textContent = `“${echo}”`;
  $('#understood').hidden = true;
  $('#refine').hidden = true;
  $('#resultLine').textContent = 'Listening to the moment…';
  $('#cards').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  document.activeElement && document.activeElement.blur();
}

function showUnderstood(req, ai) {
  const tags = [];
  for (const c of req.concepts) tags.push(c.name);
  for (const m of req.moods) tags.push(m);
  if (req.minutes) tags.push(`under ${req.minutes} min`);
  if (req.language) tags.push(req.language);
  if (req.access) tags.push(`${req.access} to watch`);
  if (!tags.length && ai && ai.intent === 'open_discovery') tags.push('open discovery');
  const box = $('#understood');
  box.innerHTML = '';
  if (state.household) {
    const t = document.createElement('span');
    t.className = 'tag tag-household';
    t.textContent = HOUSEHOLDS[state.household].tag;
    box.append(t);
  }
  for (const label of [...new Set(tags)].slice(0, 6)) {
    const t = document.createElement('span');
    t.className = 'tag';
    t.textContent = label;
    box.append(t);
  }
  box.hidden = box.children.length === 0;
}

function memoryNote(match) {
  if (!state.household) return '';
  const taste = householdTaste();
  const who = HOUSEHOLDS[state.household].last.toLowerCase();
  if (taste.watchedIds.has(match.film.id)) return `You watched this ${who.replace('last time ', '')} before.`;
  if (match.sharedWith && match.sharedWith.id !== match.film.id) return `Close to ${match.sharedWith.title}, which you chose ${who}.`;
  return '';
}

function renderCards(matches, reasons) {
  const box = $('#cards');
  box.innerHTML = '';
  for (const m of matches) {
    const film = m.film;
    const card = document.createElement('button');
    card.className = 'card f';
    card.dataset.id = film.id;
    const meta = [film.runtime, film.language.length ? film.language.join(' / ') : '', film.format].filter(Boolean).map(escapeHtml).join(' · ');
    const note = memoryNote(m);
    card.innerHTML = `
      <span class="art" style="display:block"><span class="play-cue">${film.access === 'free' ? '▶ WATCH NOW' : '◆ UNLOCK'}</span></span>
      <span class="card-body">
        <span class="card-title">${escapeHtml(film.title)}</span>
        <span class="card-meta">
          <span class="badge ${film.access === 'free' ? 'badge-free' : 'badge-founding'}">${film.access === 'free' ? 'FREE' : 'FOUNDING'}</span>
          ${meta ? `<span>${meta}</span>` : ''}
        </span>
        <span class="card-reason">${escapeHtml(reasons[film.id] || fallbackReason(film))}</span>
        ${note ? `<span class="card-memory">${escapeHtml(note)}</span>` : ''}
      </span>`;
    paintArt(card.querySelector('.art'), film);
    card.addEventListener('click', () => openFilm(film, card));
    box.append(card);
  }
  $('#refine').hidden = false;
  state.results = matches;
  state.focusFilm = matches[0] ? matches[0].film : null;
  for (const m of matches) if (!state.shown.includes(m.film.id)) state.shown.push(m.film.id);
  focusFirst('.card');
}

async function deliver(matches, query, leadFallback, extra) {
  const ai = await enhance(matches, query, extra);
  const reasons = {};
  if (ai) for (const r of ai.reasons) reasons[r.filmId] = r.reason;
  $('#resultLine').textContent = (ai && ai.chatMessage) || leadFallback;
  renderCards(matches, reasons);
}

async function ask(query, echo) {
  if (state.busy) return;
  state.busy = true;
  state.query = query;
  state.shown = [];
  beginResults(echo || query);
  try {
    const ai = await understand(query);
    const req = requestFromStructured(ai && ai.request, query);
    state.request = req;
    showUnderstood(req, ai);

    const open = (ai && ai.intent === 'open_discovery') || (isOpenDiscovery(query) && !hasConstraints(req)) || /surprise/i.test(query);
    let matches = open ? openPicks(3, new Set()) : rank(req, new Set()).slice(0, 3);
    let lead = matches.length === 1 ? `Watch ${matches[0].film.title}.` : 'These are the closest published matches for what you described.';
    if (!matches.length) {
      matches = openPicks(3, new Set());
      lead = `I don't have an exact match for that yet. These are the closest works I have.`;
    }
    await deliver(matches, query, lead);
  } finally {
    state.busy = false;
  }
}

async function askLike(film) {
  if (state.busy) return;
  state.busy = true;
  state.query = `Something like ${film.title}.`;
  state.shown = [film.id];
  beginResults(`Something like ${film.title}`);
  try {
    const req = { query: state.query, concepts: conceptsIn(film), avoids: [], minutes: null, moods: [], language: '', format: '', access: '', explicitTitle: null };
    state.request = req;
    showUnderstood(req, null);
    let matches = rank(req, new Set([film.id])).slice(0, 3);
    if (!matches.length) matches = openPicks(3, new Set([film.id]));
    await deliver(matches, state.query, `Close to ${film.title}, but new to you.`, { likeTitle: film.title });
  } finally {
    state.busy = false;
  }
}

async function refine(kind) {
  if (state.busy) return;
  if (kind === 'mood') { openMoment(); return; }

  if (kind === 'why') {
    const film = state.focusFilm || (state.results[0] && state.results[0].film);
    if (!film) return;
    state.busy = true;
    $('#resultLine').textContent = 'Thinking about why…';
    try {
      const ai = await understand('Why this one?');
      const reason = (ai && ai.chatMessage) || `I chose ${film.title} because ${fallbackReason(film).charAt(0).toLowerCase()}${fallbackReason(film).slice(1)}`;
      $('#resultLine').textContent = reason;
    } finally {
      state.busy = false;
    }
    return;
  }

  state.busy = true;
  const exclude = new Set(state.shown);
  recordPassed(state.results.map(m => m.film.id));
  beginResults(kind === 'another' ? 'Another one' : 'Something shorter');
  showUnderstood(state.request || requestFromStructured(null, ''), null);
  try {
    if (kind === 'another') {
      let matches = state.request && hasConstraints(state.request) ? rank(state.request, exclude).slice(0, 3) : [];
      if (!matches.length) matches = openPicks(3, exclude);
      if (!matches.length) {
        $('#resultLine').textContent = `That's every published work I have for this moment. Change the mood and I'll look again.`;
        $('#cards').innerHTML = '';
        $('#refine').hidden = false;
        focusFirst('[data-refine="mood"]');
        return;
      }
      await deliver(matches, 'Give me another one.', 'Here is something different.');
      return;
    }

    if (kind === 'shorter') {
      const timed = catalog.filter(f => parseSeconds(f.runtime) !== null && hasPublishedDescription(f)).sort((a, b) => parseSeconds(a.runtime) - parseSeconds(b.runtime));
      const shownTimes = state.results.map(m => parseSeconds(m.film.runtime)).filter(s => s !== null);
      const ceiling = shownTimes.length ? Math.min(...shownTimes) : Infinity;
      let pick = timed.filter(f => parseSeconds(f.runtime) < ceiling && !exclude.has(f.id));
      if (!pick.length) pick = timed.filter(f => !exclude.has(f.id));
      if (!pick.length) pick = timed.slice(0, 1);
      const matches = pick.slice(0, 2).map(film => ({ film, matched: [], score: 0 }));
      await deliver(matches, 'Something shorter.', `Most VER-DÉ works don't have a confirmed runtime yet. These are the shortest confirmed.`, { isShorter: true });
    }
  } finally {
    state.busy = false;
  }
}

document.querySelectorAll('[data-refine]').forEach(btn => btn.addEventListener('click', () => refine(btn.dataset.refine)));

// ── Playback & access ──
let chromeTimer = null;

function openFilm(film, origin) {
  state.returnFocus = origin || null;
  if (film.access !== 'free') { openAccess(film); return; }
  recordWatched(film);
  const stage = $('#playerStage');
  stage.classList.toggle('is-vertical', film.playback === 'vertical');
  $('#playerTitle').textContent = film.title;
  $('#playerFrame').src = `https://www.youtube-nocookie.com/embed/${film.videoId}?autoplay=1&rel=0&playsinline=0&controls=1&modestbranding=1`;
  $('#player').hidden = false;
  const chrome = $('#playerChrome');
  chrome.classList.remove('is-faded');
  clearTimeout(chromeTimer);
  chromeTimer = setTimeout(() => chrome.classList.add('is-faded'), 4500);
}

function closePlayer() {
  $('#playerFrame').src = 'about:blank';
  $('#player').hidden = true;
  clearTimeout(chromeTimer);
  restoreFocus();
}

function openAccess(film) {
  recordWatched(film);
  paintArt($('#accessArt'), film);
  $('#accessTitle').textContent = film.title;
  $('#accessSynopsis').textContent = film.synopsis || film.subject || '';
  const qr = $('#accessQr');
  qr.innerHTML = '';
  if (typeof window.qrcode === 'function') {
    const code = window.qrcode(0, 'M');
    code.addData(OFFER_URL);
    code.make();
    qr.innerHTML = code.createSvgTag({ cellSize: 8, margin: 0, scalable: true });
  } else {
    qr.innerHTML = '<span class="qr-fallback">ver-de.com<br>#offer</span>';
  }
  $('#access').hidden = false;
  focusFirst('#accessBack');
}

function closeAccess() {
  $('#access').hidden = true;
  restoreFocus();
}

function restoreFocus() {
  const target = state.returnFocus;
  if (target && document.body.contains(target)) target.focus({ preventScroll: true });
  else focusFirst();
}

$('#accessBack').addEventListener('click', closeAccess);

// ── Boot ──
(function boot() {
  const params = new URLSearchParams(location.search);
  if (params.has('reset')) {
    try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
    history.replaceState(null, '', location.pathname);
  }
  document.body.classList.toggle('in-app', params.has('app') || /VERDE-FireTV/.test(navigator.userAgent));
  openWho();
})();
