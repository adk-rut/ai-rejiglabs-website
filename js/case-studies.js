/**
 * Rejig Labs — Case Studies Module
 * Renders card grids and full case study pages from data/case-studies.json
 *
 * Usage:
 *   Card grid:  <div class="case-studies" data-limit="3"></div>
 *   Full page:  <div id="case-study-page"></div>  (reads ?slug= from URL)
 */
(() => {
  'use strict';

  // Resolve path to JSON relative to this script's location
  const scripts = document.querySelectorAll('script[src]');
  let basePath = '';
  for (let i = 0; i < scripts.length; i++) {
    const src = scripts[i].getAttribute('src');
    if (src && src.indexOf('case-studies.js') !== -1) {
      basePath = src.replace(/js\/case-studies\.js.*$/, '');
      break;
    }
  }
  const DATA_URL = basePath + 'data/case-studies.json';

  // Cache
  let _data = null;

  function fetchData() {
    if (_data) return Promise.resolve(_data);
    return fetch(DATA_URL)
      .then(function (r) { return r.json(); })
      .then(function (d) { _data = d; return d; });
  }

  // ---- Evervault-style random string ----

  var CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  function randomString(len) {
    var r = '';
    for (var i = 0; i < len; i++) r += CHARS.charAt(Math.floor(Math.random() * CHARS.length));
    return r;
  }

  function initEvervaultCards(container) {
    var panels = container.querySelectorAll('.ev-card');
    panels.forEach(function (panel) {
      var chars = panel.querySelector('.ev-card__chars');
      var reveal = panel.querySelector('.ev-card__reveal');

      // Fill initial chars
      chars.textContent = randomString(800);

      panel.addEventListener('mousemove', function (e) {
        var rect = panel.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var y = e.clientY - rect.top;
        reveal.style.background = 'radial-gradient(250px at ' + x + 'px ' + y + 'px, rgba(0,85,255,0.45), transparent)';
        chars.style.WebkitMaskImage = 'radial-gradient(200px at ' + x + 'px ' + y + 'px, white, transparent)';
        chars.style.maskImage = 'radial-gradient(200px at ' + x + 'px ' + y + 'px, white, transparent)';
        chars.textContent = randomString(800);
      });

      panel.addEventListener('mouseleave', function () {
        reveal.style.background = 'transparent';
        chars.style.WebkitMaskImage = 'none';
        chars.style.maskImage = 'none';
      });
    });
  }

  // ---- i18n helper ----
  function lang() {
    return (window.__i18n && window.__i18n.getLang) ? window.__i18n.getLang() : 'en';
  }
  // Pick translated field if available, fallback to English
  function t(cs, field) {
    var l = lang();
    if (l !== 'en' && cs[field + '_' + l]) return cs[field + '_' + l];
    return cs[field];
  }
  function tStat(s) {
    var l = lang();
    if (l !== 'en' && s['label_' + l]) return s['label_' + l];
    return s.label;
  }
  var readText = { en: 'Read Case Study', th: 'ดูรายละเอียด', ru: 'Подробнее' };

  // ---- Card Grid ----

  function renderCard(cs) {
    var l = lang();
    var statsHtml = cs.stats.map(function (s) {
      return '<div class="cs-card__stat"><span class="cs-card__stat-val">' + s.value + '</span><span class="cs-card__stat-label">' + tStat(s) + '</span></div>';
    }).join('');

    return '<a href="/case-studies/' + cs.slug + '" class="cs-card" data-cs-card>' +
      '<div class="ev-card">' +
        '<div class="ev-card__chars"></div>' +
        '<div class="ev-card__reveal"></div>' +
        '<div class="ev-card__logo"><img src="' + basePath + (cs.logo || 'assets/logo.png') + '" alt="' + cs.client + '"></div>' +
      '</div>' +
      '<div class="cs-card__body">' +
        '<span class="cs-card__tag">' + (t(cs, 'industry') || cs.industry) + '</span>' +
        '<h3 class="cs-card__title">' + cs.client + ' <span class="cs-card__sep">|</span> ' + t(cs, 'headline') + '</h3>' +
        '<p class="cs-card__summary">' + t(cs, 'summary') + '</p>' +
        '<div class="cs-card__stats">' + statsHtml + '</div>' +
        '<span class="cs-card__link">' + (readText[l] || readText.en) + ' <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></span>' +
      '</div>' +
    '</a>';
  }

  function renderGrid(container) {
    fetchData().then(function (studies) {
      var published = studies.filter(function (s) { return s.published; });
      var limit = parseInt(container.getAttribute('data-limit')) || published.length;
      var items = published.slice(0, limit);

      var html = '<div class="cs-grid">' + items.map(renderCard).join('') + '</div>';
      container.innerHTML = html;

      // Init evervault hover effect
      initEvervaultCards(container);

      // Trigger entrance animations after render
      requestAnimationFrame(function () {
        var cards = container.querySelectorAll('[data-cs-card]');
        var observer = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            var idx = Array.from(cards).indexOf(entry.target);
            setTimeout(function () { entry.target.classList.add('in-view'); }, idx * 120);
            observer.unobserve(entry.target);
          });
        }, { threshold: 0.1 });
        cards.forEach(function (c) { observer.observe(c); });
      });
    });
  }

  // ---- Full Page ----

  // Resolve case-study slug from the pretty path (/case-studies/<slug>) first,
  // falling back to the legacy ?slug= query param.
  function resolveSlug() {
    var m = window.location.pathname.match(/\/case-studies\/([^\/?#]+)/);
    if (m && m[1]) return decodeURIComponent(m[1]);
    return new URLSearchParams(window.location.search).get('slug');
  }

  // Inject/replace a <head> tag (meta or link) by a CSS selector.
  function setHeadTag(selector, tag, attrs) {
    var el = document.head.querySelector(selector);
    if (!el) { el = document.createElement(tag); document.head.appendChild(el); }
    for (var k in attrs) { el.setAttribute(k, attrs[k]); }
    return el;
  }

  // Populate canonical, Open Graph, Twitter, and Article JSON-LD for one case study.
  function injectCaseStudyMeta(cs) {
    var url = 'https://rejiglabs.com/case-studies/' + cs.slug;
    var title = cs.client + ' | Case Study | Rejig Labs';
    var desc = (cs.summary || '').replace(/\s+/g, ' ').trim();
    // The study's own card, generated by scripts/build-og-cards.mjs.
    var img = 'https://rejiglabs.com/assets/og/case-' + cs.slug + '.png';

    setHeadTag('link[rel="canonical"]', 'link', { rel: 'canonical', href: url });
    setHeadTag('meta[property="og:url"]', 'meta', { property: 'og:url', content: url });
    setHeadTag('meta[property="og:title"]', 'meta', { property: 'og:title', content: title });
    setHeadTag('meta[property="og:description"]', 'meta', { property: 'og:description', content: desc });
    setHeadTag('meta[property="og:image"]', 'meta', { property: 'og:image', content: img });
    setHeadTag('meta[name="twitter:card"]', 'meta', { name: 'twitter:card', content: 'summary_large_image' });
    setHeadTag('meta[name="twitter:title"]', 'meta', { name: 'twitter:title', content: title });
    setHeadTag('meta[name="twitter:description"]', 'meta', { name: 'twitter:description', content: desc });
    setHeadTag('meta[name="twitter:image"]', 'meta', { name: 'twitter:image', content: img });

    var ld = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      'headline': cs.client + ': ' + (cs.headline || ''),
      'description': desc,
      'url': url,
      'inLanguage': 'en',
      'image': img,
      'about': { '@type': 'Thing', 'name': cs.client + ' (' + (cs.industry || '') + ')' },
      'author': { '@type': 'Organization', 'name': 'Rejig Labs', 'url': 'https://rejiglabs.com' },
      'publisher': {
        '@type': 'Organization',
        'name': 'Rejig Labs',
        'logo': { '@type': 'ImageObject', 'url': 'https://rejiglabs.com/assets/logo.png' }
      },
      'mainEntityOfPage': { '@type': 'WebPage', '@id': url }
    };
    var prev = document.getElementById('cs-jsonld');
    if (prev) prev.remove();
    var s = document.createElement('script');
    s.type = 'application/ld+json';
    s.id = 'cs-jsonld';
    s.textContent = JSON.stringify(ld);
    document.head.appendChild(s);
  }

  function renderFullPage(container) {
    var slug = resolveSlug();

    if (!slug) {
      container.innerHTML = '<div class="cs-page__not-found"><h2>Case study not found</h2><p>No case study specified.</p><a href="index.html#case-studies" class="btn"><span class="btn__text">Back to Home</span><span class="btn__hover">Back to Home</span><span class="btn__fill"></span></a></div>';
      return;
    }

    fetchData().then(function (studies) {
      var cs = null;
      for (var i = 0; i < studies.length; i++) {
        if (studies[i].slug === slug && studies[i].published) { cs = studies[i]; break; }
      }

      if (!cs) {
        var safeSlug = slug.replace(/[<>"'&]/g, function(c) { return '&#' + c.charCodeAt(0) + ';'; });
        container.innerHTML = '<div class="cs-page__not-found"><h2>Case study not found</h2><p>We couldn\'t find a case study matching "' + safeSlug + '".</p><a href="index.html#case-studies" class="btn"><span class="btn__text">Back to Home</span><span class="btn__hover">Back to Home</span><span class="btn__fill"></span></a></div>';
        return;
      }

      // Update page title + SEO/AI metadata (canonical, OG, Twitter, JSON-LD)
      document.title = cs.client + ' | Case Study | Rejig Labs';
      injectCaseStudyMeta(cs);

      var l = lang();
      var statsHtml = cs.stats.map(function (s) {
        return '<div class="cs-page__stat"><span class="cs-page__stat-val">' + s.value + '</span><span class="cs-page__stat-label">' + tStat(s) + '</span></div>';
      }).join('');

      // i18n labels for section headers
      var labels = {
        challenge: { en: 'The Challenge', th: 'ความท้าทาย', ru: 'Проблема' },
        solution: { en: 'What We Built', th: 'สิ่งที่เราสร้าง', ru: 'Что мы сделали' },
        results: { en: 'The Results', th: 'ผลลัพธ์', ru: 'Результаты' },
        cta: { en: 'Ready to see results <em class="accent">like this?</em>', th: 'พร้อมเห็นผลลัพธ์<em class="accent">แบบนี้</em>ไหม?', ru: 'Хотите <em class="accent">такие же результаты?</em>' },
        more: { en: 'More <em class="accent">Case Studies</em>', th: 'ผลงาน<em class="accent">อื่น ๆ</em>', ru: 'Ещё <em class="accent">кейсы</em>' },
        back: { en: 'Back', th: 'กลับ', ru: 'Назад' },
        site: { en: 'View the live site', th: 'ดูเว็บไซต์จริง', ru: 'Открыть сайт' },
        book: { en: 'Book a Discovery Call', th: 'นัดคุยฟรี', ru: 'Записаться на консультацию' }
      };
      function lb(key) { return labels[key][l] || labels[key].en; }

      // Categorised image gallery (optional)
      var galleryHtml = '';
      if (cs.gallery && cs.gallery.length) {
        galleryHtml = '<section class="cs-page__gallery">' + cs.gallery.map(function (g) {
          var items = (g.items || []).map(function (it) {
            var cap = t(it, 'caption');
            return '<figure class="cs-page__gallery-item"><img loading="lazy" src="' + it.src + '" alt="' + (cap || cs.client) + '">' +
              (cap ? '<figcaption>' + cap + '</figcaption>' : '') + '</figure>';
          }).join('');
          return '<div class="cs-page__gallery-group"><div class="cs-page__section-label">' + t(g, 'category') + '</div>' +
            '<div class="cs-page__gallery-grid' + (g.wide ? ' cs-page__gallery-grid--wide' : '') + '">' + items + '</div></div>';
        }).join('') + '</section>';
      }

      // Get other case studies for "More Case Studies" section
      var others = studies.filter(function (s) { return s.published && s.slug !== slug; }).slice(0, 2);
      var othersHtml = '';
      if (others.length > 0) {
        othersHtml = '<section class="cs-page__more"><h2>' + lb('more') + '</h2><div class="cs-grid cs-grid--2">' + others.map(renderCard).join('') + '</div></section>';
      }

      container.innerHTML =
        '<a href="index.html#case-studies" class="cs-page__back"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg> ' + lb('back') + '</a>' +

        '<section class="cs-page__hero">' +
          '<span class="cs-card__tag">' + t(cs, 'industry') + '</span>' +
          '<h1>' + cs.client + ' <span class="cs-card__sep">|</span> <em class="accent">' + t(cs, 'headline') + '</em></h1>' +
          '<p class="cs-page__hero-summary">' + t(cs, 'summary') + '</p>' +
          (cs.site ? '<a class="cs-page__site" href="' + cs.site + '" target="_blank" rel="noopener">' + lb('site') + ' <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7"/><path d="M7 7h10v10"/></svg></a>' : '') +
          '<div class="cs-page__stats">' + statsHtml + '</div>' +
        '</section>' +

        '<div class="cs-page__image"><img src="' + cs.image + '" alt="' + cs.client + '"></div>' +

        '<section class="cs-page__section">' +
          '<div class="cs-page__section-label">' + lb('challenge') + '</div>' +
          '<p>' + t(cs, 'challenge') + '</p>' +
        '</section>' +

        '<section class="cs-page__section">' +
          '<div class="cs-page__section-label">' + lb('solution') + '</div>' +
          '<p>' + t(cs, 'solution') + '</p>' +
        '</section>' +

        // Optional real-call player (cs.call = { src, label, note }). js/call-player.js mounts it.
        (cs.call ? '<section class="cs-page__section">' +
          '<div class="cs-page__section-label">' + (t(cs.call, 'label') || 'Hear it') + '</div>' +
          '<div data-call-player data-src="' + cs.call.src + '" data-cta=""></div>' +
        '</section>' : '') +

        // Optional extra sections, each with its own per-study label. Same markup
        // as the fixed ones above, so no new CSS.
        (Array.isArray(cs.sections) ? cs.sections.map(function (s) {
          return '<section class="cs-page__section">' +
            '<div class="cs-page__section-label">' + t(s, 'label') + '</div>' +
            '<p>' + t(s, 'body') + '</p>' +
          '</section>';
        }).join('') : '') +

        '<section class="cs-page__section">' +
          '<div class="cs-page__section-label">' + lb('results') + '</div>' +
          '<p>' + t(cs, 'results') + '</p>' +
        '</section>' +

        (cs.testimonial ? '<section class="cs-page__testimonial"><span class="cs-page__tst-mark">"</span><blockquote>' + (t(cs.testimonial, 'quote') || cs.testimonial.quote) + '</blockquote><cite>' + cs.testimonial.name + ', ' + cs.testimonial.title + '</cite></section>' : '') +

        '<section class="cs-page__cta">' +
          '<h2>' + lb('cta') + '</h2>' +
          '<button data-cal-namespace="discovery" data-cal-link="rejiglabs/discovery" data-cal-config=\'{"layout":"month_view"}\' class="btn btn--filled"><span class="btn__text">' + lb('book') + '</span><span class="btn__hover">' + lb('book') + ' <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></span><span class="btn__fill"></span></button>' +
        '</section>' +

        galleryHtml +

        othersHtml;

      // Init evervault on "more case studies" cards
      if (window.RejigCallPlayer) window.RejigCallPlayer.init();

      requestAnimationFrame(function () {
        initEvervaultCards(container);
        // Make cards visible immediately on full page
        container.querySelectorAll('[data-cs-card]').forEach(function (c) {
          c.classList.add('in-view');
        });
      });
    });
  }

  // ---- Hub page (/case-studies/) ----

  // Chip labels; the segment key on each study in the JSON picks its chip.
  var SEG_LABELS = {
    all: { en: 'Everything', th: 'ทั้งหมด', ru: 'Все' },
    local: { en: 'Local & service businesses', th: 'ธุรกิจท้องถิ่นและงานบริการ', ru: 'Локальный и сервисный бизнес' },
    platform: { en: 'Platforms & teams', th: 'แพลตฟอร์มและทีม', ru: 'Платформы и команды' }
  };
  var featuredRead = { en: 'Read the full story', th: 'อ่านเรื่องราวทั้งหมด', ru: 'Читать кейс полностью' };

  function renderHub(container) {
    fetchData().then(function (studies) {
      var l = lang();
      var published = studies.filter(function (s) { return s.published; });
      var featSlug = container.getAttribute('data-featured');
      var feat = null;
      published.forEach(function (s) { if (s.slug === featSlug) feat = s; });
      var rest = published.filter(function (s) { return s !== feat; });
      var active = container.getAttribute('data-filter') || 'all';

      var featHtml = '';
      if (feat) {
        var featStats = feat.stats.map(function (s) {
          return '<div class="cs-page__stat"><span class="cs-page__stat-val">' + s.value + '</span><span class="cs-page__stat-label">' + tStat(s) + '</span></div>';
        }).join('');
        featHtml =
          '<div class="cs-hub__feature">' +
            '<div class="cs-hub__feature-text">' +
              '<span class="cs-card__tag">' + t(feat, 'industry') + '</span>' +
              '<h2 class="cs-hub__feature-title"><a href="/case-studies/' + feat.slug + '">' + t(feat, 'headline') + '</a></h2>' +
              '<p class="cs-hub__feature-summary">' + t(feat, 'summary') + '</p>' +
              '<div class="cs-page__stats">' + featStats + '</div>' +
              '<a class="cs-hub__feature-link" href="/case-studies/' + feat.slug + '">' + (featuredRead[l] || featuredRead.en) + ' <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></a>' +
            '</div>' +
            '<a href="/case-studies/' + feat.slug + '" class="cs-hub__feature-img"><img src="' + basePath + feat.image + '" alt="' + feat.client + '"></a>' +
          '</div>';
      }

      var chipsHtml = '<div class="cs-hub__chips">' + ['all', 'local', 'platform'].map(function (key) {
        return '<button class="cs-hub__chip" data-seg="' + key + '" aria-pressed="' + (key === active) + '">' + (SEG_LABELS[key][l] || SEG_LABELS[key].en) + '</button>';
      }).join('') + '</div>';

      var items = rest.filter(function (s) { return active === 'all' || s.segment === active; });
      var gridHtml = '<div class="cs-grid cs-hub__grid">' + items.map(renderCard).join('') + '</div>';

      container.innerHTML = featHtml + chipsHtml + gridHtml;

      initEvervaultCards(container);
      container.querySelectorAll('[data-cs-card]').forEach(function (c) { c.classList.add('in-view'); });

      container.querySelectorAll('.cs-hub__chip').forEach(function (b) {
        b.addEventListener('click', function () {
          container.setAttribute('data-filter', b.getAttribute('data-seg'));
          renderHub(container);
        });
      });
    });
  }

  // ---- Init ----

  function renderAll() {
    // Render all card grids on the page
    var grids = document.querySelectorAll('.case-studies');
    grids.forEach(function (g) { renderGrid(g); });

    // Render full page if container exists
    var page = document.getElementById('case-study-page');
    if (page) renderFullPage(page);

    // Render hub if container exists
    var hub = document.getElementById('case-studies-hub');
    if (hub) renderHub(hub);
  }

  document.addEventListener('DOMContentLoaded', function () {
    renderAll();

    // Re-render when language changes
    if (window.__i18n && window.__i18n.onChange) {
      window.__i18n.onChange(function () {
        renderAll();
      });
    }
  });
})();
