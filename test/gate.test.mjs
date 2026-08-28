// Lead gate handler (#736): name + email + phone -> a GHL contact on the Rejig sub-account and a
// signed session token. Driven the way Vercel drives it: request in, response out, with `fetch`
// faked so the assertions are on the GHL request that left the function.
//   node --test test/gate.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { fakeFetch } from "./fake-fetch.mjs";
import { verifyToken } from "../lib/token.js";
import gate from "../api/gate.js";

process.env.SITE_CHAT_SIGNING_SECRET = "test-secret-not-a-real-one";
process.env.GHL_REJIG_API_KEY = "pit-test";
process.env.GHL_REJIG_LOCATION_ID = "loc-test";

const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};
const upsertOk = ["POST https://services.leadconnectorhq.com/contacts/upsert", { json: { contact: { id: "ct_123" } } }];

const run = async (body, routes = [upsertOk]) => {
  const fake = fakeFetch(routes);
  const real = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  const r = res();
  try {
    await gate({ method: "POST", body, headers: {} }, r);
  } finally {
    globalThis.fetch = real;
  }
  return { r, fake };
};

test("upserts the contact with both tags and the page URL, and returns a token the verifier accepts", async () => {
  const { r, fake } = await run({
    name: "Site Chat Test", email: "a@b.co", phone: "+66812345678",
    lang: "en", pageUrl: "https://rejiglabs.com/ai-chatbot/",
  });

  assert.equal(fake.calls.length, 1);
  const [call] = fake.calls;
  assert.equal(call.method, "POST");
  assert.equal(call.url, "https://services.leadconnectorhq.com/contacts/upsert");
  assert.equal(call.headers.Authorization, "Bearer pit-test");
  assert.equal(call.headers.Version, "2021-07-28");
  assert.equal(call.body.locationId, "loc-test");
  assert.equal(call.body.name, "Site Chat Test");
  assert.equal(call.body.email, "a@b.co");
  assert.equal(call.body.phone, "+66812345678", "phone is stored exactly as the widget sent it");
  assert.deepEqual(call.body.tags, ["site-chat", "lang-en"]);
  assert.equal(call.body.source, "https://rejiglabs.com/ai-chatbot/");

  assert.equal(r.code, 200);
  assert.deepEqual(verifyToken(r.body.token), { contactId: "ct_123" });
});

test("a Thai visitor gets the lang-th tag", async () => {
  const { fake } = await run({ name: "N", email: "a@b.co", phone: "+66812345678", lang: "th" });
  assert.deepEqual(fake.calls[0].body.tags, ["site-chat", "lang-th"]);
});

test("any missing field is 400 and makes no GHL call", async () => {
  const full = { name: "N", email: "a@b.co", phone: "+66812345678" };
  for (const field of ["name", "email", "phone"]) {
    const { r, fake } = await run({ ...full, [field]: "  " });
    assert.equal(r.code, 400, `blank ${field} must be 400`);
    assert.equal(fake.calls.length, 0, `blank ${field} must not reach GHL`);
  }
  const { r, fake } = await run({});
  assert.equal(r.code, 400);
  assert.equal(fake.calls.length, 0);
});

test("a GHL failure is 502, not a token", async () => {
  const { r } = await run(
    { name: "N", email: "a@b.co", phone: "+66812345678" },
    [["POST https://services.leadconnectorhq.com/contacts/upsert", { status: 422, text: "nope" }]],
  );
  assert.equal(r.code, 502);
  assert.equal(r.body.token, undefined);
});

test("only POST is allowed", async () => {
  const r = res();
  await gate({ method: "GET", headers: {} }, r);
  assert.equal(r.code, 405);
});
