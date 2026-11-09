// Shared interactive behaviors: Mobile drawer, scroll animations, counter effects, cart modal
document.addEventListener('DOMContentLoaded', () => {

  // 1. MOBILE DRAWER NAVIGATION
  const burgerBtn = document.querySelector('[data-burger-btn]');
  const mobileDrawer = document.querySelector('[data-mobile-drawer]');
  const drawerBackdrop = document.querySelector('[data-drawer-backdrop]');
  const drawerCloseBtn = document.querySelector('[data-drawer-close]');

  function toggleMobileMenu(open) {
    if (!mobileDrawer) return;
    const isOpen = open !== undefined ? open : !mobileDrawer.classList.contains('is-open');
    if (burgerBtn) burgerBtn.classList.toggle('is-active', isOpen);
    if (mobileDrawer) mobileDrawer.classList.toggle('is-open', isOpen);
    if (drawerBackdrop) drawerBackdrop.classList.toggle('is-visible', isOpen);
    document.body.style.overflow = isOpen ? 'hidden' : '';
  }

  if (burgerBtn) {
    burgerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMobileMenu();
    });
  }

  if (drawerBackdrop) {
    drawerBackdrop.addEventListener('click', () => toggleMobileMenu(false));
  }

  if (drawerCloseBtn) {
    drawerCloseBtn.addEventListener('click', () => toggleMobileMenu(false));
  }

  // Close drawer on link click
  document.querySelectorAll('.mobile-nav-link, .mobile-btn-cta').forEach(link => {
    link.addEventListener('click', () => toggleMobileMenu(false));
  });

  // 2. SCROLL REVEAL ANIMATIONS (IntersectionObserver)
  const revealElements = document.querySelectorAll('.reveal-on-scroll');
  if ('IntersectionObserver' in window && revealElements.length > 0) {
    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          obs.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.02,
      rootMargin: '0px 0px 40px 0px'
    });

    revealElements.forEach(el => observer.observe(el));
  } else {
    revealElements.forEach(el => el.classList.add('is-revealed'));
  }

  // 3. STATS NUMBER COUNT-UP ANIMATION
  const statNumbers = document.querySelectorAll('.stat-number');
  if ('IntersectionObserver' in window && statNumbers.length > 0) {
    const numberObserver = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animateNumber(entry.target);
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.4 });

    statNumbers.forEach(num => numberObserver.observe(num));
  }

  function animateNumber(el) {
    const text = el.textContent.trim();
    const hasPlus = text.includes('+');
    const hasPercent = text.includes('%');
    const target = parseInt(text.replace(/[^0-9]/g, ''), 10);
    if (isNaN(target)) return;

    let start = 0;
    const duration = 1200;
    const startTime = performance.now();

    function update(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = Math.floor(ease * target);

      let out = current;
      if (hasPlus) out += '+';
      if (hasPercent) out += '%';
      el.textContent = out;

      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        el.textContent = text;
      }
    }

    requestAnimationFrame(update);
  }

  // 4. SMOOTH SCROLL FOR ANCHOR LINKS
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (!targetId || targetId === '#' || targetId.startsWith('#popup')) return;
      const targetEl = document.querySelector(targetId);
      if (targetEl) {
        e.preventDefault();
        targetEl.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  // 5. RUSSIAN PHONE MASK & REGEX VALIDATION
  const PHONE_REGEX = /^(\+7|7|8)?[\s\-]?\(?[489][0-9]{2}\)?[\s\-]?[0-9]{3}[\s\-]?[0-9]{2}[\s\-]?[0-9]{2}$/;

  function applyPhoneMask(input) {
    input.addEventListener('input', function() {
      let v = this.value.replace(/\D/g, '');
      if (v.startsWith('7') || v.startsWith('8')) v = v.substring(1);
      v = v.substring(0, 10);
      let formatted = '+7 ';
      if (v.length > 0) formatted += '(' + v.substring(0, 3);
      if (v.length >= 3) formatted += ') ' + v.substring(3, 6);
      if (v.length >= 6) formatted += '-' + v.substring(6, 8);
      if (v.length >= 8) formatted += '-' + v.substring(8, 10);
      this.value = formatted;
    });
  }

  document.querySelectorAll('input[type="tel"], input[name="phone"]').forEach(applyPhoneMask);

  // 6. UPDATE NAV USER NAME IF LOGGED IN
  try {
    const stored = localStorage.getItem('user_data');
    if (stored) {
      const user = JSON.parse(stored);
      document.querySelectorAll('[data-user-nav-name]').forEach(el => {
        el.textContent = user.name ? user.name.split(' ')[0] : 'Кабинет';
      });
    }
  } catch (e) {}

});
