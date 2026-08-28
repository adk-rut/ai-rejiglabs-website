// The relay's guard assertions, copied verbatim with the functions they exercise (#735).
// Every case here is a live incident the relay hit; see lib/reply-guards.js for the story.
//   node --test test/reply-guards.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { scrub, stripEmoji, splitBubbles, pendingQuestions, gapNote, PROMISED_HUMAN } from "../lib/reply-guards.js";

// --- scrub: last-line-of-defence strip of markers + em-dash. ---
test("scrub", () => {
  assert.equal(scrub("BOOKED you're all set"), "you're all set");
  assert.doesNotMatch(scrub("done — see you"), /—/);
  assert.equal(scrub("SLOT_TAKEN try 3 PM"), "try 3 PM");
});

// --- splitBubbles: one reply -> up to 3 ordered bubbles (paragraphs, then sentences). ---
test("splitBubbles", () => {
  // Two paragraphs -> two posts, in order (the human-typing feel).
  assert.deepEqual(splitBubbles("Great, you're all set for 3 PM.\n\nSee you then! 🙏"),
    ["Great, you're all set for 3 PM.", "See you then! 🙏"]);
  // Single block of multiple sentences -> split on sentence enders, punctuation kept.
  assert.deepEqual(splitBubbles("Hi! How can I help?"), ["Hi!", "How can I help?"]);
  // A single short sentence stays ONE bubble (no fake delay).
  assert.deepEqual(splitBubbles("You're booked for 3 PM today with Guy, see you then!"),
    ["You're booked for 3 PM today with Guy, see you then!"]);
  // Never more than `max`; overflow merges into the last so no text is dropped.
  const four = splitBubbles("One. Two. Three. Four.");
  assert.equal(four.length, 3);
  assert.equal(four.join(" ").includes("Four."), true, "tail sentence not dropped");
  // A URL's inner dots must NOT split it into bubbles (the maps.app.goo.gl bug).
  assert.deepEqual(splitBubbles("Here's their map: https://maps.app.goo.gl/vMqERuSB27g8bLno8"),
    ["Here's their map: https://maps.app.goo.gl/vMqERuSB27g8bLno8"]);
  // Sentence + URL: split at the sentence break, URL stays whole in its own bubble.
  assert.deepEqual(splitBubbles("Message them directly. Here's their map: https://maps.app.goo.gl/eZKRQnCAhHFujCH66"),
    ["Message them directly.", "Here's their map: https://maps.app.goo.gl/eZKRQnCAhHFujCH66"]);
  // Thai with no Latin punctuation -> one bubble, unchanged.
  assert.deepEqual(splitBubbles("ขอบคุณค่ะ เดี๋ยวจัดให้นะคะ"), ["ขอบคุณค่ะ เดี๋ยวจัดให้นะคะ"]);
  assert.deepEqual(splitBubbles(""), []);
});

// --- stripEmoji edge cases: Thai text untouched, multi-emoji runs and ✂️ (with variation selector) go.
test("stripEmoji", () => {
  assert.equal(stripEmoji("เจอกันค่ะ 😊"), "เจอกันค่ะ");
  assert.equal(stripEmoji("ตัดผม ✂️ พรุ่งนี้ค่ะ"), "ตัดผม พรุ่งนี้ค่ะ");
  assert.equal(stripEmoji("great 🙏😊"), "great");
  assert.equal(stripEmoji("no emoji here"), "no emoji here");
});

