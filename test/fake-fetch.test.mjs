// Self-check for the fake fetch every later handler test routes through (#735).
//   node --test test/fake-fetch.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { fakeFetch } from "./fake-fetch.mjs";

test("answers by URL and records the request", async () => {
  const fake = fakeFetch([["https://api.example.com/v1/contacts", { json: { id: "c1" } }]]);
  const res = await fake.fetch("https://api.example.com/v1/contacts", {
    method: "POST", headers: { Authorization: "Bearer x" }, body: JSON.stringify({ email: "a@b.co" }),
  });
  assert.equal(res.ok, true);
  assert.deepEqual(await res.json(), { id: "c1" });
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].method, "POST");
  assert.deepEqual(fake.calls[0].body, { email: "a@b.co" }, "a JSON body is recorded parsed");
  assert.equal(fake.calls[0].headers.Authorization, "Bearer x");
});

test("the method is part of the key", async () => {
  const fake = fakeFetch([
    ["POST https://api.example.com/msg", { json: { sent: true } }],
    ["GET https://api.example.com/msg", { json: { messages: [] } }],
  ]);
  assert.deepEqual(await (await fake.fetch("https://api.example.com/msg")).json(), { messages: [] });
  assert.deepEqual(await (await fake.fetch("https://api.example.com/msg", { method: "POST" })).json(), { sent: true });
});

test("first matching route wins, and a route can vary by request", async () => {
  const fake = fakeFetch([
    [/\/contacts\/lookup/, { json: { contacts: [] } }],
    [/\/contacts/, (call) => ({ json: { echoed: call.body.name } })],
  ]);
  assert.deepEqual(await (await fake.fetch("https://x.test/contacts/lookup")).json(), { contacts: [] });
  const res = await fake.fetch("https://x.test/contacts", { method: "POST", body: JSON.stringify({ name: "Rut" }) });
  assert.deepEqual(await res.json(), { echoed: "Rut" });
});

test("a non-2xx route reports ok:false and its status", async () => {
  const fake = fakeFetch([[/x\.test/, { status: 429, text: "slow down", headers: { "retry-after": "3" } }]]);
  const res = await fake.fetch("https://x.test/anything");
  assert.equal(res.ok, false);
  assert.equal(res.status, 429);
  assert.equal(await res.text(), "slow down");
  assert.equal(res.headers.get("Retry-After"), "3");
});

test("an unrouted request throws rather than passing silently", async () => {
  const fake = fakeFetch([[/routed\.test/, { json: {} }]]);
  await assert.rejects(() => fake.fetch("https://elsewhere.test/oops"), /no route for GET https:\/\/elsewhere\.test\/oops/);
});
