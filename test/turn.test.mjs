// Turn handler (#737, spec #734): a visitor message becomes an inbound Live_Chat row, the model
// answers from the knowledge file, and the reply goes back out on the same conversation.
// Driven the way Vercel drives it — request in, response out — with `fetch` faked, so every
// assertion is on what actually left the function.
//   node --test test/turn.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { fakeFetch } from "./fake-fetch.mjs";
import { signToken, verifyToken } from "../lib/token.js";
import turn from "../api/turn.js";

process.env.SITE_CHAT_SIGNING_SECRET = "test-secret-not-a-real-one";
process.env.GHL_REJIG_API_KEY = "pit-test";
process.env.GHL_REJIG_LOCATION_ID = "loc-test";
process.env.OPENROUTER_API_KEY = "or-test";
delete process.env.HELICONE_API_KEY; // tracing off: a Helicone call is not part of any assertion here

const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

const GHL = "https://services.leadconnectorhq.com";
// Fixed and long past on purpose: a `Rut:` row less than four hours old is a Standdown (#738) and
// would silence every turn this file drives.
const liveChat = (direction, body, extra = {}) => ({ id: `m_${Math.random().toString(36).slice(2)}`, direction, messageType: "TYPE_LIVE_CHAT", body, dateAdded: "2026-08-20T01:00:00.000Z", ...extra });

const messagesRoute = (rows) => [`GET ${GHL}/conversations/`, { json: { messages: { messages: rows } } }];
// GHL answers with the conversation the message landed on: the existing one, or the one it just
// opened when the contact had none.
const inboundRoute = ["POST " + GHL + "/conversations/messages/inbound", (call) => ({ status: 201, json: { conversationId: call.body.conversationId || "cv_new", messageId: "mi_1" } })];
const outboundRoute = ["POST " + GHL + "/conversations/messages", { status: 201, json: { conversationId: "cv_new", messageId: "mo_1" } }];
const modelRoute = (content) => [/openrouter\.ai/, { json: { choices: [{ message: { content } }] } }];

// Routes are tried in order and the first match wins, so the more specific /inbound goes first.
const defaults = (rows = [], reply = "Setup starts at 50,000 baht.") => [
  messagesRoute(rows), inboundRoute, outboundRoute, modelRoute(reply),
];

const run = async ({ token, body = {}, routes = defaults(), method = "POST" } = {}) => {
  const fake = fakeFetch(routes);
  const real = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  const r = res();
  try {
    await turn({ method, body, headers: token ? { authorization: `Bearer ${token}` } : {} }, r);
  } finally {
    globalThis.fetch = real;
  }
  return { r, fake };
};

const withConv = () => signToken({ contactId: "ct_1", conversationId: "cv_1" });

test("inbound is posted before the model call and outbound after, both on the token's conversation", async () => {
  const { r, fake } = await run({ token: withConv(), body: { text: "What does it cost?", lang: "en" } });

  const urls = fake.calls.map((c) => `${c.method} ${c.url}`);
  const iIn = urls.findIndex((u) => u.includes("/messages/inbound"));
  const iModel = urls.findIndex((u) => u.includes("openrouter.ai"));
  const iOut = urls.findIndex((u) => u.endsWith("/conversations/messages"));
  assert.ok(iIn >= 0 && iModel >= 0 && iOut >= 0, `all three calls must happen: ${urls.join(" | ")}`);
  assert.ok(iIn < iModel, "inbound must be posted before the model is asked");
  assert.ok(iModel < iOut, "outbound must be posted after the model answered");

  const inbound = fake.calls[iIn];
  assert.equal(inbound.body.type, "Live_Chat");
  assert.equal(inbound.body.direction, "inbound");
  assert.equal(inbound.body.contactId, "ct_1");
  assert.equal(inbound.body.conversationId, "cv_1");
  assert.equal(inbound.body.message, "What does it cost?");
  assert.equal(inbound.body.conversationProviderId, undefined, "native Live_Chat takes no provider id (#732)");
  assert.equal(inbound.headers.Authorization, "Bearer pit-test");

  const outbound = fake.calls[iOut];
  assert.equal(outbound.body.type, "Live_Chat");
  assert.equal(outbound.body.conversationId, "cv_1");
  assert.equal(outbound.body.contactId, "ct_1");
  assert.equal(outbound.body.message, "Setup starts at 50,000 baht.");

  assert.equal(r.code, 200);
  assert.equal(r.body.reply, "Setup starts at 50,000 baht.");
});

