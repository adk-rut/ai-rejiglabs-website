// Escalation pings + Standdown (#738, spec #734). Same seam as turn.test.mjs: the handler is
// driven the way Vercel drives it and every assertion is on what left the function — here, the
// Telegram sendMessage that did or did not happen.
//   node --test test/escalation.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { fakeFetch } from "./fake-fetch.mjs";
import { signToken } from "../lib/token.js";
import turn from "../api/turn.js";

process.env.SITE_CHAT_SIGNING_SECRET = "test-secret-not-a-real-one";
process.env.GHL_REJIG_API_KEY = "pit-test";
process.env.GHL_REJIG_LOCATION_ID = "loc-test";
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
const HOUR = 3600000;
const liveChat = (direction, body, msAgo = 5 * 60000) => ({
  id: `m_${Math.random().toString(36).slice(2)}`, direction, messageType: "TYPE_LIVE_CHAT", body, dateAdded: ago(msAgo),
});

const messagesRoute = (rows) => [`GET ${GHL}/conversations/`, { json: { messages: { messages: rows } } }];
const contactRoute = [`GET ${GHL}/contacts/`, { json: { contact: {
  id: "ct_1", contactName: "Ann Smith", email: "ann@example.com", phone: "+66811111111", source: "https://rejiglabs.com/pricing",
} } }];
const inboundRoute = [`POST ${GHL}/conversations/messages/inbound`, (call) => ({ status: 201, json: { conversationId: call.body.conversationId || "cv_new", messageId: "mi_1" } })];
const outboundRoute = [`POST ${GHL}/conversations/messages`, { status: 201, json: { messageId: "mo_1" } }];
const modelRoute = (content) => [/openrouter\.ai/, { json: { choices: [{ message: { content } }] } }];
const tgRoute = ["POST https://api.telegram.org", { json: { ok: true, result: { message_id: 7 } } }];

const run = async ({ routes, body = {} }) => {
  const fake = fakeFetch(routes);
  const real = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  const r = res();
  try {
    await turn({ method: "POST", body, headers: { authorization: `Bearer ${signToken({ contactId: "ct_1", conversationId: "cv_1" })}` } }, r);
  } finally {
    globalThis.fetch = real;
  }
  const tg = fake.calls.filter((c) => c.url.includes("api.telegram.org"));
  const outbound = fake.calls.filter((c) => c.method === "POST" && c.url.endsWith("/conversations/messages"));
  const model = fake.calls.filter((c) => c.url.includes("openrouter.ai"));
  return { r, fake, tg, outbound, model };
};

test("asked for a person: the reply is still posted AND one card with every field lands on Telegram", async () => {
  const rows = [
    liveChat("inbound", "what does it cost?", 9 * 60000),
    liveChat("outbound", "Setup starts at 50,000 baht.", 8 * 60000),
  ];
  const { r, tg, outbound } = await run({
    routes: [messagesRoute(rows), contactRoute, inboundRoute, outboundRoute, modelRoute("I've flagged this for Rut. He'll reply here, usually within a few hours."), tgRoute],
    body: { text: "Can I talk to a person?", lang: "en", pageUrl: "https://rejiglabs.com/ai-receptionist" },
  });

  assert.equal(outbound.length, 1, "the visitor is still answered");
  assert.equal(r.code, 200);
  assert.equal(tg.length, 1, "exactly one ping");

  assert.match(tg[0].url, /^https:\/\/api\.telegram\.org\/bottg-test-token\/sendMessage$/);
  assert.equal(tg[0].body.chat_id, "-100123");
  const card = tg[0].body.text;
  assert.match(card, /^🙋 asked for a person/, "reason line first");
  assert.match(card, /Ann Smith/);
  assert.match(card, /ann@example\.com/);
  assert.match(card, /\+66811111111/);
  assert.match(card, /https:\/\/rejiglabs\.com\/ai-receptionist/, "the page the visitor is on now");
  assert.match(card, /\ben\b/);
  assert.match(card, /last visitor message 9 min ago/);
  // last three turns, oldest first, the new line included
  assert.match(card, /what does it cost\?/);
  assert.match(card, /Setup starts at 50,000 baht\./);
  assert.match(card, /Can I talk to a person\?/);
  assert.match(card, /https:\/\/app\.gohighlevel\.com\/v2\/location\/loc-test\/conversations\/conversations\/cv_1/);
  assert.match(card, /\nref: cv_1$/, "ref footer last");
});

