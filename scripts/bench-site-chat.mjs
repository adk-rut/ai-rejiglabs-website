#!/usr/bin/env node
/**
 * bench-site-chat.mjs — the go-live latency bench (#745, spec #734).
 *
 * Runs the four starter chips (EN and TH, from knowledge/site-chat-knowledge.md) plus one
 * Discovery call booking flow, n times each, against PROD and prints p50 and max per case.
 * Gate: p50 <= 3s, max <= 8s, every case.
 *
 * PROD, not a preview, on purpose: previews sit behind Vercel SSO, so curl gets a 302 to
 * vercel.com/sso-api and measures the redirect rather than the brain.
 *
 * One test contact PER CASE, not one for the whole run. A GHL conversation is per contact, so a
 * single contact would put all 90 turns in one thread and run into run-turn.js's 40-message cap
 * (MAX_VISITOR_MSGS) a third of the way in — the last cases would be measuring the cap line, which
 * costs no model call at all. Per case, each thread stays at n messages and every turn is real.
 *
 * The booking case books a REAL appointment per iteration, each on a different open slot (the same
 * slot twice is not a second booking, it is a "that time is gone" offer, which is a different code
 * path). `--cancel` cancels them again afterwards; it needs GHL_REJIG_API_KEY in the environment.
 *
 *   node scripts/bench-site-chat.mjs                       # dry list of the cases, no traffic
 *   node scripts/bench-site-chat.mjs --run --cancel        # the real bench
 *   node scripts/bench-site-chat.mjs --run --n 3 --no-book # quick, no calendar writes
 */
import { capLine } from "../lib/answer-turn.js";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const BASE = arg("--base", "https://rejiglabs.com").replace(/\/$/, "");
const N = Number(arg("--n", "10"));
const TZ = "Asia/Bangkok";
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
// A run id in the email, because GHL's upsert matches an EXISTING contact and a re-run on the same
// address would land in yesterday's 40-message thread rather than a fresh one.
const RUN = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).replace(":", "");
const OUT = arg("--out", `bench/${TODAY}.txt`);
const GATE_GAP_MS = 400; // one turn at a time; a bench that runs in parallel measures our own queue

// The four starter chips, verbatim from knowledge/site-chat-knowledge.md (## FAQ and ## TH).
const CHIPS_EN = [
  "What does AI Front Desk cost?",
  "How does it handle LINE and phone?",
  "Can I see it working?",
  "Book a discovery call",
];
const CHIPS_TH = [
  "AI Front Desk ราคาเท่าไหร่",
  "รับสายและตอบ LINE ยังไง",
  "ขอดูตัวอย่างที่ใช้งานจริงได้ไหม",
  "จองคอลคุยกับทีมงาน",
];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Nearest-rank, so p50 is always a measurement that actually happened rather than an average of two.
export const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : NaN;
};
const s = (ms) => (ms / 1000).toFixed(2).padStart(6);

async function gate(email, phone, lang) {
  const r = await fetch(`${BASE}/api/gate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Bench Rejig", email, phone, lang, pageUrl: `${BASE}/?bench` }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.token) throw new Error(`gate ${r.status} ${JSON.stringify(j)}`);
  return j;
}

// One measured turn. The clock is around the whole HTTP round trip, which is what a visitor waits.
async function turn(token, text, lang) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/turn`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ text, lang, pageUrl: `${BASE}/?bench` }),
  });
  const j = await r.json().catch(() => ({}));
  return { ms: Date.now() - t0, status: r.status, reply: String(j.reply || ""), booked: j.booked, token: j.token || token };
}

// --- the booking case's phrases -----------------------------------------------------------------
// The model never sees the calendar (lib/booking.js), so a booking only happens when the visitor's
// words land on exactly ONE real free slot: a day AND a clock time. These are built from the live
// free-slots, one slot per phrase, so ten iterations book ten different times instead of fighting
// over one.
const bkkParts = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false })
  .formatToParts(new Date(iso)).reduce((a, x) => ((a[x.type] = x.value), a), {});

