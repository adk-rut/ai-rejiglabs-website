// Beem's brain (#737, spec #734). `answerTurn` knows NO channel: it takes the history, the
// visitor's line and the language, and returns the reply. The GHL layer around it (api/turn.js
// today, the IG/FB webhook in #743) owns everything about where the words came from and go.
//
// The whole prompt is the knowledge file. Nothing here summarises it, and nothing queries gbrain
// at runtime: if a fact is not in `knowledge/site-chat-knowledge.md`, Beem does not have it.
import { readFileSync } from "node:fs";
import { scrub, stripEmoji } from "./reply-guards.js";

const OR_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "z-ai/glm-4.7";
const FALLBACK = "z-ai/glm-4.6";
// The provider IS the latency on an open-weight model: same model, same prompt, OpenRouter's
// default (cheapest) route ran p50 18.1s where Google Vertex ran 2.1s (measured 2026-08-27 on the
// relay). Order, not `sort`, so a named provider is asked first and the budget holds.
const PROVIDERS = ["Google", "Z.AI"];
// And the REASONING is the rest of it (#746). GLM-4.7 is a hybrid thinking model: with thinking on
// it spent 500-2000 hidden tokens before every visible reply, Thai regularly hit the 2000-token cap
// with no reply at all, and that empty reply is what the fallback call and the 20 s tails were.
// Off, same model, same provider, n=5 per case (2026-08-30): EN 3.5 s -> 1.3 s, TH 9.0 s -> 1.9 s,
// and every marker (NO_ANSWER, BOOKING, the escalation line) still came out. There are no tools
// here for it to forget, which is what broke when the relay tried the same switch.
const REASONING = { enabled: false };
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

// The model's way of saying the knowledge file did not answer this. It is a marker rather than a
// phrase match because "I don't know" has fifty spellings in two languages, and the prompt asks
// for exactly one. Stripped before the reply is ever posted.
export const NO_ANSWER = "[[NO_ANSWER]]";
const NO_ANSWER_RE = /\[\[\s*NO_ANSWER\s*\]\]/i; // no /g: `.test` on a global regex carries lastIndex between calls
const NO_ANSWER_ALL = new RegExp(NO_ANSWER_RE.source, "gi");

// The same marker trick for the Discovery call (#740): the model says THAT the visitor wants to
// book and roughly when, in its own words, and the handler matches that against the real
// free-slots. The model never lists a time itself — it cannot see the calendar, and a model that
// offers times offers one that is already taken.
const BOOKING_RE = /\[\[\s*BOOKING\s*:?\s*([^\]]*?)\s*\]\]/i;
const BOOKING_ALL = new RegExp(BOOKING_RE.source, "gi");

const systemPrompt = (lang) => `You are Beem (Thai: บีม), Rejig Labs' AI front desk on rejiglabs.com. You are talking to a visitor on the website.

Answer ONLY from the knowledge file below. If it is not in there, start your reply with the marker ${NO_ANSWER} and then say plainly that you do not know and offer Rut or a Discovery call. The marker is for us, never for the visitor, and it means only that: nothing in the file answered them. Never invent a number, a client fact, a date or an integration.

If the visitor asks to book the Discovery call, or names a day or a time for it, start your reply with the marker [[BOOKING: the day and time they want, in English, the time as 24-hour HH:MM, e.g. tomorrow 14:00]] and then answer them normally without naming any time yourself. Carry forward anything already agreed in this conversation, so a visitor who said "Tuesday" and then "2pm" gives you [[BOOKING: Tuesday 2pm]]. You cannot see the calendar: the open times are added to your reply for you, and inventing one books nobody.

If the visitor asks to speak to a person or asks for Rut by name, give the escalation line from the knowledge file and then keep answering what they asked.

${lang === "th"
  ? "Answer in Thai, in the natural spoken register of the ## TH section, with prices in บาท. Use ค่ะ/นะคะ. No letter-spacing."
  : "Answer in English."}

Keep replies short: two or three sentences, the way a front desk talks, not a brochure. No emoji, no em dashes, no markdown.

--- KNOWLEDGE FILE ---
${knowledge()}`;

