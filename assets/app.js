/* AgentLane site: small, dependency-free interactions. The page works without this file. */
(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- hero: Without / With toggle ---- */
  const stage = document.getElementById('stage');
  if (stage) {
    const buttons = stage.querySelectorAll('[data-set]');
    let auto = null;
    const set = (mode) => {
      stage.dataset.mode = mode;
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.set === mode)));
    };
    buttons.forEach((b) =>
      b.addEventListener('click', () => {
        clearTimeout(auto);
        set(b.dataset.set);
      }),
    );
    // Show the conflict for one full cycle, then reveal the fix — once. The visitor stays in control.
    if (!reduce) auto = setTimeout(() => set('with'), 11500);
  }
})();