export function bookingPhrases(slots, n, now = Date.now()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(now));
  const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(now + 86400000));
  const byDate = new Map();
  for (const iso of slots) {
    if (Date.parse(iso) < now + 90 * 60000) continue; // don't race a slot that expires mid-run
    const p = bkkParts(iso);
    const date = `${p.year}-${p.month}-${p.day}`;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push({ iso, date, ...p });
  }
  // A weekday name can fall twice in a 7-day window and matchSlots resolves it to the FIRST of the
  // two, so only the first six dates are safely nameable. Round-robin across them for spread.
  const dates = [...byDate.keys()].sort().slice(0, 6);
  const out = [];
  for (let round = 0; out.length < n; round++) {
    let added = 0;
    for (const d of dates) {
      const slot = byDate.get(d)[round];
      if (!slot || out.length >= n) continue;
      const day = d === today ? "today" : d === tomorrow ? "tomorrow" : slot.weekday;
      out.push({ iso: slot.iso, text: `Can I book a discovery call ${day} at ${slot.hour}:${slot.minute}?` });
      added++;
    }
    if (!added) break; // ran out of real slots: a shorter booking case beats an invented one
  }
  return out;
}

// --- cancelling what the bench booked ------------------------------------------------------------
const GHL = "https://services.leadconnectorhq.com";
const ghlHeaders = () => ({
  Authorization: `Bearer ${process.env.GHL_REJIG_API_KEY}`,
  Version: "2021-04-15",
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0", // GHL's Cloudflare blocks default fetch UAs
});

async function cancel(id) {
  const put = await fetch(`${GHL}/calendars/events/appointments/${id}`, {
    method: "PUT", headers: ghlHeaders(), body: JSON.stringify({ appointmentStatus: "cancelled" }),
  });
  if (put.ok) return "cancelled";
  const del = await fetch(`${GHL}/calendars/events/${id}`, { method: "DELETE", headers: ghlHeaders() });
  return del.ok ? "deleted" : `FAILED ${put.status}/${del.status}`;
}

// --- the run --------------------------------------------------------------------------------------
async function runCase({ name, lang, texts, index }) {
  // Email AND phone have to be unique per case: GHL's upsert matches on either, so one shared
  // phone silently folds every case onto one contact — which is one conversation, which trips
  // run-turn.js's 40-message cap and turns the later cases into cap lines with no model call at
  // all. That is exactly what the first run of this bench measured.
  const email = `bench-${TODAY}-${RUN}-${index}-${slug(name)}@rejiglabs.com`;
  const phone = `+6690000${String(1000 + index).slice(1)}`;
  const { token: gateToken, contactId } = await gate(email, phone, lang);
  let token = gateToken;
  const times = [], notes = [], appointments = [];
  for (const text of texts) {
    const t = await turn(token, text, lang);
    token = t.token;
    times.push(t.ms);
    if (t.status !== 200) notes.push(`HTTP ${t.status}`);
    else if (!t.reply.trim()) notes.push("empty reply");
    // The cap line costs no model call, so a case that measures it is not measuring latency.
    else if (t.reply.startsWith(capLine(lang))) notes.push("CAP LINE — not a model call, number is meaningless");
    if (t.booked?.appointmentId) appointments.push(t.booked.appointmentId);
    process.stderr.write(`  ${name} ${times.length}/${texts.length} ${s(t.ms)}s${t.booked ? " booked" : ""}\n`);
    await sleep(GATE_GAP_MS);
  }
  // How many of the turns actually booked. A booking case where the model offered times instead is
  // measuring the offer path, and the reader has to be able to see that.
  if (texts.some((t) => /book/i.test(t))) notes.push(`booked ${appointments.length}/${texts.length}`);
  return { name, lang, email, contactId, times, notes, appointments };
}