test("the model's cannot-answer marker sends the ❓ card and never reaches the visitor", async () => {
  const { r, tg, outbound } = await run({
    routes: [messagesRoute([]), contactRoute, inboundRoute, outboundRoute,
      modelRoute("[[NO_ANSWER]] I don't have that one. I've flagged it for Rut, or I can book you a Discovery call."), tgRoute],
    body: { text: "Do you integrate with Shopify POS?", lang: "en" },
  });

  assert.equal(tg.length, 1);
  assert.match(tg[0].body.text, /^❓ could not answer/);
  assert.match(tg[0].body.text, /\nref: cv_1$/);
  assert.equal(outbound[0].body.message.includes("NO_ANSWER"), false, "the marker is stripped before posting");
  assert.match(outbound[0].body.message, /Rut/);
  assert.equal(r.body.reply, outbound[0].body.message);
  // the page URL falls back to the contact's source when the widget sends none
  assert.match(tg[0].body.text, /https:\/\/rejiglabs\.com\/pricing/);
});

test("Standdown: a Rut reply 1 h old means no model call, no outbound, one short-form ping", async () => {
  const rows = [
    liveChat("inbound", "can I talk to Rut?", 2 * HOUR),
    liveChat("outbound", "Rut: I've got this one, give me a minute.", HOUR),
  ];
  const { r, tg, outbound, model, fake } = await run({
    routes: [messagesRoute(rows), contactRoute, inboundRoute, tgRoute],
    body: { text: "sure, can we talk Tuesday?", lang: "en" },
  });

  assert.equal(model.length, 0, "the model is not called while Rut is on the thread");
  assert.equal(outbound.length, 0, "the bot posts nothing");
  assert.equal(fake.calls.some((c) => c.url.includes("/messages/inbound")), true, "the visitor's line is still recorded");
  assert.equal(tg.length, 1);
  const card = tg[0].body.text;
  assert.match(card, /Ann Smith/);
  assert.match(card, /sure, can we talk Tuesday\?/);
  assert.match(card, /\nref: cv_1$/);
  assert.equal(card.includes("🙋"), false, "short form, not the full card");
  assert.equal(r.code, 200);
  assert.equal(r.body.reply, "");
  assert.equal(r.body.standdown, true);
});

test("Standdown is over at 5 h: the model answers, the reply is posted, nothing is pinged", async () => {
  const rows = [
    liveChat("inbound", "can I talk to Rut?", 6 * HOUR),
    liveChat("outbound", "Rut: I've got this one.", 5 * HOUR),
  ];
  const { r, tg, outbound, model } = await run({
    routes: [messagesRoute(rows), inboundRoute, outboundRoute, modelRoute("Setup starts at 50,000 baht.")],
    body: { text: "what does setup cost?", lang: "en" },
  });

  assert.equal(model.length, 1);
  assert.equal(outbound.length, 1);
  assert.equal(tg.length, 0, "resume is silent");
  assert.equal(r.body.reply, "Setup starts at 50,000 baht.");
  assert.equal(r.body.standdown, undefined);
});

test("a hot-lead line is answered with no ping", async () => {
  const { tg, outbound } = await run({
    routes: [messagesRoute([]), inboundRoute, outboundRoute, modelRoute("Six branches is exactly the shape this fits. The anchor is 30,000 baht a month."), tgRoute],
    body: { text: "we have 6 branches, would this work?", lang: "en" },
  });
  assert.equal(tg.length, 0, "hot-lead signals are not an Escalation");
  assert.equal(outbound.length, 1);
});

test("a Telegram failure never fails the turn", async () => {
  const { r, tg, outbound } = await run({
    routes: [messagesRoute([]), contactRoute, inboundRoute, outboundRoute, modelRoute("I've flagged this for Rut."),
      ["POST https://api.telegram.org", () => { throw new Error("telegram is down"); }]],
    body: { text: "can I speak to a human?", lang: "en" },
  });
  assert.equal(tg.length, 1, "we tried");
  assert.equal(outbound.length, 1, "and the visitor was still answered");
  assert.equal(r.code, 200);
  assert.match(r.body.reply, /Rut/);
});

test("with no Telegram env set nothing is sent and the turn still answers", async () => {
  const token = process.env.REJIG_SITECHAT_TELEGRAM_BOT_TOKEN;
  delete process.env.REJIG_SITECHAT_TELEGRAM_BOT_TOKEN;
  try {
    const { r, tg, outbound } = await run({
      routes: [messagesRoute([]), contactRoute, inboundRoute, outboundRoute, modelRoute("I've flagged this for Rut.")],
      body: { text: "can I speak to a human?", lang: "en" },
    });
    assert.equal(tg.length, 0);
    assert.equal(outbound.length, 1);
    assert.equal(r.code, 200);
  } finally {
    process.env.REJIG_SITECHAT_TELEGRAM_BOT_TOKEN = token;
  }
});
