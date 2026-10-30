/* ============================================================
   theme-manager.js — Refad ERP v3.0
   ⭐ الـ Theme Manager الرئيسي
   - window.RefadTheme كامل
   - يتكامل مع theme.js v3.0
   - يطبق ثيمات الشركة من DB
   - يحدث meta theme-color + manifest
   - يدعم browser UI (taskbar, address bar)
   - PWA dynamic manifest
   - Cache + fallbacks
   ============================================================ */
(function () {
  'use strict';

  const cfg = window.REFAD_CONFIG;
  if (!cfg) {
    console.error('[RefadTheme] config.js لازم يتحمّل الأول!');
    return;
  }

  // ═══════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════
  const state = {
    isInitialized: false,
    isLoading: false,
    currentTheme: null,
    currentMode: 'light',
    availableThemes: [],
    availableCustomThemes: [],
    lastLoadedAt: null,
    companyId: null
  };

  // ═══════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════
  function hexToRgb(hex) {
    try {
      hex = String(hex).replace('#', '');
      if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
      if (hex.length !== 6 && hex.length !== 8) return null;
      return {
        r: parseInt(hex.substring(0, 2), 16),
        g: parseInt(hex.substring(2, 4), 16),
        b: parseInt(hex.substring(4, 6), 16)
      };
    } catch (e) { return null; }
  }

  function isColor(value) {
    if (typeof value !== 'string') return false;
    return /^(#[0-9a-fA-F]{3,8}|rgb|rgba|hsl|hsla|var\()/.test(value.trim());
  }

  function jsKeyToCssVar(key) {
    return '--' + key.replace(/([A-Z])/g, '-$1').toLowerCase();
  }

  function getSb() {
    return (window.Refad && window.Refad.sb) || null;
  }

  function getSession() {
    return (window.Refad && window.Refad._session) || null;
  }

  function getCompanyId() {
    const s = getSession();
    return s ? s.company_id : null;
  }

  // ═══════════════════════════════════════════════════════════
  // ⭐ UPDATE BROWSER THEME COLOR (Meta Tags)
  // ═══════════════════════════════════════════════════════════
  function updateBrowserThemeColor(theme) {
    try {
      const color = (theme && theme.primary) || '#0B2C4D';
      const mode = (theme && theme.mode) || 'light';

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
      if (!appleMeta) {
        appleMeta = document.createElement('meta');
        appleMeta.name = 'apple-mobile-web-app-status-bar-style';
        document.head.appendChild(appleMeta);
      }
      appleMeta.content = mode === 'dark' ? 'black-translucent' : 'default';

      // 4) meta[name="apple-mobile-web-app-capable"]
      let appleCapable = document.querySelector('meta[name="apple-mobile-web-app-capable"]');
      if (!appleCapable) {
        appleCapable = document.createElement('meta');
        appleCapable.name = 'apple-mobile-web-app-capable';
        appleCapable.content = 'yes';
        document.head.appendChild(appleCapable);
      }

      // 5) CSS custom property
      document.documentElement.style.setProperty('--browser-theme-color', color);

      console.log('[RefadTheme] Browser theme-color updated:', color);
    } catch (e) {
      console.warn('[RefadTheme] updateBrowserThemeColor failed:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ⭐ UPDATE MANIFEST (PWA)
  // ═══════════════════════════════════════════════════════════
  function updateManifest(theme) {
    try {
      const color = (theme && theme.primary) || '#0B2C4D';
      const bgColor = (theme && theme.bg) || '#F1F5F9';
      const companyName = (window.RefadSettings && window.RefadSettings.get('general.company_name')) || 'رفاد';

      const manifest = {
        name: companyName + ' — REFAD ERP',
        short_name: companyName.substring(0, 12),
        description: 'نظام إدارة متكامل للسوبرماركت والمخازن',
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
      // Revoke old URL
      if (link._refadBlobUrl) {
        try { URL.revokeObjectURL(link._refadBlobUrl); } catch (e) {}
      }
      link.href = url;
      link._refadBlobUrl = url;

      console.log('[RefadTheme] Manifest updated');
    } catch (e) {
      console.warn('[RefadTheme] updateManifest failed:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ⭐ APPLY THEME
  // ═══════════════════════════════════════════════════════════
  function apply(themeConfig) {
    if (!themeConfig) {
      console.warn('[RefadTheme] apply: themeConfig is null');
      return false;
    }

    try {
      // 1) لو theme.js v3.0 موجود — استخدمه
      if (window.Refad && window.Refad.Theme && typeof window.Refad.Theme.applyTheme === 'function') {
        const result = window.Refad.Theme.applyTheme(themeConfig, { persist: true });
        if (result) {
          state.currentTheme = Object.assign({}, themeConfig);
          state.currentMode = themeConfig.mode || 'light';
          // Update browser meta
          updateBrowserThemeColor(themeConfig);
          updateManifest(themeConfig);
          return true;
        }
      }

      // 2) Fallback: طبّق يدوياً
      const root = document.documentElement;

      const cssVarsMap = {
        'primary': themeConfig.primary,
        'primaryLight': themeConfig.primaryLight || themeConfig.primary_light,
        'primaryDark': themeConfig.primaryDark || themeConfig.primary_dark,
        'accent': themeConfig.accent,
        'accentDark': themeConfig.accentDark || themeConfig.accent_dark,
        'bg': themeConfig.bg,
        'bgSoft': themeConfig.bgSoft || themeConfig.bg_soft,
        'bgCard': themeConfig.bgCard || themeConfig.bg_card,
        'bgSidebar': themeConfig.bgSidebar || themeConfig.bg_sidebar,
        'card': themeConfig.card || themeConfig.bgCard,
        'text': themeConfig.text,
        'textMuted': themeConfig.textMuted || themeConfig.text_muted,
        'border': themeConfig.border,
        'borderSoft': themeConfig.borderSoft || themeConfig.border_soft,
        'gold': themeConfig.gold,
        'success': themeConfig.success,
        'danger': themeConfig.danger,
        'warning': themeConfig.warning || themeConfig.gold,
        'info': themeConfig.info,
        'purple': themeConfig.purple,
        'radius': themeConfig.radius,
        'fontFamily': themeConfig.fontFamily || themeConfig.font_family
      };

      // Soft colors
      ['primary', 'accent', 'gold', 'success', 'danger', 'info', 'purple'].forEach(colorKey => {
        const color = themeConfig[colorKey];
        if (color && isColor(color) && /^#[0-9a-fA-F]{3,8}$/.test(color)) {
          const rgb = hexToRgb(color);
          if (rgb) {
            cssVarsMap[colorKey + 'Soft'] = `rgba(${rgb.r},${rgb.g},${rgb.b},0.1)`;
          }
        }
      });

      Object.entries(cssVarsMap).forEach(([key, value]) => {
        if (value !== undefined && value !== null && String(value).trim() !== '') {
          root.style.setProperty(jsKeyToCssVar(key), String(value));
        }
      });

      // Mode
      const mode = themeConfig.mode || 'light';
      root.setAttribute('data-theme', mode);
      state.currentMode = mode;

      // Cache
      try {
        localStorage.setItem(cfg.THEME_CACHE_KEY || 'refad_cached_theme', JSON.stringify(themeConfig));
      } catch (e) {}

      state.currentTheme = Object.assign({}, themeConfig);

      // Update browser
      updateBrowserThemeColor(themeConfig);
      updateManifest(themeConfig);

      // Dispatch
      window.dispatchEvent(new CustomEvent('refad:theme-applied', {
        detail: { theme: themeConfig, mode: mode }
      }));

      return true;

    } catch (e) {
      console.error('[RefadTheme] apply failed:', e);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ⭐ APPLY CACHED
  // ═══════════════════════════════════════════════════════════
  function applyCached() {
    try {
      const cached = localStorage.getItem(cfg.THEME_CACHE_KEY || 'refad_cached_theme');
      if (cached) {
        const theme = JSON.parse(cached);
        return apply(theme);
      }
    } catch (e) {
      console.warn('[RefadTheme] applyCached failed:', e);
    }

    // Fallback: default theme
    const defaultTheme = {
      slug: cfg.DEFAULT_THEME_SLUG || 'default-blue',
      name: 'Default Blue',
      primary: '#0B2C4D',
      primaryLight: '#1e4a73',
      primaryDark: '#061a2e',
      accent: '#14B8A6',
      accentDark: '#0d9488',
      bg: '#F1F5F9',
      bgSoft: '#f8fafc',
      bgCard: '#ffffff',
      bgSidebar: '#0B2C4D',
      text: '#0f172a',
      textMuted: '#64748b',
      border: '#e2e8f0',
      gold: '#F59E0B',
      success: '#10b981',
      danger: '#ef4444',
      info: '#3b82f6',
      purple: '#8b5cf6',
      radius: '14px',
      fontFamily: "'Segoe UI', Tahoma, sans-serif",
      mode: cfg.DEFAULT_THEME_MODE || 'light'
    };
    return apply(defaultTheme);
  }

  // ═══════════════════════════════════════════════════════════
  // ⭐ LOAD FROM DATABASE
  // ═══════════════════════════════════════════════════════════
  async function loadFromDB(companyId) {
    const sb = getSb();
    if (!sb) {
      console.warn('[RefadTheme] loadFromDB: no Supabase client');
      return null;
    }

    companyId = companyId || getCompanyId();
    if (!companyId) {
      console.warn('[RefadTheme] loadFromDB: no company_id');
      return null;
    }

    state.isLoading = true;

    try {
      // 1) جلب بيانات الشركة
      const { data: company, error: companyErr } = await sb.from('companies')
        .select('name, logo_url, active_theme_slug, active_custom_theme_id, theme_overrides')
        .eq('id', companyId)
        .maybeSingle();

      if (companyErr) {
        console.warn('[RefadTheme] loadFromDB: company fetch failed:', companyErr);
        state.isLoading = false;
        return null;
      }

      if (!company) {
        state.isLoading = false;
        return null;
      }

      let themeConfig = null;

      // 2) Custom theme أولاً
      if (company.active_custom_theme_id) {
        const { data: custom } = await sb.from('company_themes')
          .select('slug, name, description, config')
          .eq('id', company.active_custom_theme_id)
          .maybeSingle();
        if (custom && custom.config) {
          themeConfig = Object.assign({
            slug: custom.slug,
            name: custom.name,
            description: custom.description
          }, custom.config);
        }
      }

      // 3) Built-in theme
      if (!themeConfig && company.active_theme_slug) {
        const { data: builtin } = await sb.from('themes')
          .select('slug, name, description, config')
          .eq('slug', company.active_theme_slug)
          .maybeSingle();
        if (builtin && builtin.config) {
          themeConfig = Object.assign({
            slug: builtin.slug,
            name: builtin.name,
            description: builtin.description
          }, builtin.config);
        }
      }

      // 4) Fallback
      if (!themeConfig) {
        themeConfig = {
          slug: cfg.DEFAULT_THEME_SLUG || 'default-blue',
          name: 'Default Blue',
          primary: '#0B2C4D',
          accent: '#14B8A6',
          bg: '#F1F5F9',
          text: '#0f172a',
          mode: cfg.DEFAULT_THEME_MODE || 'light'
        };
      }

      // 5) theme_overrides
      if (company.theme_overrides && typeof company.theme_overrides === 'object') {
        themeConfig = Object.assign({}, themeConfig, company.theme_overrides);
      }

      // 6) تطبيق
      apply(themeConfig);

      // 7) Cache brand
      try {
        localStorage.setItem(cfg.BRAND_CACHE_KEY || 'refad_cached_brand', JSON.stringify({
          name: company.name,
          logo_url: company.logo_url
        }));
      } catch (e) {}

      state.lastLoadedAt = Date.now();
      state.companyId = companyId;
      state.isLoading = false;

      console.log('[RefadTheme] Theme loaded from DB:', themeConfig.slug || 'custom');
      return themeConfig;

    } catch (e) {
      console.error('[RefadTheme] loadFromDB failed:', e);
      state.isLoading = false;
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ⭐ GET THEME
  // ═══════════════════════════════════════════════════════════
  function getTheme() {
    if (state.currentTheme) return Object.assign({}, state.currentTheme);
    // Try theme.js
    if (window.Refad && window.Refad.Theme && typeof window.Refad.Theme.getTheme === 'function') {
      const t = window.Refad.Theme.getTheme();
      if (t) return t;
    }
    // Try cache
    try {
      const cached = localStorage.getItem(cfg.THEME_CACHE_KEY || 'refad_cached_theme');
      if (cached) return JSON.parse(cached);
    } catch (e) {}
    return null;
  }

  // ═══════════════════════════════════════════════════════════
  // ⭐ GET AVAILABLE THEMES
  // ═══════════════════════════════════════════════════════════
  async function getAvailableThemes() {
    const sb = getSb();
    if (!sb) return { builtin: [], custom: [] };

    try {
      // 1) Built-in themes
      const { data: builtin } = await sb.from('themes')
        .select('id, slug, name, description, config, is_default, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      state.availableThemes = builtin || [];

      // 2) Custom themes (company-specific)
      let custom = [];
      const companyId = getCompanyId();
      if (companyId) {
        const { data: customData } = await sb.from('company_themes')
          .select('id, slug, name, description, config')
          .eq('company_id', companyId)
          .order('created_at', { ascending: false });
        custom = customData || [];
      }
      state.availableCustomThemes = custom;

      return {
        builtin: state.availableThemes,
        custom: state.availableCustomThemes
      };

    } catch (e) {
      console.error('[RefadTheme] getAvailableThemes failed:', e);
      return { builtin: [], custom: [] };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ⭐ SET THEME (saves to DB)
  // ═══════════════════════════════════════════════════════════
  async function setTheme(themeSlug, customThemeId, overrides) {
    const sb = getSb();
    const companyId = getCompanyId();
    if (!sb || !companyId) {
      throw new Error('غير مصرح');
    }

    const session = getSession();
    const hasPerm = (window.Refad && window.Refad.hasPermission) ?
      window.Refad.hasPermission('company.theme') : false;

    if (!hasPerm && !(session && session.is_owner)) {
      throw new Error('ليس لديك صلاحية تغيير الثيم');
    }

    try {
      // جرب RPC أولاً
      try {
        const { error: rpcErr } = await sb.rpc('set_company_theme', {
          p_company_id: companyId,
          p_theme_slug: themeSlug || null,
          p_custom_theme_id: customThemeId || null,
          p_overrides: overrides || null
        });
        if (!rpcErr) {
          console.log('[RefadTheme] Theme saved via RPC');
          return true;
        }
      } catch (e) {
        // RPC not available
      }

      // Direct update
      const { error } = await sb.from('companies')
        .update({
          active_theme_slug: themeSlug || null,
          active_custom_theme_id: customThemeId || null,
          theme_overrides: overrides || {}
        })
        .eq('id', companyId);

      if (error) throw error;

      // Reload
      await loadFromDB(companyId);

      console.log('[RefadTheme] Theme saved');
      return true;

    } catch (e) {
      console.error('[RefadTheme] setTheme failed:', e);
      throw e;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ⭐ OPEN PICKER
  // ═══════════════════════════════════════════════════════════
  function openPicker() {
    // لو theme.js v3.0 موجود — استخدمه
    if (window.Refad && window.Refad.Theme && typeof window.Refad.Theme.openThemePicker === 'function') {
      window.Refad.Theme.openThemePicker();
      return;
    }

    // Fallback: picker بسيط
    openFallbackPicker();
  }

  function openFallbackPicker() {
    const existing = document.getElementById('refad-theme-picker-fallback');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'refad-theme-picker-fallback';
    modal.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.7);
      display:flex;align-items:center;justify-content:center;
      z-index:99998;padding:20px;backdrop-filter:blur(8px);
      font-family:inherit;direction:rtl;
    `;

    modal.innerHTML = `
      <div style="
        background:var(--card,#fff);border:1px solid var(--border,#e2e8f0);
        border-radius:20px;padding:24px;max-width:520px;width:100%;
        box-shadow:0 32px 80px rgba(0,0,0,0.3);
      ">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <h3 style="font-size:17px;font-weight:800;margin:0;color:var(--text,#0f172a)">🎨 الثيمات</h3>
          <button id="refad-fallback-close" style="
            width:32px;height:32px;border-radius:8px;border:none;
            background:var(--bg-soft,#f8fafc);color:var(--text-muted,#64748b);
            cursor:pointer;font-size:18px;
          ">✕</button>
        </div>

        <div id="refad-fallback-content" style="text-align:center;padding:20px;color:var(--text-muted,#64748b)">
          <div style="width:32px;height:32px;border:3px solid var(--border,#e2e8f0);border-top-color:var(--accent,#14B8A6);border-radius:50%;animation:refad-spin 0.7s linear infinite;margin:0 auto 12px;"></div>
          جاري التحميل...
        </div>
      </div>
      <style>
        @keyframes refad-spin { to { transform: rotate(360deg); } }
      </style>
    `;

    document.body.appendChild(modal);

    document.getElementById('refad-fallback-close').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

    // Load and render themes
    (async () => {
      try {
        const { builtin, custom } = await getAvailableThemes();
        const currentTheme = getTheme();
        const content = document.getElementById('refad-fallback-content');
        if (!content) return;

        if (builtin.length === 0 && custom.length === 0) {
          content.innerHTML = '<p style="color:var(--text-muted,#64748b)">لا توجد ثيمات متاحة</p>';
          return;
        }

        const renderCard = (t, isActive) => {
          const config = t.config || t;
          return `
            <div class="refad-fb-theme-card" data-slug="${t.slug || ''}" data-id="${t.id || ''}" style="
              background:${config.bg || '#F1F5F9'};
              color:${config.text || '#0f172a'};
              border:2px solid ${isActive ? (config.accent || '#14B8A6') : 'var(--border,#e2e8f0)'};
              border-radius:12px;padding:12px;cursor:pointer;text-align:right;
              ${isActive ? 'box-shadow:0 0 0 4px ' + (config.accent || '#14B8A6') + '33;' : ''}
            ">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <div style="width:24px;height:24px;border-radius:6px;background:${config.primary || '#0B2C4D'}"></div>
                <div style="width:24px;height:24px;border-radius:6px;background:${config.accent || '#14B8A6'}"></div>
                <div style="flex:1;font-weight:800;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t.name || 'بدون اسم'}</div>
              </div>
            </div>
          `;
        };

        content.innerHTML = `
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;">
            ${builtin.map(t => renderCard(
              { slug: t.slug, name: t.name, config: t.config },
              currentTheme && currentTheme.slug === t.slug
            )).join('')}
            ${custom.map(t => renderCard(
              { id: t.id, slug: t.slug, name: t.name, config: t.config },
              currentTheme && currentTheme.slug === t.slug
            )).join('')}
          </div>
        `;

        content.querySelectorAll('.refad-fb-theme-card').forEach(card => {
          card.onclick = async () => {
            try {
              const slug = card.dataset.slug;
              const id = card.dataset.id;
              const theme = (builtin.find(t => t.slug === slug) || custom.find(t => t.id === id));
              if (!theme) return;

              const config = Object.assign({ slug: theme.slug }, theme.config);
              apply(config);
              await setTheme(id ? null : slug, id || null, null);
              modal.remove();

              if (window.Refad && window.Refad.toast) {
                window.Refad.toast.success('تم تطبيق الثيم');
              }
            } catch (e) {
              console.error('[RefadTheme] picker save failed:', e);
              if (window.Refad && window.Refad.toast) {
                window.Refad.toast.error('فشل: ' + (e.message || ''));
              }
            }
          };
        });

      } catch (e) {
        console.error('[RefadTheme] fallback picker load failed:', e);
      }
    })();
  }

  // ═══════════════════════════════════════════════════════════
  // ⭐ INIT
  // ═══════════════════════════════════════════════════════════
  async function init() {
    if (state.isInitialized) {
      console.log('[RefadTheme] Already initialized');
      return getTheme();
    }

    // 1) Apply cached immediately (no flash)
    applyCached();
    state.isInitialized = true;

    // 2) Load from DB if session available
    const session = getSession();
    if (session && session.company_id) {
      try {
        await loadFromDB(session.company_id);
      } catch (e) {
        console.warn('[RefadTheme] init: loadFromDB failed (using cache):', e);
      }
    } else {
      // Wait for session
      let attempts = 0;
      const maxAttempts = 20; // 10 seconds

      const checkSession = setInterval(async () => {
        attempts++;
        const s = getSession();
        if (s && s.company_id) {
          clearInterval(checkSession);
          try {
            await loadFromDB(s.company_id);
          } catch (e) {
            console.warn('[RefadTheme] init: late loadFromDB failed:', e);
          }
        } else if (attempts >= maxAttempts) {
          clearInterval(checkSession);
        }
      }, 500);
    }

    // 3) Listen to theme changes
    window.addEventListener('refad:theme-changed', async (e) => {
      try {
        const detail = e.detail || {};
        if (detail.config) {
          apply(detail.config);
        } else {
          // Reload from DB
          await loadFromDB();
        }
      } catch (err) {
        console.warn('[RefadTheme] theme-changed handler failed:', err);
      }
    });

    // 4) Listen to settings-changed
    window.addEventListener('refad:settings-changed', async () => {
      try {
        await loadFromDB();
      } catch (err) {
        console.warn('[RefadTheme] settings-changed handler failed:', err);
      }
    });

    // 5) Setup realtime
    setupRealtime();

    console.log('[RefadTheme] v3.0 initialized');
    return getTheme();
  }

  // ═══════════════════════════════════════════════════════════
  // ⭐ REALTIME
  // ═══════════════════════════════════════════════════════════
  function setupRealtime() {
    const sb = getSb();
    const companyId = getCompanyId();
    if (!sb || !companyId) return;

    // Cleanup old
    if (window._refadThemeManagerChannel) {
      try { sb.removeChannel(window._refadThemeManagerChannel); } catch (e) {}
    }

    try {
      const channel = sb.channel('theme-manager-changes-' + companyId)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'companies',
          filter: 'id=eq.' + companyId
        }, (payload) => {
          console.log('[RefadTheme] Company theme changed via realtime');
          loadFromDB(companyId).catch(() => {});
        })
        .subscribe();

      window._refadThemeManagerChannel = channel;
    } catch (e) {
      console.warn('[RefadTheme] setupRealtime failed:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ⭐ PUBLIC API
  // ═══════════════════════════════════════════════════════════
  window.RefadTheme = {
    // Lifecycle
    init: init,
    isInitialized: function() { return state.isInitialized; },

    // Theme application
    apply: apply,
    applyCached: applyCached,
    loadFromDB: loadFromDB,
    getTheme: getTheme,

    // Theme management
    setTheme: setTheme,
    getAvailableThemes: getAvailableThemes,
    openPicker: openPicker,
    openSwitcher: openPicker,  // alias

    // Browser UI
    updateBrowserThemeColor: updateBrowserThemeColor,
    updateManifest: updateManifest,

    // State
    getState: function() { return Object.assign({}, state); },
    reload: async function() { return loadFromDB(); }
  };

  // ═══════════════════════════════════════════════════════════
  // ⭐ ALIASES (للتوافق مع الكود القديم)
  // ═══════════════════════════════════════════════════════════
  if (window.Refad) {
    window.Refad.Theme = window.Refad.Theme || window.RefadTheme;

    // Merge aliases لو theme.js v3.0 مش محمّل
    if (!window.Refad.Theme.applyTheme) {
      window.Refad.Theme.applyTheme = apply;
    }
    if (!window.Refad.Theme.getTheme) {
      window.Refad.Theme.getTheme = getTheme;
    }
    if (!window.Refad.Theme.loadCompanyTheme) {
      window.Refad.Theme.loadCompanyTheme = loadFromDB;
    }
    if (!window.Refad.Theme.openThemePicker) {
      window.Refad.Theme.openThemePicker = openPicker;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // AUTO-INIT
  // ═══════════════════════════════════════════════════════════
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init().catch(e => console.warn('[RefadTheme] auto-init failed:', e));
    });
  } else {
    init().catch(e => console.warn('[RefadTheme] auto-init failed:', e));
  }

  console.log('[RefadTheme] theme-manager.js v3.0 loaded');

})();