function report(results, cancelled) {
  const gateOk = (r) => pct(r.times, 0.5) <= 3000 && Math.max(...r.times) <= 8000;
  const lines = [];
  lines.push(`Site chat latency bench — ${new Date().toISOString()}`);
  lines.push(`target: ${BASE} (prod, real handlers)   n=${N} per case   gate: p50 <= 3.00s, max <= 8.00s`);
  lines.push(`model: z-ai/glm-4.7 -> z-ai/glm-4.6, provider order Google then Z.AI (lib/answer-turn.js)`);
  lines.push("");
  lines.push("case                                        lang     n     p50     p90     max  gate");
  lines.push("-".repeat(84));
  for (const r of results) {
    lines.push(
      `${r.name.padEnd(42)}  ${r.lang.padEnd(4)} ${String(r.times.length).padStart(5)} ` +
      `${s(pct(r.times, 0.5))} ${s(pct(r.times, 0.9))} ${s(Math.max(...r.times))}  ${gateOk(r) ? "PASS" : "FAIL"}`
    );
    if (r.notes.length) lines.push(`${"".padEnd(42)}  notes: ${r.notes.join(", ")}`);
  }
  lines.push("-".repeat(84));
  const failed = results.filter((r) => !gateOk(r));
  lines.push(`VERDICT: ${failed.length ? `FAIL — ${failed.length}/${results.length} cases over budget` : "PASS"}`);
  lines.push("");
  lines.push("Per-case numbers only; a run total would hide that TH costs far more output tokens");
  lines.push("than EN for the same sentence and is the case that misses the budget.");
  lines.push("");
  lines.push("Provider: /api/turn returns the reply, not OpenRouter's `provider` field, so the route");
  lines.push("that served each call is not observable from the bench. The configured order is");
  lines.push("Google then Z.AI; Helicone (HELICONE_API_KEY) holds the per-call response bodies.");
  const appts = results.flatMap((r) => r.appointments.map((id) => [r.name, id]));
  if (appts.length) {
    lines.push("");
    lines.push(`Bench appointments (${appts.length}):`);
    for (const [name, id] of appts) lines.push(`  ${id}  ${name}  ${cancelled?.[id] || "NOT CANCELLED"}`);
  }
  lines.push("");
  lines.push("Contacts created (one per case, so no thread hits the 40-message cap):");
  for (const r of results) lines.push(`  ${r.contactId}  ${r.email}`);
  const ids = new Set(results.map((r) => r.contactId));
  if (ids.size !== results.length) {
    lines.push("");
    lines.push(`!! ${results.length} cases share only ${ids.size} contacts — GHL folded them together,`);
    lines.push("   so they share one conversation and the later cases hit the 40-message cap. INVALID.");
  }
  return lines.join("\n") + "\n";
}

async function main() {
  const cases = [];
  CHIPS_EN.forEach((c, i) => cases.push({ name: `EN chip ${i + 1}: ${c}`, lang: "en", texts: Array(N).fill(c) }));
  CHIPS_TH.forEach((c, i) => cases.push({ name: `TH chip ${i + 1}: ${c}`, lang: "th", texts: Array(N).fill(c) }));

  if (!flag("--no-book")) {
    const r = await fetch(`${BASE}/api/slots`);
    const { slots = [] } = await r.json().catch(() => ({}));
    const phrases = bookingPhrases(slots, N);
    if (!phrases.length) throw new Error("no free slots: cannot bench the booking flow");
    cases.push({ name: "Booking flow (EN, one slot each)", lang: "en", texts: phrases.map((p) => p.text) });
  }

  if (!flag("--run")) {
    console.log(`${cases.length} cases, n=${N}, target ${BASE}. Re-run with --run to fire them.`);
    for (const c of cases) console.log(`  ${c.name}  [${c.texts[0]}]`);
    return;
  }

  const results = [];
  for (const [index, c] of cases.entries()) results.push(await runCase({ ...c, index }));

  const ids = results.flatMap((r) => r.appointments);
  const cancelled = {};
  if (flag("--cancel") && ids.length) {
    if (!process.env.GHL_REJIG_API_KEY) throw new Error("--cancel needs GHL_REJIG_API_KEY in the environment");
    for (const id of ids) cancelled[id] = await cancel(id);
  }

  const text = report(results, cancelled);
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { dirname, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const out = resolve(dirname(fileURLToPath(import.meta.url)), "..", OUT);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  console.log(text);
  console.log(`written to ${OUT}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
