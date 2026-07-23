// Self-check for the nested-tag matcher. Run: node scripts/build-langs.test.mjs
import assert from 'node:assert';
import { findClose } from './build-langs.mjs';

// Simple leaf element: inner is "Services", close is the only </a>.
{
  const h = '<a data-i18n="x">Services</a>';
  const from = h.indexOf('>') + 1;
  assert.strictEqual(h.slice(from, findClose(h, from, 'a')), 'Services');
}

// Nested SAME-name tags must not fool the matcher (outer div closes at the last </div>).
{
  const h = '<div id="o">a<div>b</div>c</div>TAIL';
  const from = h.indexOf('>') + 1;
  const inner = h.slice(from, findClose(h, from, 'div'));
  assert.strictEqual(inner, 'a<div>b</div>c');
}

// data-i18n-html with a nested <em> (the real hero_h1 shape).
{
  const h = '<h1 data-i18n-html="h">talk.<br><em class="accent">deliver.</em></h1>';
  const from = h.indexOf('>') + 1;
  const inner = h.slice(from, findClose(h, from, 'h1'));
  assert.strictEqual(inner, 'talk.<br><em class="accent">deliver.</em>');
}

console.log('ok — findClose handles leaf, nested same-name, and inline-child cases');
