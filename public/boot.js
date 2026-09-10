(() => {
  try {
    const savedTheme = localStorage.getItem('mrscrap_theme_v2') || 'dark';
    const root = document.documentElement;
    if (savedTheme === 'light') {
      root.classList.remove('dark');
      root.classList.add('light');
      const meta = document.getElementById('theme-color-meta');
      if (meta) meta.setAttribute('content', '#f8fafc');
    } else {
      root.classList.remove('light');
      root.classList.add('dark');
    }
    const savedLocale = localStorage.getItem('mrscrap_locale_v2') || 'en';
    root.lang = savedLocale;
    root.dir = savedLocale === 'ar' ? 'rtl' : 'ltr';

    const fonts = document.getElementById('mrscrap-fonts');
    if (fonts) {
      const enableFonts = () => fonts.setAttribute('media', 'all');
      fonts.addEventListener('load', enableFonts, { once: true });
      if (fonts.sheet) enableFonts();
    }
  } catch {
    // Defaults from index.html remain authoritative when storage is unavailable.
  }
})();
