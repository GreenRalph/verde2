// VER-DÉ AI client — browser side only.
// Calls /api/chat:
//   • aiUnderstand(userMessage, conversationState): returns { intent, request, chatMessage } or null
//   • aiEnhance(films, userMessage, context): returns { chatMessage, reasons } or null
// The caller (app.js) falls back to deterministic keyword-engine logic when either returns null.

async function aiUnderstand(userMessage, conversationState) {
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'understand', userMessage, conversationState })
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data.intent !== 'string' || !data.request) return null;
    return data;
  } catch {
    return null;
  }
}

async function aiEnhance(films, userMessage, context) {
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'enrich', films, userMessage, context })
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Validate shape before trusting it
    if (typeof data.chatMessage !== 'string' || !Array.isArray(data.reasons)) return null;
    return data;
  } catch {
    return null;
  }
}
