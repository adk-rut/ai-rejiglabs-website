import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripCalLoader, toBookAttr, sweep } from '../scripts/cutover-booking.mjs';

const LOADER = `<body>
  <script src="js/main.js"></script>

  <!-- Cal.com Embed -->
  <script type="text/javascript">
    (function (C, A, L) { /* ... */ })(window, "https://app.cal.com/embed/embed.js", "init");
    Cal("init", "discovery", { origin: "https://cal.com" });
  </script>
  <script src="/js/site-chat.js" defer></script>
</body>`;

test('the loader block goes, the scripts around it stay', () => {
  const out = stripCalLoader(LOADER);
  assert.ok(!out.includes('cal.com'));
  assert.ok(out.includes('js/main.js'));
  assert.ok(out.includes('/js/site-chat.js'));
});

test('stripping is idempotent', () => {
  const once = stripCalLoader(LOADER);
  assert.equal(stripCalLoader(once), once);
});

test('an unbalanced block is left alone rather than eating the page', () => {
  const broken = '<body>\n  <!-- Cal.com Embed -->\n  <script>oops\n</body>';
  assert.equal(stripCalLoader(broken), broken);
});

test('the three cal attributes become one data-book, the button is otherwise untouched', () => {
  const btn = `<button data-cal-namespace="discovery" data-cal-link="rejiglabs/discovery" data-cal-config='{"layout":"month_view"}' class="btn"><span>Book a Discovery Call</span></button>`;
  assert.equal(
    toBookAttr(btn),
    `<button data-book class="btn"><span>Book a Discovery Call</span></button>`
  );
});

test('the case-studies script writes the attributes escaped; those convert too', () => {
  const js = `'<button data-cal-namespace="discovery" data-cal-link="rejiglabs/discovery" data-cal-config=\\'{"layout":"month_view"}\\' class="btn btn--filled">'`;
  assert.ok(toBookAttr(js).includes('<button data-book class="btn btn--filled">'));
});

test('a swept page keeps nothing of cal.com', () => {
  const page = LOADER.replace('<body>', `<body>\n  <button data-cal-namespace="discovery" data-cal-link="rejiglabs/discovery" data-cal-config='{"layout":"month_view"}' class="nav__cta">Get In Touch</button>`);
  const out = sweep(page);
  assert.ok(!/cal\.com/i.test(out));
  assert.ok(out.includes('data-book'));
  assert.equal(sweep(out), out);
});
