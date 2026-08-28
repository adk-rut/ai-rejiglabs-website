// The Discovery call, booked (#740, spec #734). One book path for every channel: the chat, the
// page CTA and (later) a DM all land in `bookDiscovery`, so a booking is the same six steps
// wherever it started.
//
// NOTHING about the calendar's shape lives here. The hours (12:00-22:00), the 30-minute slot, the
// look-busy and the closed days are settings ON the GHL calendar, and free-slots is the only truth
// about availability (a calendar GET is not — see the GHL gotchas memory). Code that re-derives
// opening hours is code that disagrees with the calendar the day RT changes it.
//
// Prior art, read-only: projects/front-desk-relay/api/vapi-pt.js (free-slots + appointment shapes).
import { fetchContact, fetchMessages, threadRows, toHistory, CHANNELS } from "./ghl-chat.js";

// `channel` arrives here as the human label ("Instagram") because that is what the note and the
// card print; the thread read below needs the code again to filter the right rows.
const CHANNEL_OF = Object.fromEntries(Object.entries(CHANNELS).map(([k, v]) => [v.label || k, k]));
import { bookingSummary } from "./answer-turn.js";
import { tgSend, bookingCard, contactName } from "./telegram.js";

const GHL_BASE = "https://services.leadconnectorhq.com";
const CAL_VERSION = "2021-04-15";
const CONTACT_VERSION = "2021-07-28";
export const TZ = "Asia/Bangkok";
const DAYS = 7;

const headers = (version) => ({
  Authorization: `Bearer ${process.env.GHL_REJIG_API_KEY}`,
  Version: version,
  "Content-Type": "application/json",
  "User-Agent": "Mozilla/5.0", // GHL's Cloudflare blocks default fetch UAs
});

// Open times on the Discovery calendar for the next 7 days, oldest first.
// Returns null on a GHL error — an empty calendar and a broken read must never look the same.
export async function freeSlots({ days = DAYS, now = Date.now() } = {}) {
  const url = `${GHL_BASE}/calendars/${process.env.GHL_REJIG_DISCOVERY_CAL}/free-slots`
    + `?startDate=${now}&endDate=${now + days * 86400000}&timezone=${encodeURIComponent(TZ)}`;
  try {
    const r = await fetch(url, { headers: headers(CAL_VERSION) });
    if (!r.ok) return null;
    const j = await r.json();
    // Keyed by date, one `slots` array per day, plus a traceId that is not a day.
    return Object.keys(j)
      .filter((k) => Array.isArray(j[k]?.slots))
      .sort()
      .flatMap((k) => j[k].slots);
  } catch {
    return null;
  }
}

