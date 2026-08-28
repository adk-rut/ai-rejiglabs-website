// Conversational booking (#740, spec #734): a typed "can we talk Tuesday afternoon" is answered
// with the calendar's real open times, and the visitor's pick books the call through the same
// path api/book.js uses. The model never sees the calendar and never invents a time — it only
// says THAT the visitor wants to book, and roughly when.
//   node --test test/booking-turn.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { fakeFetch } from "./fake-fetch.mjs";
import { signToken } from "../lib/token.js";
import { matchSlots } from "../lib/booking.js";
import turn from "../api/turn.js";

process.env.SITE_CHAT_SIGNING_SECRET = "test-secret-not-a-real-one";
process.env.GHL_REJIG_API_KEY = "pit-test";
process.env.GHL_REJIG_LOCATION_ID = "loc-test";
process.env.GHL_REJIG_DISCOVERY_CAL = "cal-discovery";
process.env.OPENROUTER_API_KEY = "or-test";
delete process.env.REJIG_SITECHAT_TELEGRAM_BOT_TOKEN;
delete process.env.REJIG_SITECHAT_TELEGRAM_CHAT_ID;
delete process.env.HELICONE_API_KEY;

const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

const GHL = "https://services.leadconnectorhq.com";
// Tuesday 1 September 2026 and the Wednesday after it, in Bangkok time.
const TUE = "2026-09-01", WED = "2026-09-02";
const at = (day, hhmm) => `${day}T${hhmm}:00+07:00`;
const CALENDAR = {
  [TUE]: { slots: [at(TUE, "12:00"), at(TUE, "14:00"), at(TUE, "14:30"), at(TUE, "19:00")] },
  [WED]: { slots: [at(WED, "13:00")] },
  traceId: "tr_1",
};

const liveChat = (direction, body) => ({ id: `m_${Math.random().toString(36).slice(2)}`, direction, messageType: "TYPE_LIVE_CHAT", body, dateAdded: "2026-08-20T01:00:00.000Z" });
const messagesRoute = [`GET ${GHL}/conversations/`, { json: { messages: { messages: [liveChat("inbound", "hi")] } } }];
const contactRoute = [`GET ${GHL}/contacts/`, { json: { contact: { id: "ct_1", contactName: "Ann Smith", email: "ann@example.com" } } }];
const inboundRoute = [`POST ${GHL}/conversations/messages/inbound`, (call) => ({ status: 201, json: { conversationId: call.body.conversationId || "cv_new" } })];
const outboundRoute = [`POST ${GHL}/conversations/messages`, { status: 201, json: { messageId: "mo_1" } }];
const modelRoute = (content) => [/openrouter\.ai/, { json: { choices: [{ message: { content } }] } }];
const slotsRoute = (json = CALENDAR) => [/\/free-slots/, { json }];
const apptRoute = (spec = { status: 201, json: { id: "appt_1" } }) => [`POST ${GHL}/calendars/events/appointments`, spec];
const tagsRoute = [/\/contacts\/[^/]+\/tags/, { json: {} }];
const notesRoute = [/\/contacts\/[^/]+\/notes/, { json: {} }];

const routes = (reply, extra = []) => [
  messagesRoute, contactRoute, inboundRoute, outboundRoute, slotsRoute(), modelRoute(reply), ...extra,
];

const run = async ({ body, routes: rs }) => {
  const fake = fakeFetch(rs);
  const real = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  const r = res();
  try {
    await turn({ method: "POST", body, headers: { authorization: `Bearer ${signToken({ contactId: "ct_1", conversationId: "cv_1" })}` } }, r);
  } finally {
    globalThis.fetch = real;
  }
  return { r, fake };
};

const NOW = Date.parse(at(TUE, "09:00")); // the Tuesday morning, before every slot in the fixture

test("matchSlots offers a whole afternoon, and never calls that a pick", () => {
  const all = [...CALENDAR[TUE].slots, ...CALENDAR[WED].slots];
  const { matches, exact } = matchSlots("Tuesday afternoon", all, NOW);
  assert.deepEqual(matches, [at(TUE, "12:00"), at(TUE, "14:00"), at(TUE, "14:30")]);
  assert.equal(exact, false, "an afternoon is a range, not a booking");
});