test("the first message opens the thread: inbound with contactId only, and the reply carries a re-minted token holding the conversationId", async () => {
  const { r, fake } = await run({
    token: signToken({ contactId: "ct_1" }),
    body: { text: "hello", lang: "en" },
    routes: [inboundRoute, outboundRoute, modelRoute("Hi, I'm Beem.")],
  });

  const inbound = fake.calls.find((c) => c.url.includes("/messages/inbound"));
  assert.equal(inbound.body.contactId, "ct_1");
  assert.equal(inbound.body.conversationId, undefined, "there is no conversation yet to name");
  assert.equal(fake.calls.some((c) => c.method === "GET"), false, "nothing to read back before the first message");

  const outbound = fake.calls.find((c) => c.method === "POST" && c.url.endsWith("/conversations/messages"));
  assert.equal(outbound.body.conversationId, "cv_new", "the conversation GHL just opened");

  assert.equal(r.code, 200);
  assert.deepEqual(verifyToken(r.body.token), { contactId: "ct_1", conversationId: "cv_new" });
});

test("an empty first reply falls back to glm-4.6, and the fallback's reply is what gets posted", async () => {
  let n = 0;
  const { r, fake } = await run({
    token: withConv(),
    body: { text: "hi", lang: "en" },
    routes: [
      messagesRoute([]), inboundRoute, outboundRoute,
      [/openrouter\.ai/, () => (++n === 1
        ? { json: { choices: [{ message: { content: "" } }] } }
        : { json: { choices: [{ message: { content: "Second model answered." } }] } })],
    ],
  });

  const model = fake.calls.filter((c) => c.url.includes("openrouter.ai"));
  assert.equal(model.length, 2);
  assert.equal(model[0].body.model, "z-ai/glm-4.7");
  assert.deepEqual(model[0].body.provider, { order: ["Google", "Z.AI"] });
  assert.equal(model[1].body.model, "z-ai/glm-4.6");
  // Thinking off on BOTH calls (#746): the hidden reasoning was the latency, and a fallback that
  // thinks is a fallback that times out.
  assert.deepEqual(model[0].body.reasoning, { enabled: false });
  assert.deepEqual(model[1].body.reasoning, { enabled: false });

  const outbound = fake.calls.find((c) => c.method === "POST" && c.url.endsWith("/conversations/messages"));
  assert.equal(outbound.body.message, "Second model answered.");
  assert.equal(r.body.reply, "Second model answered.");
});

test("the response says which provider and model answered, and names both when the first came back empty (#746)", async () => {
  const one = await run({
    token: withConv(), body: { text: "hi", lang: "en" },
    routes: [messagesRoute([]), inboundRoute, outboundRoute, [/openrouter\.ai/, { json: { provider: "Google", choices: [{ message: { content: "Hello." } }] } }]],
  });
  assert.equal(one.r.body.served, "Google:z-ai/glm-4.7");

  let n = 0;
  const two = await run({
    token: withConv(), body: { text: "hi", lang: "en" },
    routes: [messagesRoute([]), inboundRoute, outboundRoute, [/openrouter\.ai/, () => (++n === 1
      ? { json: { provider: "Google", choices: [{ message: { content: "" } }] } }
      : { json: { provider: "Z.AI", choices: [{ message: { content: "Second." } }] } })]],
  });
  assert.equal(two.r.body.served, "Google:z-ai/glm-4.7 -> Z.AI:z-ai/glm-4.6");
});

test("both models empty: the visitor is asked to try again, not told the thread is over", async () => {
  const { r, fake } = await run({
    token: withConv(),
    body: { text: "hi", lang: "en" },
    routes: [messagesRoute([]), inboundRoute, outboundRoute, modelRoute("")],
  });
  assert.equal(fake.calls.filter((c) => c.url.includes("openrouter.ai")).length, 2);
  const outbound = fake.calls.find((c) => c.method === "POST" && c.url.endsWith("/conversations/messages"));
  assert.match(outbound.body.message, /send that again/);
  assert.equal(outbound.body.message.includes("covered a lot"), false, "that is the 40-message cap line, not this");
  assert.equal(r.body.reply, outbound.body.message);
});

