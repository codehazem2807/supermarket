// ═══════════════════════════════════════════════════════════
// ⭐ تحديث theme-color في المتصفح (Taskbar / Address Bar)
// ═══════════════════════════════════════════════════════════
function updateBrowserThemeColor(theme) {
  try {
    const color = theme.primary || '#0B2C4D';

    // 1) meta[name="theme-color"]
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = color;

    // 2) meta[name="msapplication-TileColor"] (Windows)
    let tileMeta = document.querySelector('meta[name="msapplication-TileColor"]');
    if (!tileMeta) {
      tileMeta = document.createElement('meta');
      tileMeta.name = 'msapplication-TileColor';
      document.head.appendChild(tileMeta);
    }
    tileMeta.content = color;

    // 3) meta[name="apple-mobile-web-app-status-bar-style"]
    let appleMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (appleMeta) {
      // لو الثيم داكن → black-translucent، لو فاتح → default
      appleMeta.content = theme.mode === 'dark' ? 'black-translucent' : 'default';
    }

    // 4) CSS custom property --browser-theme-color (للاستخدام في JS)
    document.documentElement.style.setProperty('--browser-theme-color', color);

    console.log('[RefadTheme] Browser theme-color updated:', color);
  } catch (e) {
    console.warn('[RefadTheme] updateBrowserThemeColor failed:', e);
  }
}

// ═══════════════════════════════════════════════════════════
// ⭐ تحديث manifest.json ديناميكياً (PWA)
// ═══════════════════════════════════════════════════════════
function updateManifest(theme) {
  try {
    const color = theme.primary || '#0B2C4D';
    const bgColor = theme.bg || '#F1F5F9';
    const companyName = (window.RefadSettings && window.RefadSettings.get('general.company_name')) || 'رفاد';

    // نعمل blob manifest جديد بالثيم الحالي
    const manifest = {
      name: companyName + ' — REFAD ERP',
      short_name: companyName.substring(0, 12),
      description: 'نظام إدارة متكامل',
      start_url: '/dashboard.html',
      scope: '/',
      display: 'standalone',
      orientation: 'portrait',
      background_color: bgColor,
      theme_color: color,
      lang: 'ar',
      dir: 'rtl',
      icons: [
        { src: 'icons/icon-72.png', sizes: '72x72', type: 'image/png', purpose: 'any' },
        { src: 'icons/icon-96.png', sizes: '96x96', type: 'image/png', purpose: 'any' },
        { src: 'icons/icon-128.png', sizes: '128x128', type: 'image/png', purpose: 'any' },
        { src: 'icons/icon-144.png', sizes: '144x144', type: 'image/png', purpose: 'any' },
        { src: 'icons/icon-152.png', sizes: '152x152', type: 'image/png', purpose: 'any' },
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: 'icons/icon-384.png', sizes: '384x384', type: 'image/png', purpose: 'any' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
      ]
    };

    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    let link = document.querySelector('link[rel="manifest"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'manifest';
      document.head.appendChild(link);
    }
    link.href = url;
  } catch (e) {
    console.warn('[RefadTheme] updateManifest failed:', e);
  }
}