test("matchSlots turns a day plus a clock time into the one slot to book", () => {
  const all = [...CALENDAR[TUE].slots, ...CALENDAR[WED].slots];
  const { matches, exact } = matchSlots("Tuesday 2pm", all, NOW);
  assert.deepEqual(matches, [at(TUE, "14:00")]);
  assert.equal(exact, true);
});

test("matchSlots does not book on a time alone: no day, no pick", () => {
  const all = [...CALENDAR[TUE].slots, ...CALENDAR[WED].slots];
  const { exact } = matchSlots("2pm", all, NOW);
  assert.equal(exact, false);
});

test("matchSlots understands พรุ่งนี้บ่าย against Bangkok dates", () => {
  const all = [...CALENDAR[TUE].slots, ...CALENDAR[WED].slots];
  const { matches } = matchSlots("พรุ่งนี้บ่าย", all, NOW);
  assert.deepEqual(matches, [at(WED, "13:00")]);
});

test("a typed booking request fetches the calendar and offers the matching times", async () => {
  const { r, fake } = await run({
    body: { text: "Can we talk Tuesday afternoon?", lang: "en" },
    routes: routes("[[BOOKING: Tuesday afternoon]] Happy to set that up."),
  });

  assert.ok(fake.calls.some((c) => /free-slots/.test(c.url)), "the calendar was read");
  assert.ok(!fake.calls.some((c) => /events\/appointments/.test(c.url)), "nothing is booked on an offer");
  assert.ok(!/BOOKING/.test(r.body.reply), r.body.reply);
  assert.match(r.body.reply, /14:00/);
  assert.match(r.body.reply, /14:30/);
  assert.ok(!/19:00/.test(r.body.reply), "an afternoon is not the evening");

  // The visitor sees exactly what GHL recorded.
  const outbound = fake.calls.find((c) => c.method === "POST" && /\/conversations\/messages$/.test(c.url));
  assert.equal(outbound.body.message, r.body.reply);
});

test("the pick books that slot and confirms it", async () => {
  const { r, fake } = await run({
    body: { text: "Tuesday at 2pm please", lang: "en" },
    routes: routes("[[BOOKING: Tuesday 14:00]] Booking that now.", [apptRoute(), tagsRoute, notesRoute]),
  });

  const appt = fake.calls.find((c) => /events\/appointments/.test(c.url));
  assert.equal(appt.body.startTime, at(TUE, "14:00"));
  assert.equal(appt.body.calendarId, "cal-discovery");
  assert.equal(appt.body.contactId, "ct_1");
  assert.equal(r.body.booked.startTime, at(TUE, "14:00"));
  assert.match(r.body.reply, /14:00/);
});

test("a day with nothing open still gets the next real times, never an apology alone", async () => {
  const { r, fake } = await run({
    body: { text: "Sunday morning?", lang: "en" },
    routes: routes("[[BOOKING: Sunday morning]] Let me look."),
  });
  assert.ok(!fake.calls.some((c) => /events\/appointments/.test(c.url)));
  assert.match(r.body.reply, /12:00/);
});

test("a calendar we cannot read costs the visitor the times, never the answer", async () => {
  const { r } = await run({
    body: { text: "Tuesday afternoon?", lang: "en" },
    routes: routes("[[BOOKING: Tuesday afternoon]] Happy to set that up.", []).map((route) =>
      /free-slots/.test(String(route[0])) ? [/\/free-slots/, { status: 500, json: {} }] : route),
  });
  assert.equal(r.code, 200);
  assert.match(r.body.reply, /Happy to set that up/);
});

test("an ordinary question never reads the calendar", async () => {
  const { fake } = await run({
    body: { text: "What does it cost?", lang: "en" },
    routes: routes("Setup starts at 50,000 baht."),
  });
  assert.ok(!fake.calls.some((c) => /free-slots/.test(c.url)));
});
