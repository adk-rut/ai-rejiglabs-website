/**
 * Rejig Labs — Cookie consent banner (Google Consent Mode v2).
 * Analytics stay denied (set in each page's head) until the visitor accepts.
 * Persuasive, not deceptive: Accept is prominent, Decline is one visible tap.
 */
(function () {
  'use strict';

  var KEY = 'rejig_consent';
  if (localStorage.getItem(KEY)) return; // already decided — stay quiet

  // Match the site's language: a /th/ or /ru/ URL wins, else the saved toggle choice.
  var lang = localStorage.getItem('airejig_lang');
  if (['th', 'ru'].indexOf(location.pathname.split('/')[1]) !== -1) lang = location.pathname.split('/')[1];
  lang = lang || 'en';
  var T = {
    en: {
      title: 'We use cookies to make this site better for you',
      body: 'A couple of anonymous cookies help us see which pages help visitors most, so we keep improving what works. No ads, no selling your data.',
      accept: 'Accept',
      decline: 'Decline',
      more: 'Privacy'
    },
    th: {
      title: 'เราใช้คุกกี้เพื่อทำให้เว็บไซต์นี้ดีขึ้นสำหรับคุณ',
      body: 'คุกกี้แบบไม่ระบุตัวตนไม่กี่ตัวช่วยให้เราเห็นว่าหน้าไหนมีประโยชน์กับผู้เข้าชมมากที่สุด เพื่อพัฒนาสิ่งที่ดีอยู่แล้วให้ดียิ่งขึ้น ไม่มีโฆษณา ไม่ขายข้อมูลของคุณ',
      accept: 'ยอมรับ',
      decline: 'ปฏิเสธ',
      more: 'ความเป็นส่วนตัว'
    },
    ru: {
      title: 'Мы используем cookie, чтобы сделать сайт удобнее для вас',
      body: 'Пара анонимных cookie помогает нам видеть, какие страницы полезнее всего для посетителей, и улучшать то, что работает. Без рекламы и без продажи ваших данных.',
      accept: 'Принять',
      decline: 'Отклонить',
      more: 'Конфиденциальность'
    }
  };
  var t = T[lang] || T.en;

  function set(consent) {
    localStorage.setItem(KEY, consent);
    if (consent === 'granted') {
      if (typeof gtag === 'function') {
        gtag('consent', 'update', {
          'ad_storage': 'granted', 'analytics_storage': 'granted',
          'ad_user_data': 'granted', 'ad_personalization': 'granted'
        });
      }
      // Microsoft Clarity: grant cookie consent if the loader is present.
      if (typeof window.clarity === 'function') { try { window.clarity('consent'); } catch (e) {} }
    }
    if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
  }

  var css = '.rl-consent{position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483000;'
    + 'max-width:440px;margin:0 auto;background:#fff;color:#0a0f1e;border:1px solid rgba(0,51,204,.15);'
    + 'border-radius:14px;box-shadow:0 12px 40px rgba(0,20,80,.18);padding:20px 20px 18px;'
    + 'font-family:"Instrument Sans",system-ui,sans-serif;transform:translateY(8px);opacity:0;'
    + 'transition:transform .35s cubic-bezier(.2,.7,.2,1),opacity .35s ease}'
    + '.rl-consent.in{transform:translateY(0);opacity:1}'
    + '.rl-consent__t{font-weight:600;font-size:15px;line-height:1.35;margin:0 0 6px}'
    + '.rl-consent__b{font-size:13px;line-height:1.5;color:#3a4256;margin:0 0 14px}'
    + '.rl-consent__b a{color:#0033cc;text-decoration:underline}'
    + '.rl-consent__row{display:flex;align-items:center;gap:12px}'
    + '.rl-consent__accept{flex:1;background:#0033cc;color:#fff;border:0;border-radius:9px;'
    + 'padding:12px 18px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;'
    + 'transition:background .15s ease}'
    + '.rl-consent__accept:hover{background:#0044ee}'
    + '.rl-consent__decline{background:none;border:0;color:#6b7280;font-size:13px;cursor:pointer;'
    + 'font-family:inherit;padding:8px 6px;text-decoration:underline}'
    + '.rl-consent__decline:hover{color:#0a0f1e}';

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var banner = document.createElement('div');
  banner.className = 'rl-consent';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', t.title);
  banner.innerHTML =
    '<p class="rl-consent__t">' + t.title + '</p>'
    + '<p class="rl-consent__b">' + t.body + ' <a href="/privacy.html">' + t.more + '</a></p>'
    + '<div class="rl-consent__row">'
    + '<button type="button" class="rl-consent__accept">' + t.accept + '</button>'
    + '<button type="button" class="rl-consent__decline">' + t.decline + '</button>'
    + '</div>';

  document.body.appendChild(banner);
  requestAnimationFrame(function () { banner.classList.add('in'); });

  banner.querySelector('.rl-consent__accept').addEventListener('click', function () { set('granted'); });
  banner.querySelector('.rl-consent__decline').addEventListener('click', function () { set('denied'); });
})();

// ponytail: no consent-management library. Consent Mode v2 + localStorage is the whole job.
// Add a CMP (Cookiebot/Osano) only if you need per-vendor granular toggles or a legal audit trail.
