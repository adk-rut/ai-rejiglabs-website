// POST /api/book (#740, spec #734): the one booking endpoint. The chat sends a session token and a
// slot; the page CTA sends a slot plus name, email and phone. Everything after that is the same.
import { verifyToken } from "../lib/token.js";
import { bookDiscovery } from "../lib/booking.js";

const clean = (v) => String(v ?? "").trim();

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const slot = clean(body.slot);
  if (!slot || Number.isNaN(Date.parse(slot))) return res.status(400).json({ error: "a slot time is required" });
  const lang = clean(body.lang).toLowerCase().startsWith("th") ? "th" : "en";

  // The token is optional here, unlike every other handler: a visitor can book from the page CTA
  // without ever opening the chat. What it is NOT is optional identity — without it, the three
  // details the gate would have asked for are required instead.
  const session = verifyToken(String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "")) || {};
  const name = clean(body.name);
  const email = clean(body.email);
  const phone = clean(body.phone);
  if (!session.contactId && !(name && email && phone)) {
    return res.status(400).json({ error: "name, email and phone are all required" });
  }

  // Page questions (/blockchain): a small {label: answer} map, strings only, bounded.
  const answers = Object.fromEntries(Object.entries(body.answers && typeof body.answers === "object" ? body.answers : {})
    .filter(([k, v]) => typeof v === "string" && v.trim()).slice(0, 8)
    .map(([k, v]) => [clean(k).slice(0, 80), clean(v).slice(0, 600)]));

  const booked = await bookDiscovery({
    contactId: session.contactId,
    conversationId: session.conversationId,
    name, email, phone, slot, lang, answers,
    pageUrl: clean(body.pageUrl),
  });
  if (booked.stale) return res.status(401).json({ error: booked.error });
  if (!booked.ok) return res.status(502).json({ error: booked.error });
  return res.status(200).json(booked);
}
