// POST /api/dm-webhook (#741, spec #734): Jasmin answers Rejig's Instagram and Facebook DMs.
//
// A hand-built GHL workflow (Customer Replied, IG + FB) fires a Webhook action at this URL. What
// arrives depends on how that action was filled in, so both shapes are read: the mapped custom
// data (nested under `customData`, GHL's shape for Webhook-action fields) and, when the action was
// left bare, GHL's own payload. The location id is NEVER taken from either — it is env, because a
// merge field that renders red posts an empty string and an empty string reads as "some other
// account's contact".
//
// The visitor's line is already a row in the thread by the time this fires, so unlike the widget
// there is nothing to post inbound; the turn itself is lib/run-turn.js, shared with api/turn.js.
import { createHash, timingSafeEqual } from "node:crypto";
import { fetchMessages, threadRows, findConversation } from "../lib/ghl-chat.js";
import { runTurn, MAX_CHARS } from "../lib/run-turn.js";

// The bubbles and their typing pauses come AFTER the model turn; the default function limit is not
// enough for all three (the relay learned this on a Thalang IG thread, 2026-08-24).
export const config = { maxDuration: 60 };

// The workflow's Webhook action sends this header; nothing else knows it. Without it the endpoint
// is a public "post as Jasmin into conversation X" button for anyone who learns a conversation id,
// and a free OpenRouter meter for anyone who does not. Digests, so the compare is a fixed 32 bytes
// and an attacker learns nothing from how long it took.
const digest = (v) => createHash("sha256").update(String(v ?? "")).digest();
const secretOk = (given) => {
  const want = process.env.DM_WEBHOOK_SECRET || "";
  return !!want && timingSafeEqual(digest(given), digest(want));
};

const pick = (...vals) => vals.map((v) => String(v ?? "").trim()).find(Boolean) || "";

// GHL says "IG" on a message type, "instagram" on a channel field, and the workflow's own
// dropdown says something else again. All three mean the same inbox.
export function normalizeChannel(value) {
  const s = String(value || "").toUpperCase();
  if (s === "IG" || s.includes("INSTA")) return "IG";
  if (s === "FB" || s.includes("FACE") || s.includes("MESSENGER")) return "FB";
  return "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  // Before the body is even parsed: an unsigned caller gets nothing read, nothing sent, no model.
  if (!secretOk(req.headers?.["x-webhook-secret"])) {
    console.error("[dm-webhook] 401: secret header", req.headers?.["x-webhook-secret"] ? "wrong" : "missing");
    return res.status(401).json({ error: "unauthorized" });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const cd = body.customData || {};
  const contactId = pick(cd.contact_id, cd.contactId, body.contact_id, body.contactId, body.contact?.id);
  const conversationId = pick(cd.conversation_id, cd.conversationId, body.conversation_id, body.conversationId, body.conversation?.id)
    || await findConversation(contactId);
  // `{{message.type}}` renders EMPTY on a live Customer Replied fire (seen 2026-08-30), so the
  // channel comes from the thread itself: the newest inbound row's type is the inbox the DM sat in.
  const raw = await fetchMessages(conversationId);
  const channel = normalizeChannel(pick(cd.channel, body.channel, body.message?.type, body.messageType, body.conversation?.lastMessageType))
    || normalizeChannel(raw.find((m) => m.direction === "inbound")?.messageType);
  // Shape only, never content: which keys GHL actually sent is the whole diagnosis when a DM goes
  // unanswered, and `vercel logs` is the only place to read it.
  const reject = (why) => {
    console.error(`[dm-webhook] 400 ${why}: keys=${Object.keys(body).join(",")} customData=${Object.keys(cd).join(",")} channel=${JSON.stringify(pick(cd.channel, body.channel, body.message?.type, body.messageType))}`);
    return res.status(400).json({ error: why });
  };
  if (!contactId || !conversationId) return reject("contact and conversation are required");
  // Only the two DM inboxes: this endpoint must never answer an SMS or an email as if it were one.
  if (!channel) return reject("unsupported channel");

  const rows = threadRows(raw, channel);
  const last = rows.filter((m) => m.who === "visitor").pop();
  const text = pick(cd.message, body.message?.body, last?.text);
  if (!text) return res.status(200).json({ ignored: "no visitor message" });
  // The widget rejects an over-long message to its face; a DM has no face to reject to, and
  // truncating would answer a question nobody asked. Leave it for Rut.
  if ([...text].length > MAX_CHARS) return res.status(200).json({ ignored: "over the message cap" });

  // The line being answered is history to nobody: `runTurn` appends it itself.
  const history = last && last.text === text ? rows.slice(0, rows.lastIndexOf(last)) : rows;
  const lang = pick(cd.lang, body.lang).toLowerCase().startsWith("th") || /[฀-๿]/.test(text) ? "th" : "en";

  const out = await runTurn({ contactId, conversationId, text, lang, channel, rows: history, pageUrl: `${channel === "IG" ? "Instagram" : "Facebook"} DM` });
  if (!out.ok) return res.status(out.status || 502).json({ error: out.error });
  return res.status(200).json({ ok: true, reply: out.reply, standdown: out.standdown, booked: out.booked });
}
