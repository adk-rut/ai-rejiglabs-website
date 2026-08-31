#!/usr/bin/env node
/**
 * build-langs.mjs — the "printing machine".
 * Reads index.html + data/translations.json and stamps out a fully-baked,
 * crawlable Thai homepage at /th/index.html (Thai text in the HTML source,
 * Thai <title>/meta, canonical, hreflang, root-absolute asset paths).
 *
 * Run from anywhere:  node scripts/build-langs.mjs
 * Add a language: append to LANGS. Add a page: extend PAGES (needs seo keys).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://rejiglabs.com';

// lang code -> { dir: output subfolder }.  'en' is the source at root (not generated).
const LANGS = [{ code: 'th', dir: 'th' }, { code: 'ru', dir: 'ru' }];
// source page -> { seoTitleKey, seoDescKey }.  src is root-relative; a "<dir>/index.html"
// src produces the clean URL /<lang>/<dir>/.  Add a page by appending here.
const PAGES = [
  { src: 'index.html', seoTitle: 'seo_title', seoDesc: 'seo_desc' },
  { src: 'ai-chatbot/index.html', seoTitle: 'seo_title_chatbot', seoDesc: 'seo_desc_chatbot' },
];

const T = JSON.parse(readFileSync(resolve(ROOT, 'data/translations.json'), 'utf8'));

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Find the index of the </tag> that closes the element whose inner starts at `from`,
// accounting for nested same-name tags. Returns -1 if unbalanced.
export function findClose(html, from, tag) {
  const openRe = new RegExp('<' + tag + '(\\s|>|/)', 'ig');
  const closeRe = new RegExp('</' + tag + '\\s*>', 'ig');
  let depth = 1, i = from;
  while (true) {
    openRe.lastIndex = i; closeRe.lastIndex = i;
    const o = openRe.exec(html); const c = closeRe.exec(html);
    if (!c) return -1;
    if (o && o.index < c.index) { depth++; i = o.index + 1; }
    else { depth--; if (depth === 0) return c.index; i = c.index + 1; }
  }
}

// Replace inner content of every element carrying attr="key" with its `lang` translation.
function bakeAttr(html, attr, lang, isHtml) {
  // opening tag that has attr="<key>"; capture tag name + the key
  const re = new RegExp('<([a-zA-Z0-9]+)([^>]*\\s' + attr + '="([^"]+)")[^>]*>', 'g');
  const edits = [];
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1], key = m[3];
    const t = T[key] && (T[key][lang] || T[key].en);
    if (t == null) continue;
    const innerStart = m.index + m[0].length;
    const closeAt = findClose(html, innerStart, tag);
    if (closeAt === -1) continue;
    edits.push({ start: innerStart, end: closeAt, text: isHtml ? t : esc(t) });
  }
  // apply back-to-front so indices stay valid
  edits.sort((a, b) => b.start - a.start);
  for (const e of edits) html = html.slice(0, e.start) + e.text + html.slice(e.end);
  return html;
}

function buildPage(page, lang) {
  let html = readFileSync(resolve(ROOT, page.src), 'utf8');

  // 1) body text
  html = bakeAttr(html, 'data-i18n-html', lang.code, true);
  html = bakeAttr(html, 'data-i18n', lang.code, false);

  // 2) head: lang, title, description, canonical, og/twitter, og:url
  const title = T[page.seoTitle][lang.code];
  const desc = T[page.seoDesc][lang.code];
  // "ai-chatbot/index.html" -> clean URL /<lang>/ai-chatbot/ ; "index.html" -> /<lang>/
  const srcDir = page.src.replace(/index\.html$/, '');
  const url = ORIGIN + '/' + lang.dir + '/' + srcDir;
  html = html.replace(/<html lang="en">/, `<html lang="${lang.code}">`);
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
  html = html.replace(/(<meta name="description" content=")[^"]*(">)/, `$1${esc(desc)}$2`);
  html = html.replace(/(<meta property="og:title" content=")[^"]*(">)/, `$1${esc(title)}$2`);
  html = html.replace(/(<meta property="og:description" content=")[^"]*(">)/, `$1${esc(desc)}$2`);
  html = html.replace(/(<meta name="twitter:title" content=")[^"]*(">)/, `$1${esc(title)}$2`);
  html = html.replace(/(<meta name="twitter:description" content=")[^"]*(">)/, `$1${esc(desc)}$2`);
  html = html.replace(/(<meta property="og:url" content=")[^"]*(">)/, `$1${url}$2`);
  html = html.replace(/(<link rel="canonical" href=")[^"]*(">)/, `$1${url}$2`);

  // 3) paths: this page lives one folder deep, so make root-relative refs absolute
  html = html.replace(/((?:src|href)=")((?:css|js|assets|data|images)\/)/g, '$1/$2');
  html = html.replace(/(href=")([\w-]+\.html)(")/g, '$1/$2$3');

  // 4) Beem links: Thai visitors land on the Thai side of heybeem.com
  if (lang.code === 'th') html = html.replace(/href="https:\/\/heybeem\.com\/"/g, 'href="https://heybeem.com/th"');

  const outFile = resolve(ROOT, lang.dir, page.src);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, html);
  return { url, path: `${lang.dir}/${page.src}`, title };
}

// Only run the build when invoked directly (so tests can import the helpers).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const built = [];
  for (const lang of LANGS)
    for (const page of PAGES) built.push(buildPage(page, lang));

  for (const b of built) console.log(`✓ ${b.path}  →  ${b.title}`);
  console.log(`\nDone. ${built.length} page(s) generated. Remember to check sitemap.xml lists them.`);
}
