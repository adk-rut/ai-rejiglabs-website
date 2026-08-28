// Takeover (#739, spec #734): Rut replies to a ping card in Telegram and that text lands in the
// visitor's chat as his own message. He never opens GHL to answer.
//
// The card's `ref: <conversationId>` footer is the whole routing table — Telegram gives us the
// card back verbatim in `reply_to_message`, so nothing has to be stored between the ping and the
// reply. Every path answers 200: Telegram retries a non-2xx, and a retried Takeover is a
// duplicate message in the visitor's chat.
import { postOutbound, RUT_PREFIX } from "../lib/ghl-chat.js";
import { tgSend } from "../lib/telegram.js";

const GUIDANCE = "reply to a ping to send it";

export default async function handler(req, res) {
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const message = body?.message || body?.edited_message || {};

  // Anyone can find a bot and message it; only Rut's private chat may speak as Rut.
  if (String(message?.chat?.id ?? "") !== String(process.env.REJIG_SITECHAT_TELEGRAM_CHAT_ID ?? "")) {
    return res.status(200).json({ ok: true, ignored: "chat" });
  }

  const text = String(message.text || "").trim();
  const conversationId = String(message.reply_to_message?.text || "").match(/ref: (\w+)/)?.[1];
  if (!text || !conversationId) {
    await tgSend(GUIDANCE);
    return res.status(200).json({ ok: true, guidance: true });
  }

  const posted = await postOutbound({ conversationId, message: `${RUT_PREFIX}${text}` });
  if (!posted.ok) await tgSend(`could not send that — GHL said ${posted.status}. Try again.`);
  return res.status(200).json({ ok: true, sent: posted.ok });
}
