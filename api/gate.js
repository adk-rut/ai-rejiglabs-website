// Lead gate (#736, spec #734): the visitor gives name + email + phone, becomes a contact on
// Rejig's OWN GHL sub-account, and gets back the signed session token every later handler needs.
//
// Nothing is stored anywhere else. There is no session store, no KV, no database: the contact is
// the record and the token is the session.
//
// Phone is passed through byte for byte. The widget owns the "+" prefix and the "start with your
// country code, not 0" nudge (#728), so a second opinion here would only fight it.
import { signToken } from "../lib/token.js";

const GHL_BASE = "https://services.leadconnectorhq.com";
const CONTACT_VERSION = "2021-07-28";

const clean = (v) => String(v ?? "").trim();

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const name = clean(body.name);
  const email = clean(body.email);
  const phone = clean(body.phone);
  if (!name || !email || !phone) return res.status(400).json({ error: "name, email and phone are all required" });

  const lang = clean(body.lang).toLowerCase().startsWith("th") ? "th" : "en";

  const r = await fetch(`${GHL_BASE}/contacts/upsert`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GHL_REJIG_API_KEY}`,
      Version: CONTACT_VERSION,
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0", // GHL's Cloudflare blocks default fetch UAs
    },
    body: JSON.stringify({
      locationId: process.env.GHL_REJIG_LOCATION_ID,
      name,
      email, // upsert matches on email: the same visitor from a second page is one contact
      phone,
      tags: ["site-chat", `lang-${lang}`],
      // The page the chat was opened on, in GHL's native Source field, so it shows on the contact
      // without a custom field to create and keep in sync.
      source: clean(body.pageUrl) || "site-chat",
    }),
  });

  const contactId = r.ok ? (await r.json())?.contact?.id : null;
  if (!contactId) {
    console.error("[gate] contact upsert failed", r.status, await r.text().catch(() => ""));
    return res.status(502).json({ error: "could not save your details" });
  }

  // conversationId joins the payload in #737, when the first visitor message opens the thread.
  return res.status(200).json({ token: signToken({ contactId }), contactId });
}
