/* ============================================================
   theme.js — Refad ERP v3.0
   ⭐ v3.0: نظام ثيمات احترافي متكامل
   - Mode Manager (light/dark/auto) — تفضيل شخصي
   - Company Theme Applier — يطبق ثيم الشركة من الإعدادات
   - Theme Picker — UI لاختيار الثيم
   - Real-time updates — يستمع لتغييرات الثيم
   - Cache + Fallback
   - يدعم كل CSS variables (primary, accent, bg, text, ...)
   - يدعم theme_overrides + custom themes
   ============================================================ */
(function () {
  'use strict';

  const cfg = window.REFAD_CONFIG;
  if (!cfg) {
    console.error('[Refad] config.js لازم يتحمّل الأول!');
    return;
  }

  // ═══════════════════════════════════════════════════════════
  // CONSTANTS
  // ═══════════════════════════════════════════════════════════
  const KEY_THEME = cfg.THEME_KEY || 'refad_theme';
  const KEY_MODE  = 'refad_mode_preference';
  const KEY_CACHED_THEME = cfg.THEME_CACHE_KEY || 'refad_cached_theme';
  const KEY_CACHED_BRAND = cfg.BRAND_CACHE_KEY || 'refad_cached_brand';
  const KEY_CUSTOM_THEME = 'refad_custom_theme_overrides';

  // ═══════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════
  const state = {
    currentTheme: null,
    currentMode: 'light',
    isLoading: false,
    isInitialized: false,
    availableThemes: [],
    availableCustomThemes: []
  };

  // ═══════════════════════════════════════════════════════════
  // MODE PREFERENCE (light/dark/auto)
  // ═══════════════════════════════════════════════════════════
  function getModePreference() {
    try {
      const v = localStorage.getItem(KEY_MODE);
      if (v === 'light' || v === 'dark' || v === 'auto') return v;
      const legacy = localStorage.getItem(KEY_THEME);
      if (legacy === 'dark' || legacy === 'light') return legacy;
      return null;
    } catch (e) { return null; }
  }

  function setModePreference(mode) {
    try {
      if (mode === 'auto' || mode === null) {
        localStorage.removeItem(KEY_MODE);
        localStorage.removeItem(KEY_THEME);
      } else {
        localStorage.setItem(KEY_MODE, mode);
        localStorage.setItem(KEY_THEME, mode);
      }
    } catch (e) {}
  }

  function detectCurrentMode() {
    const pref = getModePreference();
    if (pref === 'light' || pref === 'dark') return pref;
    if (pref === 'auto') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    // من الثيم الحالي
    if (state.currentTheme && state.currentTheme.mode) {
      return state.currentTheme.mode;
    }
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark' || attr === 'light') return attr;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyMode(mode) {
    const root = document.documentElement;
    const targetMode = (mode === 'dark') ? 'dark' : 'light';
    state.currentMode = targetMode;

    root.setAttribute('data-theme', targetMode);
    document.body && document.body.classList.toggle('theme-dark', targetMode === 'dark');
    document.body && document.body.classList.toggle('theme-light', targetMode === 'light');

    // meta theme-color
    if (state.currentTheme && state.currentTheme.primary) {
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.content = state.currentTheme.primary;
    }

    window.dispatchEvent(new CustomEvent('refad:mode-changed', { detail: { mode: targetMode } }));
  }

  function toggleMode() {
    const current = detectCurrentMode();
    const next = current === 'dark' ? 'light' : 'dark';
    setModePreference(next);
    applyMode(next);
    return next;
  }

  function setMode(mode) {
    if (mode === 'auto') {
      setModePreference(null);
      const sys = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      applyMode(sys);
      return sys;
    }
    setModePreference(mode);
    applyMode(mode);
    return mode;
  }

  // ═══════════════════════════════════════════════════════════
  // ⭐ THEME APPLICATION — تطبيق الثيم من الإعدادات
  // ═══════════════════════════════════════════════════════════

  /**
   * يحوّل مفتاح JS (camelCase) إلى CSS variable
   * primaryLight → --primary-light
   */
  function jsKeyToCssVar(key) {
    return '--' + key.replace(/([A-Z])/g, '-$1').toLowerCase();
  }

  /**
   * هل القيمة دي لون؟
   */
  function isColor(value) {
    if (typeof value !== 'string') return false;
    return /^(#[0-9a-fA-F]{3,8}|rgb|rgba|hsl|hsla|var\()/.test(value.trim());
  }

  /**
   * ⭐ تطبيق ثيم كامل على DOM
   * @param {Object} themeConfig - { primary, accent, bg, text, ... }
   * @param {Object} options - { persist: true, mode: 'dark' }
   */
  function applyTheme(themeConfig, options) {
    options = options || {};
    if (!themeConfig) {
      console.warn('[Refad] applyTheme: themeConfig is null');
      return false;
    }

    try {
      const root = document.documentElement;

      // ⭐ تطبيق كل CSS variables
      const cssVarsMap = {
        // Primary colors
        'primary': themeConfig.primary,
        'primaryLight': themeConfig.primaryLight || themeConfig.primary_light,
        'primaryDark': themeConfig.primaryDark || themeConfig.primary_dark,
        // Accent
        'accent': themeConfig.accent,
        'accentDark': themeConfig.accentDark || themeConfig.accent_dark,
        // Backgrounds
        'bg': themeConfig.bg,
        'bgSoft': themeConfig.bgSoft || themeConfig.bg_soft,
        'bgCard': themeConfig.bgCard || themeConfig.bg_card,
        'bgSidebar': themeConfig.bgSidebar || themeConfig.bg_sidebar,
        'card': themeConfig.card || themeConfig.bgCard,
        // Text
        'text': themeConfig.text,
        'textMuted': themeConfig.textMuted || themeConfig.text_muted,
        // Borders
        'border': themeConfig.border,
        'borderSoft': themeConfig.borderSoft || themeConfig.border_soft,
        // Semantic
        'gold': themeConfig.gold,
        'success': themeConfig.success,
        'danger': themeConfig.danger,
        'warning': themeConfig.warning || themeConfig.gold,
        'info': themeConfig.info,
        'purple': themeConfig.purple,
        // Sizing
        'radius': themeConfig.radius,
        'fontFamily': themeConfig.fontFamily || themeConfig.font_family
      };

      // Soft colors (derived)
      const softColors = ['primary', 'accent', 'gold', 'success', 'danger', 'info', 'purple'];
      softColors.forEach(colorKey => {
        const color = themeConfig[colorKey];
        if (color && isColor(color)) {
          // extract RGB if hex
          if (/^#[0-9a-fA-F]{3,8}$/.test(color)) {
            const rgb = hexToRgb(color);
            if (rgb) {
              cssVarsMap[colorKey + 'Soft'] = `rgba(${rgb.r},${rgb.g},${rgb.b},0.1)`;
            }
          }
        }
      });

      // ⭐ Apply
      Object.entries(cssVarsMap).forEach(([key, value]) => {
        if (value !== undefined && value !== null && String(value).trim() !== '') {
          const cssVar = jsKeyToCssVar(key);
          root.style.setProperty(cssVar, String(value));
        }
      });

      // ⭐ Mode
      const mode = options.mode || themeConfig.mode || 'light';
      applyMode(mode);

      // ⭐ meta theme-color
      if (themeConfig.primary) {
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.content = themeConfig.primary;
      }

      // ⭐ Save state
      state.currentTheme = Object.assign({}, themeConfig);
      state.currentMode = mode;

      // ⭐ Cache
      if (options.persist !== false) {
        try {
          localStorage.setItem(KEY_CACHED_THEME, JSON.stringify(themeConfig));
        } catch (e) {}
      }

      // ⭐ Dispatch event
      window.dispatchEvent(new CustomEvent('refad:theme-applied', {
        detail: { theme: themeConfig, mode: mode }
      }));

      console.log('[Refad] Theme applied:', themeConfig.slug || themeConfig.name || 'custom');
      return true;

    } catch (e) {
      console.error('[Refad] applyTheme failed:', e);
      return false;
    }
  }

  /**
   * تحويل hex إلى RGB
   */
  function hexToRgb(hex) {
    try {
      hex = hex.replace('#', '');
      if (hex.length === 3) {
        hex = hex.split('').map(c => c + c).join('');
      }
      if (hex.length !== 6 && hex.length !== 8) return null;
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      return { r, g, b };
    } catch (e) { return null; }
  }

  /**
   * ⭐ تطبيق من الـ cache
   */
  function applyCached() {
    try {
      const cached = localStorage.getItem(KEY_CACHED_THEME);
      if (cached) {
        const theme = JSON.parse(cached);
        applyTheme(theme, { persist: false });
        return true;
      }
    } catch (e) {
      console.warn('[Refad] applyCached failed:', e);
    }

    // ⭐ لو مفيش cache — طبق الافتراضي
    const defaultTheme = {
      primary: cfg.DEFAULT_SETTINGS?.theme?.primary || '#0B2C4D',
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
      mode: cfg.DEFAULT_THEME_MODE || 'light'
    };
    applyTheme(defaultTheme, { persist: false });
    return false;
  }

  /**
   * ⭐ جلب الثيم الحالي
   */
  function getTheme() {
    if (state.currentTheme) return Object.assign({}, state.currentTheme);
    try {
      const cached = localStorage.getItem(KEY_CACHED_THEME);
      if (cached) return JSON.parse(cached);
    } catch (e) {}
    return null;
  }

  // ═══════════════════════════════════════════════════════════
  // ⭐ LOAD THEME FROM DATABASE
  // ═══════════════════════════════════════════════════════════
  async function loadCompanyTheme() {
    const sb = window.Refad && window.Refad.sb;
    const session = window.Refad && window.Refad._session;
    if (!sb || !session || !session.company_id) {
      console.warn('[Refad] loadCompanyTheme: no sb or session');
      return null;
    }

    state.isLoading = true;

    try {
      // 1) جلب بيانات الشركة
      const { data: company, error: companyErr } = await sb.from('companies')
        .select('active_theme_slug, active_custom_theme_id, theme_overrides')
        .eq('id', session.company_id)
        .maybeSingle();

      if (companyErr) {
        console.warn('[Refad] loadCompanyTheme: company fetch failed:', companyErr);
        state.isLoading = false;
        return null;
      }

      if (!company) {
        state.isLoading = false;
        return null;
      }

      let themeConfig = null;

      // 2) ثيم مخصص للشركة أولاً
      if (company.active_custom_theme_id) {
        const { data: custom } = await sb.from('company_themes')
          .select('slug, name, config')
          .eq('id', company.active_custom_theme_id)
          .maybeSingle();
        if (custom && custom.config) {
          themeConfig = Object.assign({ slug: custom.slug, name: custom.name }, custom.config);
        }
      }

      // 3) ثيم جاهز
      if (!themeConfig && company.active_theme_slug) {
        const { data: builtin } = await sb.from('themes')
          .select('slug, name, config')
          .eq('slug', company.active_theme_slug)
          .maybeSingle();
        if (builtin && builtin.config) {
          themeConfig = Object.assign({ slug: builtin.slug, name: builtin.name }, builtin.config);
        }
      }

      // 4) Fallback: default theme
      if (!themeConfig) {
        themeConfig = {
          slug: cfg.DEFAULT_THEME_SLUG,
          name: 'Default',
          primary: '#0B2C4D',
          accent: '#14B8A6',
          bg: '#F1F5F9',
          text: '#0f172a',
          mode: cfg.DEFAULT_THEME_MODE
        };
      }

      // 5) تطبيق theme_overrides
      if (company.theme_overrides && typeof company.theme_overrides === 'object') {
        themeConfig = Object.assign({}, themeConfig, company.theme_overrides);
      }

      // 6) تطبيق
      applyTheme(themeConfig, { persist: true });

      // 7) Cache brand
      try {
        const { data: brand } = await sb.from('companies')
          .select('name, logo_url').eq('id', session.company_id).maybeSingle();
        if (brand) {
          localStorage.setItem(KEY_CACHED_BRAND, JSON.stringify(brand));
        }
      } catch (e) {}

      state.isLoading = false;
      return themeConfig;

    } catch (e) {
      console.error('[Refad] loadCompanyTheme failed:', e);
      state.isLoading = false;
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ⭐ SAVE THEME TO DATABASE
  // ═══════════════════════════════════════════════════════════
  async function saveTheme(themeSlug, customThemeId, overrides) {
    const sb = window.Refad && window.Refad.sb;
    const session = window.Refad && window.Refad._session;
    if (!sb || !session || !session.company_id) {
      throw new Error('غير مصرح');
    }

    // تحقق من الصلاحية
    const hasPerm = (window.Refad && window.Refad.hasPermission) ?
      window.Refad.hasPermission('company.theme') : false;

    if (!hasPerm && !session.is_owner) {
      throw new Error('ليس لديك صلاحية تغيير الثيم');
    }

    try {
      // ⭐ استخدام RPC set_company_theme لو موجود
      if (typeof sb.rpc === 'function') {
        try {
          const { error: rpcErr } = await sb.rpc('set_company_theme', {
            p_company_id: session.company_id,
            p_theme_slug: themeSlug,
            p_custom_theme_id: customThemeId || null,
            p_overrides: overrides || null
          });
          if (!rpcErr) {
            console.log('[Refad] Theme saved via RPC');
            return true;
          }
        } catch (e) {
          // RPC مش موجود — نكمل بـ direct update
        }
      }

      // ⭐ Direct update
      const { error } = await sb.from('companies')
        .update({
          active_theme_slug: themeSlug || null,
          active_custom_theme_id: customThemeId || null,
          theme_overrides: overrides || {}
        })
        .eq('id', session.company_id);

      if (error) throw error;

      console.log('[Refad] Theme saved');
      return true;

    } catch (e) {
      console.error('[Refad] saveTheme failed:', e);
      throw e;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ⭐ LOAD AVAILABLE THEMES
  // ═══════════════════════════════════════════════════════════
  async function loadAvailableThemes() {
    const sb = window.Refad && window.Refad.sb;
    const session = window.Refad && window.Refad._session;
    if (!sb) return { builtin: [], custom: [] };

    try {
      // 1) الثيمات الجاهزة
      const { data: builtin } = await sb.from('themes')
        .select('id, slug, name, description, config, is_default')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      state.availableThemes = builtin || [];

      // 2) الثيمات المخصصة للشركة
      let custom = [];
      if (session && session.company_id) {
        const { data: customData } = await sb.from('company_themes')
          .select('id, slug, name, description, config')
          .eq('company_id', session.company_id)
          .order('created_at', { ascending: false });
        custom = customData || [];
      }
      state.availableCustomThemes = custom;

      return {
        builtin: state.availableThemes,
        custom: state.availableCustomThemes
      };

    } catch (e) {
      console.error('[Refad] loadAvailableThemes failed:', e);
      return { builtin: [], custom: [] };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ⭐ THEME PICKER — UI لاختيار الثيم
  // ═══════════════════════════════════════════════════════════
  async function openThemePicker() {
    // 1) حذف أي picker موجود
    const existing = document.getElementById('refad-theme-picker');
    if (existing) existing.remove();

    // 2) تحميل الثيمات
    const { builtin, custom } = await loadAvailableThemes();
    const currentTheme = getTheme();

    // 3) بناء الـ modal
    const modal = document.createElement('div');
    modal.id = 'refad-theme-picker';
    modal.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.7);
      display:flex;align-items:center;justify-content:center;
      z-index:99998;padding:20px;backdrop-filter:blur(8px);
      font-family:inherit;direction:rtl;
    `;

    const renderThemeCard = (theme, isActive) => {
      const config = theme.config || theme;
      const primary = config.primary || '#0B2C4D';
      const accent = config.accent || '#14B8A6';
      const bg = config.bg || '#F1F5F9';
      const text = config.text || '#0f172a';

      return `
        <div data-theme-slug="${theme.slug || ''}" data-theme-id="${theme.id || ''}" class="refad-theme-card" style="
          background:${bg};color:${text};
          border:2px solid ${isActive ? accent : 'var(--border,#e2e8f0)'};
          border-radius:14px;padding:14px;cursor:pointer;
          transition:all 0.15s;position:relative;
          ${isActive ? 'box-shadow:0 0 0 4px ' + accent + '33;' : ''}
        ">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
            <div style="
              width:32px;height:32px;border-radius:8px;
              background:${primary};flex-shrink:0;
            "></div>
            <div style="
              width:32px;height:32px;border-radius:8px;
              background:${accent};flex-shrink:0;
            "></div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:800;font-size:13px;color:${text};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                ${theme.name || 'بدون اسم'}
              </div>
              ${theme.description ? `<div style="font-size:10.5px;color:${text}aa;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${theme.description}</div>` : ''}
            </div>
            ${isActive ? `<span style="color:${accent};font-weight:900;font-size:18px;">✓</span>` : ''}
          </div>
          <div style="
            background:${bg};border:1px solid ${text}22;
            border-radius:6px;padding:6px 8px;font-size:10px;
            color:${text}aa;font-family:monospace;
          ">
            ${config.mode === 'dark' ? '🌙 داكن' : '☀️ فاتح'}
          </div>
        </div>
      `;
    };

    modal.innerHTML = `
      <div style="
        background:var(--card,#fff);border:1px solid var(--border,#e2e8f0);
        border-radius:20px;padding:24px;max-width:900px;width:100%;
        max-height:90vh;overflow-y:auto;
        box-shadow:0 32px 80px rgba(0,0,0,0.3);
      ">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;position:sticky;top:0;background:var(--card,#fff);padding-bottom:14px;border-bottom:1px solid var(--border,#e2e8f0);z-index:1;">
          <div>
            <h3 style="font-size:18px;font-weight:800;margin:0;color:var(--text,#0f172a);display:flex;align-items:center;gap:10px;">
              <i data-lucide="palette" style="width:22px;height:22px;color:var(--accent,#14B8A6);"></i>
              اختر الثيم
            </h3>
            <p style="font-size:12px;color:var(--text-muted,#64748b);margin:4px 0 0 0;">
              اختر الثيم المناسب لشركتك — يطبق على كل المستخدمين
            </p>
          </div>
          <button id="refad-theme-picker-close" style="
            width:36px;height:36px;border-radius:10px;border:none;
            background:var(--bg-soft,#f8fafc);color:var(--text-muted,#64748b);
            cursor:pointer;font-size:20px;display:flex;align-items:center;justify-content:center;
          ">✕</button>
        </div>

        <!-- Built-in themes -->
        <h4 style="font-size:14px;font-weight:800;color:var(--text,#0f172a);margin:16px 0 12px 0;">
          🎨 الثيمات الجاهزة (${builtin.length})
        </h4>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;">
          ${builtin.length === 0 ? '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-muted,#64748b);font-size:12px;">لا توجد ثيمات جاهزة</div>' : ''}
          ${builtin.map(t => renderThemeCard(
            { slug: t.slug, name: t.name, description: t.description, config: t.config },
            currentTheme && currentTheme.slug === t.slug
          )).join('')}
        </div>

        <!-- Custom themes -->
        ${custom.length > 0 ? `
          <h4 style="font-size:14px;font-weight:800;color:var(--text,#0f172a);margin:24px 0 12px 0;">
            ⭐ ثيماتك المخصصة (${custom.length})
          </h4>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;">
            ${custom.map(t => renderThemeCard(
              { id: t.id, slug: t.slug, name: t.name, description: t.description, config: t.config },
              currentTheme && currentTheme.slug === t.slug
            )).join('')}
          </div>
        ` : ''}

        <!-- Mode toggle -->
        <div style="margin-top:24px;padding-top:18px;border-top:1px solid var(--border,#e2e8f0);">
          <h4 style="font-size:14px;font-weight:800;color:var(--text,#0f172a);margin:0 0 10px 0;">
            🌓 وضع العرض (لك شخصياً)
          </h4>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button data-mode="light" style="flex:1;min-width:100px;padding:10px;border:1px solid var(--border,#e2e8f0);border-radius:10px;background:${getModePreference() === 'light' ? 'var(--accent-soft,rgba(20,184,166,0.1))' : 'var(--bg-soft,#f8fafc)'};color:var(--text,#0f172a);font-family:inherit;font-weight:700;font-size:12px;cursor:pointer;">
              ☀️ فاتح
            </button>
            <button data-mode="dark" style="flex:1;min-width:100px;padding:10px;border:1px solid var(--border,#e2e8f0);border-radius:10px;background:${getModePreference() === 'dark' ? 'var(--accent-soft,rgba(20,184,166,0.1))' : 'var(--bg-soft,#f8fafc)'};color:var(--text,#0f172a);font-family:inherit;font-weight:700;font-size:12px;cursor:pointer;">
              🌙 داكن
            </button>
            <button data-mode="auto" style="flex:1;min-width:100px;padding:10px;border:1px solid var(--border,#e2e8f0);border-radius:10px;background:${getModePreference() === null || getModePreference() === 'auto' ? 'var(--accent-soft,rgba(20,184,166,0.1))' : 'var(--bg-soft,#f8fafc)'};color:var(--text,#0f172a);font-family:inherit;font-weight:700;font-size:12px;cursor:pointer;">
              🔄 تلقائي
            </button>
          </div>
          <p style="font-size:11px;color:var(--text-muted,#64748b);margin:10px 0 0 0;line-height:1.6;">
            💡 <b>ملاحظة:</b> الثيم يطبق على كل المستخدمين. وضع العرض (فاتح/داكن) يطبق عليك شخصياً فقط.
          </p>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    if (window.lucide) window.lucide.createIcons();

    // ═══════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════
    document.getElementById('refad-theme-picker-close').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

    // Theme cards
    modal.querySelectorAll('.refad-theme-card').forEach(card => {
      card.onclick = async () => {
        const slug = card.dataset.themeSlug;
        const id = card.dataset.themeId;

        try {
          // Preview
          const theme = (builtin.find(t => t.slug === slug) ||
                         custom.find(t => t.id === id) || {}).config;
          if (theme) {
            applyTheme(Object.assign({ slug }, theme), { persist: false });
          }

          // Save to DB
          const customId = id || null;
          await saveTheme(customId ? null : slug, customId, null);

          // Reapply (with persist)
          if (theme) {
            applyTheme(Object.assign({ slug }, theme), { persist: true });
          }

          // Reload picker
          modal.remove();
          setTimeout(() => openThemePicker(), 300);

          // Toast
          if (window.Refad && window.Refad.toast) {
            window.Refad.toast.success('تم تطبيق الثيم');
          }

        } catch (e) {
          console.error('[Refad] Theme picker error:', e);
          if (window.Refad && window.Refad.toast) {
            window.Refad.toast.error('فشل: ' + (e.message || ''));
          }
        }
      };
    });

    // Mode buttons
    modal.querySelectorAll('[data-mode]').forEach(btn => {
      btn.onclick = () => {
        setMode(btn.dataset.mode);
        modal.remove();
        setTimeout(() => openThemePicker(), 200);
      };
    });
  }

  // ═══════════════════════════════════════════════════════════
  // 👂 WATCH SYSTEM PREFERENCE
  // ═══════════════════════════════════════════════════════════
  function watchSystemPreference() {
    try {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (e) => {
        const pref = getModePreference();
        if (pref === null) {
          const themeMode = (state.currentTheme && state.currentTheme.mode) || 'light';
          if (themeMode === 'dark') return;
          applyMode(e.matches ? 'dark' : 'light');
        } else if (pref === 'auto') {
          applyMode(e.matches ? 'dark' : 'light');
        }
      };
      if (media.addEventListener) media.addEventListener('change', handler);
      else if (media.addListener) media.addListener(handler);
    } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════
  // 👂 WATCH COMPANY THEME CHANGES
  // ═══════════════════════════════════════════════════════════
  function watchCompanyThemeChanges() {
    // ⭐ refad:theme-changed
    window.addEventListener('refad:theme-changed', (e) => {
      try {
        const theme = e.detail || {};
        if (theme.config) {
          applyTheme(theme.config, { persist: true });
        }
      } catch (err) {
        console.warn('[Refad] theme change handler failed:', err);
      }
    });

    // ⭐ refad:settings-changed → reload theme
    window.addEventListener('refad:settings-changed', () => {
      loadCompanyTheme().catch(err => console.warn('[Refad] reload theme failed:', err));
    });

    // ⭐ refad:warehouse-changed → مش محتاج نعمل حاجة (نفس الثيم)
  }

  // ═══════════════════════════════════════════════════════════
  // 👂 REALTIME — مراقبة تغييرات الثيم في DB
  // ═══════════════════════════════════════════════════════════
  function setupRealtime() {
    const sb = window.Refad && window.Refad.sb;
    const session = window.Refad && window.Refad._session;
    if (!sb || !session || !session.company_id) return;

    try {
      const channel = sb.channel('theme-changes')
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'companies',
          filter: 'id=eq.' + session.company_id
        }, (payload) => {
          console.log('[Refad] Company theme changed via realtime');
          if (payload.new) {
            // reload theme
            loadCompanyTheme().catch(() => {});
          }
        })
        .subscribe();

      // Store for cleanup
      window._refadThemeChannel = channel;
    } catch (e) {
      console.warn('[Refad] Realtime setup failed:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 🎯 INIT
  // ═══════════════════════════════════════════════════════════
  async function init() {
    if (state.isInitialized) return;

    // 1) طبّق الثيم من الـ cache فوراً (عشان مايحصلش flash)
    applyCached();
    state.isInitialized = true;

    // 2) راقب تغييرات النظام
    watchSystemPreference();

    // 3) راقب تغييرات الثيم
    watchCompanyThemeChanges();

    // 4) لو فيه session، حمّل الثيم من DB
    if (window.Refad && window.Refad._session) {
      try {
        await loadCompanyTheme();
        setupRealtime();
      } catch (e) {
        console.warn('[Refad] loadCompanyTheme failed (using cache):', e);
      }
    } else {
      // انتظر لحد ما الـ session تجهز
      const checkSession = setInterval(async () => {
        if (window.Refad && window.Refad._session) {
          clearInterval(checkSession);
          try {
            await loadCompanyTheme();
            setupRealtime();
          } catch (e) {
            console.warn('[Refad] loadCompanyTheme failed (using cache):', e);
          }
        }
      }, 500);

      // Stop after 10s
      setTimeout(() => clearInterval(checkSession), 10000);
    }

    console.log('[Refad] theme.js v3.0 ready — mode:', state.currentMode);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ═══════════════════════════════════════════════════════════
  // 📤 EXPORTS
  // ═══════════════════════════════════════════════════════════
  window.Refad = window.Refad || {};

  window.Refad.Theme = {
    // ⭐ New API v3.0
    getTheme: getTheme,
    applyTheme: applyTheme,
    loadCompanyTheme: loadCompanyTheme,
    saveTheme: saveTheme,
    loadAvailableThemes: loadAvailableThemes,
    openThemePicker: openThemePicker,
    applyCached: applyCached,

    // ⭐ Mode API
    getMode: detectCurrentMode,
    setMode: setMode,
    toggle: toggleMode,
    getPreference: getModePreference,

    // ⭐ Backwards compat
    openSwitcher: openThemePicker,  // يستخدم الـ picker الجديد
    apply: function(themeName, accentName) {
      // deprecated
      if (themeName === 'dark') applyMode('dark');
      else if (themeName === 'light') applyMode('light');
      console.warn('[Refad] Theme.apply deprecated — use Refad.Theme.applyTheme(config)');
    },

    // ⭐ State
    getState: function() { return Object.assign({}, state); },
    isInitialized: function() { return state.isInitialized; }
  };

  console.log('[Refad] theme.js v3.0 ready — full theme manager');

})();