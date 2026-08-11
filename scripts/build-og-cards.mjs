#!/usr/bin/env node
/**
 * build-og-cards.mjs — one 1200x630 link-preview card per published case study.
 *
 * "Quiet" template, picked by RT from four prototyped directions: off-white,
 * Instrument Serif headline, one blue rule, client logo. It is the only
 * direction that never has to fight an image, which matters because the case
 * study heroes are light line art on white and were not shot for this crop.
 *
 * Headlines come from data/case-studies.json, so the cards cannot drift from
 * the pages. Rendered with the Chrome already on this machine.
 *
 * Run from anywhere:  node scripts/build-og-cards.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// ponytail: hardcoded macOS Chrome. This is a local authoring script, not CI.
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Long headlines get a smaller face rather than overflowing the card.
export function headlineSize(headline) {
  const n = headline.length;
  if (n <= 60) return 62;
  if (n <= 90) return 54;
  return 46;
}

export function cardHtml(cs, logoHref) {
  return `<!doctype html>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600&family=Instrument+Serif&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  /* One centred block, not a top band and a bottom band: long and short
     headlines both sit as a single composition with no dead space. */
  .card{width:1200px;height:630px;background:#f7f8fc;color:#1a1d2e;padding:0 96px;
        display:flex;flex-direction:column;justify-content:center;
        font-family:'Instrument Sans',-apple-system,system-ui,sans-serif}
  .eyebrow{font-size:21px;letter-spacing:.16em;text-transform:uppercase;color:#0033cc}
  h2{font-family:'Instrument Serif',Georgia,serif;font-weight:400;
     font-size:${headlineSize(cs.headline)}px;line-height:1.12;margin:28px 0 0;max-width:940px}
  .rule{width:96px;height:4px;background:#0033cc;margin:34px 0 0}
  .bottom{display:flex;align-items:center;gap:26px;margin-top:44px}
  /* multiply drops the white box on JPG logos; harmless for transparent PNGs. */
  .bottom img{height:56px;width:auto;mix-blend-mode:multiply}
  .wm{font-size:23px;color:rgba(26,29,46,.42)}
</style>
<div class="card">
  <div>
    <div class="eyebrow">${esc(cs.eyebrow || 'Case study')}</div>
    <h2>${esc(cs.headline)}</h2>
    <div class="rule"></div>
  </div>
  <div class="bottom">
    <img src="${logoHref}" alt="">
    <span class="wm">${esc(cs.client)} &middot; Rejig Labs</span>
  </div>
</div>`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const studies = JSON.parse(readFileSync(resolve(ROOT, 'data/case-studies.json'), 'utf8'))
    .filter((c) => c.published);
  // The /case-studies/ hub gets its own card: same Quiet template, Rejig's blue mark.
  studies.push({ slug: 'hub', headline: "Systems we've shipped.", client: 'Case Studies', logo: 'assets/logo-blue.png', eyebrow: 'Case studies' });
  const work = resolve(tmpdir(), 'rejig-og-cards');
  mkdirSync(work, { recursive: true });
  mkdirSync(resolve(ROOT, 'assets/og'), { recursive: true });

  for (const cs of studies) {
    const src = resolve(work, `${cs.slug}.html`);
    const out = resolve(ROOT, 'assets/og', `case-${cs.slug}.png`);
    writeFileSync(src, cardHtml(cs, pathToFileURL(resolve(ROOT, cs.logo)).href));
    execFileSync(CHROME, [
      '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
      '--allow-file-access-from-files', '--force-device-scale-factor=1',
      '--window-size=1200,630', '--virtual-time-budget=5000',
      `--screenshot=${out}`, src,
    ], { stdio: 'ignore' });
    console.log(`✓ assets/og/case-${cs.slug}.png  →  ${cs.headline}`);
  }
  rmSync(work, { recursive: true, force: true });
  console.log(`\nDone. ${studies.length} card(s) rendered at 1200x630.`);
}
