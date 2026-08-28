// Rut's ping channel for Site chat (#738, spec #734): one bot, one private chat, two card shapes.
// Fire-and-forget by contract — every failure is swallowed and returned as `{ sent: false }`, so a
// Telegram outage costs Rut a notification and the visitor nothing.
//
// Prior art for the sendMessage shape only: projects/front-desk-relay/lib/telegram.js (read-only).
// The relay routes per branch and per forum topic; here there is exactly one destination.

const GHL_APP = "https://app.gohighlevel.com/v2/location";

export async function tgSend(text) {
  const token = process.env.REJIG_SITECHAT_TELEGRAM_BOT_TOKEN;
  const chat_id = process.env.REJIG_SITECHAT_TELEGRAM_CHAT_ID;
  if (!token || !chat_id) return { sent: false, reason: "telegram not configured" };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(5000),
    });
    const j = await r.json().catch(() => ({}));
    return { sent: !!j.ok, reason: j.ok ? undefined : String(j.description || r.status) };
  } catch (e) {
    return { sent: false, reason: String(e).slice(0, 120) };
  }
}

// GHL contacts come back under several name shapes depending on how they were created.
export const contactName = (c = {}) =>
  String(c.contactName || [c.firstName, c.lastName].filter(Boolean).join(" ") || c.name || "").trim() || "visitor";

const REASONS = { person: "🙋 asked for a person", "cannot-answer": "❓ could not answer" };

// `rows` are threadRows (oldest first) WITH the line being answered already appended, so the last
// three turns include it and the "N min ago" is measured off the visitor line before it.
export function escalationCard({ reason, contact = {}, pageUrl = "", lang = "en", rows = [], conversationId = "", locationId = "", now = Date.now() }) {
  const visitors = rows.filter((m) => m.who === "visitor");
  const previous = visitors[visitors.length - 2];
  const ago = previous?.ts ? `last visitor message ${Math.max(0, Math.round((now - previous.ts) / 60000))} min ago` : "first visitor message";
  const who = { visitor: contactName(contact), jasmin: "Jasmin", rut: "Rut" };
  return [
    REASONS[reason] || reason,
    [contactName(contact), contact.email || "no email", contact.phone || "no phone", pageUrl || contact.source || "unknown page", lang, ago].join(" · "),
    "",
    ...rows.slice(-3).map((m) => `${who[m.who]}: ${m.text}`),
    "",
    `${GHL_APP}/${locationId}/conversations/conversations/${conversationId}`,
    `ref: ${conversationId}`,
  ].join("\n");
}

// Standdown: Rut is already on the thread, so he needs the new line and nothing he already knows.
export const standdownCard = ({ contact = {}, text = "", conversationId = "" }) =>
  [`💬 ${contactName(contact)}`, text, `ref: ${conversationId}`].join("\n");

// 📅 A Discovery call just landed on Rut's calendar. The three-line summary is the same text that
// went on the contact note, so the card and the CRM never tell him two different stories.
export function bookingCard({ contact = {}, name = "", email = "", phone = "", whenText = "", summary = "", contactId = "", conversationId = "", locationId = "" }) {
  const who = name || contactName(contact);
  const link = conversationId
    ? `${GHL_APP}/${locationId}/conversations/conversations/${conversationId}`
    : `${GHL_APP}/${locationId}/contacts/detail/${contactId}`;
  return [
    `📅 Discovery call booked — ${whenText}`,
    [who, email || contact.email || "no email", phone || contact.phone || "no phone"].join(" · "),
    "",
    summary,
    "",
    link,
  ].join("\n");
}
