// Proves the api/ path deploys and answers on the website Vercel project (#735). Nothing
// depends on it; the Site chat handlers land beside it.
export default function handler(_req, res) {
  res.status(200).json({ ok: true });
}
