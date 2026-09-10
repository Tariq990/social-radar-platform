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
  } catch {
    // Defaults from index.html remain authoritative when storage is unavailable.
  }
})();
