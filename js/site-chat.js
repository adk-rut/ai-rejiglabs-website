/**
 * Site chat — Beem, Rejig's AI front desk (#742, spec #734).
 *
 * The prototype at proto/site-chat/ shipped for real: same states, same markup, same brand,
 * but every answer now comes from the handlers in api/ (#735-#741) instead of a script.
 *
 * One script tag per page is the whole install. This file injects its own stylesheet and its own
 * DOM, so a page needs no markup and no <link> of its own.
 *
 * State the browser holds: a signed token in localStorage and nothing else. The transcript is the
 * GHL conversation, read back through /api/thread — which is also how Rut's Telegram replies
 * (the Takeover) arrive.
 *
 * API paths are relative on purpose: a Vercel preview then talks to its OWN functions.
 */
(function () {
  'use strict';

  var TOKEN_KEY = 'rejig_chat_token';
  var LANG_KEY = 'rejig_chat_lang';
  var MAX_CHARS = 500;          // matches MAX_CHARS in lib/run-turn.js
  var POLL_OPEN = 5000;         // spec #734: 5 s while the chat is open
  var POLL_IDLE = 15000;        // 15 s while it is closed

  // Copy that is the visitor's, not the model's. The four starter chips and the phone nudge are
  // verbatim from knowledge/site-chat-knowledge.md and the spec — do not paraphrase either.
  var T = {
    en: {
      bubble: 'Ask Beem',
      role: 'Rejig Labs · AI front desk',
      placeholder: 'Type a message',
      gateTitle: 'Quick one before I answer.',
      gateSub: 'Your name, email and phone, so the team can pick this up if I can\'t.',
      nameL: 'Name', emailL: 'Email', phoneL: 'Phone',
      phoneHint: 'Start with your country code: 66 for Thailand, not 0.',
      cont: 'Continue',
      fine: 'No password, no newsletter. The team reads every chat.',
      greet: 'Hi, I\'m Beem, Rejig\'s AI front desk. Ask me anything, or pick one:',
      rtTag: 'Rut · Founder', rtJoined: 'Rut joined', booked: 'Discovery call booked',
      err: 'Something went wrong on our side. Try again, or email rut@rejiglabs.com.',
      chips: {
        cost: 'What does AI Front Desk cost?',
        line: 'How does it handle LINE and phone?',
        see: 'Can I see it working?',
        book: 'Book a discovery call'
      }
    },
    th: {
      bubble: 'คุยกับบีม',
      role: 'Rejig Labs · ผู้ช่วยหน้าร้าน AI',
      placeholder: 'พิมพ์ข้อความ',
      gateTitle: 'ขอข้อมูลนิดนึงก่อนตอบนะคะ',
      gateSub: 'ชื่อ อีเมล และเบอร์โทร เผื่อทีมงานต้องมาตอบต่อค่ะ',
      nameL: 'ชื่อ', emailL: 'อีเมล', phoneL: 'เบอร์โทร',
      phoneHint: 'ใส่รหัสประเทศก่อนนะคะ เช่น 66 แทน 0 นำหน้า',
      cont: 'ไปต่อ',
      fine: 'ไม่ต้องตั้งรหัสผ่าน ไม่มีสแปม ทีมงานอ่านทุกแชทค่ะ',
      greet: 'สวัสดีค่ะ บีมค่ะ ผู้ช่วยหน้าร้าน AI ของ Rejig Labs ถามได้ทุกอย่างเลยค่ะ หรือเลือกจากนี้ก็ได้',
      rtTag: 'รุจ · ผู้ก่อตั้ง', rtJoined: 'รุจเข้าร่วมแชท', booked: 'จองคอลเรียบร้อย',
      err: 'ระบบขัดข้องค่ะ ลองใหม่อีกครั้ง หรืออีเมลไปที่ rut@rejiglabs.com ได้เลยค่ะ',
      chips: {
        cost: 'AI Front Desk ราคาเท่าไหร่',
        line: 'รับสายและตอบ LINE ยังไง',
        see: 'ขอดูตัวอย่างที่ใช้งานจริงได้ไหม',
        book: 'จองคอลคุยกับทีมงาน'
      }
    }
  };

  // The page decides the language; the header switch overrides it and that choice sticks.
  // A /ru/ page has no Russian Beem, so it opens in English.
  var pageLang = (document.documentElement.lang || 'en').slice(0, 2) === 'th' ? 'th' : 'en';
  var S = {
    lang: (function () { try { return localStorage.getItem(LANG_KEY); } catch (e) { return null; } })() || pageLang,
    token: (function () { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } })() || '',
    cursor: 0, started: false, busy: false, lastWho: '', polling: null, opened: false
  };
  if (S.lang !== 'th') S.lang = 'en';
  var t = function () { return T[S.lang]; };

  var store = function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} };

  // ---- shell -------------------------------------------------------------
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/site-chat.css';
  document.head.appendChild(link);

  var IC = {
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 0 1 4 11.5 8.4 8.4 0 0 1 12.5 3a8.4 8.4 0 0 1 8.5 8.5z"/></svg>',
    max: '<svg class="ic-max" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>',
    min: '<svg class="ic-min" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>'
  };

  var rj = document.createElement('div');
  rj.id = 'rj';
  rj.className = 'rj';
  rj.setAttribute('data-mode', 'closed');
  rj.setAttribute('lang', S.lang);
  rj.innerHTML =
    '<button class="rj__bubble" id="rjBubble" aria-label="Chat with Beem">' + IC.chat +
      '<span class="rj__bubble-label" data-t="bubble"></span><span class="rj__bubble-dot"></span></button>' +
    '<div class="rj__backdrop" id="rjBackdrop"></div>' +
    '<section class="rj__panel" id="rjPanel" role="dialog" aria-label="Chat with Beem" aria-modal="false">' +
      '<header class="rj__head">' +
        '<span class="rj__av rj__av--j"><em>B</em></span>' +
        '<div class="rj__who"><div class="rj__name">Beem</div><div class="rj__role" data-t="role"></div></div>' +
        '<div class="rj__lang" id="rjLang"><button type="button" data-l="en">EN</button><button type="button" data-l="th">TH</button></div>' +
        '<button class="rj__ib rj__expand" id="rjExpand" aria-label="Expand">' + IC.max + IC.min + '</button>' +
        '<button class="rj__ib rj__close" id="rjClose" aria-label="Close">' + IC.close + '</button>' +
      '</header>' +
      '<div class="rj__body"><div class="rj__thread" id="rjThread"></div></div>' +
      '<footer class="rj__foot">' +
        '<div class="rj__chips" id="rjChips"></div>' +
        '<form class="rj__compose" id="rjCompose">' +
          '<input type="text" id="rjInput" maxlength="' + MAX_CHARS + '" autocomplete="off">' +
          '<button type="submit" class="rj__send" aria-label="Send">' + IC.send + '</button>' +
        '</form>' +
      '</footer>' +
    '</section>';
  document.body.appendChild(rj);

  var $ = function (id) { return document.getElementById(id); };
  var thread = $('rjThread'), chipsEl = $('rjChips'), input = $('rjInput'), panel = $('rjPanel');

  // ---- analytics ---------------------------------------------------------
  // GA4 is already on the page (G-1BB5D5KCXM) with Consent Mode; if a visitor declined, gtag
  // simply drops the event. Nothing here loads a tag of its own.
  function ga(name) {
    if (typeof window.gtag !== 'function') return;
    window.gtag('event', name, { page_location: location.href, chat_lang: S.lang });
  }

  // ---- rendering ---------------------------------------------------------
  function scroll() {
    thread.scrollTop = thread.scrollHeight;
    setTimeout(function () { thread.scrollTop = thread.scrollHeight; }, 50);
  }
  function el(cls, html) {
    var d = document.createElement('div');
    d.className = cls;
    d.innerHTML = html;
    thread.appendChild(d);
    scroll();
    return d;
  }
  var esc = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  var avJ = '<span class="rj__av rj__av--j rj__av--sm"><em>B</em></span>';
  var avRT = '<span class="rj__av rj__av--rt rj__av--sm"><img src="/assets/rut.jpg" alt="Rut" width="26" height="26"></span>';

  // Every row the widget shows goes through here, whether it came from a fetch response or from
  // the poll, so the "Rut joined" divider is decided in exactly one place.
  function render(who, text) {
    if (who === 'visitor') el('rj__msg rj__msg--v', '<div class="rj__bub">' + esc(text) + '</div>');
    else if (who === 'rut') {
      if (S.lastWho !== 'rut') el('rj__sys', avRT.replace(' rj__av--sm', '') + esc(t().rtJoined));
      el('rj__msg rj__msg--rt', avRT + '<div class="rj__bub"><span class="rj__tag">' + esc(t().rtTag) + '</span>' + esc(text) + '</div>');
    } else el('rj__msg rj__msg--j', avJ + '<div class="rj__bub">' + esc(text) + '</div>');
    S.lastWho = who;
  }

  // A row we rendered ourselves comes back from the poll a few seconds later. Counts, not a set:
  // a visitor who says "yes" twice must see it twice.
  var pending = Object.create(null);   // reset on a gate pass, see gate()
  var key = function (who, text) { return who + '|' + text; };
  function mine(who, text) {
    text = String(text).trim();
    var k = key(who, text);
    pending[k] = (pending[k] || 0) + 1;
    render(who, text);
  }
  function alreadyShown(who, text) {
    var k = key(who, text);
    if (!pending[k]) return false;
    pending[k]--;
    return true;
  }

  function sys(html, cls) { el('rj__sys' + (cls ? ' ' + cls : ''), html); }

  function typing(on) {
    var d = document.getElementById('rjTyping');
    if (!on) { if (d) d.remove(); return; }
    if (d) return;
    var n = el('rj__msg rj__msg--j', avJ + '<div class="rj__bub rj__typing"><i></i><i></i><i></i></div>');
    n.id = 'rjTyping';
  }

  function bookedCard(when) {
    el('rj__card', '<div class="rj__card-t">' + IC.cal + esc(t().booked) + '</div>' +
      '<div class="rj__card-h">Discovery call · ' + esc(when) + '</div>' +
      '<div class="rj__card-p">30 min · Google Meet</div>');
  }

  // Before the gate: the four starter chips. After it: the Book-a-call chip stays put, which is
  // what an Escalation needs and costs nothing the rest of the time.
  function setChips() {
    chipsEl.innerHTML = '';
    var keys = S.token ? ['book'] : ['cost', 'line', 'see', 'book'];
    keys.forEach(function (k) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'rj__chip';
      b.textContent = t().chips[k];
      b.dataset.k = k;
      chipsEl.appendChild(b);
    });
  }

  function applyLang() {
    rj.setAttribute('lang', S.lang);
    rj.querySelectorAll('[data-t]').forEach(function (n) { n.textContent = t()[n.dataset.t]; });
    input.placeholder = t().placeholder;
    rj.querySelectorAll('#rjLang button').forEach(function (b) { b.classList.toggle('active', b.dataset.l === S.lang); });
    setChips();
  }

  // ---- api ---------------------------------------------------------------
  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (S.token) headers.Authorization = 'Bearer ' + S.token;
    return fetch(path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
        return j;
      });
    });
  }

  function saveToken(tok) {
    if (!tok) return;
    S.token = tok;
    store(TOKEN_KEY, tok);
  }

  // ---- the Lead gate, inline in the thread --------------------------------
  function gate(pendingText) {
    var f = document.createElement('form');
    f.className = 'rj__gate';
    f.innerHTML =
      '<h2 class="rj__gate-h">' + esc(t().gateTitle) + '</h2>' +
      '<p class="rj__gate-p">' + esc(t().gateSub) + '</p>' +
      '<label class="rj__f"><span>' + esc(t().nameL) + '</span><input type="text" name="name" autocomplete="name" required placeholder="Your name"></label>' +
      '<label class="rj__f"><span>' + esc(t().emailL) + '</span><input type="email" name="email" autocomplete="email" required placeholder="you@company.com"></label>' +
      '<label class="rj__f"><span>' + esc(t().phoneL) + '</span>' +
        '<span class="rj__tel"><span class="rj__tel-plus">+</span>' +
        '<input type="tel" name="phone" inputmode="tel" autocomplete="tel" required placeholder="66 81 234 5678"></span>' +
        '<small class="rj__hint">' + esc(t().phoneHint) + '</small></label>' +
      '<button type="submit" class="rj__btn">' + esc(t().cont) + '</button>' +
      '<p class="rj__fine">' + esc(t().fine) + '</p>';
    thread.appendChild(f);
    scroll();

    // The "+" is furniture, so the field itself holds digits only, and a leading 0 is the one
    // mistake worth naming: a Thai number typed the way it is spoken is unreachable.
    var tel = f.querySelector('input[type=tel]');
    tel.addEventListener('input', function () {
      tel.value = tel.value.replace(/[^\d ]/g, '');
      tel.closest('.rj__f').classList.toggle('rj__f--hint', /^0/.test(tel.value));
    });

    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = f.querySelector('.rj__btn');
      btn.disabled = true;
      api('/api/gate', {
        method: 'POST',
        body: {
          name: f.elements.name.value.trim(),
          email: f.elements.email.value.trim(),
          phone: '+' + tel.value.replace(/\D/g, ''),
          lang: S.lang,
          pageUrl: location.href
        }
      }).then(function (j) {
        saveToken(j.token);
        ga('gate_pass');
        f.remove();
        setChips();
        // The token is new but the CONTACT may not be: GHL matches on email, so a visitor who
        // cleared this browser walks back into their old thread. Restore it first, then re-say
        // the line that opened the gate, or the history lands underneath it.
        thread.innerHTML = '';
        S.lastWho = '';
        pending = Object.create(null);
        render('jasmin', t().greet);
        poll().then(function () {
          mine('visitor', pendingText);
          send(pendingText, true);
        });
      }).catch(function () {
        btn.disabled = false;
        sys(esc(t().err), 'rj__err');
      });
    });
    f.querySelector('input').focus();
  }

  // ---- turns -------------------------------------------------------------
  function send(text, alreadyRendered) {
    text = String(text || '').trim().slice(0, MAX_CHARS);
    if (!text || S.busy) return;
    if (!alreadyRendered) mine('visitor', text);
    if (!S.token) { chipsEl.innerHTML = ''; return gate(text); }

    S.busy = true;
    rj.setAttribute('data-busy', '1');
    typing(true);
    api('/api/turn', { method: 'POST', body: { text: text, lang: S.lang, pageUrl: location.href } })
      .then(function (j) {
        typing(false);
        saveToken(j.token);
        // A Standdown returns no reply on purpose: Rut owns the thread and his line arrives on
        // the next poll. Saying anything here would be Beem talking over him.
        if (j.reply) mine('jasmin', j.reply);
        if (j.booked && j.booked.when) bookedCard(j.booked.when);
        startPolling();
      })
      .catch(function () {
        typing(false);
        sys(esc(t().err), 'rj__err');
      })
      .then(function () {
        S.busy = false;
        rj.removeAttribute('data-busy');
      });
  }

  // ---- the thread poll: returning visitors, and Rut's Takeover -------------
  function poll() {
    if (!S.token) return;
    return api('/api/thread?since=' + S.cursor).then(function (j) {
      S.cursor = j.cursor || S.cursor;
      (j.messages || []).forEach(function (m) {
        var text = String(m.text || '').trim();
        if (!text || alreadyShown(m.who, text)) return;
        render(m.who, text);
      });
    }).catch(function () {});
  }

  function startPolling() {
    if (S.polling) clearTimeout(S.polling);
    var tick = function () {
      poll().then(function () {
        S.polling = setTimeout(tick, rj.getAttribute('data-mode') === 'closed' ? POLL_IDLE : POLL_OPEN);
      });
    };
    S.polling = setTimeout(tick, rj.getAttribute('data-mode') === 'closed' ? POLL_IDLE : POLL_OPEN);
  }

  // ---- open / close / expand ----------------------------------------------
  // The cookie banner (js/consent.js) sits at z-index 2147483000, above everything. Rather than
  // reach into that file, flag the state on <html> and let this widget's own stylesheet stand the
  // banner down while the chat is up; it comes straight back on close.
  function mode(m) {
    rj.setAttribute('data-mode', m);
    document.documentElement.classList.toggle('rj-open', m !== 'closed');
  }

  function open() {
    mode('open');
    if (!S.opened) { S.opened = true; ga('chat_start'); }
    if (S.started) return;
    S.started = true;
    // The greeting is ours, not GHL's — it is never a row in the conversation, so it opens every
    // thread, fresh or restored, and the restore appends underneath it.
    render('jasmin', t().greet);
    setChips();
    if (S.token) poll().then(startPolling);
  }
  function close() { mode('closed'); }
  function expand(on) {
    if (window.innerWidth <= 640) return;
    mode(on ? 'expanded' : 'open');
  }

  $('rjBubble').addEventListener('click', open);
  $('rjClose').addEventListener('click', close);
  $('rjExpand').addEventListener('click', function () { expand(rj.getAttribute('data-mode') !== 'expanded'); });
  $('rjBackdrop').addEventListener('click', function () {
    if (rj.getAttribute('data-mode') === 'expanded') expand(false); else close();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (rj.getAttribute('data-mode') === 'expanded') expand(false);
    else if (rj.getAttribute('data-mode') === 'open') close();
  });

  chipsEl.addEventListener('click', function (e) {
    var b = e.target.closest('.rj__chip');
    if (!b) return;
    if (b.dataset.k === 'book') return window.rejigChat.openBooking();
    send(t().chips[b.dataset.k]);
  });

  $('rjCompose').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = input.value.trim();
    if (!v) return;
    input.value = '';
    send(v);
  });

  $('rjLang').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || b.dataset.l === S.lang) return;
    S.lang = b.dataset.l;
    store(LANG_KEY, S.lang);
    applyLang();
    // Only an untouched greeting is worth re-saying in the other language; a real thread stays
    // as it was said.
    if (S.started && thread.children.length === 1 && !S.token) {
      thread.innerHTML = '';
      S.lastWho = '';
      render('jasmin', t().greet);
    }
  });

  // Mobile bottom sheet: drag the header down to dismiss. Velocity, not distance alone — a
  // quick flick should close even if the finger never travelled far.
  (function () {
    var y0 = null, t0 = 0, head = rj.querySelector('.rj__head');
    head.addEventListener('touchstart', function (e) {
      if (window.innerWidth > 640) return;
      y0 = e.touches[0].clientY;
      t0 = Date.now();
    }, { passive: true });
    head.addEventListener('touchmove', function (e) {
      if (y0 === null) return;
      var dy = Math.max(0, e.touches[0].clientY - y0);
      panel.style.transform = 'translateY(' + dy + 'px)';
      panel.style.transition = 'none';
    }, { passive: true });
    head.addEventListener('touchend', function (e) {
      if (y0 === null) return;
      var dy = e.changedTouches[0].clientY - y0;
      var v = dy / Math.max(1, Date.now() - t0);
      y0 = null;
      panel.style.transform = '';
      panel.style.transition = '';
      if (dy > 80 || v > 0.11) close();
    });
  })();

  // The Booking panel (js/booking.js, #743) renders INSIDE the thread, not over it: booking from
  // the chip is part of the conversation, and a modal on top of the chat would hide it.
  window.rejigChat = {
    open: open,
    close: close,
    openBooking: function () {
      if (!S.started) open();
      if (!window.rejigBooking) { sys(esc(t().err), 'rj__err'); return; }
      // The Book-a-call chip stays on screen while the panel is open (an Escalation needs it
      // there). Tapping it again means "where did it go", not "give me a second one".
      var already = thread.querySelector('.rj__book');
      if (already) { already.scrollIntoView({ block: 'end' }); return; }
      var slot = document.createElement('div');
      slot.className = 'rj__book';
      thread.appendChild(slot);
      scroll();
      window.rejigBooking.open({
        mount: slot,
        lang: S.lang,
        // The panel's own Booked state sits in a box the thread scrolls past; the card is the
        // widget's own furniture, and is what a booking made by TALKING to Beem leaves behind.
        // One shape for both, so the thread reads the same however the call was booked.
        onBooked: function (b) {
          slot.remove();
          bookedCard(b.when);
        }
      });
    }
  };

  applyLang();
})();