// One OpenRouter call. Returns { text, served }: the reply text, or "" for anything that is not
// one — a timeout, a non-200, a body with no content — and which provider actually answered
// ("Google:z-ai/glm-4.7"), because the provider is the latency and the bench has to be able to
// see it. The caller's fallback is the only error handling this needs.
async function callModel(model, messages, timeoutMs) {
  const body = {
    model,
    provider: { order: PROVIDERS },
    reasoning: REASONING,
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
    if (!r.ok) return { text: "", served: `${r.status}:${model}` };
    const j = await r.json();
    heliconeLog({ reqBody: body, resBody: j, startedAt });
    return { text: String(j?.choices?.[0]?.message?.content || "").trim(), served: `${j?.provider || "?"}:${model}` };
  } catch {
    return { text: "", served: `timeout:${model}` }; // AbortSignal.timeout, a dead socket, unparseable JSON: all the same to the visitor
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

// The visitor asking for a human, the mirror of `PROMISED_HUMAN` (which reads the REPLY). Over-
// flags rather than under-flags: a spurious card costs Rut one glance, a missed one costs him a
// prospect who thinks nobody is there.
export const ASKED_FOR_HUMAN =
  /\b(talk|speak|chat)\b[^.!?\n]{0,20}\b(to|with)\b[^.!?\n]{0,20}\b(a |an |the )?(person|human|someone|somebody|real|rut|founder|owner|staff|agent)\b|\b(real|actual) (person|human)\b|\bhuman being\b|\bis (there )?(anyone|anybody|someone|a human)\b|(คุย|พูด|ติดต่อ)[^\n]{0,20}(กับคน|กับพนักงาน|กับแอดมิน|กับเจ้าหน้าที่|กับรุจ|กับผู้ก่อตั้ง|ตัวจริง)|ขอคุยกับคน/i;

// history: [{ role: "user" | "assistant", content }] oldest-first, already filtered to this thread.
// Returns { reply, escalate?, booking?, served } — `escalate` is 'person' | 'cannot-answer' (#738),
// `booking` is { wants: true, hint } when the visitor asked for the Discovery call (#740), `served`
// names the provider and model that answered, or both attempts when the first came back empty.
export async function answerTurn(history = [], text = "", lang = "en") {
  const messages = [{ role: "system", content: systemPrompt(lang) }, ...history, { role: "user", content: text }];
  let { text: raw, served } = await callModel(MODEL, messages, TIMEOUT_MS);
  if (!raw) {
    const second = await callModel(FALLBACK, messages, FALLBACK_TIMEOUT_MS);
    raw = second.text;
    served = `${served} -> ${second.served}`;
  }
  // Guards run here, not in the handler, so every channel gets the same cleaning.
  const reply = stripEmoji(scrub(raw.replace(NO_ANSWER_ALL, "").replace(BOOKING_ALL, "")));
  // Asking for a person wins: it is what the visitor said, not what the model made of it.
  const escalate = ASKED_FOR_HUMAN.test(text) ? "person" : NO_ANSWER_RE.test(raw) ? "cannot-answer" : undefined;
  const wantsBooking = raw.match(BOOKING_RE);
  const booking = wantsBooking ? { wants: true, hint: wantsBooking[1] || text } : undefined;
  return { reply: reply || troubleLine(lang), escalate, booking, served };
}

// The three lines Rut reads before he walks into the call: who they are, what they asked, what
// range they were quoted and when the call is. One small model call on the thread that exists —
// a CTA booking has no thread, and then the fallback below is the whole truth there is.
// English always: this is for Rut, not for the visitor.
export async function bookingSummary({ history = [], contact = {}, whenText = "" }) {
  const who = [contact.name, contact.email, contact.phone].filter(Boolean).join(" · ") || "a site visitor";
  const fallback = `${who}\nBooked a Discovery call from the site chat.\nCall ${whenText}.`;
  const transcript = history.map((m) => `${m.role === "user" ? "Visitor" : "Beem"}: ${m.content}`).join("\n").slice(-4000);
  if (!transcript) return fallback;
  const out = await callModel(MODEL, [{
    role: "system",
    content: `Summarise this website chat for Rut, who is about to take the Discovery call. EXACTLY three plain lines, no markdown, no emoji, no preamble:
1. who they are and what business they run
2. what they asked about
3. what price or range Beem quoted, and the call time (${whenText})
Only what is in the transcript. If a line has nothing to say, say so in three words rather than inventing anything.`,
  }, { role: "user", content: `Contact: ${who}\n\n${transcript}` }], 8000);
  return out.text || fallback;
}
