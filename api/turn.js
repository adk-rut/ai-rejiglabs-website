// One visitor turn (#737, #738, spec #734): record what they said, answer it, record the answer,
// and ping Rut when the moment is one of his.
//
// The GHL conversation is the only transcript and the only memory — there is no KV and no
// database, so the caps, the Standdown and the card's "N min ago" are all counted off the thread
// itself on every turn.
import { requireToken, signToken } from "../lib/token.js";
import { answerTurn, capLine } from "../lib/answer-turn.js";
import { fetchMessages, fetchContact, threadRows, toHistory, postInbound, postOutbound } from "../lib/ghl-chat.js";
import { tgSend, escalationCard, standdownCard } from "../lib/telegram.js";

const MAX_CHARS = 500;      // per message
const MAX_VISITOR_MSGS = 40; // per thread, after which only the call-or-Rut line
const HISTORY_TURNS = 30;    // what the model reads back; the count above uses the whole thread
// Standdown (#730): while Rut's last reply is this fresh he owns the thread and Jasmin is silent.
// Read off the thread, never stored — the same four hours are visible to every handler and every
// deploy, and there is nothing to expire.
const STANDDOWN_MS = 4 * 60 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const session = requireToken(req, res);
  if (!session) return;

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const text = String(body.text ?? "").trim();
  const lang = String(body.lang || "").toLowerCase().startsWith("th") ? "th" : "en";
  const pageUrl = String(body.pageUrl || "").trim();
  if (!text) return res.status(400).json({ error: "message is empty" });
  // Codepoints, not UTF-16 units: 500 Thai characters is 500 characters.
  if ([...text].length > MAX_CHARS) return res.status(400).json({ error: `message is over ${MAX_CHARS} characters` });

  const rows = threadRows(await fetchMessages(session.conversationId));

  const inbound = await postInbound({ contactId: session.contactId, conversationId: session.conversationId, message: text });
  if (!inbound.ok) return res.status(502).json({ error: "could not reach the chat" });
  const conversationId = inbound.conversationId;
  const token = signToken({ contactId: session.contactId, conversationId });

  // Standdown before anything else: the point is that this turn costs no model call and posts
  // nothing. Rut still hears every line, in short form, or he is blind after his first reply.
  const lastRut = rows.filter((m) => m.who === "rut").pop();
  if (lastRut && Date.now() - lastRut.ts < STANDDOWN_MS) {
    await tgSend(standdownCard({ contact: await fetchContact(session.contactId), text, conversationId }));
    return res.status(200).json({ reply: "", standdown: true, token });
  }

  // This message included: the 41st is the one that gets the line instead of an answer.
  const capped = rows.filter((m) => m.who === "visitor").length + 1 > MAX_VISITOR_MSGS;
  const { reply, escalate } = capped
    ? { reply: capLine(lang) }
    : await answerTurn(toHistory(rows).slice(-HISTORY_TURNS), text, lang);

  await postOutbound({ contactId: session.contactId, conversationId, message: reply });

  // After the reply is posted, never before: a Telegram wobble must not cost the visitor an answer
  // (tgSend swallows its own failures, so there is nothing here to catch).
  if (escalate) {
    await tgSend(escalationCard({
      reason: escalate,
      contact: await fetchContact(session.contactId),
      pageUrl,
      lang,
      rows: [...rows, { who: "visitor", text, ts: Date.now() }],
      conversationId,
      locationId: process.env.GHL_REJIG_LOCATION_ID || "",
    }));
  }

  // Re-minted every turn: on the first one it is the only place the new conversationId exists, and
  // after that it is the same payload signed again, which the widget can safely overwrite.
  return res.status(200).json({ reply, token });
}
