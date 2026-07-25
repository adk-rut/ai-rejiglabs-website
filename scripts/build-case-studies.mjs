#!/usr/bin/env node
/**
 * build-case-studies.mjs — bakes per-study head tags into real files.
 *
 * Link-preview crawlers (LinkedIn, X, Slack, LINE) never run JavaScript, so the
 * tags js/case-studies.js injects at runtime are invisible to them. This reads
 * data/case-studies.json and stamps out case-studies/<slug>/index.html with the
 * study's own title, description, canonical, OG, Twitter and Article JSON-LD in
 * the raw HTML. The body is untouched, so behaviour after load is unchanged.
 *
 * Run from anywhere:  node scripts/build-case-studies.mjs
 * Adding a study is a JSON edit plus this command. No hand-written HTML.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://rejiglabs.com';

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function headFor(cs) {
  const url = `${ORIGIN}/case-studies/${cs.slug}`;
  const title = `${cs.headline} | Rejig Labs`;
  const desc = (cs.summary || '').replace(/\s+/g, ' ').trim();
  const img = `${ORIGIN}/assets/og/case-${cs.slug}.png`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: `${cs.client}: ${cs.headline || ''}`,
    description: desc,
    url,
    inLanguage: 'en',
    image: img,
    about: { '@type': 'Thing', name: `${cs.client} (${cs.industry || ''})` },
    author: { '@type': 'Organization', name: 'Rejig Labs', url: ORIGIN },
    publisher: {
      '@type': 'Organization',
      name: 'Rejig Labs',
      logo: { '@type': 'ImageObject', url: `${ORIGIN}/assets/logo.png` },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
  };
  return { url, title, desc, img, ld };
}

// A silent no-op here ships the generic shell tags, which is the exact bug this
// script exists to fix. Reformat the shell's head and the build fails loudly.
const sub = (html, re, replacement, what) => {
  const next = html.replace(re, replacement);
  if (next === html) throw new Error(`build-case-studies: no ${what} tag matched in case-study.html`);
  return next;
};

export function buildPage(shell, cs) {
  const { url, title, desc, img, ld } = headFor(cs);
  let html = shell;
  html = sub(html, /<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`, 'title');
  html = sub(html, /(<meta name="description" content=")[^"]*(">)/, `$1${esc(desc)}$2`, 'description');
  html = sub(html, /(<meta property="og:title" content=")[^"]*(">)/, `$1${esc(title)}$2`, 'og:title');
  html = sub(html, /(<meta property="og:description" content=")[^"]*(">)/, `$1${esc(desc)}$2`, 'og:description');
  html = sub(html, /(<meta property="og:image" content=")[^"]*(">)/, `$1${esc(img)}$2`, 'og:image');
  html = sub(html, /(<meta name="twitter:title" content=")[^"]*(">)/, `$1${esc(title)}$2`, 'twitter:title');
  html = sub(html, /(<meta name="twitter:description" content=")[^"]*(">)/, `$1${esc(desc)}$2`, 'twitter:description');
  html = sub(html, /(<meta name="twitter:image" content=")[^"]*(">)/, `$1${esc(img)}$2`, 'twitter:image');
  // The shell carries no canonical or og:url (it is one page serving every study).
  // JSON.stringify leaves "<" alone, so a headline containing "</script>" would
  // close the block early; < is valid JSON and inert in HTML.
  const jsonld = JSON.stringify(ld).replace(/</g, '\\u003c');
  const extra = [
    `  <link rel="canonical" href="${esc(url)}">`,
    `  <meta property="og:url" content="${esc(url)}">`,
    `  <script type="application/ld+json" id="cs-jsonld">${jsonld}</script>`,
    '</head>',
  ].join('\n');
  return sub(html, '</head>', extra, 'closing head');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const shell = readFileSync(resolve(ROOT, 'case-study.html'), 'utf8');
  const studies = JSON.parse(readFileSync(resolve(ROOT, 'data/case-studies.json'), 'utf8'))
    .filter((c) => c.published);

  for (const cs of studies) {
    // The slug becomes both a path segment and a public URL, so keep it boring.
    if (!/^[a-z0-9-]+$/.test(cs.slug)) throw new Error(`bad slug: ${cs.slug}`);
    const out = resolve(ROOT, 'case-studies', cs.slug, 'index.html');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, buildPage(shell, cs));
    console.log(`✓ case-studies/${cs.slug}/index.html  →  ${cs.headline}`);
  }
  console.log(`\nDone. ${studies.length} page(s) generated. Remember: sitemap.xml + an OG card per slug.`);
}
