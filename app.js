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
let currentFilmContext = null;
let lastUserMessageElement = null;
let selectedBritishVoice = null;
const recommendedIds = new Set();
const conversationHistory = [
  { role: 'assistant', text: 'I’ll help you find something. What does the moment call for?' }
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
    currentRecommendation: (currentFilmContext || lastRecommendation?.film) ? {
      id: (currentFilmContext || lastRecommendation.film).id,
      title: (currentFilmContext || lastRecommendation.film).title
    } : null,
    currentFilm: (currentFilmContext || lastRecommendation?.film) ? {
      id: (currentFilmContext || lastRecommendation.film).id,
      title: (currentFilmContext || lastRecommendation.film).title,
      subject: (currentFilmContext || lastRecommendation.film).subject || '',
      synopsis: (currentFilmContext || lastRecommendation.film).synopsis || '',
      themes: (currentFilmContext || lastRecommendation.film).themes || [],
      runtime: (currentFilmContext || lastRecommendation.film).runtime || '',
      language: (currentFilmContext || lastRecommendation.film).language || [],
      format: (currentFilmContext || lastRecommendation.film).format || '',
      access: (currentFilmContext || lastRecommendation.film).access || '',
      award: (currentFilmContext || lastRecommendation.film).award || '',
      filmmaker: (currentFilmContext || lastRecommendation.film).filmmaker || 'Green Ralph',
      countryLocation: (currentFilmContext || lastRecommendation.film).countryLocation || 'Nabua, Camarines Sur, Philippines',
      setting: (currentFilmContext || lastRecommendation.film).setting || ''
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
    /\bi\s+don'?t\s+know\s+what\s+(?:i\s+)?(?:want\s+to\s+watch|to\s+watch)(?:,?\s+help\s+me)?\b/,
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
    /\bhelp\s+me\b/,
    /^anything[.!?]*$/
  ].some(pattern => pattern.test(lower));
}

function isWhyFollowUp(text) {
  return /^why\b(?:[^a-z]|$)/i.test(text.trim());
}

function isAnotherFollowUp(text) {
  return /\b(?:something else|another (?:one|film)|pick another|give me another(?: one)?)\b[.!?]*$/i.test(text.trim());
}

function isShorterFollowUp(text) {
  return /\b(?:something shorter|a? ?shorter (?:one|film))\b[.!?]*$/i.test(text.trim());
}

function isMoreFollowUp(text) {
  return /\b(?:tell me more|more about (?:this|it|that)|details)\b/i.test(text.trim());
}

function isConversationalRemark(text) {
  return isLayerBQuestion(text);
}

