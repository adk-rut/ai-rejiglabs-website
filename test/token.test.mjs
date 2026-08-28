// The shared token verifier every later Site chat handler imports (#736).
//   node --test test/token.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { signToken, verifyToken, requireToken } from "../lib/token.js";

process.env.SITE_CHAT_SIGNING_SECRET = "test-secret-not-a-real-one";

const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};
const req = (token) => ({ headers: token === undefined ? {} : { authorization: `Bearer ${token}` } });

test("a signed token round-trips to its payload", () => {
  const token = signToken({ contactId: "c1", conversationId: "v1" });
  assert.deepEqual(verifyToken(token), { contactId: "c1", conversationId: "v1" });
});

test("requireToken hands the payload back on a good token", () => {
  const r = res();
  assert.deepEqual(requireToken(req(signToken({ contactId: "c1" })), r), { contactId: "c1" });
  assert.equal(r.code, null, "a valid token answers nothing itself");
});

test("a missing, empty or blank token is 401", () => {
  for (const t of [undefined, "", "   "]) {
    const r = res();
    assert.equal(requireToken(req(t), r), null);
    assert.equal(r.code, 401, `token ${JSON.stringify(t)} must be 401`);
  }
});

test("a tampered payload or signature is 401", () => {
  const token = signToken({ contactId: "c1" });
  const [payload, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ contactId: "someone-else" })).toString("base64url");
  for (const t of [`${forged}.${sig}`, `${payload}.${"a".repeat(sig.length)}`, payload, `${payload}.`]) {
    const r = res();
    assert.equal(requireToken(req(t), r), null);
    assert.equal(r.code, 401);
  }
});

test("a token signed with another secret is 401", () => {
  const token = signToken({ contactId: "c1" });
  process.env.SITE_CHAT_SIGNING_SECRET = "a-different-secret";
  try {
    assert.equal(verifyToken(token), null);
  } finally {
    process.env.SITE_CHAT_SIGNING_SECRET = "test-secret-not-a-real-one";
  }
});
