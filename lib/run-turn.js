// One visitor turn, whatever channel it came in on (#737, #738, #740, #741; spec #734).
//
// This is everything api/turn.js used to be, minus the widget's token and its 400s: record the
// visitor's line (on the channels where that is ours to do), decide whether Rut owns the thread,
// answer, offer or book the Discovery call, post the answer back out on the same channel, and ping
// Rut when the moment is one of his.
//
// The GHL conversation is the only transcript and the only memory — there is no KV and no
// database, so the caps, the Standdown and the card's "N min ago" are all counted off the thread
// itself on every turn.
import { answerTurn, capLine } from "./answer-turn.js";
import { fetchContact, postInbound, postOutbound, toHistory, channelLabel } from "./ghl-chat.js";
import { tgSend, escalationCard, standdownCard } from "./telegram.js";
import { freeSlots, matchSlots, bookDiscovery, offerLine, bookedLine } from "./booking.js";

export const MAX_CHARS = 500;       // per message
const MAX_VISITOR_MSGS = 40;        // per thread, after which only the call-or-Rut line
const HISTORY_TURNS = 30;           // what the model reads back; the count above uses the whole thread
// Standdown (#730): while Rut's last reply is this fresh he owns the thread and Jasmin is silent.
// Read off the thread, never stored — the same four hours are visible to every handler and every
// deploy, and there is nothing to expire.
const STANDDOWN_MS = 4 * 60 * 60 * 1000;

/**
 * @param rows threadRows for this channel, oldest first, WITHOUT the line being answered.
 * Returns { ok, status?, error?, reply, standdown?, booked?, served?, conversationId }.
 */
export async function runTurn({ contactId, conversationId, text, lang = "en", channel = "Live_Chat", rows = [], pageUrl = "" }) {
  const label = channelLabel(channel);

  // Live_Chat is the only channel whose inbound row is ours to write: on IG/FB the visitor's
  // message is already in the thread by the time GHL's workflow calls us, and posting it again
  // would show them their own words twice.
  if (channel === "Live_Chat") {
    const inbound = await postInbound({ contactId, conversationId, message: text, type: channel });
    if (!inbound.ok) return { ok: false, status: 502, error: "could not reach the chat" };
    conversationId = inbound.conversationId;
  }

  // Standdown before anything else: the point is that this turn costs no model call and posts
  // nothing. Rut still hears every line, in short form, or he is blind after his first reply.
  const lastRut = rows.filter((m) => m.who === "rut").pop();
  if (lastRut && Date.now() - lastRut.ts < STANDDOWN_MS) {
    await tgSend(standdownCard({ contact: await fetchContact(contactId), text, conversationId, channel: label }));
    return { ok: true, reply: "", standdown: true, conversationId };
  }

  // This message included: the 41st is the one that gets the line instead of an answer.
  const capped = rows.filter((m) => m.who === "visitor").length + 1 > MAX_VISITOR_MSGS;
  const { reply, escalate, booking, served } = capped
    ? { reply: capLine(lang) }
    : await answerTurn(toHistory(rows).slice(-HISTORY_TURNS), text, lang);

  // The Discovery call, in the conversation (#740). The model asked for it; the calendar decides
  // what is actually open, and only a day AND a clock time that land on one slot book anything.
  // A calendar we cannot read costs the visitor the times, never the answer.
  let message = reply;
  let booked;
  if (booking?.wants) {
    const slots = (await freeSlots()) || [];
    if (slots.length) {
      const { matches, exact } = matchSlots(booking.hint, slots);
      const done = exact
        ? await bookDiscovery({ contactId, conversationId, slot: matches[0], lang, channel: label })
        : null;
      if (done?.ok) {
        booked = { startTime: done.startTime, when: done.when, appointmentId: done.appointmentId };
        message = `${reply}\n\n${bookedLine(done.when, lang)}`;
      } else {
        // Includes the slot GHL refused between the read and the write: offer again rather than
        // apologise, the visitor still wants a call.
        const offer = (matches.length && !done ? matches : slots).slice(0, 3);
        message = `${reply}\n\n${offerLine(offer, lang, matches.length === 0 || !!done)}`;
      }
    }
  }

  await postOutbound({ contactId, conversationId, message, type: channel });

  // After the reply is posted, never before: a Telegram wobble must not cost the visitor an answer
  // (tgSend swallows its own failures, so there is nothing here to catch).
  if (escalate) {
    await tgSend(escalationCard({
      reason: escalate,
      contact: await fetchContact(contactId),
      pageUrl,
      lang,
      rows: [...rows, { who: "visitor", text, ts: Date.now() }],
      conversationId,
      channel: label,
      locationId: process.env.GHL_REJIG_LOCATION_ID || "",
    }));
  }

  return { ok: true, reply: message, booked, served, conversationId };
}
