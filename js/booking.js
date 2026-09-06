/**
 * Booking panel — the Discovery call, booked on the page (#743, spec #734).
 *
 * One component, two homes:
 *   - inside the chat thread, opened by Beem's Book-a-call chip (`open({ mount })`)
 *   - in a same-page modal, opened by every site CTA (`[data-book]`, bound below)
 * GHL's own booking page is never shown and there is no iframe: days, times and the confirm
 * all come from /api/slots and /api/book, which is the same pair the chat uses.
 *
 * A visitor who already passed the Lead gate has a token in localStorage, so the panel asks for
 * nothing and books in one tap. Without a token it asks for the three details the gate would
 * have asked for, with the same "+" prefix and the same 0-nudge — booking from a CTA must not
 * feel like a different company from booking in the chat.
 *
 * Self-contained by design (own stylesheet, own tokens): a CTA on /blockchain loads neither
 * css/style.css nor the chat's stylesheet, and the panel has to look the same there.
 */
(function () {
  'use strict';

  var TOKEN_KEY = 'rejig_chat_token';   // minted by /api/gate, read by site-chat.js too
  var TZ = 'Asia/Bangkok';              // the calendar's timezone, and the only one shown

  var T = {
    en: {
      title: 'Book a Discovery call',
      sub: '30 min · Google Meet · times in Bangkok',
      loading: 'Finding open times…',
      none: 'No open times in the next few days. Email rut@rejiglabs.com and we will find one.',
      err: 'Could not load the calendar. Try again, or email rut@rejiglabs.com.',
      retry: 'Try again',
      pick: 'Pick a time',
      back: 'Back',
      confirm: 'Confirm this time',
      detailsTitle: 'Almost done.',
      detailsSub: 'Your name, email and phone, so we can send the invite and reach you.',
      nameL: 'Name', emailL: 'Email', phoneL: 'Phone',
      phoneHint: 'Start with your country code: 66 for Thailand, not 0.',
      fine: 'No password, no newsletter. The team reads every chat.',
      booking: 'Booking…',
      booked: 'Booked',
      bookedSub: 'The calendar invite with the Meet link is on its way to your email.',
      close: 'Close'
    },
    th: {
      title: 'จองคอลคุยกับทีมงาน',
      sub: '30 นาที · Google Meet · เวลาไทย',
      loading: 'กำลังดูเวลาที่ว่าง…',
      none: 'ช่วงนี้ไม่มีเวลาว่างค่ะ อีเมลมาที่ rut@rejiglabs.com เดี๋ยวเราหาเวลาให้',
      err: 'โหลดปฏิทินไม่สำเร็จค่ะ ลองใหม่อีกครั้ง หรืออีเมลไปที่ rut@rejiglabs.com',
      retry: 'ลองใหม่',
      pick: 'เลือกเวลา',
      back: 'ย้อนกลับ',
      confirm: 'ยืนยันเวลานี้',
      detailsTitle: 'อีกนิดเดียวค่ะ',
      detailsSub: 'ชื่อ อีเมล และเบอร์โทร เพื่อส่งคำเชิญและติดต่อกลับค่ะ',
      nameL: 'ชื่อ', emailL: 'อีเมล', phoneL: 'เบอร์โทร',
      phoneHint: 'ใส่รหัสประเทศก่อนนะคะ เช่น 66 แทน 0 นำหน้า',
      fine: 'ไม่ต้องตั้งรหัสผ่าน ไม่มีสแปม ทีมงานอ่านทุกแชทค่ะ',
      booking: 'กำลังจอง…',
      booked: 'จองเรียบร้อย',
      bookedSub: 'คำเชิญในปฏิทินพร้อมลิงก์ Google Meet กำลังส่งไปที่อีเมลของคุณค่ะ',
      close: 'ปิด'
    }
  };

  var IC = {
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>'
  };

  // The page decides the language; the chat passes its own, which may differ (header switch).
  // /ru/ has no Russian panel, so it opens in English — same rule as the widget.
  function pageLang() {
    return (document.documentElement.lang || 'en').slice(0, 2) === 'th' ? 'th' : 'en';
  }

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  var token = function () { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } };

  // One stylesheet for the whole component, injected once however many panels open.
  if (!document.querySelector('link[href="/css/booking.css"]')) {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/css/booking.css';
    document.head.appendChild(link);
  }

  function ga(name, extra) {
    if (typeof window.gtag !== 'function') return;
    var p = { page_location: location.href, chat_lang: (extra && extra.lang) || pageLang() };
    if (extra && extra.slot) p.slot = extra.slot;
    window.gtag('event', name, p);
  }

  // ---- slot times, in Bangkok ---------------------------------------------
  // Never getDay()/getHours(): a slot is an ISO instant and the browser's zone is the visitor's.
  function parts(iso, lang, opts) {
    return new Intl.DateTimeFormat(lang === 'th' ? 'th-TH-u-ca-gregory' : 'en-GB',
      Object.assign({ timeZone: TZ }, opts)).format(new Date(iso));
  }
  var dayKey = function (iso) { return parts(iso, 'en', { year: 'numeric', month: '2-digit', day: '2-digit' }); };
  var dayLabel = function (iso, lang) { return parts(iso, lang, { weekday: 'short', day: 'numeric', month: 'short' }); };
  var timeLabel = function (iso, lang) { return parts(iso, lang, { hour: '2-digit', minute: '2-digit', hour12: false }); };
  var fullLabel = function (iso, lang) { return dayLabel(iso, lang) + ', ' + timeLabel(iso, lang); };

  // [{ key, label, slots: [iso] }], oldest day first, times in order inside the day.
  function byDay(slots, lang) {
    var days = [], index = Object.create(null);
    (slots || []).slice().sort().forEach(function (iso) {
      if (!iso || isNaN(Date.parse(iso))) return;
      var k = dayKey(iso);
      if (!index[k]) { index[k] = { key: k, label: dayLabel(iso, lang), slots: [] }; days.push(index[k]); }
      index[k].slots.push(iso);
    });
    return days;
  }

  // ---- one panel ----------------------------------------------------------
  /**
   * open({ mount, lang, onBooked, onClose })
   *   mount   – render inline into this element (the chat thread). Omit for the CTA modal.
   *   onBooked({ slot, when }) – the chat draws its own Booked card; the modal shows its own.
   */
  function open(opts) {
    // A page can pre-set questions for every panel it opens (window.rejigBookingDefaults, set by
    // /blockchain). Explicit opts win.
    opts = Object.assign({}, window.rejigBookingDefaults || {}, opts || {});
    opts = opts || {};
    var lang = opts.lang === 'th' ? 'th' : (opts.lang === 'en' ? 'en' : pageLang());
    var t = T[lang];
    var inline = !!opts.mount;

    var root = document.createElement('div');
    root.className = 'rb' + (inline ? ' rb--inline' : '');
    root.setAttribute('lang', lang);
    root.innerHTML =
      '<div class="rb__head">' +
        '<button type="button" class="rb__ib rb__back" aria-label="' + esc(t.back) + '">' + IC.back + '</button>' +
        '<div class="rb__who"><div class="rb__title">' + esc(t.title) + '</div><div class="rb__sub">' + esc(t.sub) + '</div></div>' +
        (inline ? '' : '<button type="button" class="rb__ib rb__x" aria-label="' + esc(t.close) + '">' + IC.close + '</button>') +
      '</div>' +
      '<div class="rb__body" aria-live="polite"></div>';

    var body = root.querySelector('.rb__body');
    var back = root.querySelector('.rb__back');
    var overlay = null;
    var state = { days: [], day: null, slot: null };

    // ---- shell placement -------------------------------------------------
    if (inline) {
      opts.mount.appendChild(root);
    } else {
      overlay = document.createElement('div');
      overlay.className = 'rb-ov';
      overlay.innerHTML = '<div class="rb-ov__bd"></div>';
      overlay.appendChild(root);
      document.body.appendChild(overlay);
      // Read a layout property to flush the "from" styles, then add the class in the same tick:
      // the transition has a start state without waiting for a frame that an automated or
      // background tab may never paint.
      void overlay.offsetHeight;
      overlay.classList.add('rb-ov--in');
      document.documentElement.classList.add('rb-open');
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      root.setAttribute('aria-label', t.title);
      overlay.querySelector('.rb-ov__bd').addEventListener('click', close);
      root.querySelector('.rb__x').addEventListener('click', close);
      document.addEventListener('keydown', onKey);
    }

    function onKey(e) { if (e.key === 'Escape') close(); }

    function close() {
      if (!overlay) { root.remove(); if (opts.onClose) opts.onClose(); return; }
      document.removeEventListener('keydown', onKey);
      document.documentElement.classList.remove('rb-open');
      overlay.classList.remove('rb-ov--in');
      var gone = false;
      var drop = function () { if (gone) return; gone = true; overlay.remove(); if (opts.onClose) opts.onClose(); };
      overlay.addEventListener('transitionend', drop, { once: true });
      setTimeout(drop, 400);   // a display:none tab fires no transitionend
    }

    var showBack = function (on) { root.classList.toggle('rb--back', !!on); };
    // Inside the chat thread the panel changes height at every step (loading -> days -> form ->
    // booked). The thread does not follow on its own, so each render ends by pulling the panel
    // back into view. `block: end` and not `smooth`: an automated or background tab never paints
    // the frames a smooth scroll needs.
    var settle = function () { if (inline && root.scrollIntoView) root.scrollIntoView({ block: 'end' }); };
    back.addEventListener('click', function () { state.slot = null; renderDays(); });

    // ---- steps -----------------------------------------------------------
    function renderLoading() {
      showBack(false);
      body.innerHTML = '<div class="rb__wait"><span class="rb__spin"></span>' + esc(t.loading) + '</div>';
      settle();
    }

    function renderError(msg) {
      showBack(false);
      body.innerHTML = '<p class="rb__msg">' + esc(msg) + '</p>' +
        '<button type="button" class="rb__btn rb__retry">' + esc(t.retry) + '</button>';
      body.querySelector('.rb__retry').addEventListener('click', load);
      settle();
    }

    function renderDays() {
      showBack(false);
      if (!state.days.length) return renderError(t.none);
      if (!state.days.some(function (d) { return d.key === state.day; })) state.day = state.days[0].key;
      var day = state.days.filter(function (d) { return d.key === state.day; })[0];
      body.innerHTML =
        '<div class="rb__days" role="tablist">' + state.days.map(function (d) {
          return '<button type="button" class="rb__day' + (d.key === state.day ? ' is-on' : '') +
            '" role="tab" aria-selected="' + (d.key === state.day) + '" data-k="' + esc(d.key) + '">' +
            esc(d.label) + '</button>';
        }).join('') + '</div>' +
        '<div class="rb__label">' + esc(t.pick) + '</div>' +
        '<div class="rb__slots">' + day.slots.map(function (s, i) {
          return '<button type="button" class="rb__slot" style="--i:' + i + '" data-s="' + esc(s) + '">' +
            esc(timeLabel(s, lang)) + '</button>';
        }).join('') + '</div>';

      body.querySelector('.rb__days').addEventListener('click', function (e) {
        var b = e.target.closest('.rb__day');
        if (!b || b.dataset.k === state.day) return;
        state.day = b.dataset.k;
        renderDays();
      });
      body.querySelector('.rb__slots').addEventListener('click', function (e) {
        var b = e.target.closest('.rb__slot');
        if (!b) return;
        state.slot = b.dataset.s;
        renderConfirm();
      });
      settle();
    }

    // Gate-passed → one tap. Otherwise the same three fields as the gate, same nudge.
    function renderConfirm() {
      showBack(true);
      var known = !!token();
      body.innerHTML =
        '<div class="rb__chosen">' + IC.cal + '<div><div class="rb__chosen-h">' + esc(fullLabel(state.slot, lang)) + '</div>' +
          '<div class="rb__chosen-p">' + esc(t.sub) + '</div></div></div>' +
        (known ? '' :
          '<h3 class="rb__h">' + esc(t.detailsTitle) + '</h3>' +
          '<p class="rb__p">' + esc(t.detailsSub) + '</p>') +
        '<form class="rb__form">' +
          (known ? '' :
            '<label class="rb__f"><span>' + esc(t.nameL) + '</span><input type="text" name="name" autocomplete="name" required placeholder="Your name"></label>' +
            '<label class="rb__f"><span>' + esc(t.emailL) + '</span><input type="email" name="email" autocomplete="email" required placeholder="you@company.com"></label>' +
            '<label class="rb__f"><span>' + esc(t.phoneL) + '</span>' +
              '<span class="rb__tel"><span class="rb__tel-plus">+</span>' +
              '<input type="tel" name="phone" inputmode="tel" autocomplete="tel" required placeholder="66 81 234 5678"></span>' +
              '<small class="rb__hint">' + esc(t.phoneHint) + '</small></label>') +
          questionsHtml(opts.questions) +
          '<button type="submit" class="rb__btn">' + esc(t.confirm) + '</button>' +
          (known ? '' : '<p class="rb__fine">' + esc(t.fine) + '</p>') +
        '</form>';

      var form = body.querySelector('.rb__form');
      var tel = form.querySelector('input[type=tel]');
      if (tel) {
        // The "+" is furniture, so the field holds digits only; a Thai number typed with the
        // leading 0 is unreachable, and that is the one mistake worth naming.
        tel.addEventListener('input', function () {
          tel.value = tel.value.replace(/[^\d ]/g, '');
          tel.closest('.rb__f').classList.toggle('rb__f--hint', /^0/.test(tel.value));
        });
      }
      form.addEventListener('submit', function (e) { e.preventDefault(); confirm(form, tel); });
      settle();
      var first = form.querySelector('input');
      if (first) first.focus();
    }

    // [{ label, options?, required? }] → a select per option list, a textarea otherwise.
    function questionsHtml(qs) {
      if (!qs || !qs.length) return '';
      return qs.map(function (q, i) {
        var req = q.required ? ' required' : '';
        var field = q.options
          ? '<select name="q' + i + '"' + req + '><option value="" disabled selected>' + esc(q.placeholder || 'Choose one') + '</option>' +
              q.options.map(function (o) { return '<option value="' + esc(o) + '">' + esc(o) + '</option>'; }).join('') + '</select>'
          : '<textarea name="q' + i + '" rows="3"' + req + ' placeholder="' + esc(q.placeholder || '') + '"></textarea>';
        return '<label class="rb__f"><span>' + esc(q.label) + '</span>' + field + '</label>';
      }).join('');
    }

    function confirm(form, tel) {
      var btn = form.querySelector('.rb__btn');
      btn.disabled = true;
      btn.textContent = t.booking;
      var payload = { slot: state.slot, lang: lang, pageUrl: location.href };
      if (!token()) {
        payload.name = form.elements.name.value.trim();
        payload.email = form.elements.email.value.trim();
        payload.phone = '+' + tel.value.replace(/\D/g, '');
      }
      if (opts.questions && opts.questions.length) {
        payload.answers = {};
        opts.questions.forEach(function (q, i) {
          var v = (form.elements['q' + i].value || '').trim();
          if (v) payload.answers[q.label] = v;
        });
      }
      var headers = { 'Content-Type': 'application/json' };
      if (token()) headers.Authorization = 'Bearer ' + token();

      fetch('/api/book', { method: 'POST', headers: headers, body: JSON.stringify(payload) })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            if (!r.ok) { var e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
            return j;
          });
        })
        .then(function (j) {
          var when = j.when || fullLabel(state.slot, lang);
          ga('book_complete', { lang: lang, slot: state.slot });
          if (opts.onBooked) opts.onBooked({ slot: state.slot, when: when });
          renderBooked(when);
        })
        .catch(function (err) {
          // 401: the session's contact is gone from GHL. Drop the token and ask for the details.
          if (err && err.status === 401) {
            try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
            return renderConfirm();
          }
          btn.disabled = false;
          btn.textContent = t.confirm;
          var line = document.createElement('p');
          line.className = 'rb__err';
          line.textContent = (err && err.message) || t.err;
          form.insertBefore(line, btn);
          // The slot may simply have gone; the next list is the honest answer.
          load(true);
        });
    }

    function renderBooked(when) {
      showBack(false);
      body.innerHTML =
        '<div class="rb__done">' +
          '<div class="rb__done-ic">' + IC.cal + '</div>' +
          '<div class="rb__done-h">' + esc(t.booked) + ' — ' + esc(when) + '</div>' +
          '<p class="rb__done-p">' + esc(t.bookedSub) + '</p>' +
          (inline ? '' : '<button type="button" class="rb__btn rb__done-x">' + esc(t.close) + '</button>') +
        '</div>';
      settle();
      var x = body.querySelector('.rb__done-x');
      if (x) x.addEventListener('click', close);
    }

    // ---- availability ----------------------------------------------------
    // `quiet` refreshes the list behind a failed confirm without wiping what the visitor sees.
    function load(quiet) {
      if (!quiet) renderLoading();
      fetch('/api/slots')
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('slots')); })
        .then(function (j) {
          state.days = byDay(j.slots, lang);
          if (!quiet) renderDays();
        })
        .catch(function () { if (!quiet) renderError(t.err); });
    }

    ga('book_click', { lang: lang });
    load();
    return { close: close, el: root };
  }

  // ---- every CTA on the page ----------------------------------------------
  // Delegated, so a CTA the case-studies script renders after load is bound too.
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-book]');
    if (!b) return;
    e.preventDefault();
    open({});
  });

  window.rejigBooking = { open: open, byDay: byDay };
})();