test("a 501-character message is rejected and reaches neither GHL nor the model", async () => {
  const { r, fake } = await run({ token: withConv(), body: { text: "a".repeat(501), lang: "en" } });
  assert.equal(r.code, 400);
  assert.equal(fake.calls.length, 0);

  const ok = await run({ token: withConv(), body: { text: "a".repeat(500), lang: "en" } });
  assert.equal(ok.r.code, 200, "500 characters is still allowed");
});

test("the 41st visitor message gets the call-or-Rut line with no model call", async () => {
  // 40 visitor messages already in the thread: this one is the 41st.
  const rows = Array.from({ length: 40 }, (_, i) => liveChat("inbound", `q${i}`));
  const { r, fake } = await run({
    token: withConv(),
    body: { text: "one more question", lang: "en" },
    routes: [messagesRoute(rows), inboundRoute, outboundRoute],
  });

  assert.equal(fake.calls.some((c) => c.url.includes("openrouter.ai")), false, "the cap must not cost a model call");
  const outbound = fake.calls.find((c) => c.method === "POST" && c.url.endsWith("/conversations/messages"));
  assert.match(outbound.body.message, /rut@rejiglabs\.com/);
  assert.equal(r.body.reply, outbound.body.message);

  // The 40th is still answered normally.
  const under = await run({
    token: withConv(),
    body: { text: "q39", lang: "en" },
    routes: defaults(rows.slice(0, 39)),
  });
  assert.equal(under.fake.calls.some((c) => c.url.includes("openrouter.ai")), true);
});

test("the copied guards clean the model's reply before it is posted", async () => {
  const { r, fake } = await run({
    token: withConv(),
    body: { text: "hi", lang: "en" },
    routes: defaults([], "Setup is from 50,000 baht 😊 — the call decides the rest. TECHNICAL_ERROR"),
  });
  const outbound = fake.calls.find((c) => c.method === "POST" && c.url.endsWith("/conversations/messages"));
  assert.equal(outbound.body.message.includes("😊"), false, "stripEmoji");
  assert.equal(outbound.body.message.includes("—"), false, "scrub: no em dashes");
  assert.equal(outbound.body.message.includes("TECHNICAL_ERROR"), false, "scrub: no steering markers");
  assert.equal(r.body.reply, outbound.body.message);
});

test("the thread is read back as history and Rut's replies keep their own voice", async () => {
  const rows = [
    liveChat("outbound", "Rut: I'll take this one."),
    liveChat("inbound", "can I get a discount?"),
    liveChat("outbound", "Setup is always collected."),
    liveChat("inbound", "what does it cost?"),
    { id: "ig1", direction: "inbound", messageType: "TYPE_INSTAGRAM", body: "hey on insta", dateAdded: "2026-08-20T01:00:00.000Z" },
  ];
  const { fake } = await run({ token: withConv(), body: { text: "ok", lang: "en" } , routes: defaults(rows) });
  const model = fake.calls.find((c) => c.url.includes("openrouter.ai"));
  const turns = model.body.messages.filter((m) => m.role !== "system");

  assert.deepEqual(turns.map((m) => m.content), [
    "what does it cost?",
    "Setup is always collected.",
    "can I get a discount?",
    "Rut (the founder) replied: I'll take this one.",
    "ok",
  ], "oldest first, the Instagram row dropped, Rut's line labelled");
  assert.deepEqual(turns.map((m) => m.role), ["user", "assistant", "user", "assistant", "user"]);
});

test("a Thai turn tells the model to answer in Thai", async () => {
  const { fake } = await run({ token: withConv(), body: { text: "ราคาเท่าไหร่", lang: "th" } });
  const system = fake.calls.find((c) => c.url.includes("openrouter.ai")).body.messages[0];
  assert.equal(system.role, "system");
  assert.match(system.content, /Thai/);
  assert.match(system.content, /## TH/, "the corpus itself is the prompt");
  assert.match(system.content, /30,000/, "the whole knowledge file is loaded, not a summary");
});

test("no token is 401, and a non-POST is 405", async () => {
  const { r, fake } = await run({ body: { text: "hi" } });
  assert.equal(r.code, 401);
  assert.equal(fake.calls.length, 0);

  const g = await run({ token: withConv(), method: "GET", body: {} });
  assert.equal(g.r.code, 405);
});

test("an empty message is 400", async () => {
  const { r, fake } = await run({ token: withConv(), body: { text: "   " } });
  assert.equal(r.code, 400);
  assert.equal(fake.calls.length, 0);
});