// --- A question the customer asked while the agent was typing must still get answered. The webhook
// for a message that lands mid-run is dropped, so the only place it survives is the thread history
// (live: "price per child?" arrived 245ms before the reply went out and was never answered). ---
test("pendingQuestions", () => {
  // The live thread: two customer messages back to back, then one reply that answered only the first.
  const sarit = [
    { role: "user", content: "Hello, is it possible to schedule a haircut for 2 boys tomorrow?" },
    { role: "assistant", content: "We have 3 PM or 4 PM open. Would either of those work? 😊" },
    { role: "user", content: "3pm Is good" },
    { role: "user", content: "can you please advise the price per child?" },
    { role: "assistant", content: "Great! What's your name for the booking? 😊" },
  ];
  assert.deepEqual(pendingQuestions(sarit), ["can you please advise the price per child?"],
    "the question that landed mid-reply is flagged, the message before it (which the reply answered) is not");

  // No burst → nothing overdue. One customer message, one reply, all accounted for.
  assert.deepEqual(pendingQuestions([
    { role: "user", content: "are you open today?" },
    { role: "assistant", content: "Yes, 10 AM to 8 PM 😊" },
  ]), [], "a normal alternating conversation flags nothing");

  // A burst with no reply after it is THIS turn's job (burst-collapse answers the whole thing).
  assert.deepEqual(pendingQuestions([
    { role: "assistant", content: "Hi! 😊" },
    { role: "user", content: "book me tomorrow" },
    { role: "user", content: "how much is a beard trim?" },
  ]), [], "an unanswered burst at the very end is the current turn's to answer, not overdue");

  // Not every stray message is a question — a plain statement in a burst isn't flagged.
  assert.deepEqual(pendingQuestions([
    { role: "user", content: "3pm is good" },
    { role: "user", content: "make it two people" },
    { role: "assistant", content: "What's your name? 😊" },
  ]), [], "a non-question in a burst is not treated as an open question");

  // Thai questions rarely carry "?", so the marker words have to catch them.
  assert.deepEqual(pendingQuestions([
    { role: "user", content: "บ่ายสามได้ค่ะ" },
    { role: "user", content: "ตัดผมเด็กราคาเท่าไหร่คะ" },
    { role: "assistant", content: "ขอชื่อด้วยนะคะ 😊" },
  ]), ["ตัดผมเด็กราคาเท่าไหร่คะ"], "a Thai question without a question mark is still caught");

  // A mid-reply burst from a past visit stays closed.
  const NOW = Date.parse("2026-08-02T09:00:00Z");
  const DAY = 24 * 3600000;
  assert.deepEqual(pendingQuestions([
    { role: "user", content: "book me tomorrow", ts: NOW - 15 * DAY },
    { role: "user", content: "how much is a beard trim?", ts: NOW - 15 * DAY },
    { role: "assistant", content: "What's your name? 😊", ts: NOW - 15 * DAY },
  ], NOW), [], "a stale mid-reply burst is not re-flagged weeks later");
});

// --- gapNote: the history the LLM reads has no dates, so a long silence is invisible and the model
// resumes a two-week-old topic as if live (the Rey bug). The gap renders as a bracketed note on the
// turn after the silence. ---
test("gapNote", () => {
  const H = 3600000;
  const t0 = Date.parse("2026-07-18T05:00:00Z");
  assert.strictEqual(gapNote({ ts: t0 }, t0 + 5 * H), "", "a same-visit pause (<6h) gets no note");
  assert.match(gapNote({ ts: t0 }, t0 + 8 * H), /8 hours passed/, "an 8h gap is rendered in hours");
  assert.match(gapNote({ ts: t0 }, t0 + 15 * 24 * H), /15 days passed/, "a multi-day gap is rendered in days");
  assert.match(gapNote({ ts: t0 }, t0 + 15 * 24 * H), /fresh visit/, "the note tells the model to drop stale topics");
  assert.strictEqual(gapNote({ content: "no ts" }, t0), "", "no ts on the previous turn → no note");
  assert.strictEqual(gapNote(undefined, t0), "", "no previous turn at all → no note");
});

// --- PROMISED_HUMAN: the reply says a person will follow up. The relay only ever asserts this one
// through runChatAgent (which is not copied), so the regex gets its own cases here: it must fire on
// the claim and stay off a plain confirmation. ---
test("PROMISED_HUMAN", () => {
  assert.match("A team member will follow up with you shortly.", PROMISED_HUMAN);
  assert.match("Someone will get back to you today.", PROMISED_HUMAN);
  assert.match("ทีมงานจะติดต่อกลับนะคะ", PROMISED_HUMAN);
  assert.doesNotMatch("All set, you're booked for 3 PM.", PROMISED_HUMAN);
  assert.doesNotMatch("Our team builds AI front desks for appointment businesses.", PROMISED_HUMAN);
});