function isLayerBQuestion(text) {
  const lower = text.toLowerCase().trim();

  // Layer A explicit discovery requests must NOT be treated as Layer B:
  if (isAnotherFollowUp(text) || isShorterFollowUp(text) || isOpenDiscovery(text)) {
    return false;
  }
  if (/\b(?:something\s+(?:else|different|longer|other)|give\s+me\s+another|another\s+one|recommend|find\s+me|find\s+a\s+film)\b/.test(lower)) {
    return false;
  }

  return [
    /^why\b/i,
    /\b(?:why\s+(?:that|this)\s+one|why\s+this|why\s+that|why\s+choose|why\s+did\s+you)\b/,
    /\b(?:tell\s+me\s+more|more\s+about\s+(?:this|it|that)|details)\b/,
    /\b(?:who\s+(?:made|directed|created|wrote)\s*(?:it|this)?|director|filmmaker|creator)\b/,
    /\b(?:what(?:'s|\s+is)\s+(?:this|it)\s+about|synopsis|story|plot|what\s+happens)\b/,
    /\b(?:what(?:'s|\s+is)\s+the\s+point(?:\s+of\s+this\s+film)?)\b/,
    /\b(?:where\s+(?:was\s+this|was\s+it|filmed|shot)|filming\s+location|where\s+was\s+it\s+made|where\s+is\s+it\s+set)\b/,
    /\b(?:how\s+long(?:\s+is\s+(?:this|it))?|runtime|duration)\b/,
    /\b(?:what\s+language(?:\s+is\s+(?:this|it))?)\b/,
    /\b(?:award|awards|won|festival|recognition)\b/,
    /^(?:awesome|great|cool|nice|wow|that's beautiful|beautiful|sounds good)[.!?]*$/,
    /^(?:that's depressing|depressing|that's sad|sad|sounds sad)[.!?]*$/,
    /^(?:that's interesting|interesting)[.!?]*$/,
    /^(?:haha|hehe|lol|rofl|lmao)[.!?]*$/,
    /\bi\s+don'?t\s+like\s+sad\s+movies\b/,
    /\bwhat\s+do\s+you\s+mean\b/,
    /\bis\s+this\s+(?:based\s+on\s+a\s+)?true\s+story\b/
  ].some(pattern => pattern.test(lower));
}

function answerLayerBQuestion(query, film = currentFilmContext) {
  const lower = query.toLowerCase().trim();

  // If no film context exists yet
  if (!film) {
    if (/(?:awesome|great|cool|nice|wow|beautiful|sounds good)/.test(lower)) {
      return `I’ll help you find a film that fits. Tell me what theme, mood, or time you have in mind.`;
    }
    if (/(?:depressing|sad)/.test(lower)) {
      return `I understand. We can steer towards something uplifting, gentle, or focused on rebuilding. Tell me what you'd prefer.`;
    }
    if (/\bi\s+don'?t\s+like\s+sad\s+movies\b/.test(lower)) {
      return `Understood. Tell me what mood or theme you prefer, and I'll find a fit.`;
    }
    if (/(?:who\s+(?:made|directed|created)|director|filmmaker)/.test(lower)) {
      return `All films in VER-DÉ are created by filmmaker and recording artist Green Ralph in Nabua, Camarines Sur, Philippines.`;
    }
    if (/(?:what(?:'s|\s+is)\s+(?:this|it)\s+about|what\s+is\s+ver-d[eé]|what\s+is\s+this)/.test(lower)) {
      return `VER-DÉ is an AI Cinema Engine catalogue of 17 independent works by Green Ralph. You can describe what you're looking for, or say 'surprise me'.`;
    }
    return `I’ll help you find a film from the catalog. Tell me what you're in the mood for, or say 'surprise me'.`;
  }

  // 1. Why that one? / Why this one? / Why?
  if (isWhyFollowUp(query)) {
    const whyReason = (lastRecommendation && lastRecommendation.aiReason) || generateDistinctWhyThisFits(film, lastRequest, query);
    return `I chose ${film.title} because ${whyReason.charAt(0).toLowerCase() + whyReason.slice(1)}`;
  }

  // 2. Who made it? / director / filmmaker
  if (/\b(?:who\s+(?:directed|made|created|wrote)|director|filmmaker|creator)\b/.test(lower)) {
    return `${film.title} is directed by ${film.filmmaker || 'Green Ralph'} from ${film.countryLocation || 'Nabua, Camarines Sur, Philippines'}.`;
  }

  // 3. Where was it made? / where filmed / setting
  if (/\b(?:where\s+(?:was\s+this|was\s+it|is\s+this|is\s+it|filmed|shot)|setting|location|place)\b/.test(lower)) {
    if (film.setting) {
      return `${film.title} is set in ${film.setting}, based in ${film.countryLocation || 'Nabua, Camarines Sur, Philippines'}.`;
    }
    if (film.countryLocation) {
      return `${film.title} was filmed on location in ${film.countryLocation}.`;
    }
    return "I don't have that detail in the film information I have.";
  }

  // 4. How long is it? / runtime / duration
  if (/\b(?:how\s+long|runtime|duration|minutes|length)\b/.test(lower)) {
    if (film.runtime) {
      return `The confirmed runtime for ${film.title} is ${film.runtime}.`;
    }
    return "I don't have that detail in the film information I have.";
  }

  // 5. What language is it? / spoken language
  if (/\b(?:language|dialect|spoken|tagalog|english|bikol)\b/.test(lower)) {
    if (film.language && film.language.length) {
      return `The spoken language for ${film.title} is ${film.language.join(' and ')}.`;
    }
    return "I don't have that detail in the film information I have.";
  }

  // 6. Awards / recognition
  if (/\b(?:award|awards|won|festival|recognition|finalist|nominee)\b/.test(lower)) {
    if (film.award) {
      return `Published recognition for ${film.title}: ${film.award}.`;
    }
    return "I don't have that detail in the film information I have.";
  }

  // 7. What's the point of this film?
  if (/\b(?:what(?:'s|\s+is)\s+the\s+point(?:\s+of\s+this\s+film)?)\b/.test(lower)) {
    if (film.subject || film.synopsis) {
      return `${film.title} explores ${film.subject || film.synopsis}.`;
    }
    return "I don't have that detail in the film information I have.";
  }

  // 8. Tell me more / what's this about / synopsis / premise / what happens
  if (isMoreFollowUp(query) || /\b(?:what(?:'s|\s+is)\s+(?:this|it)\s+about|about|story|synopsis|plot|premise|what\s+happens)\b/.test(lower)) {
    return tellMeMoreText(film);
  }

  // 9. True story
  if (/\b(?:true\s+story|real\s+life|reality)\b/.test(lower)) {
    return `${film.title} is grounded in the direct lived experiences and family realities of Green Ralph on the farm in Nabua, Camarines Sur.`;
  }

  // 10. Reactions & spontaneous feedback
  if (/\b(?:awesome|great|cool|nice|wow|beautiful|sounds good)\b/.test(lower)) {
    return `Glad that resonates. You can watch ${film.title} whenever you're ready, or ask me anything more about it.`;
  }

  if (/\b(?:that's\s+interesting|interesting)\b/.test(lower)) {
    return `${film.title} reflects authentic personal realities from the farm in Nabua. Would you like to watch it or know more?`;
  }

  if (/\b(?:depressing|sad|heartbreaking)\b/.test(lower)) {
    return `${film.title} carries raw, unflinching emotion, reflecting real struggles. If you want something different, I can recommend another work like Project 39 or an uplifting short.`;
  }

  if (/\bi\s+don'?t\s+like\s+sad\s+movies\b/.test(lower)) {
    return `I understand. VER-DÉ has works focused on rebuilding, quiet presence, and endurance. Say 'something else' or tell me what mood fits you best.`;
  }

  if (/\b(?:haha|hehe|lol|rofl|lmao)\b/.test(lower)) {
    return `Cinema should keep you on your toes. What else would you like to explore?`;
  }

  if (/\bwhat\s+do\s+you\s+mean\b/.test(lower)) {
    return `In ${film.title}, the focus is directly on ${film.subject || film.synopsis}. Would you like to watch it or try something different?`;
  }

  return tellMeMoreText(film);
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

// ── Distinct & Grounded "WHY THIS FITS" Generator ───────────────────────────
function generateDistinctWhyThisFits(film, request, userMessage = '') {
  const query = (userMessage || (request && request.query) || '').toLowerCase();

  // 1. Time / runtime constraint
  if ((request && request.minutes) || /\b(?:10\s*minutes|short|runtime|shorter)\b/.test(query)) {
    if (film.runtime) {
      return `With a confirmed runtime of ${film.runtime}, this fits comfortably inside your time limit while delivering an uncompromised full narrative.`;
    }
  }

  // 2. Being judged
  if (/\b(?:judged|judgement|judgment|sentenced)\b/.test(query) || (request && request.concepts && request.concepts.some(c => c.name === 'being judged'))) {
    if (film.id === 'sentensyador') {
      return `SENTENSYADOR confronts being sentenced by everyone who knows you across a lifetime, told without argument or retreat in 2 minutes.`;
    }
    if (film.id === 'bagsak') {
      return `BAGSAK centers on four family voices judging a man across his life over a childhood report card. Thirty-nine years of being told what he is.`;
    }
  }

  // 3. The land / farming
  if (/\b(?:land|farm|farming|field|soil|nature)\b/.test(query) || (request && request.concepts && request.concepts.some(c => c.name === 'the land'))) {
    if (film.id === 'project-39-rebuild') {
      return `Set directly on the farm in Nabua. When a man loses everything, he returns to the only thing that asks nothing of him: the land.`;
    }
    if (film.id === 'the-storm-answers') {
      return `Captured on the farm amidst Typhoon Kristine aftermath. A farmer screams at God after losing everything, and the land answers back in questions.`;
    }
    if (film.id === 'maraming-kamay') {
      return `Focuses on the generational family hands that worked this soil before him: you do not inherit this land, you only borrow it.`;
    }
  }

  // 4. Emotional, hopeful
  if (/\b(?:emotional|hopeful|uplifting)\b/.test(query) || (request && request.moods && (request.moods.includes('emotional') || request.moods.includes('hopeful')))) {
    if (film.id === 'project-39-rebuild') {
      return `Carries raw emotional weight after total loss, but turns resolutely hopeful as one man rebuilds with his own hands on the soil.`;
    }
    if (film.id === 'the-wilderness-original') {
      return `An emotional portrait of the guardian walking beside a child through the dry years, finding hope in quiet presence.`;
    }
    if (film.id === 'bagsak') {
      return `Highly emotional reckoning with family voices, offering an honest path forward in year forty.`;
    }
  }

  // 5. Open discovery / "I don't know what to watch" / surprise me
  if (isOpenDiscovery(query)) {
    if (film.id === 'bagsak') {
      return `The rawest personal entry point into VER-DÉ: thirty-nine years of judgment, one report card, four voices, and no reply.`;
    }
    if (film.id === 'sentensyador') {
      return `An immediate 2-minute cinema statement: a man sentenced by everyone who knows him, who shrugs and walks.`;
    }
    if (film.id === 'project-39-rebuild') {
      return `The core story of VER-DÉ: losing everything, and returning to the land to rebuild with your own hands.`;
    }
    if (film.subject) {
      return film.subject;
    }
  }

  // 6. Specific film facts fallback
  if (film.subject) return film.subject;
  if (film.synopsis) return film.synopsis;
  return `An official work in the VER-DÉ catalog by Green Ralph.`;
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

function detailsFor(film) {
  return [film.runtime, film.language.join(' / '), film.format].filter(Boolean).join(' · ');
}

// ── Voice / Speech Synthesis (Listen / Speaker) ────────────────────────────
function updateBritishVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  if (!voices.length) return null;

  const isBritish = v => /^en[-_]GB$/i.test(v.lang) || v.lang.toLowerCase().includes('en-gb') || v.name.toLowerCase().includes('united kingdom') || v.name.toLowerCase().includes('british') || v.name.toLowerCase().includes('uk english');
  const isEnglish = v => v.lang && v.lang.toLowerCase().startsWith('en');

  const isNatural = v => {
    const n = (v.name + ' ' + (v.voiceURI || '')).toLowerCase();
    return n.includes('natural') || n.includes('neural') || n.includes('online') || n.includes('premium') || n.includes('multilingual') || n.includes('high quality') || n.includes('google uk english') || n.includes('sonia') || n.includes('libby') || n.includes('ryan') || n.includes('oliver') || n.includes('hazel');
  };

  const isFemale = v => {
    const n = (v.name + ' ' + (v.voiceURI || '')).toLowerCase();
    return n.includes('female') || n.includes('woman') || n.includes('sonia') || n.includes('libby') || n.includes('hazel') || n.includes('susan') || n.includes('stephanie') || n.includes('mia') || n.includes('google uk english female');
  };

  const isMale = v => {
    const n = (v.name + ' ' + (v.voiceURI || '')).toLowerCase();
    return n.includes('male') || n.includes('man') || n.includes('ryan') || n.includes('oliver') || n.includes('george') || n.includes('google uk english male');
  };

  const britishVoices = voices.filter(isBritish);
  const englishVoices = voices.filter(isEnglish);

  // 1. Natural/premium/neural/high-quality en-GB female voice
  let best = britishVoices.find(v => isNatural(v) && isFemale(v));

  // 2. Natural/premium/neural/high-quality en-GB male voice
  if (!best) best = britishVoices.find(v => isNatural(v) && isMale(v));

  // 2b. Any natural en-GB voice
  if (!best) best = britishVoices.find(isNatural);

  // 3. Best available en-GB voice
  if (!best) best = britishVoices.find(isFemale);
  if (!best) best = britishVoices[0];

  // 4. Best available English voice if no British voice exists
  if (!best) best = englishVoices.find(isNatural);
  if (!best) best = englishVoices[0];

  selectedBritishVoice = best || null;
  return selectedBritishVoice;
}

if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = updateBritishVoice;
  updateBritishVoice();
}

function speakText(text, btn) {
  if (!('speechSynthesis' in window)) return;

  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    document.querySelectorAll('.listen-btn.is-speaking, .inline-listen.is-speaking').forEach(b => {
      b.classList.remove('is-speaking');
      b.dataset.speaking = 'false';
    });
    if (btn && btn.dataset.speaking === 'true') {
      btn.dataset.speaking = 'false';
      return;
    }
  }

  const clean = text.replace(/<[^>]+>/g, '').trim();
  if (!clean) return;

  const utterance = new SpeechSynthesisUtterance(clean);
  const voice = selectedBritishVoice || updateBritishVoice();
  if (voice) {
    utterance.voice = voice;
  }
  utterance.rate = 0.98;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  if (btn) {
    btn.classList.add('is-speaking');
    btn.dataset.speaking = 'true';
    utterance.onend = () => {
      btn.classList.remove('is-speaking');
      btn.dataset.speaking = 'false';
    };
    utterance.onerror = () => {
      btn.classList.remove('is-speaking');
      btn.dataset.speaking = 'false';
    };
  }

  window.speechSynthesis.speak(utterance);
}

// ── Voice / Speech Recognition (Dictation) ─────────────────────────────────
function setupSpeechRecognition(button, input, form) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition || !button) {
    if (button) button.style.display = 'none';
    return;
  }

  let isListening = false;
  let recognition;
  try {
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
  } catch (err) {
    console.warn('[VER-DÉ Voice] Speech recognition unsupported:', err);
    button.style.display = 'none';
    return;
  }

  recognition.onstart = () => {
    isListening = true;
    button.classList.add('is-recording');
  };

  recognition.onresult = event => {
    const transcript = event.results[0]?.[0]?.transcript;
    if (transcript && input) {
      input.value = transcript;
      if (form) form.requestSubmit();
    }
  };

  recognition.onerror = event => {
    console.warn('[VER-DÉ Voice] Speech recognition error:', event.error);
    isListening = false;
    button.classList.remove('is-recording');
  };

  recognition.onend = () => {
    isListening = false;
    button.classList.remove('is-recording');
  };

  button.addEventListener('click', () => {
    if (!isListening) {
      try {
        recognition.start();
      } catch (err) {
        console.warn('[VER-DÉ Voice] Could not start speech recognition:', err);
      }
    } else {
      recognition.stop();
    }
  });
}

// ── Film Modal Opener Helper ───────────────────────────────────────────────
function openFilmPlayer(film) {
  if (!film || !watchDialog) return;
  currentFilmContext = film;
  document.querySelector('#dialogTitle').textContent = film.title;
  const text = document.querySelector('#dialogText');
  const player = document.querySelector('#dialogPlayer');
  const action = document.querySelector('#dialogAction');

  if (film.access === 'free') {
    text.textContent = 'Free to watch on VER-DÉ.';
    player.referrerPolicy = 'strict-origin-when-cross-origin';
    player.src = `https://www.youtube-nocookie.com/embed/${film.videoId}?autoplay=1&rel=0&playsinline=1&enablejsapi=1`;
    player.hidden = false;
    player.style.display = 'block';
    action.hidden = true;
    action.style.display = 'none';
  } else {
    text.textContent = 'This film is part of Founding Access. One payment. Lifetime access. No subscription.';
    player.src = '';
    player.hidden = true;
    player.style.display = 'none';
    action.textContent = 'GET FOUNDING ACCESS →';
    action.href = 'https://ver-de.com/#offer';
    action.hidden = false;
    action.style.display = 'inline-flex';
  }
  setupFilmCompanion(film);
  watchDialog.showModal();
}

// ── In-Conversation Message & Card Renderer ────────────────────────────────
function addMessage(role, text, filmMatch = null, request = null) {
  conversationHistory.push({ role, text });
  const item = document.createElement('article');
  item.className = `message ${role}-message`;

  if (role === 'assistant') {
    let filmCardHtml = '';
    if (filmMatch && filmMatch.film) {
      const film = filmMatch.film;
      const details = detailsFor(film);
      const frameUrl = `https://img.youtube.com/vi/${film.videoId}/maxresdefault.jpg`;
      const fallbackFrame = `https://img.youtube.com/vi/${film.videoId}/hqdefault.jpg`;
      const whyFits = filmMatch.aiReason || generateDistinctWhyThisFits(film, request, conversationHistory.slice(-2)[0]?.text || '');
      const watchButtonText = film.access === 'free' ? 'WATCH FREE →' : 'GET FOUNDING ACCESS →';

      filmCardHtml = `
        <div class="inline-film-card">
          <div class="film-frame-wrap">
            <img src="${frameUrl}" alt="${film.title}" class="film-frame" loading="lazy" onerror="this.src='${fallbackFrame}'">
            <span class="access-tag ${film.access}">${film.access === 'free' ? 'WATCH FREE' : 'FOUNDING ACCESS'}</span>
          </div>
          <div class="film-details">
            <div class="film-meta-row">
              <span class="film-meta-item">${details || 'CONFIRMED CATALOG ENTRY'}</span>
              ${film.award ? `<span class="film-award-tag">${film.award}</span>` : ''}
            </div>
            <h3 class="film-card-title">${film.title}</h3>
            <div class="why-fits-box">
              <span class="why-fits-label">WHY THIS FITS</span>
              <p class="why-fits-text">${whyFits}</p>
            </div>
            <div class="card-action-row">
              <button type="button" class="inline-listen" aria-label="Listen to recommendation" title="Listen">🔊 Listen</button>
              <button type="button" class="inline-watch" data-id="${film.id}">${watchButtonText}</button>
            </div>
          </div>
        </div>
      `;
    }

    item.innerHTML = `
      <div class="avatar">V</div>
      <div class="message-body">
        <p class="speaker">VER-DÉ</p>
        <p class="assistant-lead-text">${text}</p>
        ${filmCardHtml}
      </div>
      <button type="button" class="listen-btn" aria-label="Listen to response" title="Listen">🔊</button>
    `;

    // Wire up header listen button
    const headerListenBtn = item.querySelector('.listen-btn');
    if (headerListenBtn) {
      headerListenBtn.addEventListener('click', () => speakText(text, headerListenBtn));
    }

    // Wire up inline card actions if present
    if (filmMatch && filmMatch.film) {
      const inlineWatchBtn = item.querySelector('.inline-watch');
      if (inlineWatchBtn) {
        inlineWatchBtn.addEventListener('click', () => openFilmPlayer(filmMatch.film));
      }

      const inlineListenBtn = item.querySelector('.inline-listen');
      if (inlineListenBtn) {
        const speakSpeech = `${text}. ${filmMatch.film.title}. ${item.querySelector('.why-fits-text')?.textContent || ''}`;
        inlineListenBtn.addEventListener('click', () => speakText(speakSpeech, inlineListenBtn));
      }
    }

    messages.append(item);

    // Requirement 15: Scroll anchor to the beginning of the newly created exchange
    if (lastUserMessageElement && messages.contains(lastUserMessageElement)) {
      const containerRect = messages.getBoundingClientRect();
      const userRect = lastUserMessageElement.getBoundingClientRect();
      const scrollOffset = messages.scrollTop + (userRect.top - containerRect.top) - 12;
      messages.scrollTo({ top: Math.max(0, scrollOffset), behavior: 'smooth' });
    } else {
      item.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } else {
    item.innerHTML = `<div class="message-body"><p>${text}</p></div>`;
    messages.append(item);
    lastUserMessageElement = item;
    item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function remember(match, request) {
  lastRecommendation = match;
  lastRequest = request;
  if (match && match.film) {
    currentFilmContext = match.film;
    recommendedIds.add(match.film.id);
  }
}

// ── AI enrichment ──────────────────────────────────────────────────────────
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
  // Check Layer B first
  if (isLayerBQuestion(query)) {
    const answer = answerLayerBQuestion(query, currentFilmContext || lastRecommendation?.film);
    addMessage('assistant', answer);
    return true;
  }

  // Another film (Layer A)
  if (isAnotherFollowUp(query) && (lastRecommendation || currentFilmContext)) {
    const baseFilm = currentFilmContext || lastRecommendation.film;
    const excludedId = baseFilm.id;
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
    const lead = chatMessage || `Try ${film.title}.`;
    addMessage('assistant', lead, enriched || next, previousRequest);
    remember(enriched || next, previousRequest);
    return true;
  }

  // Shorter film (Layer A)
  if (isShorterFollowUp(query) && (lastRecommendation || currentFilmContext)) {
    const shorter = shorterMatch();
    if (!shorter) {
      addMessage('assistant', 'VER-DÉ does not have a confirmed shorter runtime than the last recommendation. Most works in the catalog do not yet have a published runtime. I can find something different instead.');
      return true;
    }
    const preservedRequest = lastRequest;
    const { matches: [enriched], chatMessage } = await enrichWithAI([shorter], query, preservedRequest);
    const film = (enriched && enriched.film) || shorter.film;
    const lead = chatMessage || `Watch ${film.title}. Its ${film.runtime} runtime is the shortest confirmed runtime available.`;
    addMessage('assistant', lead, enriched || shorter, preservedRequest);
    remember(enriched || shorter, preservedRequest);
    return true;
  }

  return false;
}

async function recommendOpenDiscovery(query, structuredReq = null) {
  const request = structuredReq ? requestFromStructured(structuredReq, query) : requestFrom(query);
  const match = openDiscoveryMatch(recommendedIds);
  if (!match) {
    addMessage('assistant', 'I have run out of published recommendations to rotate through. Try a theme, time, language, or format.');
    return;
  }
  const { matches: [enriched] } = await enrichWithAI([match], query, request);
  const film = (enriched && enriched.film) || match.film;
  const leadText = `Try ${film.title}.`;
  addMessage('assistant', leadText, enriched || match, request);
  remember(enriched || match, request);
}

// ── Main recommendation orchestrator ───────────────────────────────────────
async function recommend(query) {
  expandMainAssistant();
  addMessage('user', query);

  // 1. Layer B check: If query is conversational, a reaction, or about currentFilmContext
  if (isLayerBQuestion(query)) {
    if (typeof aiUnderstand === 'function') {
      try {
        const conversationState = buildConversationState();
        const aiResult = await aiUnderstand(query, conversationState);
        if (aiResult && aiResult.chatMessage && (aiResult.intent === 'conversation' || aiResult.intent === 'explain_current')) {
          addMessage('assistant', aiResult.chatMessage);
          return;
        }
      } catch (err) {
        console.warn('[VER-DÉ AI] aiUnderstand conversational fallback:', err);
      }
    }
    const answer = answerLayerBQuestion(query, currentFilmContext || lastRecommendation?.film);
    addMessage('assistant', answer);
    return;
  }

  // 2. Layer A Discovery: Natural language understanding layer via Gemini
  let aiResult = null;
  if (typeof aiUnderstand === 'function') {
    const conversationState = buildConversationState();
    aiResult = await aiUnderstand(query, conversationState);
  }

  // 3. Process recognized conversational intent from Gemini
  if (aiResult && aiResult.intent) {
    const { intent, request: structuredReq, chatMessage } = aiResult;

    // A. Explain why current recommendation was chosen (Layer B)
    if (intent === 'explain_current' && (lastRecommendation || currentFilmContext)) {
      const activeFilm = currentFilmContext || lastRecommendation.film;
      const whyReason = (lastRecommendation && lastRecommendation.aiReason) || generateDistinctWhyThisFits(activeFilm, lastRequest, query);
      const message = chatMessage || `I chose ${activeFilm.title} because ${whyReason.charAt(0).toLowerCase() + whyReason.slice(1)}`;
      addMessage('assistant', message);
      return;
    }

    // B. Natural follow-up / reaction / conversation (Layer B)
    if (intent === 'conversation') {
      const activeFilm = currentFilmContext || (lastRecommendation ? lastRecommendation.film : null);
      if (activeFilm) {
        const message = chatMessage || tellMeMoreText(activeFilm);
        addMessage('assistant', message);
      } else {
        addMessage('assistant', chatMessage || `I’ll help you find something from the VER-DÉ catalog. Tell me what you're in the mood for, or say 'surprise me'.`);
      }
      return;
    }

    // C. Request for another film (Layer A)
    if (intent === 'another' && (lastRecommendation || currentFilmContext)) {
      const baseFilm = currentFilmContext || lastRecommendation.film;
      const excludedId = baseFilm.id;
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
      const lead = aiChat || `Try ${film.title}.`;
      addMessage('assistant', lead, enriched || next, effectiveRequest);
      remember(enriched || next, effectiveRequest);
      return;
    }

    // D. Request for something shorter (Layer A)
    if (intent === 'shorter' && (lastRecommendation || currentFilmContext)) {
      const shorter = shorterMatch();
      if (!shorter) {
        addMessage('assistant', 'VER-DÉ does not have a confirmed shorter runtime than the last recommendation. Most works in the catalog do not yet have a published runtime. I can find something different instead.');
        return;
      }
      const effectiveRequest = lastRequest || requestFromStructured(structuredReq, query);
      const { matches: [enriched], chatMessage: aiChat } = await enrichWithAI([shorter], query, effectiveRequest);
      const film = (enriched && enriched.film) || shorter.film;
      const lead = aiChat || `Watch ${film.title}. Its ${film.runtime} runtime is the shortest confirmed runtime available.`;
      addMessage('assistant', lead, enriched || shorter, effectiveRequest);
      remember(enriched || shorter, effectiveRequest);
      return;
    }

    // E. Open discovery / surprise me (Layer A)
    const reqFromAI = requestFromStructured(structuredReq, query);
    if (intent === 'open_discovery' || (isOpenDiscovery(query) && !hasConstraints(reqFromAI))) {
      await recommendOpenDiscovery(query, structuredReq);
      return;
    }

    // F. New recommendation request or changed preferences (Layer A)
    const request = reqFromAI;
    const rawMatches = catalog
      .map(film => matchFilm(film, request))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    const { matches, chatMessage: aiChat } = await enrichWithAI(rawMatches, query, request);
    if (matches.length) {
      const lead = aiChat || `Watch ${matches[0].film.title}.`;
      addMessage('assistant', lead, matches[0], request);
      remember(matches[0], request);
    } else {
      if (isLayerBQuestion(query)) {
        const answer = answerLayerBQuestion(query, currentFilmContext || lastRecommendation?.film);
        addMessage('assistant', answer);
      } else {
        // Honest fallback with closest documented option for actual discovery queries
        const closest = catalog.find(f => publishedReason(f));
        const lead = "I don't have enough published detail to make that an exact match. But here is the closest work I do have.";
        if (closest) {
          const matchObj = { film: closest, matched: [], durationFits: false, score: 0 };
          addMessage('assistant', lead, matchObj, request);
          remember(matchObj, request);
        } else {
          addMessage('assistant', lead);
        }
      }
    }
    return;
  }

  // 4. Fallback path if AI layer is unavailable
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
  if (matches.length) {
    const lead = chatMessage || `Watch ${matches[0].film.title}.`;
    addMessage('assistant', lead, matches[0], request);
    remember(matches[0], request);
  } else {
    if (isLayerBQuestion(query)) {
      const answer = answerLayerBQuestion(query, currentFilmContext || lastRecommendation?.film);
      addMessage('assistant', answer);
    } else {
      const closest = catalog.find(f => publishedReason(f));
      const lead = "I don't have enough published detail to make that an exact match. But here is the closest work I do have.";
      if (closest) {
        const matchObj = { film: closest, matched: [], durationFits: false, score: 0 };
        addMessage('assistant', lead, matchObj, request);
        remember(matchObj, request);
      } else {
        addMessage('assistant', lead);
      }
    }
  }
}

promptForm.addEventListener('submit', async event => {
  event.preventDefault();
  expandMainAssistant();
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
const micBtn = document.querySelector('#micBtn');
const companionMicBtn = document.querySelector('#companionMicBtn');

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
  if (role === 'assistant') {
    item.innerHTML = `
      <div class="avatar">V</div>
      <div class="message-body">
        <p class="speaker">VER-DÉ</p>
        <p>${text}</p>
      </div>
      <button type="button" class="listen-btn" aria-label="Listen to response" title="Listen">🔊</button>
    `;
    const listenBtn = item.querySelector('.listen-btn');
    listenBtn.addEventListener('click', () => speakText(text, listenBtn));
  } else {
    item.innerHTML = `<div class="message-body"><p>${text}</p></div>`;
  }
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

  // True story
  if (/\b(?:true\s+story|real\s+life|reality)\b/.test(q)) {
    return `${film.title} is grounded in the direct lived experiences and family realities of Green Ralph on the farm in Nabua, Camarines Sur.`;
  }

  // Reactions in companion
  if (/\b(?:beautiful|awesome|love\s+this|great|remarkable)\b/.test(q)) {
    return `Glad this resonates with you. ${film.title} was made with direct honesty from the farm in Nabua.`;
  }

  if (/\b(?:depressing|sad|heartbreaking)\b/.test(q)) {
    return `${film.title} carries raw, unflinching emotion, reflecting real struggles of family and livelihood.`;
  }

  // Why recommended
  if (/\b(?:why\s+(?:did\s+you\s+recommend|this)|why\s+choose)\b/.test(q)) {
    return `I recommended ${film.title} because ${publishedReason(film)}.`;
  }

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
    return "I don't have that detail in the film information I have.";
  }

  // Runtime / Duration
  if (/\b(?:how\s+long|runtime|duration|minutes|length|time)\b/.test(q)) {
    if (film.runtime) {
      return `The confirmed runtime for ${film.title} is ${film.runtime}.`;
    }
    return "I don't have that detail in the film information I have.";
  }

  // Language
  if (/\b(?:language|dialect|spoken|tagalog|english|bikol)\b/.test(q)) {
    if (film.language && film.language.length) {
      return `The spoken language for ${film.title} is ${film.language.join(' and ')}.`;
    }
    return "I don't have that detail in the film information I have.";
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
  currentFilmContext = film;
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

// Fallback watch listener for any legacy watch triggers
if (recommendations) {
  recommendations.addEventListener('click', event => {
    const button = event.target.closest('.watch, .inline-watch');
    if (!button) return;
    const film = catalog.find(item => item.id === button.dataset.id);
    if (film) openFilmPlayer(film);
  });
}

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
  const player = document.querySelector('#dialogPlayer');
  player.src = '';
  player.hidden = true;
  player.style.display = 'none';
  currentWatchedFilm = null;
  collapseCompanion();
  watchDialog.close();
});

// Stop playback when the user dismisses the dialog via the Escape key.
watchDialog.addEventListener('cancel', () => {
  const player = document.querySelector('#dialogPlayer');
  player.src = '';
  player.hidden = true;
  player.style.display = 'none';
  currentWatchedFilm = null;
  collapseCompanion();
});

// Initialize Voice capabilities on page load
setupSpeechRecognition(micBtn, promptInput, promptForm);
setupSpeechRecognition(companionMicBtn, companionInput, companionForm);

// Wire initial greeting listen button
const initialListenBtn = document.querySelector('.assistant-message .listen-btn');
if (initialListenBtn) {
  initialListenBtn.addEventListener('click', () => {
    const text = document.querySelector('.assistant-message .message-body .assistant-lead-text')?.textContent || '';
    speakText(text, initialListenBtn);
  });
}
