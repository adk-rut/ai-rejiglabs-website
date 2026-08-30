// Instagram / Facebook DM webhook (#741, spec #734). Same seam as turn.test.mjs: the handler is
// driven the way Vercel drives it and every assertion is on what left the function.
//   node --test test/dm-webhook.test.mjs
//
// The DM channel differs from the widget in exactly three places, and all three are asserted here:
// the visitor's line is already in the thread (we never post it), Rut's Takeover is an outbound
// row with a `userId` rather than a `Rut: ` prefix, and the outbound goes back out as IG / FB.
import assert from "node:assert/strict";
import test from "node:test";
import { fakeFetch } from "./fake-fetch.mjs";
import dm from "../api/dm-webhook.js";

process.env.DM_WEBHOOK_SECRET = "dm-test-secret";
process.env.GHL_REJIG_API_KEY = "pit-test";
process.env.GHL_REJIG_LOCATION_ID = "loc-test";
process.env.GHL_REJIG_DISCOVERY_CAL = "cal-test";
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
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const row = (direction, body, messageType, msAgo = 5 * 60000, extra = {}) => ({
  id: `m_${Math.random().toString(36).slice(2)}`, direction, messageType, body, dateAdded: ago(msAgo), ...extra,
});

// Rows are written oldest-first here for readability; GHL hands them back newest-first.
const messagesRoute = (rows) => [`GET ${GHL}/conversations/`, { json: { messages: { messages: [...rows].reverse() } } }];
const contactRoute = [`GET ${GHL}/contacts/`, { json: { contact: { id: "ct_1", contactName: "Ann Smith", email: "ann@example.com", phone: "+66811111111" } } }];
const outboundRoute = [`POST ${GHL}/conversations/messages`, { status: 201, json: { messageId: "mo_1" } }];
const modelRoute = (content) => [/openrouter\.ai/, { json: { choices: [{ message: { content } }] } }];
const tgRoute = ["POST https://api.telegram.org", { json: { ok: true, result: { message_id: 7 } } }];

const run = async ({ routes, body, method = "POST", headers = { "x-webhook-secret": "dm-test-secret" } }) => {
  const fake = fakeFetch(routes);
  const real = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  const r = res();
  try {
    await dm({ method, body, headers }, r);
  } finally {
    globalThis.fetch = real;
  }
  const url = (c) => `${c.method} ${c.url}`;
  return {
    r, fake,
    urls: fake.calls.map(url),
    tg: fake.calls.filter((c) => c.url.includes("api.telegram.org")),
    model: fake.calls.filter((c) => c.url.includes("openrouter.ai")),
    outbound: fake.calls.filter((c) => c.method === "POST" && c.url.endsWith("/conversations/messages")),
  };
};

test("customData payload: the thread is fetched, the model answers, the reply goes out as IG", async () => {
  const rows = [
    row("inbound", "hi, do you do Instagram DMs?", "TYPE_INSTAGRAM", 9 * 60000),
    row("outbound", "We do. Jasmin answers them.", "TYPE_INSTAGRAM", 8 * 60000),
    row("inbound", "What does it cost?", "TYPE_INSTAGRAM", 60000),
  ];
  const { r, fake, model, outbound, urls } = await run({
    body: { customData: { contact_id: "ct_1", conversation_id: "cv_1", channel: "IG", lang: "en" } },
    routes: [messagesRoute(rows), outboundRoute, modelRoute("Setup starts at 50,000 baht.")],
  });

  assert.ok(urls.some((u) => u.startsWith(`GET ${GHL}/conversations/cv_1/messages`)), `thread must be fetched: ${urls.join(" | ")}`);
  assert.equal(fake.calls.filter((c) => c.url.includes("/messages/inbound")).length, 0, "the DM is already a row: we never post it again");
  assert.equal(model.length, 1);

  // The visitor's own last line is the question, and the rest of the thread is history — not the
  // question repeated back at the model as if they had said it twice.
  const sent = model[0].body.messages;
  assert.equal(sent.at(-1).content, "What does it cost?");
  assert.equal(sent.filter((m) => m.content === "What does it cost?").length, 1);

  assert.equal(outbound.length, 1);
  assert.equal(outbound[0].body.type, "IG");
  assert.equal(outbound[0].body.contactId, "ct_1");
  assert.equal(outbound[0].body.conversationId, "cv_1");
  assert.equal(outbound[0].body.message, "Setup starts at 50,000 baht.");
  assert.equal(r.code, 200);
});

test("no customData: GHL's native fields are used, and a Facebook thread answers as FB", async () => {
  const rows = [row("inbound", "can you handle Facebook too?", "TYPE_FACEBOOK", 60000)];
  const { r, model, outbound, urls } = await run({
    body: { contact_id: "ct_2", conversation: { id: "cv_2" }, message: { type: "FB", body: "can you handle Facebook too?" }, location: { id: "should-be-ignored" } },
    routes: [messagesRoute(rows), outboundRoute, modelRoute("Yes, the same brain answers Facebook.")],
  });

  assert.ok(urls.some((u) => u.startsWith(`GET ${GHL}/conversations/cv_2/messages`)));
  assert.equal(model.length, 1);
  assert.equal(outbound.length, 1);
  assert.equal(outbound[0].body.type, "FB");
  assert.equal(outbound[0].body.contactId, "ct_2");
  assert.equal(outbound[0].body.conversationId, "cv_2");
  assert.equal(r.code, 200);
});

