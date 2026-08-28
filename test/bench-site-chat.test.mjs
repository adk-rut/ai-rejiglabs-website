// The two pure bits of the bench (#745): the percentile the gate is read off, and the booking
// phrases, which have to land on exactly one real slot or they book nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { pct, bookingPhrases } from "../scripts/bench-site-chat.mjs";
import { matchSlots } from "../lib/booking.js";

test("pct is nearest-rank, so p50 is a measurement that happened", () => {
  const xs = [5000, 1000, 3000, 2000, 4000];
  assert.equal(pct(xs, 0.5), 3000);
  assert.equal(pct(xs, 0.9), 5000);
  assert.equal(pct([7], 0.5), 7);
});

test("booking phrases each match exactly one free slot", () => {
  // A Monday noon, Bangkok, and the next three days of half-hour slots.
  const now = Date.parse("2026-08-31T05:00:00Z"); // 12:00 Asia/Bangkok
  const slots = [];
  for (let day = 0; day < 4; day++) {
    for (const hhmm of ["13:00", "14:30", "16:00", "19:30"]) {
      const d = new Date(Date.parse(`2026-08-31T${hhmm}:00+07:00`) + day * 86400000);
      slots.push(d.toISOString());
    }
  }
  const real = slots;
  const phrases = bookingPhrases(real, 6, now);
  assert.equal(phrases.length, 6);
  for (const p of phrases) {
    const { matches, exact } = matchSlots(p.text, real, now);
    assert.ok(exact, `not an exact slot match: ${p.text}`);
    assert.equal(Date.parse(matches[0]), Date.parse(p.iso), p.text);
  }
});

test("booking phrases never reuse a slot", () => {
  const now = Date.parse("2026-08-31T05:00:00Z");
  const slots = ["13:00", "14:30", "16:00"].map((t) => new Date(`2026-09-01T${t}:00+07:00`).toISOString());
  const phrases = bookingPhrases(slots, 10, now);
  assert.equal(phrases.length, 3); // asked for ten, there are three: a short case, not an invented one
  assert.equal(new Set(phrases.map((p) => p.iso)).size, 3);
});
