// VER-DÉ AI client — browser side only.
// Calls /api/chat and returns { chatMessage, reasons } or null on any failure.
// The caller (app.js) falls back to keyword-engine text when this returns null.
// Does not know or care which provider is active — that is decided by the server.

async function aiEnhance(films, userMessage, context) {
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ films, userMessage, context })
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
