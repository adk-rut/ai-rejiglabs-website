/**
 * Rejig Labs — i18n Module
 * JSON-driven translation system. Supports EN, TH, RU.
 */
(() => {
  'use strict';

  var STORAGE_KEY = 'airejig_lang';
  var DEFAULT_LANG = 'en';
  var SUPPORTED = ['en', 'th', 'ru'];
  var translations = null;
  var _callbacks = [];

  // Resolve base path from script src
  var scripts = document.querySelectorAll('script[src]');
  var basePath = '';
  for (var i = 0; i < scripts.length; i++) {
    var src = scripts[i].getAttribute('src');
    if (src && src.indexOf('i18n.js') !== -1) {
      basePath = src.replace(/js\/i18n\.js.*$/, '');
      break;
    }
  }

  function getLang() {
    // A dedicated language URL (e.g. /th/) is the source of truth for that page,
    // so a Thai page stays Thai regardless of a returning visitor's saved choice.
    var path = location.pathname;
    for (var s = 0; s < SUPPORTED.length; s++) {
      if (path.indexOf('/' + SUPPORTED[s] + '/') === 0) return SUPPORTED[s];
    }
    var stored = localStorage.getItem(STORAGE_KEY);
    return (stored && SUPPORTED.indexOf(stored) !== -1) ? stored : DEFAULT_LANG;
  }

  function setLang(lang) {
    if (SUPPORTED.indexOf(lang) === -1) return;
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;
    applyTranslations(lang);
    updateToggles(lang);
    _callbacks.forEach(function (fn) { try { fn(lang); } catch(e) {} });
  }

  function applyTranslations(lang) {
    if (!translations) return;

    // data-i18n → textContent
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      var t = translations[key];
      if (t && t[lang]) el.textContent = t[lang];
      else if (t && t.en) el.textContent = t.en;
    });

    // data-i18n-html → innerHTML
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-html');
      var t = translations[key];
      if (t && t[lang]) el.innerHTML = t[lang];
      else if (t && t.en) el.innerHTML = t.en;
    });
  }

  function updateToggles(lang) {
    // Only target buttons inside .nav__lang containers
    document.querySelectorAll('.nav__lang button[data-lang]').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
    });
  }

  function init() {
    fetch(basePath + 'data/translations.json')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        translations = data;
        var lang = getLang();
        document.documentElement.lang = lang;
        applyTranslations(lang);
        updateToggles(lang);
      })
      .catch(function () {
        // Translations failed to load — page stays in English
      });

    // Click handler — only for language buttons inside .nav__lang
    document.addEventListener('click', function (e) {
      var langBtn = e.target.closest('.nav__lang button[data-lang]');
      if (!langBtn) return;
      e.preventDefault();
      var lang = langBtn.getAttribute('data-lang');
      // If this page has a dedicated URL for the chosen language, go there
      // (keeps URL and content in sync so each language stays crawlable).
      var urls = window.__i18nUrls;
      if (urls && urls[lang]) {
        try { localStorage.setItem(STORAGE_KEY, lang); } catch (e2) {}
        if (location.pathname !== urls[lang]) { location.href = urls[lang]; return; }
      }
      setLang(lang);
    });
  }

  // Expose for other scripts
  window.__i18n = {
    getLang: getLang,
    apply: function () {
      if (translations) applyTranslations(getLang());
    },
    onChange: function (fn) {
      _callbacks.push(fn);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
