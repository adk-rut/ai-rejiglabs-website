// Thread poll (#737, spec #734): the widget's way back into a conversation it did not keep.
// Nothing is stored in the browser but the token, so a returning visitor's transcript — and Rut's
// Takeover while the chat is open — both come from here.
//
// The cursor is a timestamp, not an id: the widget already knows the `ts` of the last row it
// rendered, and GHL gives every message one. `since` is exclusive.
import { requireToken } from "../lib/token.js";
import { fetchMessages, threadRows } from "../lib/ghl-chat.js";

export default async function handler(req, res) {
  if (req.method && req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const session = requireToken(req, res);
  if (!session) return;

  // Before the first message there is no conversation to read: an empty thread, not an error.
  if (!session.conversationId) return res.status(200).json({ messages: [], cursor: 0 });

  const rows = threadRows(await fetchMessages(session.conversationId));
  const since = Number(req.query?.since) || 0;
  // The cursor tracks the whole thread, not the filtered slice, so an empty poll never rewinds it.
  const cursor = rows.reduce((max, m) => Math.max(max, m.ts), since);
  return res.status(200).json({ messages: rows.filter((m) => m.ts > since), cursor });
}
