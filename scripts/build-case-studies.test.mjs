// Self-check for the head baker. Run: node scripts/build-case-studies.test.mjs
import assert from 'node:assert';
import { buildPage } from './build-case-studies.mjs';

const SHELL = [
  '<head>',
  '<title>Case Study | Rejig Labs</title>',
  '<meta name="description" content="generic blurb">',
  '<meta property="og:title" content="Case Study | Rejig Labs">',
  '<meta property="og:description" content="generic blurb">',
  '<meta property="og:image" content="https://rejiglabs.com/assets/og/default.png">',
  '<meta name="twitter:title" content="Case Study | Rejig Labs">',
  '<meta name="twitter:description" content="generic blurb">',
  '<meta name="twitter:image" content="https://rejiglabs.com/assets/og/default.png">',
  '</head><body>page</body>',
].join('\n');

const CS = {
  slug: 'acme',
  client: 'Acme',
  industry: 'Widgets',
  headline: 'A "quoted" & <angled> headline',
  summary: '  Two   lines\n  of summary.  ',
};

const out = buildPage(SHELL, CS);

// The study's own identity is in the raw HTML, and the generic shell title is gone.
assert.ok(out.includes('<title>A &quot;quoted&quot; &amp; &lt;angled&gt; headline | Rejig Labs</title>'));
assert.ok(!out.includes('Case Study | Rejig Labs'));
assert.ok(out.includes('content="https://rejiglabs.com/assets/og/case-acme.png"'));
assert.ok(!out.includes('assets/og/default.png'));
assert.ok(out.includes('<link rel="canonical" href="https://rejiglabs.com/case-studies/acme">'));
assert.ok(out.includes('<meta property="og:url" content="https://rejiglabs.com/case-studies/acme">'));

// Summary is collapsed to one line in both description slots.
assert.ok(out.includes('<meta name="description" content="Two lines of summary.">'));
assert.ok(out.includes('<meta property="og:description" content="Two lines of summary.">'));

// JSON-LD is valid, and carries the study's image rather than the default.
const ld = JSON.parse(out.match(/id="cs-jsonld">([\s\S]*?)<\/script>/)[1]);
assert.strictEqual(ld.image, 'https://rejiglabs.com/assets/og/case-acme.png');
assert.strictEqual(ld.headline, 'Acme: A "quoted" & <angled> headline');
assert.strictEqual(ld.mainEntityOfPage['@id'], 'https://rejiglabs.com/case-studies/acme');

// The body survives untouched.
assert.ok(out.includes('<body>page</body>'));

console.log('ok — head tags are baked per study, generic shell title is replaced');
