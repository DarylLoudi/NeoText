// Applies the saved appearance before first paint so there is no flash.
// Keep in step with applyAppearance in src/design/theme.ts (a test compares the two).
(() => {
  try {
    const root = document.documentElement;
    const raw = localStorage.getItem('neotext:appearance');
    // Dark is the default theme until the saved settings say otherwise.
    if (!raw) {
      root.setAttribute('data-theme', 'dark');
      return;
    }
    const a = JSON.parse(raw);
    const set = (attr, value, skip) => {
      if (typeof value === 'string' && value !== skip) root.setAttribute(attr, value);
      else root.removeAttribute(attr);
    };
    set('data-theme', a.theme, 'system');
    set('data-accent', a.accent);
    set('data-ui-font', a.uiFont);
    set('data-reading-font', a.readingFont);
    set('data-code-font', a.codeFont);
    set('data-width', a.messageWidth);
    set('data-density', a.density);
    // data-motion says whether motion runs: "Reduce" (reduceMotion 'on') turns it off.
    set('data-motion', { on: 'off', off: 'on' }[a.reduceMotion]);
    if (typeof a.fontScale === 'number' && a.fontScale > 0) {
      root.style.setProperty('--font-scale', String(a.fontScale));
    }
  } catch {
    // Storage unavailable or malformed: keep the defaults.
  }
})();
