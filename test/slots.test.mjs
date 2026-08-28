// Slots endpoint (#740, spec #734): the Discovery call calendar's own free-slots, passed through.
// The hours, the look-busy and the closed days live ON the calendar — nothing here filters them,
// so the only assertions are on the read GHL was asked for and the times it gave back.
//   node --test test/slots.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { fakeFetch } from "./fake-fetch.mjs";
import slots from "../api/slots.js";

process.env.GHL_REJIG_API_KEY = "pit-test";
process.env.GHL_REJIG_LOCATION_ID = "loc-test";
process.env.GHL_REJIG_DISCOVERY_CAL = "cal-discovery";

const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

// GHL answers free-slots keyed by date, one `slots` array per day, plus a traceId that is not a day.
const freeSlotsRoute = (json) => [/\/free-slots/, { json }];
const twoDays = {
  "2026-09-01": { slots: ["2026-09-01T14:00:00+07:00", "2026-09-01T14:30:00+07:00"] },
  "2026-09-02": { slots: ["2026-09-02T12:00:00+07:00"] },
  traceId: "tr_1",
};

const run = async ({ routes = [freeSlotsRoute(twoDays)], method = "GET" } = {}) => {
  const fake = fakeFetch(routes);
  const real = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  const r = res();
  try {
    await slots({ method, headers: {}, query: {} }, r);
  } finally {
    globalThis.fetch = real;
  }
  return { r, fake };
};

test("free-slots is read on the Discovery calendar over a 7-day window in Bangkok time", async () => {
  const { fake } = await run();

  assert.equal(fake.calls.length, 1);
  const url = new URL(fake.calls[0].url);
  assert.equal(fake.calls[0].method, "GET");
  assert.ok(url.pathname.includes("/calendars/cal-discovery/free-slots"), url.pathname);
  assert.equal(url.searchParams.get("timezone"), "Asia/Bangkok");
  const start = Number(url.searchParams.get("startDate"));
  const end = Number(url.searchParams.get("endDate"));
  assert.ok(Math.abs(start - Date.now()) < 60_000, "the window starts now");
  assert.equal(Math.round((end - start) / 86_400_000), 7);
});

test("every time GHL returned comes back, oldest first, with the traceId dropped", async () => {
  const { r } = await run();

  assert.equal(r.code, 200);
  assert.deepEqual(r.body.slots, [
    "2026-09-01T14:00:00+07:00",
    "2026-09-01T14:30:00+07:00",
    "2026-09-02T12:00:00+07:00",
  ]);
});

test("a GHL failure is a 502, never an empty calendar", async () => {
  const { r } = await run({ routes: [[/\/free-slots/, { status: 500, json: { error: "boom" } }]] });
  assert.equal(r.code, 502);
});

test("GET only", async () => {
  const { r } = await run({ method: "POST", routes: [] });
  assert.equal(r.code, 405);
});
