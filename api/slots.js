// GET /api/slots (#740, spec #734): the Discovery call calendar's open times, for the widget's
// booking panel and for whoever else asks. Public and read-only — availability is not a secret,
// and the CTA on a page can offer times before a visitor has a session token.
import { freeSlots } from "../lib/booking.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const slots = await freeSlots();
  if (!slots) return res.status(502).json({ error: "could not read the calendar" });
  return res.status(200).json({ slots });
}