test("Rut answered from the GHL app: a recent outbound with a userId is a Takeover — no model, no reply, one short ping naming the channel", async () => {
  const rows = [
    row("inbound", "is anyone there?", "TYPE_INSTAGRAM", 30 * 60000),
    row("outbound", "Yes, this is Rut.", "TYPE_INSTAGRAM", 20 * 60000, { userId: "user_rut" }),
    row("inbound", "great, what does it cost?", "TYPE_INSTAGRAM", 60000),
  ];
  const { r, model, outbound, tg } = await run({
    body: { customData: { contact_id: "ct_1", conversation_id: "cv_1", channel: "instagram" } },
    routes: [messagesRoute(rows), contactRoute, tgRoute, outboundRoute, modelRoute("should never be called")],
  });

  assert.equal(model.length, 0, "Rut owns the thread: no model call");
  assert.equal(outbound.length, 0, "and nothing posted over him");
  assert.equal(tg.length, 1);
  const card = tg[0].body.text;
  assert.match(card, /Ann Smith/);
  assert.match(card, /Instagram/, "the reason line carries the channel");
  assert.match(card, /great, what does it cost\?/);
  assert.match(card, /ref: cv_1/);
  assert.equal(r.code, 200);
  assert.equal(r.body.standdown, true);
});

test("an outbound with a userId older than four hours is not a Takeover: Jasmin answers again", async () => {
  const rows = [
    row("outbound", "Yes, this is Rut.", "TYPE_INSTAGRAM", 5 * 3600000, { userId: "user_rut" }),
    row("inbound", "still interested", "TYPE_INSTAGRAM", 60000),
  ];
  const { model, outbound } = await run({
    body: { customData: { contact_id: "ct_1", conversation_id: "cv_1", channel: "IG" } },
    routes: [messagesRoute(rows), outboundRoute, modelRoute("Happy to help.")],
  });
  assert.equal(model.length, 1);
  assert.equal(outbound.length, 1);
});

test("booking over a DM: the pick is booked through the same book path, with the channel on the note and the card", async () => {
  const slot = (() => { const d = new Date(Date.now() + 26 * 3600000); d.setUTCMinutes(0, 0, 0); return d.toISOString(); })();
  // Bangkok wall clock for the slot, so the hint the model returns matches a real free slot.
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(slot))
    .reduce((a, x) => ((a[x.type] = x.value), a), {});
  const hint = `${parts.weekday} ${parts.hour}:${parts.minute}`;

  const rows = [row("inbound", "can we book a call?", "TYPE_INSTAGRAM", 60000)];
  let modelCalls = 0;
  const { r, outbound, tg, fake } = await run({
    body: { customData: { contact_id: "ct_1", conversation_id: "cv_1", channel: "IG" } },
    routes: [
      messagesRoute(rows), contactRoute, tgRoute, outboundRoute,
      [`GET ${GHL}/calendars/`, { json: { "2026-09-01": { slots: [slot] } } }],
      [`POST ${GHL}/calendars/events/appointments`, { status: 201, json: { id: "ap_1" } }],
      [`POST ${GHL}/contacts/`, { status: 201, json: {} }],
      [/openrouter\.ai/, () => (++modelCalls === 1
        ? { json: { choices: [{ message: { content: `[[BOOKING: ${hint}]] Sure, let's get that booked.` } }] } }
        : { json: { choices: [{ message: { content: "Ann Smith runs a salon.\nAsked about price.\nQuoted the 50k anchor." } }] } }),]
    ],
  });

  const appt = fake.calls.find((c) => c.url.endsWith("/calendars/events/appointments"));
  assert.ok(appt, "the pick is booked on the Discovery calendar");
  assert.equal(appt.body.startTime, slot);
  assert.equal(appt.body.contactId, "ct_1");

  const note = fake.calls.find((c) => c.url.includes("/notes"));
  assert.ok(note, "the summary is written to the contact");
  assert.match(note.body.body, /Instagram/, "the channel is noted in the summary");

  const booked = tg.find((c) => /Discovery call booked/.test(c.body.text));
  assert.ok(booked, "Rut gets the 📅 card");
  assert.match(booked.body.text, /Instagram/);

  assert.equal(outbound.length, 1);
  assert.equal(outbound[0].body.type, "IG");
  assert.match(outbound[0].body.message, /Booked/);
  assert.equal(r.code, 200);
  assert.ok(r.body.booked?.appointmentId, "ap_1");
});

test("no conversation id in the payload: the contact's newest conversation is looked up and answered on (#741 follow-up)", async () => {
  const rows = [row("inbound", "hi from insta", "TYPE_INSTAGRAM")];
  const { r, urls, outbound } = await run({
    body: { customData: { contact_id: "ct_1", conversation_id: "", channel: "IG" } },
    routes: [
      [`GET ${GHL}/conversations/search`, { json: { conversations: [{ id: "cv_found" }] } }],
      messagesRoute(rows), contactRoute, tgRoute, outboundRoute, modelRoute("Hello from Jasmin."),
    ],
  });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.ok(urls.some((u) => u.includes("/conversations/search?") && u.includes("contactId=ct_1")), urls.join(" | "));
  assert.equal(outbound.length, 1);
  assert.equal(outbound[0].body.conversationId, "cv_found");
});

test("no shared secret, no turn: an unsigned caller cannot post as Jasmin or spend a model call", async () => {
  const { r, fake } = await run({
    headers: {},
    body: { customData: { contact_id: "ct_1", conversation_id: "cv_1", channel: "IG" } },
    routes: [], // any request at all would throw: fakeFetch has nothing routed
  });
  assert.equal(r.code, 401);
  assert.equal(fake.calls.length, 0);

  const wrong = await run({
    headers: { "x-webhook-secret": "not-the-secret" },
    body: { customData: { contact_id: "ct_1", conversation_id: "cv_1", channel: "IG" } },
    routes: [],
  });
  assert.equal(wrong.r.code, 401);
  assert.equal(wrong.fake.calls.length, 0);
});
