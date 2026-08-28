// The Site chat session token (#736, spec #734): the ONLY thing the visitor's browser holds.
// The transcript lives in the GHL conversation, so this token is the whole session — it names the
// contact (and, once #737 opens one, the conversation) and nothing else. Every later handler
// verifies it through `requireToken` here; there is no second copy of this logic.
//
// Shape: base64url(JSON payload) "." base64url(HMAC-SHA256 of that payload string).
// No JWT library: a header nobody reads and an `alg` field an attacker can set to "none" are
// exactly the parts we do not want. node:crypto is the whole dependency.
import { createHmac, timingSafeEqual } from "node:crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64url");

// Read at call time, never at module load: Vercel injects env before the handler runs, and the
// tests swap secrets between cases.
const secret = () => {
  const s = process.env.SITE_CHAT_SIGNING_SECRET;
  if (!s) throw new Error("SITE_CHAT_SIGNING_SECRET is not set");
  return s;
};

const sign = (payloadB64) => b64url(createHmac("sha256", secret()).update(payloadB64).digest());

export function signToken(payload) {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

// Returns the payload, or null for anything we did not sign. Never throws on visitor input.
export function verifyToken(token) {
  const [body, sig] = String(token || "").trim().split(".");
  if (!body || !sig) return null;
  let expected;
  try {
    expected = sign(body);
  } catch {
    return null; // no secret configured: verify nothing rather than accept everything
  }
  // Length-guard first: timingSafeEqual throws on a length mismatch, and the length of a
  // signature is not a secret.
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

// Handler front door: `const session = requireToken(req, res); if (!session) return;`
// The token travels as `Authorization: Bearer <token>` so a GET poll and a POST turn carry it the
// same way.
export function requireToken(req, res) {
  const header = String(req?.headers?.authorization || "");
  const payload = verifyToken(header.replace(/^Bearer\s+/i, ""));
  if (!payload) {
    res.status(401).json({ error: "invalid or missing token" });
    return null;
  }
  return payload;
}
