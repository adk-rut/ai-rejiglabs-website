#!/usr/bin/env node
/**
 * add-site-chat.mjs — puts the Site chat tags on every page (#742, #743, spec #734).
 *
 * The site has no page template: 20-odd pages are hand-authored HTML and only /th/ and /ru/ are
 * generated (scripts/build-langs.mjs). So "one script tag on every page" is a stamping pass, not
 * an include — this file is the place it is decided, and no page is hand-edited.
 *
 * Idempotent: run it again after adding a page, or after build-langs regenerates /th/ and /ru/.
 *
 *   node scripts/add-site-chat.mjs          list what would change and change it
 *   node scripts/add-site-chat.mjs --check  exit 1 if any page is missing the tag
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Two tags, one install: the widget, and the Booking panel every CTA on the page opens (#743).
// booking.js first — a CTA click must not depend on the chat script having parsed.
export const TAGS = [
  '<script src="/js/booking.js" defer></script>',
  '<script src="/js/site-chat.js" defer></script>',
];

// Not every .html under the repo is a page of rejiglabs.com:
// - proto/      the prototype this widget was promoted from; it carries its own copy
// - deck/       standalone decks on deck.rejiglabs.com
// - onboarding-ducky-cutz/  a client deliverable in the client's own theme, not a Rejig page
// - node_modules, .git, .vercel  not ours
const SKIP_DIRS = new Set(['proto', 'deck', 'onboarding-ducky-cutz', 'node_modules', '.git', '.vercel', 'drawbridge', '.moat']);

export function pages(dir = ROOT, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) pages(full, out);
    } else if (name.endsWith('.html')) out.push(full);
  }
  return out;
}

// Before </body> so the widget mounts after the page's own markup exists. `defer` means the tag's
// position costs nothing either way, but a widget appended to a body that is already there is one
// less thing to reason about.
export function withTag(html) {
  for (const tag of TAGS) {
    const src = tag.match(/src="([^"]+)"/)[1];
    if (html.includes(src)) continue;
    const at = html.lastIndexOf('</body>');
    html = at === -1 ? html + '\n' + tag + '\n' : html.slice(0, at) + '  ' + tag + '\n' + html.slice(at);
  }
  return html;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const missing = [];
  for (const file of pages()) {
    const html = readFileSync(file, 'utf8');
    const next = withTag(html);
    if (next === html) continue;
    missing.push(relative(ROOT, file));
    if (!check) writeFileSync(file, next);
  }
  if (check) {
    if (missing.length) {
      console.error(`Missing a Site chat tag:\n  ${missing.join('\n  ')}`);
      process.exit(1);
    }
    console.log('✓ every page carries the Site chat tag');
  } else {
    console.log(missing.length ? `✓ tagged ${missing.length} page(s):\n  ${missing.join('\n  ')}` : '✓ nothing to do');
  }
}
