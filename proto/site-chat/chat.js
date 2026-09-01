/* Site chat widget — prototype. Scripted turns only: no model, no API. */
(function () {
  'use strict';

  var T = {
    en: {
      bubble: 'Ask Beem', role: 'Rejig Labs · AI front desk', placeholder: 'Type a message', placeholderRT: 'Reply to Rut',
      gateTitle: 'Hi, I\'m <em>Beem</em>.',
      gateSub: 'Rejig\'s AI front desk. Tell me who you are, then ask me anything about AI Front Desk, prices, or a Discovery call.',
      gateInlineTitle: 'Quick one before I answer.',
      gateInlineSub: 'Your name, email and phone, so the team can pick this up if I can\'t.',
      nameL: 'Name', emailL: 'Email', phoneL: 'Phone', phoneHint: 'Start with your country code: 66 for Thailand, not 0.', start: 'Start chatting', startInline: 'Continue',
      fine: 'No password, no newsletter. The team reads every chat.',
      greetNamed: 'Hi {name}. I\'m Beem, Rejig\'s AI front desk. Ask me anything, or pick one:',
      greetAnon: 'Hi, I\'m Beem, Rejig\'s AI front desk. Ask me anything, or pick one:',
      rtTag: 'Rut · Founder', rtJoined: 'Rut joined', booked: 'Discovery call booked',
      chips: { cost: 'What does AI Front Desk cost?', line: 'How does it handle LINE and phone?', see: 'Can I see it working?', book: 'Book a discovery call', human: 'Talk to Rut',
               tue: 'Tuesday afternoon', thu: 'Thursday morning', s1: 'Tue 2 Sep · 14:00', s2: 'Tue 2 Sep · 15:30', s3: 'Tue 2 Sep · 17:00' },
      a: {
        cost: ['The anchor is <b>฿30,000 a month</b> on a 12-month agreement, with setup from <b>฿50,000</b>. Most businesses start with a paid one-branch pilot at roughly <b>฿40,000 to ฿50,000</b> for the month including setup, credited against the annual when they expand.',
               'The final number depends on locations, channels, languages and integrations. Rut gives you a real number on a 30-minute Discovery call.'],
        line: ['It answers the phone in Thai, English or Russian, picks the language from the first sentence, checks live availability and books the slot on the call. On LINE it takes bookings, changes and cancellations and sends confirmations and reminders.',
               'Both write into the same calendar as your staff bookings, so availability stays honest.'],
        see:  ['Yes. There is a <a href="/ai-receptionist-barbershop/" target="_blank">recording of a real inbound call</a> being booked on the barbershop page, and the full Ducky Cutz case study on the site.',
               'The best version is a Discovery call, where Rut walks you through the live system.'],
        book: ['Happy to. It\'s free and about 30 minutes with Rut. What day and rough time suits you?'],
        day:  ['Tuesday afternoon I have these open (Bangkok time):'],
        slot: ['Done. The invite is in your inbox. Anything else before then?'],
        human: ['I\'ve flagged this for Rut. He\'ll reply here, usually within a few hours.'],
        free: ['That one I can\'t answer from what\'s published, so I\'ve flagged it for Rut. He\'ll reply here, usually within a few hours. In the meantime I can book you a Discovery call with him if you\'d like.']
      },
      rt: 'Hi {name}, Rut here. Saw your question on pricing for six branches. Short version: same stack as Ducky Cutz, so the retainer doesn\'t scale one-to-one with branches. Let\'s go through it on the call Tuesday.',
      cardP: '30 min · Google Meet · invite sent to {email}',
      vFree: 'Do you integrate with our POS?'
    },
    th: {
      bubble: 'คุยกับบีม', role: 'Rejig Labs · ผู้ช่วยหน้าร้าน AI', placeholder: 'พิมพ์ข้อความ', placeholderRT: 'ตอบรุจ',
      gateTitle: 'สวัสดีค่ะ <em>บีม</em>ค่ะ',
      gateSub: 'ผู้ช่วยหน้าร้าน AI ของ Rejig Labs บอกชื่อกับอีเมลไว้หน่อยนะคะ แล้วถามเรื่อง AI Front Desk ราคา หรือจองคอลได้เลยค่ะ',
      gateInlineTitle: 'ขอข้อมูลนิดนึงก่อนตอบนะคะ',
      gateInlineSub: 'ชื่อ อีเมล และเบอร์โทร เผื่อทีมงานต้องมาตอบต่อค่ะ',
      nameL: 'ชื่อ', emailL: 'อีเมล', phoneL: 'เบอร์โทร', phoneHint: 'ใส่รหัสประเทศก่อนนะคะ เช่น 66 แทน 0 นำหน้า', start: 'เริ่มแชท', startInline: 'ไปต่อ',
      fine: 'ไม่ต้องตั้งรหัสผ่าน ไม่มีสแปม ทีมงานอ่านทุกแชทค่ะ',
      greetNamed: 'สวัสดีค่ะคุณ{name} บีมค่ะ ผู้ช่วยหน้าร้าน AI ของ Rejig Labs ถามได้ทุกอย่างเลยค่ะ หรือเลือกจากนี้ก็ได้',
      greetAnon: 'สวัสดีค่ะ บีมค่ะ ผู้ช่วยหน้าร้าน AI ของ Rejig Labs ถามได้ทุกอย่างเลยค่ะ หรือเลือกจากนี้ก็ได้',
      rtTag: 'รุจ · ผู้ก่อตั้ง', rtJoined: 'รุจเข้าร่วมแชท', booked: 'จองคอลเรียบร้อย',
      chips: { cost: 'AI Front Desk ราคาเท่าไหร่', line: 'รับสายและตอบ LINE ยังไง', see: 'ขอดูตัวอย่างที่ใช้งานจริงได้ไหม', book: 'จองคอลคุยกับทีมงาน', human: 'ขอคุยกับรุจ',
               tue: 'อังคารบ่าย', thu: 'พฤหัสเช้า', s1: 'อ. 2 ก.ย. · 14:00', s2: 'อ. 2 ก.ย. · 15:30', s3: 'อ. 2 ก.ย. · 17:00' },
      a: {
        cost: ['ค่าบริการรายเดือนเริ่มต้นที่ <b>30,000 บาทต่อเดือน</b> สัญญา 12 เดือน ค่าติดตั้งและวางระบบเริ่มต้นที่ <b>50,000 บาท</b> ค่ะ ส่วนใหญ่จะเริ่มจากสาขาเดียวแบบทดลองใช้จริง ประมาณ <b>40,000 ถึง 50,000 บาท</b>สำหรับเดือนแรก รวมค่าติดตั้งแล้ว และหักคืนให้เมื่อขยายเป็นสัญญารายปีค่ะ',
               'ราคาจริงขึ้นอยู่กับจำนวนสาขา ช่องทางที่ใช้ ภาษา และระบบที่ต้องเชื่อมต่อ รุจจะให้ตัวเลขจริงตอนคุยกัน 30 นาทีค่ะ'],
        line: ['รับสายได้ทั้งไทย อังกฤษ และรัสเซีย ฟังจากประโยคแรกแล้วเลือกภาษาเอง เช็กคิวว่างแบบเรียลไทม์ แล้วจองให้เสร็จในสายเลยค่ะ ส่วน LINE รับจอง เลื่อน ยกเลิก และส่งยืนยันกับแจ้งเตือนให้ค่ะ',
               'ทั้งสองช่องทางลงปฏิทินเดียวกับที่พนักงานใช้ คิวเลยไม่ชนกันค่ะ'],
        see:  ['ได้ค่ะ มี<a href="/th/ai-receptionist-barbershop/" target="_blank">เสียงบันทึกสายจริง</a>ที่ระบบรับจองให้ในหน้าร้านตัดผม และเคสของ Ducky Cutz แบบเต็มบนเว็บค่ะ',
               'ถ้าอยากเห็นชัด ๆ จองคอลกับรุจได้เลย เขาจะพาดูระบบที่ใช้งานจริงค่ะ'],
        book: ['ได้เลยค่ะ คุยกันครั้งแรกฟรี ประมาณ 30 นาที กับรุจผู้ก่อตั้งโดยตรง สะดวกวันไหน ช่วงเวลาไหนคะ'],
        day:  ['อังคารบ่ายว่างช่วงนี้ค่ะ (เวลาไทย)'],
        slot: ['เรียบร้อยค่ะ ส่งคำเชิญไปที่อีเมลแล้ว มีอะไรถามเพิ่มก่อนถึงวันนัดไหมคะ'],
        human: ['ส่งเรื่องนี้ให้รุจแล้วนะคะ เขาจะตอบกลับตรงนี้ ปกติภายในไม่กี่ชั่วโมง'],
        free: ['เรื่องนี้ตอบเองไม่ได้ค่ะ ส่งให้รุจแล้วนะคะ เขาจะตอบกลับตรงนี้ ปกติภายในไม่กี่ชั่วโมง ระหว่างนี้ถ้าสนใจ จองเวลาคุยกับเขาให้เลยก็ได้นะคะ']
      },
      rt: 'สวัสดีครับคุณ{name} รุจครับ เห็นคำถามเรื่องราคาสำหรับหกสาขาแล้ว สั้น ๆ คือใช้ระบบเดียวกับ Ducky Cutz ค่ารายเดือนเลยไม่ได้คูณตามจำนวนสาขาตรง ๆ เดี๋ยวคุยรายละเอียดกันวันอังคารนะครับ',
      cardP: '30 นาที · Google Meet · ส่งคำเชิญไปที่ {email}',
      vFree: 'เชื่อมกับ POS ของร้านได้ไหม'
    }
  };

  var NEXT = { cost: ['book', 'line', 'human'], line: ['cost', 'see', 'book'], see: ['book', 'cost'], book: ['tue', 'thu'],
               tue: ['s1', 's2', 's3'], thu: ['s1', 's2', 's3'], s1: ['line', 'human'], s2: ['line', 'human'], s3: ['line', 'human'],
               human: [], free: ['book'] };

  var S = { lang: (document.documentElement.lang || 'en').slice(0, 2) === 'th' ? 'th' : 'en', variant: 'b', gate: 'after', name: '', email: '', gated: false, pending: null, instant: false };
  var VARIANTS = { a: 'A · circle', b: 'B · pill + label', c: 'C · avatar pill' };

  var $ = function (id) { return document.getElementById(id); };
  var rj = $('rj'), thread = $('rjThread'), chipsEl = $('rjChips'), input = $('rjInput');
  var t = function () { return T[S.lang]; };
  var fill = function (s) { return s.replace('{name}', S.name || 'there').replace('{email}', S.email || 'you@company.com'); };
  var wait = function (ms) { return S.instant ? Promise.resolve() : new Promise(function (r) { setTimeout(r, ms); }); };

  function applyLang() {
    rj.setAttribute('lang', S.lang);
    document.querySelectorAll('[data-t]').forEach(function (el) { var v = t()[el.dataset.t]; if (v) el.innerHTML = v; });
    input.placeholder = t()[input.dataset.p];
    document.querySelectorAll('#rjLang button').forEach(function (b) { b.classList.toggle('active', b.dataset.l === S.lang); });
    document.querySelectorAll('.pk [data-pk="lang"]').forEach(function (b) { b.classList.toggle('on', b.dataset.v === S.lang); });
    document.querySelectorAll('.pk [data-pk="gate"]').forEach(function (b) { b.classList.toggle('on', b.dataset.v === S.gate); });
    $('pkVariant').textContent = VARIANTS[S.variant];
  }

  function scroll() { thread.scrollTop = thread.scrollHeight; setTimeout(function () { thread.scrollTop = thread.scrollHeight; }, 50); }
  function el(cls, html) { var d = document.createElement('div'); d.className = cls; d.innerHTML = html; thread.appendChild(d); scroll(); return d; }
  function avJ(sm) { return '<span class="rj__av rj__av--j' + (sm ? ' rj__av--sm' : '') + '"><em>B</em></span>'; }
  function avRT(sm) { return '<span class="rj__av rj__av--rt' + (sm ? ' rj__av--sm' : '') + '"><img src="rut.jpg" alt="Rut"></span>'; }
  function msgV(text) { el('rj__msg rj__msg--v', '<div class="rj__bub">' + text + '</div>'); }
  function msgJ(html, cont) { el('rj__msg rj__msg--j' + (cont ? ' rj__msg--cont' : ''), avJ(true) + '<div class="rj__bub">' + html + '</div>'); }
  function msgRT(html) { el('rj__msg rj__msg--rt', avRT(true) + '<div class="rj__bub"><span class="rj__tag">' + t().rtTag + '</span>' + html + '</div>'); }
  function sys(html) { el('rj__sys', html); }
  function typing(ms) {
    if (S.instant) return Promise.resolve();
    var d = el('rj__msg rj__msg--j', avJ(true) + '<div class="rj__bub rj__typing"><i></i><i></i><i></i></div>');
    return wait(ms).then(function () { d.remove(); });
  }
  function setChips(keys) {
    chipsEl.innerHTML = '';
    keys.forEach(function (k) { var b = document.createElement('button'); b.className = 'rj__chip'; b.textContent = t().chips[k]; b.dataset.k = k; chipsEl.appendChild(b); });
    scroll();
  }
  function jasminSays(lines) {
    var p = Promise.resolve();
    lines.forEach(function (line, i) { p = p.then(function () { return typing(i ? 700 : 1000); }).then(function () { msgJ(fill(line), i > 0); }); });
    return p;
  }

  function greet() {
    thread.innerHTML = ''; chipsEl.innerHTML = '';
    rj.dataset.screen = 'chat';
    input.placeholder = t().placeholder;
    return typing(600).then(function () { msgJ(fill(S.gated ? t().greetNamed : t().greetAnon)); setChips(['cost', 'line', 'see', 'book']); });
  }

  // Phone: the field shows a fixed "+", keeps digits only, and nudges when the number starts with 0 (a local number without a country code).
  document.addEventListener('input', function (e) {
    var i = e.target; if (i.type !== 'tel') return;
    i.value = i.value.replace(/[^\d ]/g, '');
    i.closest('.rj__f').classList.toggle('rj__f--hint', /^0/.test(i.value));
  });

  function inlineGate(afterKey) {
    chipsEl.innerHTML = '';
    var f = document.createElement('form');
    f.className = 'rj__gate rj__gate--inline';
    f.innerHTML = '<h2 class="rj__gate-h">' + t().gateInlineTitle + '</h2><p class="rj__gate-p">' + t().gateInlineSub + '</p>' +
      '<label class="rj__f"><span>' + t().nameL + '</span><input type="text" required placeholder="Ella"></label>' +
      '<label class="rj__f"><span>' + t().emailL + '</span><input type="email" required placeholder="ella@duckycutz.com"></label>' +
      '<label class="rj__f"><span>' + t().phoneL + '</span><span class="rj__tel"><span class="rj__tel-plus">+</span><input type="tel" inputmode="tel" required placeholder="66 81 234 5678"></span><small class="rj__hint">' + t().phoneHint + '</small></label>' +
      '<button type="submit" class="rj__btn">' + t().startInline + '</button><p class="rj__fine">' + t().fine + '</p>';
    thread.appendChild(f); scroll();
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      S.name = f.querySelectorAll('input')[0].value; S.email = f.querySelectorAll('input')[1].value; S.gated = true;
      f.remove(); answer(afterKey);
    });
  }

  function answer(k) {
    if (!S.gated && S.gate === 'after') { S.pending = k; return inlineGate(k); }
    if (k === 'tue' || k === 'thu') {
      return jasminSays(t().a.day).then(function () { setChips(NEXT[k]); });
    }
    if (k === 's1' || k === 's2' || k === 's3') {
      return typing(1200).then(function () {
        el('rj__card', '<div class="rj__card-t"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11 3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>' + t().booked + '</div>' +
          '<div class="rj__card-h">Discovery call · ' + t().chips[k] + '</div><div class="rj__card-p">' + fill(t().cardP) + '</div>');
        return jasminSays(t().a.slot);
      }).then(function () { setChips(NEXT[k]); });
    }
    if (k === 'human' || k === 'free') {
      return jasminSays(t().a[k]).then(function () { setChips(NEXT[k]); return wait(2500); }).then(function () {
        sys(avRT() + t().rtJoined);
        return wait(1500);
      }).then(function () { msgRT(fill(t().rt)); input.placeholder = t().placeholderRT; setChips([]); });
    }
    return jasminSays(t().a[k]).then(function () { setChips(NEXT[k]); });
  }

  function pick(k) { msgV(t().chips[k]); chipsEl.innerHTML = ''; return answer(k); }

  // ---- mode / screens ----
  function open() { rj.dataset.mode = 'open'; rj.dataset.screen = (S.gate === 'first' && !S.gated) ? 'gate' : 'chat'; if (rj.dataset.screen === 'chat' && !thread.children.length) greet(); }
  function close() { rj.dataset.mode = 'closed'; }
  function expand(on) { if (window.innerWidth <= 640) return; rj.dataset.mode = on ? 'expanded' : 'open'; }

  $('rjBubble').addEventListener('click', open);
  (function () { // mobile sheet: drag the header down to close
    var y0 = null, head = document.querySelector('.rj__head'), panel = $('rjPanel');
    head.addEventListener('touchstart', function (e) { if (window.innerWidth <= 640) y0 = e.touches[0].clientY; }, { passive: true });
    head.addEventListener('touchmove', function (e) { if (y0 === null) return; var dy = Math.max(0, e.touches[0].clientY - y0); panel.style.transform = 'translateY(' + dy + 'px)'; panel.style.transition = 'none'; }, { passive: true });
    head.addEventListener('touchend', function (e) { if (y0 === null) return; var dy = e.changedTouches[0].clientY - y0; y0 = null; panel.style.transform = ''; panel.style.transition = ''; if (dy > 80) close(); });
  })();
  $('rjClose').addEventListener('click', close);
  $('rjExpand').addEventListener('click', function () { expand(rj.dataset.mode !== 'expanded'); });
  $('rjBackdrop').addEventListener('click', function () { expand(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { if (rj.dataset.mode === 'expanded') expand(false); else if (rj.dataset.mode === 'open') close(); } });

  $('rjGate').addEventListener('submit', function (e) {
    e.preventDefault(); S.name = $('rjName').value; S.email = $('rjEmail').value; S.gated = true; greet();
  });
  chipsEl.addEventListener('click', function (e) { var b = e.target.closest('.rj__chip'); if (b) pick(b.dataset.k); });
  $('rjCompose').addEventListener('submit', function (e) {
    e.preventDefault(); var v = input.value.trim(); if (!v) return; input.value = '';
    msgV(v); chipsEl.innerHTML = '';
    if (input.placeholder === t().placeholderRT) return; // RT has the thread now; the reply lands in GHL
    answer('free');
  });
  $('rjLang').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setLang(b.dataset.l); });

  function setLang(l) { S.lang = l; applyLang(); if (rj.dataset.screen === 'chat' && thread.children.length) greet(); }

  // ---- picker ----
  var pk = $('pk');
  $('pkHide').addEventListener('click', function () { pk.classList.toggle('hidden'); $('pkHide').textContent = pk.classList.contains('hidden') ? 'show' : 'hide'; });
  pk.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-pk]'); if (!b) return;
    var keys = Object.keys(VARIANTS), i = keys.indexOf(S.variant);
    switch (b.dataset.pk) {
      case 'prev': S.variant = keys[(i + keys.length - 1) % keys.length]; rj.dataset.variant = S.variant; applyLang(); break;
      case 'next': S.variant = keys[(i + 1) % keys.length]; rj.dataset.variant = S.variant; applyLang(); break;
      case 'gate': S.gate = b.dataset.v; rj.dataset.gate = S.gate; S.gated = false; thread.innerHTML = ''; applyLang(); if (rj.dataset.mode !== 'closed') open(); break;
      case 'lang': setLang(b.dataset.v); break;
      case 's': jump(b.dataset.v); break;
    }
  });

  // Jump straight to a state: replay the script with no delays, then play the last step live.
  function jump(state) {
    S.instant = true; thread.innerHTML = ''; chipsEl.innerHTML = ''; input.placeholder = t().placeholder;
    if (state === 'bubble') { S.instant = false; close(); return; }
    if (state === 'gate') { S.gated = false; S.gate = 'first'; rj.dataset.gate = 'first'; applyLang(); S.instant = false; open(); return; }
    S.name = S.name || 'Ella'; S.email = S.email || 'ella@duckycutz.com'; S.gated = true;
    rj.dataset.mode = rj.dataset.mode === 'expanded' ? 'expanded' : 'open'; rj.dataset.screen = 'chat';
    var steps = { chips: [], price: ['cost'], booking: ['cost', 'book', 'tue', 's1'], expand: ['cost', 'book', 'tue', 's1'], rt: ['cost', 'human'] }[state];
    var liveFrom = state === 'expand' ? steps.length : state === 'booking' ? 1 : steps.length - 1; // index of the first step played live
    if (!steps.length) S.instant = false;
    var p = greet();
    steps.forEach(function (k, i) { p = p.then(function () { if (i >= liveFrom) S.instant = false; return pick(k); }).then(function () { return wait(900); }); });
    p.then(function () { S.instant = false; if (state === 'expand') expand(true); });
  }

  applyLang();
})();
