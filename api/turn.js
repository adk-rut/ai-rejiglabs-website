// One visitor turn from the widget (#737, #738, spec #734). The thin Live_Chat wrapper around
// `runTurn`: check the token, check the caps the widget can break, read the thread, hand over.
// Everything a turn actually does is channel-neutral and lives in lib/run-turn.js, because the
// IG/FB webhook (#741) runs the same turn with a different channel.
import { requireToken, signToken } from "../lib/token.js";
import { fetchMessages, threadRows } from "../lib/ghl-chat.js";
import { runTurn, MAX_CHARS } from "../lib/run-turn.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const session = requireToken(req, res);
  if (!session) return;

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const text = String(body.text ?? "").trim();
  const lang = String(body.lang || "").toLowerCase().startsWith("th") ? "th" : "en";
  if (!text) return res.status(400).json({ error: "message is empty" });
  // Codepoints, not UTF-16 units: 500 Thai characters is 500 characters.
  if ([...text].length > MAX_CHARS) return res.status(400).json({ error: `message is over ${MAX_CHARS} characters` });

  const rows = threadRows(await fetchMessages(session.conversationId));
  const out = await runTurn({
    contactId: session.contactId,
    conversationId: session.conversationId,
    text, lang,
    channel: "Live_Chat",
    rows,
    pageUrl: String(body.pageUrl || "").trim(),
  });
  if (!out.ok) return res.status(out.status || 502).json({ error: out.error });

  // Re-minted every turn: on the first one it is the only place the new conversationId exists, and
  // after that it is the same payload signed again, which the widget can safely overwrite.
  const token = signToken({ contactId: session.contactId, conversationId: out.conversationId });
  if (out.standdown) return res.status(200).json({ reply: "", standdown: true, token });
  // `served` is for the bench and nobody else: which provider and model answered (#746).
  return res.status(200).json({ reply: out.reply, token, booked: out.booked, served: out.served });
}
