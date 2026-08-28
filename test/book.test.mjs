// Book endpoint (#740, spec #734): the ONE booking path — chat, page CTA and DM all land here.
// The order is the contract: contact first (upsert only when there is no session), then the
// appointment, then tags, then the note, then Rut's 📅 ping. Everything after the appointment is
// bookkeeping; nothing before it is skippable.
//   node --test test/book.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { fakeFetch } from "./fake-fetch.mjs";
import { signToken } from "../lib/token.js";
import book from "../api/book.js";

process.env.SITE_CHAT_SIGNING_SECRET = "test-secret-not-a-real-one";
process.env.GHL_REJIG_API_KEY = "pit-test";
process.env.GHL_REJIG_LOCATION_ID = "loc-test";
process.env.GHL_REJIG_DISCOVERY_CAL = "cal-discovery";
process.env.OPENROUTER_API_KEY = "or-test";
process.env.REJIG_SITECHAT_TELEGRAM_BOT_TOKEN = "tg-test-token";
process.env.REJIG_SITECHAT_TELEGRAM_CHAT_ID = "-100123";
delete process.env.HELICONE_API_KEY;

const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

const GHL = "https://services.leadconnectorhq.com";
const SLOT = "2026-09-01T14:00:00+07:00";
const SUMMARY = "Ann Smith, three salons in Phuket.\nAsked what it costs and whether it does LINE.\nQuoted 30,000 a month, setup from 50,000. Call Tue 1 Sep, 14:00.";

const upsertRoute = [`POST ${GHL}/contacts/upsert`, { json: { contact: { id: "ct_new" } } }];
const contactRoute = [`GET ${GHL}/contacts/`, { json: { contact: { id: "ct_1", contactName: "Ann Smith", email: "ann@example.com", phone: "+66811111111" } } }];
const apptRoute = (spec = { status: 201, json: { id: "appt_1" } }) => [`POST ${GHL}/calendars/events/appointments`, spec];
const tagsRoute = [/\/contacts\/[^/]+\/tags/, { json: { tags: [] } }];
const notesRoute = [/\/contacts\/[^/]+\/notes/, { json: { note: { id: "note_1" } } }];
const liveChat = (direction, body) => ({ id: `m_${Math.random().toString(36).slice(2)}`, direction, messageType: "TYPE_LIVE_CHAT", body, dateAdded: "2026-08-20T01:00:00.000Z" });
// A real thread: with no transcript there is nothing for the model to summarise and the fallback
// lines are the whole truth (asserted at the bottom of this file).
const messagesRoute = [`GET ${GHL}/conversations/`, { json: { messages: { messages: [
  liveChat("outbound", "Setup starts at 50,000 baht."),
  liveChat("inbound", "What does it cost?"),
] } } }];
const modelRoute = [/openrouter\.ai/, { json: { choices: [{ message: { content: SUMMARY } }] } }];
const tgRoute = ["POST https://api.telegram.org", { json: { ok: true, result: { message_id: 7 } } }];

const defaults = (appt) => [upsertRoute, apptRoute(appt), tagsRoute, notesRoute, contactRoute, messagesRoute, modelRoute, tgRoute];

const run = async ({ token, body = {}, routes = defaults(), method = "POST" } = {}) => {
  const fake = fakeFetch(routes);
  const real = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  const r = res();
  try {
    await book({ method, body, headers: token ? { authorization: `Bearer ${token}` } : {} }, r);
  } finally {
    globalThis.fetch = real;
  }
  return { r, fake };
};

// The write calls, in the order they left the function — reads (the contact, the thread, the model)
// are not part of the contract, only the writes are.
const writes = (fake) => fake.calls
  .filter((c) => c.method === "POST" && !/openrouter/.test(c.url))
  .map((c) => c.url.replace(GHL, "").replace(/^https:\/\/api\.telegram\.org.*/, "telegram"));

test("with a session token there is no upsert: appointment, tags, note, ping, in that order", async () => {
  const token = signToken({ contactId: "ct_1", conversationId: "cv_1" });
  const { r, fake } = await run({ token, body: { slot: SLOT, lang: "en" } });

  assert.equal(r.code, 200);
  assert.deepEqual(writes(fake), [
    "/calendars/events/appointments",
    "/contacts/ct_1/tags",
    "/contacts/ct_1/notes",
    "telegram",
  ]);

  const appt = fake.calls.find((c) => c.url.endsWith("/appointments"));
  assert.equal(appt.body.calendarId, "cal-discovery");
  assert.equal(appt.body.contactId, "ct_1");
  assert.equal(appt.body.startTime, SLOT);
  assert.equal(appt.body.appointmentStatus, "confirmed");
});

