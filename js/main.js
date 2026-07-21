/**
 * Rejig Labs — Main JS
 * GSAP ScrollTrigger animations + vanilla interactions
 */
(() => {
  'use strict';

  /* ---- NAV ---- */
  const nav = document.getElementById('nav');
  const navToggle = document.getElementById('navToggle');
  const mobileMenu = document.getElementById('mobileMenu');

  if (nav) {
    window.addEventListener('scroll', () => {
      nav.classList.toggle('nav--scrolled', window.scrollY > 40);
    }, { passive: true });
  }

  if (navToggle && mobileMenu) {
    navToggle.addEventListener('click', () => {
      const open = mobileMenu.classList.toggle('open');
      navToggle.classList.toggle('open', open);
    });
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.remove('open');
        navToggle.classList.remove('open');
      });
    });
  }

  /* ---- SMOOTH SCROLL ---- */
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const id = a.getAttribute('href');
      if (id === '#') return;
      const el = document.querySelector(id);
      if (!el) return;
      e.preventDefault();
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  /* ---- SAFETY FALLBACK — force in-view if observers haven't fired ---- */
  setTimeout(() => {
    document.querySelectorAll('[data-slide], .stat, .faq__item, .closing__line, .cs-card').forEach(el => {
      el.classList.add('in-view');
    });
    document.querySelectorAll('.rv').forEach(el => el.classList.add('in'));
  }, 600);

  /* ---- GSAP SETUP — scripts are at body-bottom so GSAP is already loaded ---- */
  (function () {
  gsap.registerPlugin(ScrollTrigger);
  const ease = 'power3.out';

  /* =============================================
     HERO — staggered entrance on load
  ============================================= */
  const heroTl = gsap.timeline({ delay: 0.15 });
  heroTl
    .from('.nav', { y: -20, opacity: 0, duration: 0.6, ease })
    .from('.hero__content .eyebrow', { y: 20, opacity: 0, duration: 0.7, ease }, '-=0.2')
    .from('.hero__h1', { y: 30, opacity: 0, duration: 0.9, ease }, '-=0.5')
    .from('.hero__sub', { y: 20, opacity: 0, duration: 0.7, ease }, '-=0.55')
    .from('.hero .btn', { y: 16, opacity: 0, duration: 0.6, ease }, '-=0.45')
    .from('.hero__trusted', { opacity: 0, duration: 0.8, ease }, '-=0.2');

  /* =============================================
     NARRATIVE — sequential stack
     Exit completes BEFORE next line enters.
     No two lines are ever at center together.

     Each transition = 2 half-steps:
       first half:  current exits to above
       second half: next enters from below
     Lines that have exited stay ghosted above.
  ============================================= */
  const narrativeSection = document.querySelector('.narrative');
  const narrativeLines   = [...document.querySelectorAll('[data-narrative]')];
  const lineCount        = narrativeLines.length;
  const transitions      = lineCount - 1; // number of switches

  // Each transition = 1 unit. Total timeline = transitions units.
  // Section scroll height: extra room to read first + last line.
  if (narrativeSection) narrativeSection.style.height = ((transitions * 100) + 200) + 'vh';

  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: narrativeSection,
      start: 'top top',
      end: 'bottom bottom',
      scrub: 1.2,
    }
  });

  // Explicitly set every line's starting state so GSAP knows exactly
  // where each one begins — no ambiguity.
  narrativeLines.forEach((line, i) => {
    gsap.set(line, {
      y:       i === 0 ? '0vh' : '80vh',
      opacity: i === 0 ? 1      : 0,
    });
  });

  // Spacing between stacked ghosted lines above center
  const stackGap = 16; // vh between each ghosted line
  const exitY    = -22; // vh — first exit position above center

  for (let step = 0; step < transitions; step++) {
    const base = step;

    // Push ALL previously exited lines further up to make room
    for (let prev = 0; prev < step; prev++) {
      const stackPos = exitY - (step - prev) * stackGap;
      tl.to(narrativeLines[prev],
        { y: stackPos + 'vh', ease: 'power1.inOut', duration: 0.45 },
        base
      );
    }

    // EXIT: current line drifts up to the nearest ghosted position
    tl.to(narrativeLines[step],
      { y: exitY + 'vh', opacity: 0.12, ease: 'power1.inOut', duration: 0.45 },
      base
    );

    // ENTER: next line rises from below — after exit clears center
    tl.fromTo(narrativeLines[step + 1],
      { y: '80vh', opacity: 0 },
      { y: '0vh',  opacity: 1, ease: 'power2.out', duration: 0.45, immediateRender: false },
      base + 0.55
    );
  }

  /* =============================================
     NARRATIVE — progress bar + dots
  ============================================= */
  const progressBar  = document.getElementById('narrativeProgress');
  const progressFill = document.getElementById('narrativeProgressFill');

  ScrollTrigger.create({
    trigger: narrativeSection,
    start: 'top top',
    end: 'bottom bottom',
    onEnter:     () => progressBar.classList.add('visible'),
    onLeave:     () => progressBar.classList.remove('visible'),
    onEnterBack: () => progressBar.classList.add('visible'),
    onLeaveBack: () => progressBar.classList.remove('visible'),
    onUpdate: (self) => {
      progressFill.style.width = (self.progress * 100) + '%';
    }
  });

  /* =============================================
     SOLUTION — content slides up, glow pulses
  ============================================= */
  gsap.from('.solution__content > *', {
    scrollTrigger: { trigger: '.solution', start: 'top 58%' },
    y: 40, opacity: 0, duration: 0.85, stagger: 0.18, ease,
  });
  gsap.to('.solution__glow', {
    scrollTrigger: { trigger: '.solution', scrub: 2, start: 'top bottom', end: 'bottom top' },
    scale: 1.4, opacity: 0.6,
  });

  /* =============================================
     PROCESS — header + cards staggered
  ============================================= */
  gsap.from('.process__header > *', {
    scrollTrigger: { trigger: '.process__header', start: 'top 68%' },
    y: 28, opacity: 0, duration: 0.75, stagger: 0.14, ease,
  });

  /* Process steps — slide in from left, staggered */
  const processSteps = document.querySelectorAll('[data-slide]');
  const slideObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const idx = Array.from(processSteps).indexOf(entry.target);
      setTimeout(() => entry.target.classList.add('in-view'), idx * 200);
      slideObserver.unobserve(entry.target);
    });
  }, { threshold: 0.05 });
  processSteps.forEach(s => slideObserver.observe(s));

  /* Enterprise sections (.rv) — simple fade-up reveal */
  const rvObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('in');
      rvObserver.unobserve(entry.target);
    });
  }, { threshold: 0.12 });
  document.querySelectorAll('.rv').forEach(el => rvObserver.observe(el));

  /* =============================================
     PROCESS — scroll-scrubbed morphing geometry
  ============================================= */
  document.querySelectorAll('.process__morph').forEach(function (morph) {
    var shapes = morph.querySelectorAll('.morph-shape');
    var step = morph.closest('.process__step');

    // Set initial state with GSAP for proper SVG transform
    shapes.forEach(function (shape) {
      gsap.set(shape, { scale: 0, opacity: 0, svgOrigin: '100 100' });
    });

    // Create a timeline scrubbed by scroll
    var tl = gsap.timeline({
      scrollTrigger: {
        trigger: step,
        start: 'top 80%',
        end: 'bottom 30%',
        scrub: 1,
      }
    });

    shapes.forEach(function (shape, i) {
      var rotDir = i % 2 === 0 ? 8 : -8;
      tl.to(shape, {
        scale: 1,
        opacity: 1,
        rotation: i === 0 ? 0 : rotDir,
        duration: 1,
        ease: 'power2.out',
      }, i * 0.35);
    });
  });

  /* =============================================
     TESTIMONIALS — header + cards
  ============================================= */
  /* =============================================
     CASE STUDIES — header stagger
  ============================================= */
  const csHeader = document.querySelector('.case-studies-section__header');
  if (csHeader) {
    gsap.from('.case-studies-section__header > *', {
      scrollTrigger: { trigger: '.case-studies-section__header', start: 'top 68%' },
      y: 28, opacity: 0, duration: 0.75, stagger: 0.14, ease,
    });
  }

  gsap.from('.testimonials__header > *', {
    scrollTrigger: { trigger: '.testimonials__header', start: 'top 68%' },
    y: 24, opacity: 0, duration: 0.75, stagger: 0.14, ease,
  });

  /* Interactive testimonial switcher */
  (function () {
    // Quotes are English-only except Thai (RU falls back to EN by design).
    var testimonials = [
      {
        quote: 'We used to lose bookings every time the phone rang mid-cut. Rejig built us an AI front desk that answers in Thai, English and Russian, takes the booking and never puts a customer on hold. It runs on its own now and the calendar fills itself across all our branches.',
        quote_th: 'เมื่อก่อนเราเสียลูกค้าจองคิวทุกครั้งที่โทรศัพท์ดังตอนกำลังตัดผม Rejig สร้างระบบรับสายอัจฉริยะ (AI) ที่รับสายเป็นภาษาไทย อังกฤษ และรัสเซีย จองคิวให้ลูกค้าได้ทันทีโดยไม่ต้องให้ใครรอสาย ตอนนี้ระบบทำงานเองทั้งหมด และคิวก็เต็มเองในทุกสาขาของเรา',
        role: 'Ella N. | Owner, Ducky Cutz Barbershop, Phuket',
        role_th: 'Ella N. | เจ้าของ Ducky Cutz Barbershop, ภูเก็ต'
      },
      {
        quote: 'Rejig didn\'t just advise, they built the whole engine we go to market with: the targeting, the outreach sequences, the design system, all of it. We went from a deck to a working pipeline in weeks. They handle the technical side so we can focus on closing.',
        quote_th: 'Rejig ไม่ได้แค่ให้คำปรึกษา แต่สร้างระบบที่เราใช้บุกตลาดให้เราทั้งหมด ทั้งการเจาะกลุ่มเป้าหมาย ลำดับการติดต่อลูกค้า และระบบดีไซน์ทั้งชุด เราเปลี่ยนจากแค่สไลด์นำเสนอมาเป็นไปป์ไลน์ที่ใช้งานได้จริงภายในไม่กี่สัปดาห์ พวกเขาดูแลงานเทคนิคให้ เราเลยโฟกัสกับการปิดการขายได้เต็มที่',
        role: 'Denis K. | Founder, BoBe',
        role_th: 'Denis K. | ผู้ก่อตั้ง BoBe'
      },
      {
        quote: 'We needed a whole event operation: the website, registrations, sponsors and print, all in three languages. Rejig Labs delivered every piece and ran it like a team many times its size. They became a real partner, credited on the tournament banner alongside our sponsors.',
        quote_th: 'เราต้องการทีมจัดงานแบบครบวงจร ทั้งเว็บไซต์ ระบบลงทะเบียน งานสปอนเซอร์ และงานพิมพ์ ครบทั้งสามภาษา Rejig Labs ทำให้เราครบทุกส่วน และบริหารงานได้เหมือนทีมที่ใหญ่กว่าตัวจริงหลายเท่า พวกเขากลายเป็นพาร์ตเนอร์ตัวจริงของเรา จนได้ขึ้นชื่อบนป้ายงานเคียงข้างสปอนเซอร์',
        role: 'Samran Sinthong | VP & Founder, ANRCF',
        role_th: 'Samran Sinthong | รองประธานและผู้ก่อตั้ง ANRCF'
      },
      {
        quote: 'We install and service elevators, we are not marketers. Rejig rebuilt our website, got us found on both search and AI search, set up our CRM and reworked how leads move through the business. For the first time our presence online matches the quality of our work on the ground.',
        quote_th: 'เราติดตั้งและดูแลลิฟต์ เราไม่ใช่นักการตลาด Rejig สร้างเว็บไซต์ใหม่ให้เรา ทำให้เราถูกค้นเจอทั้งบนเสิร์ชและบน AI จัดระบบ CRM และปรับวิธีที่ลูกค้าใหม่ไหลเข้าสู่ธุรกิจใหม่ทั้งหมด เป็นครั้งแรกที่ตัวตนออนไลน์ของเราสมกับคุณภาพงานจริงหน้างานของเรา',
        role: 'Suchart | Founder, Mobile Engineer, Phuket',
        role_th: 'Suchart | ผู้ก่อตั้ง Mobile Engineer, ภูเก็ต'
      }
    ];

    var quoteEl = document.getElementById('tstQuote');
    var roleEl = document.getElementById('tstRole');
    var btns = document.querySelectorAll('[data-tst-index]');
    var activeIdx = 0;
    var animating = false;

    // Pick the quote/role in the active language; Thai when set, else English.
    function tstText(t, field) {
      var lang = (window.__i18n && window.__i18n.getLang) ? window.__i18n.getLang() : 'en';
      return (lang === 'th' && t[field + '_th']) ? t[field + '_th'] : t[field];
    }
    function renderTst(idx) {
      quoteEl.textContent = tstText(testimonials[idx], 'quote');
      roleEl.textContent = tstText(testimonials[idx], 'role');
    }

    // Render the default card in the stored language (handles Thai-on-load).
    renderTst(activeIdx);

    // Re-render the active card when the language toggles.
    if (window.__i18n && window.__i18n.onChange) {
      window.__i18n.onChange(function () { renderTst(activeIdx); });
    }

    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.dataset.tstIndex);
        if (idx === activeIdx || animating) return;
        animating = true;

        // Fade out
        quoteEl.classList.add('fading');
        roleEl.classList.add('fading');

        setTimeout(function () {
          // Swap content
          activeIdx = idx;
          renderTst(idx);

          // Update active button
          btns.forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');

          // Fade in
          quoteEl.classList.remove('fading');
          roleEl.classList.remove('fading');

          setTimeout(function () { animating = false; }, 350);
        }, 250);
      });
    });
  })();

  /* =============================================
     STATS — slide up + count-up
  ============================================= */
  const statItems = document.querySelectorAll('.stat');
  const statObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const idx = Array.from(statItems).indexOf(entry.target);
      setTimeout(() => entry.target.classList.add('in-view'), idx * 100);
      statObserver.unobserve(entry.target);
    });
  }, { threshold: 0.05 });
  statItems.forEach(s => statObserver.observe(s));

  /* Count-up */
  const countEls = document.querySelectorAll('.count');
  const countObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const target = +el.dataset.target;
      const dur = 1400;
      const t0 = performance.now();
      const tick = now => {
        const p = Math.min((now - t0) / dur, 1);
        const e = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(e * target);
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      countObserver.unobserve(el);
    });
  }, { threshold: 0.1 });
  countEls.forEach(el => countObserver.observe(el));

  /* =============================================
     FAQ — slide in from left, staggered
  ============================================= */
  const faqItems = document.querySelectorAll('.faq__item');
  const faqObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const idx = Array.from(faqItems).indexOf(entry.target);
      setTimeout(() => entry.target.classList.add('in-view'), idx * 70);
      faqObserver.unobserve(entry.target);
    });
  }, { threshold: 0.05 });
  faqItems.forEach(f => faqObserver.observe(f));

  gsap.from('.faq__header > *', {
    scrollTrigger: { trigger: '.faq__header', start: 'top 70%' },
    y: 24, opacity: 0, duration: 0.7, stagger: 0.14, ease,
  });

  /* =============================================
     CLOSING — staggered line-by-line reveal
  ============================================= */
  const closingLines = document.querySelectorAll('.closing__line');
  const closingObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      // Trigger all lines with stagger
      closingLines.forEach((line, idx) => {
        setTimeout(() => line.classList.add('in-view'), idx * 300);
      });
      closingObserver.unobserve(entry.target);
    });
  }, { threshold: 0.05 });
  const closingFooter = document.querySelector('.closing-footer');
  if (closingFooter) closingObserver.observe(closingFooter);

  gsap.from('.closing__btn-wrap', {
    scrollTrigger: {
      trigger: '.closing-footer',
      start: 'top 55%',
      onEnter: function () {
        // Delay circle draw until button has faded in
        setTimeout(function () {
          var wrap = document.getElementById('closingBtnWrap');
          if (wrap) wrap.classList.add('animate');
        }, 600);
      }
    },
    y: 20, opacity: 0, duration: 0.7, delay: 0.3, ease,
  });

  /* =============================================
     FOOTER — fade up
  ============================================= */
  gsap.from('.footer__inner > *', {
    scrollTrigger: { trigger: '.closing-footer', start: 'top 85%' },
    y: 16, opacity: 0, duration: 0.6, stagger: 0.1, ease,
  });

  /* =============================================
     FAQ ACCORDION
  ============================================= */
  document.querySelectorAll('.faq__q').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq__item');
      const isOpen = item.classList.contains('open');
      document.querySelectorAll('.faq__item.open').forEach(el => el.classList.remove('open'));
      if (!isOpen) item.classList.add('open');
    });
  });

  /* =============================================
     ENTROPY — particle order-to-chaos canvas
  ============================================= */
  (function initEntropy() {
    const canvas = document.getElementById('entropyCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = 500;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    ctx.scale(dpr, dpr);

    // Use site accent blue for particles
    const particleColor = '#3385ff';

    const particles = [];
    const gridSize = 14;
    const spacing = size / gridSize;

    function Particle(x, y, order) {
      this.x = x;
      this.y = y;
      this.originalX = x;
      this.originalY = y;
      this.size = 1.8;
      this.order = order;
      this.vx = (Math.random() - 0.5) * 2;
      this.vy = (Math.random() - 0.5) * 2;
      this.influence = 0;
      this.neighbors = [];
    }

    Particle.prototype.update = function () {
      if (this.order) {
        var dx = this.originalX - this.x;
        var dy = this.originalY - this.y;
        var cx = 0, cy = 0;
        for (var i = 0; i < this.neighbors.length; i++) {
          var n = this.neighbors[i];
          if (!n.order) {
            var d = Math.hypot(this.x - n.x, this.y - n.y);
            var s = Math.max(0, 1 - d / 100);
            cx += n.vx * s;
            cy += n.vy * s;
            this.influence = Math.max(this.influence, s);
          }
        }
        this.x += dx * 0.05 * (1 - this.influence) + cx * this.influence;
        this.y += dy * 0.05 * (1 - this.influence) + cy * this.influence;
        this.influence *= 0.99;
      } else {
        this.vx += (Math.random() - 0.5) * 0.5;
        this.vy += (Math.random() - 0.5) * 0.5;
        this.vx *= 0.95;
        this.vy *= 0.95;
        this.x += this.vx;
        this.y += this.vy;
        if (this.x < 0 || this.x > size / 2) this.vx *= -1;
        if (this.y < 0 || this.y > size) this.vy *= -1;
        this.x = Math.max(0, Math.min(size / 2, this.x));
        this.y = Math.max(0, Math.min(size, this.y));
      }
    };

    Particle.prototype.draw = function (ctx) {
      var alpha = this.order ? 0.8 - this.influence * 0.5 : 0.8;
      var hex = Math.round(alpha * 255).toString(16);
      if (hex.length < 2) hex = '0' + hex;
      ctx.fillStyle = particleColor + hex;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fill();
    };

    for (var i = 0; i < gridSize; i++) {
      for (var j = 0; j < gridSize; j++) {
        var x = spacing * i + spacing / 2;
        var y = spacing * j + spacing / 2;
        particles.push(new Particle(x, y, x >= size / 2));
      }
    }

    function updateNeighbors() {
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.neighbors = [];
        for (var j = 0; j < particles.length; j++) {
          if (i === j) continue;
          if (Math.hypot(p.x - particles[j].x, p.y - particles[j].y) < 100) {
            p.neighbors.push(particles[j]);
          }
        }
      }
    }

    var time = 0;
    var running = false;

    function animate() {
      if (!running) return;
      ctx.clearRect(0, 0, size, size);

      if (time % 60 === 0) {
        if (typeof requestIdleCallback !== 'undefined') {
          requestIdleCallback(updateNeighbors, { timeout: 100 });
        } else {
          updateNeighbors();
        }
      }

      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.update();
        p.draw(ctx);
        for (var j = 0; j < p.neighbors.length; j++) {
          var n = p.neighbors[j];
          var d = Math.hypot(p.x - n.x, p.y - n.y);
          if (d < 50) {
            var a = 0.2 * (1 - d / 50);
            var hex = Math.round(a * 255).toString(16);
            if (hex.length < 2) hex = '0' + hex;
            ctx.strokeStyle = particleColor + hex;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(n.x, n.y);
            ctx.stroke();
          }
        }
      }

      // Divider line
      ctx.strokeStyle = particleColor + '30';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(size / 2, 0);
      ctx.lineTo(size / 2, size);
      ctx.stroke();
      ctx.lineWidth = 1;

      time++;
      requestAnimationFrame(animate);
    }

    // Only run when visible
    var entropyObserver = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) {
        if (!running) { running = true; animate(); }
      } else {
        running = false;
      }
    }, { threshold: 0.05 });
    entropyObserver.observe(canvas);
  })();

  /* Yield to browser input queue before forcing layout recalculation */
  setTimeout(() => ScrollTrigger.refresh(), 0);

  /* Web fonts load async (preload onload) — once they swap in the text
     reflows and every scroll trigger's start/end goes stale. Recompute
     positions after fonts settle and after full load. */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => ScrollTrigger.refresh());
  }
  window.addEventListener('load', () => ScrollTrigger.refresh());

  })(); // end GSAP setup

})();
