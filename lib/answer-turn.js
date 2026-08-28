// Jasmin's brain (#737, spec #734). `answerTurn` knows NO channel: it takes the history, the
// visitor's line and the language, and returns the reply. The GHL layer around it (api/turn.js
// today, the IG/FB webhook in #743) owns everything about where the words came from and go.
//
// The whole prompt is the knowledge file. Nothing here summarises it, and nothing queries gbrain
// at runtime: if a fact is not in `knowledge/site-chat-knowledge.md`, Jasmin does not have it.
import { readFileSync } from "node:fs";
import { scrub, stripEmoji } from "./reply-guards.js";

const OR_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "z-ai/glm-4.7";
const FALLBACK = "z-ai/glm-4.6";
// The provider IS the latency on an open-weight model: same model, same prompt, OpenRouter's
// default (cheapest) route ran p50 18.1s where Google Vertex ran 2.1s (measured 2026-08-27 on the
// relay). Order, not `sort`, so a named provider is asked first and the budget holds.
const PROVIDERS = ["Google", "Z.AI"];
// Abort points, not targets. The budget is p50 3s / max 8s and #744's bench is the gate on it,
// but an abort BELOW the real tail just converts a slow answer into no answer: at 10s the live
// preview timed out both models on 2 of 3 Thai turns and handed the visitor the cap line for a
// first question (measured 2026-08-28, EN 4.3-7.1s, TH 9.0-17.0s — Thai costs far more output
// tokens for the same sentence). 15s clears that tail; 12s leaves the fallback room to answer.
const TIMEOUT_MS = 15000;
const FALLBACK_TIMEOUT_MS = 12000;

// Read once per warm function. `new URL` rather than a cwd-relative path: Vercel does not run the
// handler from the repo root, and the file is bundled beside the code.
let corpus = "";
const knowledge = () => (corpus ||= readFileSync(new URL("../knowledge/site-chat-knowledge.md", import.meta.url), "utf8"));

// The last line of a thread that has run its 40 messages. Never a made-up fact and never a
// promise Rut has to keep: the call and his email are the two things the knowledge file says are
// always available.
export const capLine = (lang) => (lang === "th"
  ? "คุยกันมาเยอะแล้วนะคะ ขั้นต่อไปที่ดีที่สุดคือจองเวลาคุยกับรุจผู้ก่อตั้งโดยตรง หรือส่งอีเมลไปที่ rut@rejiglabs.com ได้เลยค่ะ"
  : "We've covered a lot here. The best next step is a Discovery call with Rut, or email him at rut@rejiglabs.com.");

// Both models came back empty. NOT capLine: "we've covered a lot" is a lie on turn three, and a
// visitor who has just been failed should be told to try again rather than sent away.
export const troubleLine = (lang) => (lang === "th"
  ? "ขออภัยค่ะ ระบบขัดข้องชั่วคราว ลองพิมพ์อีกครั้งได้ไหมคะ หรือส่งอีเมลไปที่ rut@rejiglabs.com ก็ได้ค่ะ"
  : "Sorry, something went wrong on my side. Could you send that again? You can also email Rut at rut@rejiglabs.com.");

const systemPrompt = (lang) => `You are Jasmin, Rejig Labs' AI front desk on rejiglabs.com. You are talking to a visitor on the website.

Answer ONLY from the knowledge file below. If it is not in there, say plainly that you do not know and offer Rut or a Discovery call. Never invent a number, a client fact, a date or an integration.

${lang === "th"
  ? "Answer in Thai, in the natural spoken register of the ## TH section, with prices in บาท. Use ค่ะ/นะคะ. No letter-spacing."
  : "Answer in English."}

Keep replies short: two or three sentences, the way a front desk talks, not a brochure. No emoji, no em dashes, no markdown.

--- KNOWLEDGE FILE ---
${knowledge()}`;

// One OpenRouter call. Returns the reply text, or "" for anything that is not one — a timeout, a
// non-200, a body with no content. The caller's fallback is the only error handling this needs.
async function callModel(model, messages, timeoutMs) {
  const body = {
    model,
    provider: { order: PROVIDERS },
    temperature: 0.3,
    max_tokens: 2000, // GLM is a hybrid thinking model: hidden reasoning eats the budget before the visible reply
    messages,
  };
  const startedAt = Date.now();
  try {
    const r = await fetch(OR_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return "";
    const j = await r.json();
    heliconeLog({ reqBody: body, resBody: j, startedAt });
    return String(j?.choices?.[0]?.message?.content || "").trim();
  } catch {
    return ""; // AbortSignal.timeout, a dead socket, unparseable JSON: all the same to the visitor
  }
}

// Fire-and-forget trace, AFTER the reply exists. Helicone is deliberately not a proxy in front of
// the model: an observability vendor in the visitor's critical path is how a dashboard blip
// becomes a dropped turn (the relay's #204). Off entirely when no key is set.
// The endpoint is the manual-logger one, verified live 2026-07-20; the documented
// api.helicone.ai/oai/v1/log path is dead (404). Do not "fix" it back without probing.
export const HELICONE_LOG_URL = "https://api.worker.helicone.ai/custom/v1/log";
function heliconeLog({ reqBody, resBody, startedAt, key = process.env.HELICONE_API_KEY || "" }) {
  if (!key) return;
  const split = (ms) => ({ seconds: Math.floor(ms / 1000), milliseconds: ms % 1000 });
  fetch(HELICONE_LOG_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      providerRequest: { url: OR_URL, json: reqBody, meta: { "Helicone-Property-Environment": "site-chat" } },
      providerResponse: { json: resBody, status: 200, headers: {} },
      timing: { startTime: split(startedAt), endTime: split(Date.now()) },
    }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {}); // tracing must never surface to the visitor
}

// history: [{ role: "user" | "assistant", content }] oldest-first, already filtered to this thread.
// Returns { reply }. Later tickets add `escalate` (#739) and `booking` (#740) to the same object.
export async function answerTurn(history = [], text = "", lang = "en") {
  const messages = [{ role: "system", content: systemPrompt(lang) }, ...history, { role: "user", content: text }];
  const raw = (await callModel(MODEL, messages, TIMEOUT_MS)) || (await callModel(FALLBACK, messages, FALLBACK_TIMEOUT_MS));
  // Guards run here, not in the handler, so every channel gets the same cleaning.
  const reply = stripEmoji(scrub(raw));
  return { reply: reply || troubleLine(lang) };
}
