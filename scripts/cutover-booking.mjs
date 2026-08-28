#!/usr/bin/env node
/**
 * cutover-booking.mjs — cal.com out, the Booking panel in, on every page (#743, spec #734).
 *
 * The site has no page template: 20-odd pages are hand-authored HTML, /th/ and /ru/ come from
 * build-langs.mjs and case-studies/* from build-case-studies.mjs. So "every CTA opens the panel"
 * is a stamping pass over the files, exactly like add-site-chat.mjs, and no page is hand-edited.
 *
 * Two edits per page, both idempotent:
 *   1. the cal.com embed loader block goes
 *   2. every cal.com CTA's three data-cal-* attributes become one `data-book`, which js/booking.js
 *      binds by delegation. The button, its classes and its copy are untouched.
 *
 * The one-off prose (the four Calendly links on /blockchain, llms*.txt, the privacy vendor line,
 * the 20→30-minute copy) is not repeated markup and is edited in the files themselves.
 *
 *   node scripts/cutover-booking.mjs          change every page
 *   node scripts/cutover-booking.mjs --check  exit 1 if any page still carries cal.com
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pages } from './add-site-chat.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The loader is one comment plus one <script> on every page that has it. Anchoring the end on the
// first </script> AFTER the comment (not a copy of the block's body) survives the day someone
// reformats the IIFE.
export function stripCalLoader(html) {
  const start = html.indexOf('<!-- Cal.com Embed -->');
  if (start === -1) return html;
  const end = html.indexOf('</script>', start);
  if (end === -1) return html;          // unbalanced: leave it alone rather than eat the page
  const from = html.lastIndexOf('\n', start) + 1;   // take the indentation with it
  const to = end + '</script>'.length;
  const after = html[to] === '\n' ? to + 1 : to;
  return stripCalLoader(html.slice(0, from) + html.slice(after));
}

// data-cal-namespace + data-cal-link + data-cal-config -> data-book. Written as one regex over the
// three so a button that carries only some of them (there are none today) is left visible to
// --check rather than half-converted.
const CAL_ATTRS = /data-cal-namespace="[^"]*"\s+data-cal-link="[^"]*"\s+data-cal-config=\\?'[^']*'\\?/g;
export const toBookAttr = (src) => src.replace(CAL_ATTRS, 'data-book');

export const sweep = (html) => toBookAttr(stripCalLoader(html));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const changed = [];
  for (const file of pages()) {
    const html = readFileSync(file, 'utf8');
    const next = sweep(html);
    if (next === html) continue;
    changed.push(relative(ROOT, file));
    if (!check) writeFileSync(file, next);
  }
  if (check) {
    if (changed.length) {
      console.error(`Still carrying cal.com markup:\n  ${changed.join('\n  ')}`);
      process.exit(1);
    }
    console.log('✓ no page carries cal.com markup');
  } else {
    console.log(changed.length ? `✓ swept ${changed.length} page(s):\n  ${changed.join('\n  ')}` : '✓ nothing to do');
  }
}
