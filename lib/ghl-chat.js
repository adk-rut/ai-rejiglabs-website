// The GHL side of Site chat (#737, spec #734): read a contact's thread, post the visitor's line
// in, post Jasmin's line back out. Everything channel-specific lives here so `answer-turn.js`
// stays channel-neutral — the IG/FB webhook (#743) reuses this file with a different `type`.
//
// Shapes are the ones #732 proved live on the Rejig sub-account, not the ones the docs imply:
// `POST /conversations/messages/inbound` with `type: "Live_Chat"` and NO `conversationProviderId`
// returns 201, and both directions read back as `TYPE_LIVE_CHAT` with no `userId`.
const GHL_BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-04-15"; // conversations API (contacts is 2021-07-28 — different version)

// A GHL conversation is per CONTACT, not per channel (#732): a visitor who once DM'd the Rejig
// Instagram gets their site chat stitched into that same thread. So every read filters by row.
export const LIVE_CHAT = "TYPE_LIVE_CHAT";

// Rut's Telegram replies are posted as outbound Live_Chat with this prefix (#730), which is the
// only thing separating a human's line from Jasmin's — our own posts carry no `userId` either.
export const RUT_PREFIX = "Rut: ";

const headers = () => ({
  Authorization: `Bearer ${process.env.GHL_REJIG_API_KEY}`,
  Version: VERSION,
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0", // GHL's Cloudflare blocks default fetch UAs
});

// Recent rows, newest-first as GHL returns them. Best-effort: a GHL wobble costs the model its
// memory for one turn, never the visitor's answer.
export async function fetchMessages(conversationId, limit = 100) {
  if (!conversationId) return [];
  try {
    const r = await fetch(`${GHL_BASE}/conversations/${conversationId}/messages?limit=${limit}`, { headers: headers() });
    if (!r.ok) return [];
    const j = await r.json();
    return j?.messages?.messages || j?.messages || [];
  } catch {
    return [];
  }
}

// The rows the widget and the brain are allowed to see: Live_Chat, plus any outbound Rut wrote
// (his reply can land on another channel — the composer offered no Live Chat option, #732).
// `text` has the `Rut: ` prefix stripped; `who` is visitor | jasmin | rut.
export function threadRows(raw = []) {
  return raw
    .filter((m) => m.messageType === LIVE_CHAT || (m.direction === "outbound" && String(m.body || "").startsWith(RUT_PREFIX)))
    .map((m) => {
      const body = String(m.body || "").trim();
      const isRut = m.direction === "outbound" && body.startsWith(RUT_PREFIX);
      return {
        id: m.id || "",
        who: m.direction === "inbound" ? "visitor" : isRut ? "rut" : "jasmin",
        text: isRut ? body.slice(RUT_PREFIX.length).trim() : body,
        ts: Date.parse(m.dateAdded || "") || 0,
      };
    })
    .filter((m) => m.text)
    .reverse(); // GHL returns newest-first; everyone downstream wants oldest -> newest
}

// The same rows as LLM turns. Rut's line is labelled rather than dropped: the model has to know a
// human already spoke, or it answers over him.
export const toHistory = (rows) => rows.map((m) => ({
  role: m.who === "visitor" ? "user" : "assistant",
  content: m.who === "rut" ? `Rut (the founder) replied: ${m.text}` : m.text,
}));

// The visitor's line, recorded as a real inbound message. On the first turn there is no
// conversation yet: GHL opens one and names it in the response, and that id is what gets folded
// into the re-minted token.
export async function postInbound({ contactId, conversationId, message, type = "Live_Chat" }) {
  const r = await fetch(`${GHL_BASE}/conversations/messages/inbound`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ type, contactId, conversationId: conversationId || undefined, message, direction: "inbound" }),
  });
  if (!r.ok) return { ok: false, status: r.status };
  const j = await r.json().catch(() => ({}));
  return { ok: true, conversationId: j?.conversationId || conversationId || "", messageId: j?.messageId || "" };
}

export async function postOutbound({ contactId, conversationId, message, type = "Live_Chat" }) {
  const r = await fetch(`${GHL_BASE}/conversations/messages`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ type, contactId, conversationId: conversationId || undefined, message }),
  });
  if (!r.ok) return { ok: false, status: r.status };
  const j = await r.json().catch(() => ({}));
  return { ok: true, messageId: j?.messageId || "" };
}
