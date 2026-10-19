/* 뷰포트 안에서만 움직이고, 사용자·기기의 동작 줄이기 설정을 따릅니다. */
(function () {
  'use strict';
  const root = document.documentElement;
  const button = document.getElementById('motion-toggle');
  const art = document.querySelector('.hero-art');
  const media = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  let preference = 'on';
  let homeVisible = true;
  let observer;
  try { preference = localStorage.getItem('promptera.motion') === 'off' ? 'off' : 'on'; } catch (_) { /* 저장 제한 환경 */ }
  const disabled = () => media.matches || preference === 'off';

  function revealAll() {
    root.classList.remove('motion-ready');
    document.querySelectorAll('[data-reveal]').forEach(node => node.classList.add('is-visible'));
  }

  function refresh(view) {
    if (view) homeVisible = view === 'home';
    if (disabled() || !homeVisible) art.classList.remove('motion-active');
    if (disabled()) { revealAll(); return; }
    if (!observer) {
      revealAll();
      art.classList.remove('motion-active');
      return;
    }
    root.classList.add('motion-ready');
    document.querySelectorAll('[data-reveal]').forEach(node => observer.observe(node));
    if (homeVisible) observer.observe(art);
    else observer.unobserve(art);
  }

  function apply() {
    if (observer) observer.disconnect();
    observer = null;
    root.dataset.motion = disabled() ? 'off' : 'on';
    button.disabled = media.matches;
    button.setAttribute('aria-pressed', String(disabled()));
    button.textContent = media.matches ? '동작 줄이기 적용 중' : disabled() ? '모션 켜기 ▷' : '모션 끄기 Ⅱ';
    if (!disabled() && typeof window.IntersectionObserver === 'function') {
      const nextObserver = new window.IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.target === art) art.classList.toggle('motion-active', entry.isIntersecting && homeVisible && !disabled());
          else if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            nextObserver.unobserve(entry.target);
          }
        });
      }, { threshold: .08 });
      observer = nextObserver;
    }
    refresh();
  }

  button.addEventListener('click', () => {
    preference = preference === 'off' ? 'on' : 'off';
    try { localStorage.setItem('promptera.motion', preference); } catch (_) { /* 저장 제한 환경 */ }
    apply();
  });
  if (media.addEventListener) media.addEventListener('change', apply);
  window.PMOTION = { refresh, reduced: disabled };
  apply();
})();
