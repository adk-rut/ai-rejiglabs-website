// Takeover from Telegram (#739, spec #734). Same seam as the other handler tests: the function is
// driven the way Vercel drives it, and every assertion is on what left it — the GHL outbound post
// and the Telegram sendMessage that did or did not happen.
//   node --test test/telegram-webhook.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { fakeFetch } from "./fake-fetch.mjs";
import webhook from "../api/telegram-webhook.js";

process.env.GHL_REJIG_API_KEY = "pit-test";
process.env.REJIG_SITECHAT_TELEGRAM_BOT_TOKEN = "tg-test-token";
process.env.REJIG_SITECHAT_TELEGRAM_CHAT_ID = "-100123";

const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

const GHL = "https://services.leadconnectorhq.com";
const outboundRoute = [`POST ${GHL}/conversations/messages`, { status: 201, json: { messageId: "mo_1" } }];
const tgRoute = ["POST https://api.telegram.org", { json: { ok: true, result: { message_id: 7 } } }];

const CARD = [
  "🙋 asked for a person",
  "Ann Smith · ann@example.com · +66811111111 · https://rejiglabs.com/pricing · en · last visitor message 4 min ago",
  "",
  "visitor: can I talk to a person?",
  "",
  "https://app.gohighlevel.com/v2/location/loc-test/conversations/conversations/cv_1",
  "ref: cv_1",
].join("\n");

const update = ({ chatId = "-100123", text = "on my way, 2pm works", reply = CARD } = {}) => ({
  update_id: 1,
  message: {
    message_id: 22,
    chat: { id: chatId, type: "private" },
    text,
    ...(reply === null ? {} : { reply_to_message: { message_id: 7, text: reply } }),
  },
});

const run = async ({ routes = [outboundRoute, tgRoute], body }) => {
  const fake = fakeFetch(routes);
  const real = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  const r = res();
  try {
    await webhook({ method: "POST", body }, r);
  } finally {
    globalThis.fetch = real;
  }
  const tg = fake.calls.filter((c) => c.url.includes("api.telegram.org"));
  const outbound = fake.calls.filter((c) => c.method === "POST" && c.url.endsWith("/conversations/messages"));
  return { r, fake, tg, outbound };
};

test("reply to a card: one Rut: outbound on the ref: conversation, 200, nothing sent back", async () => {
  const { r, tg, outbound } = await run({ body: update() });
  assert.equal(r.code, 200);
  assert.equal(outbound.length, 1);
  assert.deepEqual(
    { type: outbound[0].body.type, conversationId: outbound[0].body.conversationId, message: outbound[0].body.message },
    { type: "Live_Chat", conversationId: "cv_1", message: "Rut: on my way, 2pm works" },
  );
  assert.equal(tg.length, 0);
});

test("not a reply: the guidance line goes back, no GHL call", async () => {
  const { r, tg, outbound } = await run({ body: update({ reply: null }) });
  assert.equal(r.code, 200);
  assert.equal(outbound.length, 0);
  assert.equal(tg.length, 1);
  assert.match(tg[0].body.text, /reply to a ping to send it/);
});

test("reply to something without a ref: footer is treated as not a reply", async () => {
  const { tg, outbound } = await run({ body: update({ reply: "just a note I typed myself" }) });
  assert.equal(outbound.length, 0);
  assert.equal(tg.length, 1);
  assert.match(tg[0].body.text, /reply to a ping to send it/);
});

test("GHL refuses the post: the error is echoed back to Rut, still 200", async () => {
  const { r, tg, outbound } = await run({
    routes: [[`POST ${GHL}/conversations/messages`, { status: 422, json: { message: "bad conversation" } }], tgRoute],
    body: update(),
  });
  assert.equal(r.code, 200);
  assert.equal(outbound.length, 1);
  assert.equal(tg.length, 1);
  assert.match(tg[0].body.text, /could not send/i);
  assert.match(tg[0].body.text, /422/);
});

test("another chat id: ignored, 200, no calls at all", async () => {
  const { r, fake } = await run({ routes: [], body: update({ chatId: "-100999" }) });
  assert.equal(r.code, 200);
  assert.equal(fake.calls.length, 0);
});