test("the note and the ping carry the same summary", async () => {
  const token = signToken({ contactId: "ct_1", conversationId: "cv_1" });
  const { fake } = await run({ token, body: { slot: SLOT, lang: "en" } });

  const note = fake.calls.find((c) => /\/notes$/.test(c.url));
  const ping = fake.calls.find((c) => /telegram/.test(c.url));
  assert.ok(note.body.body.includes(SUMMARY), note.body.body);
  assert.ok(ping.body.text.includes(SUMMARY), ping.body.text);
  assert.ok(ping.body.text.startsWith("📅"), ping.body.text);
});

test("the tags say a Discovery call is booked and in which language", async () => {
  const token = signToken({ contactId: "ct_1", conversationId: "cv_1" });
  const { fake } = await run({ token, body: { slot: SLOT, lang: "th" } });
  const tags = fake.calls.find((c) => /\/tags$/.test(c.url));
  assert.deepEqual(tags.body.tags, ["discovery-booked", "lang-th"]);
});

test("without a token the contact is upserted first, then the same sequence", async () => {
  const { r, fake } = await run({ body: { slot: SLOT, name: "Ann Smith", email: "ann@example.com", phone: "+66811111111", pageUrl: "https://rejiglabs.com/pricing" } });

  assert.equal(r.code, 200);
  assert.deepEqual(writes(fake), [
    "/contacts/upsert",
    "/calendars/events/appointments",
    "/contacts/ct_new/tags",
    "/contacts/ct_new/notes",
    "telegram",
  ]);
  const upsert = fake.calls[0];
  assert.equal(upsert.body.email, "ann@example.com");
  assert.equal(upsert.body.source, "https://rejiglabs.com/pricing");
});

test("without a token and without details it is a 400, and nothing is written", async () => {
  const { r, fake } = await run({ body: { slot: SLOT, name: "Ann Smith" } });
  assert.equal(r.code, 400);
  assert.deepEqual(fake.calls, []);
});

test("a slot that is not a time is a 400", async () => {
  const token = signToken({ contactId: "ct_1" });
  const { r, fake } = await run({ token, body: { slot: "next tuesday-ish" } });
  assert.equal(r.code, 400);
  assert.deepEqual(fake.calls, []);
});

test("an appointment GHL refused is a 5xx, and no tags, note or ping follow", async () => {
  const token = signToken({ contactId: "ct_1", conversationId: "cv_1" });
  const { r, fake } = await run({ token, body: { slot: SLOT }, routes: defaults({ status: 422, json: { message: "slot no longer available" } }) });

  assert.equal(r.code, 502);
  assert.deepEqual(writes(fake), ["/calendars/events/appointments"]);
});

test("the booked time comes back for the widget's Booked state", async () => {
  const token = signToken({ contactId: "ct_1", conversationId: "cv_1" });
  const { r } = await run({ token, body: { slot: SLOT, lang: "en" } });
  assert.equal(r.body.startTime, SLOT);
  assert.equal(r.body.appointmentId, "appt_1");
  assert.match(r.body.when, /14:00/);
});

test("with no thread behind it — a CTA booking — the summary is the contact and the time, never invented", async () => {
  const { fake } = await run({ body: { slot: SLOT, name: "Ann Smith", email: "ann@example.com", phone: "+66811111111" },
    routes: [upsertRoute, apptRoute(), tagsRoute, notesRoute, contactRoute, [`GET ${GHL}/conversations/`, { json: { messages: { messages: [] } } }], tgRoute] });

  const note = fake.calls.find((c) => /\/notes$/.test(c.url));
  assert.ok(note.body.body.includes("Ann Smith"), note.body.body);
  assert.ok(note.body.body.includes("Tue 1 Sept, 14:00"), note.body.body);
  assert.equal(fake.calls.filter((c) => /openrouter/.test(c.url)).length, 0, "no model call with nothing to summarise");
});