// "Tue 1 Sep, 14:00" / "อังคาร 1 ก.ย. 14:00" — the one place a slot becomes words, so the widget's
// Booked state, the note, the card and Jasmin's offer all say the same thing.
export function humanSlot(iso, lang = "en") {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const fmt = (opts) => new Intl.DateTimeFormat(lang === "th" ? "th-TH-u-ca-gregory" : "en-GB", { timeZone: TZ, ...opts }).format(d);
  return `${fmt({ weekday: "short", day: "numeric", month: "short" })}, ${fmt({ hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

// Same upsert as the Lead gate (api/gate.js): email is the match key, so a visitor who booked from
// the CTA and later opens the chat is one contact. Copied rather than shared — the gate owns its
// own 400s and its own tags, and one shared "upsert a contact" that both bend would serve neither.
async function upsertContact({ name, email, phone, lang, pageUrl }) {
  const r = await fetch(`${GHL_BASE}/contacts/upsert`, {
    method: "POST",
    headers: headers(CONTACT_VERSION),
    body: JSON.stringify({
      locationId: process.env.GHL_REJIG_LOCATION_ID,
      name, email, phone,
      tags: ["site-chat", `lang-${lang}`],
      source: pageUrl || "site-chat-booking",
    }),
  });
  if (!r.ok) return null;
  return (await r.json().catch(() => ({})))?.contact?.id || null;
}

const post = (path, body, version) => fetch(`${GHL_BASE}${path}`, { method: "POST", headers: headers(version), body: JSON.stringify(body) });

/**
 * The Discovery call booking, whichever channel it came from.
 * Steps, in this order and no other: contact (upserted only when there is no session), appointment,
 * tags, note, 📅 ping. The appointment is the booking — if GHL refuses it there is nothing to tag,
 * nothing to note and nothing to tell Rut. Everything after it is best-effort bookkeeping and none
 * of it can lose the visitor a confirmed call.
 */
export async function bookDiscovery({ contactId, name, email, phone, slot, lang = "en", pageUrl = "", conversationId = "", channel = "" }) {
  if (!contactId) {
    contactId = await upsertContact({ name, email, phone, lang, pageUrl });
    if (!contactId) return { ok: false, error: "could not save your details" };
  }

  const appt = await post("/calendars/events/appointments", {
    calendarId: process.env.GHL_REJIG_DISCOVERY_CAL,
    locationId: process.env.GHL_REJIG_LOCATION_ID,
    contactId,
    startTime: slot,
    title: `Discovery call — ${name || "site chat"}`,
    appointmentStatus: "confirmed", // the calendar auto-confirms and sends the Google invite itself
  }, CAL_VERSION);
  if (!appt.ok) {
    console.error("[book] appointment refused", appt.status, await appt.text().catch(() => ""));
    return { ok: false, error: "that time is no longer free" };
  }
  const appointmentId = (await appt.json().catch(() => ({})))?.id || "";

  await post(`/contacts/${contactId}/tags`, { tags: ["discovery-booked", `lang-${lang}`] }, CONTACT_VERSION).catch(() => {});

  // The reads happen HERE, after the booking is real: a GHL wobble on the thread or the contact
  // must not cost a call that is already on the calendar.
  const [contact, rows] = await Promise.all([fetchContact(contactId), fetchMessages(conversationId).then((m) => threadRows(m, channel ? CHANNEL_OF[channel] : "Live_Chat"))]);
  const when = humanSlot(slot, lang);
  const written = await bookingSummary({ history: toHistory(rows), contact: { ...contact, name: name || contactName(contact), email: email || contact.email, phone: phone || contact.phone }, whenText: humanSlot(slot, "en") });

  // Where the call came from, on the one line Rut actually reads before the call (#741). Appended
  // rather than prompted for: the summary model sees a transcript, not the channel it arrived on.
  const summary = channel ? `${written}\nChannel: ${channel}` : written;

  await post(`/contacts/${contactId}/notes`, { body: `📅 Discovery call booked — ${humanSlot(slot, "en")} (${TZ})\n\n${summary}` }, CONTACT_VERSION).catch(() => {});
  await tgSend(bookingCard({ contact, name, email, phone, whenText: humanSlot(slot, "en"), summary, contactId, conversationId, locationId: process.env.GHL_REJIG_LOCATION_ID || "" }));

  return { ok: true, contactId, appointmentId, startTime: slot, when };
}

// --- Reading a day and a time out of what the visitor typed -----------------------------------
// The model tells us THAT they want to book and roughly when (the [[BOOKING: …]] marker); it never
// sees the calendar, so the times themselves are matched here against the real free-slots. That
// split is deliberate: a model that lists times invents one sooner or later.
const WEEKDAYS = {
  sunday: 0, sun: 0, "อาทิตย์": 0,
  monday: 1, mon: 1, "จันทร์": 1,
  tuesday: 2, tue: 2, tues: 2, "อังคาร": 2,
  wednesday: 3, wed: 3, "พุธ": 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, "พฤหัส": 4,
  friday: 5, fri: 5, "ศุกร์": 5,
  saturday: 6, sat: 6, "เสาร์": 6,
};
// Rough halves of the day, the way people ask for them. The calendar opens at noon, so "morning"
// matches nothing today and the caller falls back to the next real times — which is the honest answer.
const BANDS = [
  [/\bmorning\b|เช้า/i, 0, 12],
  [/\bafternoon\b|บ่าย/i, 12, 17],
  [/\b(evening|night|tonight)\b|เย็น|ค่ำ|กลางคืน/i, 17, 24],
];

// Bangkok wall-clock parts of a slot. Never `getHours()`: the server runs in UTC.
function bkk(iso) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date(iso))
    .reduce((a, x) => ((a[x.type] = x.value), a), {});
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    wday: WEEKDAYS[String(p.weekday).toLowerCase()] ?? -1,
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
  };
}
const bkkDate = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));

/**
 * Which of the real open slots the visitor's words point at.
 * `exact` is the pick: a day AND a clock time that land on exactly one slot. A range ("Tuesday
 * afternoon", "tomorrow") is an offer, never a booking — nobody should find a call on their
 * calendar because they said "afternoon".
 */
export function matchSlots(hint, slots = [], now = Date.now()) {
  const h = String(hint || "").toLowerCase();
  const upcoming = (slots || []).filter((s) => Date.parse(s) > now);

  let date = null;
  if (/\btoday\b|วันนี้/i.test(h)) date = bkkDate(now);
  else if (/\btomorrow\b|พรุ่งนี้/i.test(h)) date = bkkDate(now + 86400000);
  const wday = date ? -1 : Object.entries(WEEKDAYS).find(([w]) => new RegExp(/[a-z]/.test(w) ? `\\b${w}\\b` : w, "i").test(h))?.[1] ?? -1;

  // "14:00", "2.30pm", "2 pm", "at 2" once a day is already on the table.
  const clock = h.match(/(\d{1,2})\s*[:.]\s*(\d{2})\s*(am|pm)?|\b(\d{1,2})\s*(am|pm)\b/i);
  let hour = null, minute = null;
  if (clock) {
    hour = Number(clock[1] ?? clock[4]);
    minute = Number(clock[2] ?? 0);
    const ampm = (clock[3] || clock[5] || "").toLowerCase();
    if (ampm === "pm" && hour < 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
  }
  const band = BANDS.find(([re]) => re.test(h));

  let matches = upcoming.filter((s) => {
    const p = bkk(s);
    if (date && p.date !== date) return false;
    if (wday >= 0 && p.wday !== wday) return false;
    if (hour !== null) return p.hour === hour && p.minute === minute;
    if (band) return p.hour >= band[1] && p.hour < band[2];
    return true;
  });
  // A weekday can fall twice inside a 7-day window; "Tuesday" means the next one.
  if (wday >= 0 && matches.length) {
    const first = bkk(matches[0]).date;
    matches = matches.filter((s) => bkk(s).date === first);
  }
  return { matches, exact: (date || wday >= 0) && hour !== null && matches.length === 1 };
}

// The two lines Jasmin adds to her own reply. Code, not model: these carry real times, and the one
// thing the model must never do with a time is make it up.
export const offerLine = (slots, lang = "en", none = false) => {
  const list = slots.map((s) => humanSlot(s, lang)).join(" / ");
  if (lang === "th") return none ? `ช่วงนั้นไม่ว่างค่ะ เวลาที่ว่างถัดไปคือ ${list} สะดวกช่วงไหนคะ` : `เวลาที่ว่างคือ ${list} สะดวกช่วงไหนคะ`;
  return none ? `Nothing open then. The next open times are: ${list}. Any of those work?` : `Open times: ${list}. Which one works for you?`;
};

export const bookedLine = (when, lang = "en") => (lang === "th"
  ? `จองให้แล้วนะคะ ${when} เดี๋ยวคำเชิญในปฏิทินจะส่งไปทางอีเมลค่ะ`
  : `Booked — ${when}. The calendar invite is on its way to your email.`);
