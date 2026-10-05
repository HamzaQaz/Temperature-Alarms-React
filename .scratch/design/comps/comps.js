/* Shared behaviour for the design comps: the icon sprite, the notes panel, the reduced-motion preview. */
(function () {
  // Lucide paths (ISC licence), the icon set the product already uses.
  const ICONS = {
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
    history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    settings: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
    building: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    thermometer: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
    wifi: '<path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.86a10 10 0 0 1 14 0"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/>',
    wifioff: '<path d="M12 20h.01"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 4.18-2.65"/><path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76"/><path d="M16.85 11.25a10 10 0 0 1 2.22 1.68"/><path d="M5 12.86a10 10 0 0 1 5.17-2.69"/><path d="m2 2 20 20"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
    play: '<path d="M6 3l14 9-14 9V3Z"/>',
    calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/>',
    pin: '<path d="M20 10c0 4.99-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 14.99 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    motion: '<path d="M5 12h14"/><path d="M5 6h9"/><path d="M5 18h6"/>'
  };
  const sprite = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  sprite.setAttribute('aria-hidden', 'true');
  sprite.style.display = 'none';
  sprite.innerHTML = Object.entries(ICONS)
    .map(([id, body]) => `<symbol id="i-${id}" viewBox="0 0 24 24">${body}</symbol>`)
    .join('');
  document.body.prepend(sprite);

  window.icon = (id, cls = '') =>
    `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;

  // Restart the Reading-landed wash (or any class-driven animation) on an element.
  window.replayClass = (el, cls) => {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  };

  const notes = document.querySelector('.notes');
  const toggle = document.querySelector('[data-notes-toggle]');
  if (notes && toggle) {
    const set = (open) => {
      notes.dataset.open = String(open);
      toggle.setAttribute('aria-expanded', String(open));
      if (open) notes.querySelector('h2')?.focus();
    };
    toggle.addEventListener('click', () => set(notes.dataset.open !== 'true'));
    notes.querySelector('[data-notes-close]')?.addEventListener('click', () => { set(false); toggle.focus(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && notes.dataset.open === 'true') { set(false); toggle.focus(); } });
    if (new URLSearchParams(location.search).has('notes')) set(true);
  }

  const rm = document.querySelector('[data-rm-toggle]');
  if (rm) {
    rm.addEventListener('click', () => {
      const on = !document.documentElement.classList.contains('rm');
      document.documentElement.classList.toggle('rm', on);
      rm.setAttribute('aria-pressed', String(on));
    });
  }
  window.reducedMotion = () =>
    document.documentElement.classList.contains('rm') ||
    matchMedia('(prefers-reduced-motion: reduce)').matches;
})();
