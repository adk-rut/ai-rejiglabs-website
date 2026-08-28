// Thread poll (#737, spec #734): what the widget reads to restore a returning visitor's thread
// and to see a Takeover appear while the chat is open.
//   node --test test/thread.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { fakeFetch } from "./fake-fetch.mjs";
import { signToken } from "../lib/token.js";
import thread from "../api/thread.js";

process.env.SITE_CHAT_SIGNING_SECRET = "test-secret-not-a-real-one";
process.env.GHL_REJIG_API_KEY = "pit-test";

const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

const GHL = "https://services.leadconnectorhq.com";
const at = (iso) => Date.parse(iso);
const row = (id, direction, body, dateAdded, messageType = "TYPE_LIVE_CHAT") => ({ id, direction, body, dateAdded, messageType });

// Newest-first, as GHL returns them.
const ROWS = [
  row("m5", "outbound", "Rut: I'll take this one, give me ten minutes.", "2026-08-28T03:00:00.000Z"),
  row("m4", "inbound", "can I talk to a person?", "2026-08-28T02:00:00.000Z"),
  row("m3", "outbound", "Opportunity status changed", "2026-08-28T01:30:00.000Z", "TYPE_ACTIVITY_OPPORTUNITY"),
  row("m2", "outbound", "Setup starts from 50,000 baht.", "2026-08-28T01:00:00.000Z"),
  row("m1", "inbound", "what does it cost?", "2026-08-28T00:30:00.000Z"),
  row("ig1", "inbound", "hey on instagram", "2026-08-20T00:00:00.000Z", "TYPE_INSTAGRAM"),
];

const run = async ({ token, query = {}, rows = ROWS, method = "GET" } = {}) => {
  const fake = fakeFetch([[`GET ${GHL}/conversations/`, { json: { messages: { messages: rows } } }]]);
  const real = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  const r = res();
  try {
    await thread({ method, query, headers: token ? { authorization: `Bearer ${token}` } : {} }, r);
  } finally {
    globalThis.fetch = real;
  }
  return { r, fake };
};

const withConv = () => signToken({ contactId: "ct_1", conversationId: "cv_1" });

test("returns only the Live_Chat rows and Rut's, oldest first, with the prefix stripped and flagged", async () => {
  const { r, fake } = await run({ token: withConv() });

  assert.equal(r.code, 200);
  assert.deepEqual(r.body.messages, [
    { id: "m1", who: "visitor", text: "what does it cost?", ts: at("2026-08-28T00:30:00.000Z") },
    { id: "m2", who: "jasmin", text: "Setup starts from 50,000 baht.", ts: at("2026-08-28T01:00:00.000Z") },
    { id: "m4", who: "visitor", text: "can I talk to a person?", ts: at("2026-08-28T02:00:00.000Z") },
    { id: "m5", who: "rut", text: "I'll take this one, give me ten minutes.", ts: at("2026-08-28T03:00:00.000Z") },
  ], "no Instagram row, no CRM activity row, no 'Rut: ' prefix");

  assert.equal(fake.calls[0].url, `${GHL}/conversations/cv_1/messages?limit=100`);
  assert.equal(fake.calls[0].headers.Authorization, "Bearer pit-test");
});

test("the cursor is honoured: only what landed after it comes back, and the new cursor is the newest row", async () => {
  const { r } = await run({ token: withConv(), query: { since: String(at("2026-08-28T01:00:00.000Z")) } });
  assert.deepEqual(r.body.messages.map((m) => m.id), ["m4", "m5"]);
  assert.equal(r.body.cursor, at("2026-08-28T03:00:00.000Z"));

  const caught = await run({ token: withConv(), query: { since: String(at("2026-08-28T03:00:00.000Z")) } });
  assert.deepEqual(caught.r.body.messages, [], "nothing new");
  assert.equal(caught.r.body.cursor, at("2026-08-28T03:00:00.000Z"), "the cursor does not go backwards on an empty poll");
});

test("a token with no conversation yet is an empty thread, not a GHL call", async () => {
  const { r, fake } = await run({ token: signToken({ contactId: "ct_1" }) });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.messages, []);
  assert.equal(r.body.cursor, 0);
  assert.equal(fake.calls.length, 0);
});

test("no token is 401 and a non-GET is 405", async () => {
  const { r, fake } = await run({});
  assert.equal(r.code, 401);
  assert.equal(fake.calls.length, 0);

  const p = await run({ token: withConv(), method: "POST" });
  assert.equal(p.r.code, 405);
});
