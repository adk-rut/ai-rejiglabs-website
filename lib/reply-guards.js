// Reply guards for Site chat's brain, copied from projects/front-desk-relay/lib/chat-agent.js
// (#735, ADR 0014). The relay is read-only reference: nothing here imports from it, and nothing
// there imports from here. `fixPermissionAsk` and `PHANTOM_CLAIMS` are deliberately NOT copied —
// they guard a booking-writing barbershop agent, and Site chat books one calendar, not a chair.
// Every comment below is the relay's own; it carries the live case each guard was written for.

// Strip anything meant to STEER the model (or violate RT's style) from a customer-facing reply.
// The LLM composes replies from the relay's steering strings, so a marker can leak on a bad turn;
// this is the last line of defence.
export function scrub(reply) {
  return String(reply || "")
    .replace(/\b(BOOKED|CANCELLED|RESCHEDULED|MISSING_ID|NOT_FOUND|SLOT_TAKEN|TOO_SOON|BARBER_OFF|BARBER_UNAVAILABLE|TECHNICAL_ERROR|RATE_LIMIT|CALL_LIMIT|GROUP_SLOT_FULL|GROUP_TOO_LARGE|NO_MORE_TODAY|INVALID_DATE|BAD_PHONE|OUTSIDE_HOURS|CLOSED_WEDNESDAY|OUTAGE)\b/g, "")
    .replace(/DAY MEMORY[^\n]*/gi, "")
    .replace(/\s*—\s*/g, ", ") // RT rule: never em-dashes
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// Remove every emoji from a banned turn's reply (belt to the prompt note's braces — the live
// model sometimes ignores even a user-turn instruction). Eats the space BEFORE the emoji so
// "เจอกันค่ะ 😊" → "เจอกันค่ะ"; ️/‍ cover variation selectors and ZWJ sequences.
export function stripEmoji(reply) {
  return String(reply || "").replace(/\s*(?:\p{Extended_Pictographic}|\uFE0F|\u200D)+/gu, "").trim();
}

// Split a composed reply into up to `max` short message bubbles so it reads like a human typing,
// not one wall of text. Paragraphs first (the model sometimes newlines between thoughts), then
// sentence boundaries when it's a single block; overflow past `max` is merged back into the last
// bubble so no text is ever dropped. A single short sentence stays one bubble (no fake delay).
export function splitBubbles(reply, max = 3) {
  const text = String(reply || "").trim();
  if (!text) return [];
  let parts = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) {
    // Sentence split, punctuation kept. A Latin .!? only ends a sentence when whitespace follows,
    // so a URL's inner dots (maps.app.goo.gl) never split it into bubbles. CJK enders split standalone.
    parts = text.split(/(?<=[.!?])\s+|(?<=[。！？])/).map((s) => s.trim()).filter(Boolean);
    if (parts.length < 1) parts = [text];
  }
  if (parts.length <= max) return parts;
  const head = parts.slice(0, max - 1);
  head.push(parts.slice(max - 1).join(" ")); // merge the tail so nothing is lost
  return head;
}

// The reply promises that a PERSON will follow up. In the relay that fires an escalation, because
// nobody had been told; in Site chat it is the same claim about Rut, and the same answer applies.
export const PROMISED_HUMAN =
  /(team|staff|admin|colleague|someone|a person|human)[^.!?\n]{0,60}(follow up|follows up|get back|gets back|be in touch|contact you|reach out|will check|will confirm|will let you know)|(แอดมิน|ทีมงาน|พนักงาน|เจ้าหน้าที่|คนของร้าน)[^\n]{0,60}(ติดต่อกลับ|ติดต่อไป|ตอบกลับ|ยืนยันให้|เช็คให้|แจ้งให้)/i;

// An "open question" goes stale: live 2026-08-02 (contact liiD6pnVRCUVLZtAWZcP, Rey), a 15-day-old
// "I'm 10 mins late / parking" left hanging after our last post got injected as today's open item,
// and the agent answered THAT ("hurry, Phon is waiting!") instead of the fresh 4pm booking request.
// 12h: anything the customer still cares about after half a day, they will say again; anything
// older is a previous visit. Turns without a `ts` (tests, replay lab) are never aged out.
const STALE_OPEN_MS = 12 * 60 * 60 * 1000;

// A question the customer sends WHILE we are typing is the one that gets lost: the webhook for it
// lands mid-run, the reply already in flight answers only the message before it, and from the next
// turn on it just looks handled. Live case 2026-07-27: "can you please advise the price per
// child?" landed 245ms before the booking reply went out and was never answered at all.
//
// Its signature in the history is a RUN of consecutive customer messages with no reply between them:
// the first one is what the in-flight reply addressed, anything after it in that run was written
// blind. Only the MOST RECENT run counts (older ones were visible to later replies), and only when a
// reply came after it — otherwise this turn is the one answering the burst and nothing is overdue.
// Deliberately over-flags rather than under-flags: a question already answered costs one ignored line
// (the injected note says so), a question dropped costs a customer waiting for an answer that never comes.
// ponytail: "?" plus a handful of Thai question words — no parser, no model call. A Thai question with
// none of these markers is missed; the standing prompt rule is the backstop for that.
const QUESTION_MARK = /[?？]|ไหม|มั้ย|เท่าไหร่|เท่าไร|กี่|อะไร|ยังไง|หรือเปล่า/;
export function pendingQuestions(history = [], nowMs = Date.now()) {
  const lastAssistant = history.map((m) => m.role).lastIndexOf("assistant");
  if (lastAssistant < 0) return []; // never replied yet → this turn sees the whole burst
  let end = -1; // end of the most recent consecutive-user run that a reply came after
  for (let i = lastAssistant - 1; i >= 0; i--) {
    if (history[i].role === "user" && history[i - 1]?.role === "user") { end = i; break; }
  }
  if (end < 0) return [];
  let start = end;
  while (start > 0 && history[start - 1].role === "user") start--;
  // The first message of the run is the one the in-flight reply was answering; the rest went unseen.
  // A question from a past visit is not open — hence the STALE_OPEN_MS bound.
  return history.slice(start + 1, end + 1)
    .filter((m) => !(m.ts && nowMs - m.ts > STALE_OPEN_MS))
    .map((m) => String(m.content || "").trim())
    .filter((c) => c && QUESTION_MARK.test(c));
}

// The history the LLM reads carries no dates, so a long silence in the middle of a thread is
// invisible: a customer coming back two weeks later looks mid-conversation, and the model happily
// resumes the old booking's small talk (the 2026-08-02 Rey bug). This renders the gap as a short
// bracketed note prefixed onto the turn AFTER the silence. 6h: shorter gaps are same-visit pauses
// (a human takeover, a slow customer) where resuming context is exactly right.
// Returns "" when either side has no `ts` — ts-less callers (tests, replay lab) opt out.
const GAP_NOTE_MS = 6 * 60 * 60 * 1000;
export function gapNote(prev, ts) {
  if (!prev?.ts || !ts || ts - prev.ts < GAP_NOTE_MS) return "";
  const hours = Math.round((ts - prev.ts) / 3600000);
  const ago = hours < 48 ? `${hours} hours` : `${Math.round(hours / 24)} days`;
  return `[SHOP SYSTEM NOTE, not from the customer, never quote or mention it: ${ago} passed before the next message. Earlier topics (old bookings, running late, etc.) are over unless the customer raises them again; treat what follows as a fresh visit.]\n`;
}
