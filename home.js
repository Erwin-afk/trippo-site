'use strict';
/* Homepage motion: sections ease in as they scroll into view. Without JS, or with reduced motion, everything is simply there. */
(() => {
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.documentElement.classList.add('js');

  document.addEventListener('DOMContentLoaded', () => {
    const groups = ['.steps-home li', '.split > *', '.price', '.ticks li'];
    const single = ['.section .title', '.section .lead', '.band'];
    const seen = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add('in');
          seen.unobserve(e.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    const watch = (el, i = 0) => {
      el.classList.add('reveal');
      el.style.setProperty('--delay', `${Math.min(i, 4) * 70}ms`);
      seen.observe(el);
    };
    single.forEach((s) => document.querySelectorAll(s).forEach((el) => watch(el)));
    groups.forEach((s) => document.querySelectorAll(s).forEach(watch));

    const bar = document.querySelector('.bar');
    const onScroll = () => bar.classList.toggle('scrolled', window.scrollY > 8);
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  });
})();
