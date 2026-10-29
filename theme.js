/* ============================================================
   theme.js — Refad ERP v2.0
   ⚠️ Lightweight dark/light toggle
   ⚠️ لا يتحكم في الألوان — الألوان من theme-manager.js
   ============================================================ */
(function () {
  'use strict';

  const cfg = window.REFAD_CONFIG;
  if (!cfg) {
    console.error('[Refad] config.js لازم يتحمّل الأول!');
    return;
  }

  // ═══════════════════════════════════════════════════════════
  // 💾 SAVE / LOAD DARK MODE PREFERENCE
  // ═══════════════════════════════════════════════════════════
  const KEY_THEME = cfg.THEME_KEY || 'refad_theme';           // 'refad_theme'
  const KEY_MODE  = 'refad_mode_preference';                  // 'light' | 'dark' | 'auto' | null

  function getModePreference() {
    try {
      const v = localStorage.getItem(KEY_MODE);
      if (v === 'light' || v === 'dark' || v === 'auto') return v;
      // backwards compat: لو حد كان بيستخدم theme.js القديم
      const legacy = localStorage.getItem(KEY_THEME);
      if (legacy === 'dark' || legacy === 'light') return legacy;
      return null; // ما اختارش
    } catch (e) { return null; }
  }

  function setModePreference(mode) {
    try {
      if (mode === 'auto' || mode === null) {
        localStorage.removeItem(KEY_MODE);
        localStorage.removeItem(KEY_THEME);
      } else {
        localStorage.setItem(KEY_MODE, mode);
        localStorage.setItem(KEY_THEME, mode); // legacy
      }
    } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════
  // 🎯 DETECT CURRENT MODE
  // أولوية: user preference → theme from company → system → light
  // ═══════════════════════════════════════════════════════════
  function detectCurrentMode() {
    // 1) user preference
    const pref = getModePreference();
    if (pref === 'light' || pref === 'dark') return pref;
    if (pref === 'auto') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    // 2) theme from company (عن طريق RefadTheme لو موجود)
    if (window.RefadTheme) {
      try {
        const theme = window.RefadTheme.getTheme();
        if (theme && theme.mode) return theme.mode;
      } catch (e) {}
    }

    // 3) fallback: من data-theme الموجود
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'dark' || attr === 'light') return attr;

    // 4) system preference
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  // ═══════════════════════════════════════════════════════════
  // 🎨 APPLY MODE (light / dark only — لا يمس الألوان)
  // ═══════════════════════════════════════════════════════════
  function applyMode(mode) {
    const root = document.documentElement;
    const targetMode = (mode === 'dark') ? 'dark' : 'light';

    root.setAttribute('data-theme', targetMode);
    document.body && document.body.classList.toggle('theme-dark', targetMode === 'dark');
    document.body && document.body.classList.toggle('theme-light', targetMode === 'light');

    // ⭐ حدّث meta theme-color (لمتصفح الموبايل)
    if (window.RefadTheme) {
      try {
        const theme = window.RefadTheme.getTheme();
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta && theme && theme.primary) meta.content = theme.primary;
      } catch (e) {}
    }

    // ⭐ dispatch event عشان الصفحات تستجيب لو حابة
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
  // 👂 LISTEN TO SYSTEM PREFERENCE (لو المستخدم في auto mode)
  // ═══════════════════════════════════════════════════════════
  function watchSystemPreference() {
    try {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (e) => {
        const pref = getModePreference();
        // لو مفيش تفضيل شخصي + مفيش ثيم داكن من الشركة → اتبع النظام
        if (pref === null) {
          const themeMode = (window.RefadTheme && window.RefadTheme.getTheme && window.RefadTheme.getTheme().mode) || 'light';
          // لو ثيم الشركة داكن → سيبه
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
  // 👂 LISTEN TO THEME CHANGES FROM COMPANY
  // لما المالك يغيّر الثيم (light ↔ dark)، نعيد تطبيق الـ mode
  // ═══════════════════════════════════════════════════════════
  function watchCompanyThemeChanges() {
    window.addEventListener('refad:theme-changed', (e) => {
      try {
        const theme = e.detail || {};
        const pref = getModePreference();

        // لو المستخدم اختار light أو dark صراحة → احترم اختياره
        if (pref === 'light' || pref === 'dark') return;

        // غير كده: اتبع ثيم الشركة
        const targetMode = theme.mode || 'light';
        if (pref === 'auto') {
          // auto: system preference
          const sys = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
          applyMode(sys);
        } else {
          // null: follow company theme
          applyMode(targetMode);
        }
      } catch (err) {
        console.warn('[Refad] theme change handler failed:', err);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  // 🎨 BACKWARDS COMPAT: Refad.Theme API (لـ sidebar.js القديم)
  // ═══════════════════════════════════════════════════════════
  // sidebar.js القديم بيعمل: Refad.Theme.openSwitcher() أو Refad.Theme.apply()
  // لازم نعمل shims عشان مايكراش

  function openModeSwitcher() {
    // Modal بسيط: light / dark / auto
    let modal = document.getElementById('refad-mode-modal');
    if (modal) { modal.remove(); }

    const current = getModePreference() || 'auto';

    modal = document.createElement('div');
    modal.id = 'refad-mode-modal';
    modal.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.7);
      display:flex;align-items:center;justify-content:center;
      z-index:99998;padding:20px;backdrop-filter:blur(8px);
      font-family:inherit;direction:rtl;
    `;

    const options = [
      { key: 'light', label: 'فاتح', icon: 'sun', desc: 'دائماً فاتح' },
      { key: 'dark',  label: 'داكن', icon: 'moon', desc: 'دائماً داكن' },
      { key: 'auto',  label: 'تلقائي', icon: 'monitor', desc: 'حسب النظام' }
    ];

    modal.innerHTML = `
      <div style="
        background:var(--card,#fff);border:1px solid var(--border,#e2e8f0);
        border-radius:20px;padding:24px;max-width:420px;width:100%;
        box-shadow:0 32px 80px rgba(0,0,0,0.3);
      ">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <h3 style="font-size:17px;font-weight:800;margin:0;color:var(--text,#0f172a)">🌓 وضع العرض</h3>
          <button id="refad-mode-close" style="
            width:32px;height:32px;border-radius:8px;border:none;
            background:var(--bg-soft,#f8fafc);color:var(--text-muted,#64748b);
            cursor:pointer;font-size:18px;
          ">✕</button>
        </div>

        <div style="display:flex;flex-direction:column;gap:10px;">
          ${options.map(o => `
            <button data-mode="${o.key}" style="
              display:flex;align-items:center;gap:14px;padding:14px 16px;
              background:${current === o.key ? 'var(--accent-soft, rgba(20,184,166,0.1))' : 'var(--bg-soft,#f8fafc)'};
              border:2px solid ${current === o.key ? 'var(--accent,#14B8A6)' : 'var(--border,#e2e8f0)'};
              border-radius:12px;cursor:pointer;transition:all 0.15s;
              color:var(--text,#0f172a);font-family:inherit;text-align:right;
            ">
              <i data-lucide="${o.icon}" style="width:20px;height:20px;color:var(--accent,#14B8A6)"></i>
              <div style="flex:1">
                <div style="font-weight:700;font-size:14px">${o.label}</div>
                <div style="font-size:12px;color:var(--text-muted,#64748b);margin-top:2px">${o.desc}</div>
              </div>
              ${current === o.key ? '<span style="color:var(--accent,#14B8A6);font-weight:800">✓</span>' : ''}
            </button>
          `).join('')}
        </div>

        <div style="margin-top:16px;padding:12px;background:var(--bg-soft,#f8fafc);border-radius:10px;font-size:11.5px;color:var(--text-muted,#64748b);line-height:1.6">
          💡 <b>ملاحظة:</b> ألوان الشركة الأساسية يحددها المالك من صفحة الإعدادات. هذا الاختيار يؤثر فقط على الوضع الفاتح/الداكن لجهازك.
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    if (window.lucide) window.lucide.createIcons();

    document.getElementById('refad-mode-close').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

    modal.querySelectorAll('[data-mode]').forEach(btn => {
      btn.onclick = () => {
        setMode(btn.dataset.mode);
        modal.remove();
      };
    });
  }

  // ═══════════════════════════════════════════════════════════
  // 🎯 INIT
  // ═══════════════════════════════════════════════════════════
  function init() {
    // اقرأ الـ mode الحالي وطبّقه
    const mode = detectCurrentMode();
    applyMode(mode);

    // راقب تغييرات النظام
    watchSystemPreference();

    // راقب تغييرات الثيم من الشركة
    watchCompanyThemeChanges();

    console.log('[Refad] theme.js v2.0 ready — mode:', mode);
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
    // API جديدة
    getMode: detectCurrentMode,
    setMode: setMode,
    toggle: toggleMode,
    openSwitcher: openModeSwitcher,
    getPreference: getModePreference,

    // ⭐ Backwards compat: الـ code القديم في sidebar.js كان بيعمل
    // Refad.Theme.openSwitcher() — لسه شغال
    // Refad.Theme.apply() — كنا بنستقبل (theme, accent)، دلوقتي نتجاهل الألوان
    apply: function(themeName, accentName) {
      // ⚠️ deprecated: الألوان بقت من RefadTheme فقط
      // نتجاهل accent ونطبّق theme فقط لو light/dark
      if (themeName === 'dark' || themeName === 'midnight' || themeName === 'royal') {
        applyMode('dark');
      } else if (themeName === 'light' || themeName === 'ocean' || themeName === 'forest' || themeName === 'sunset' || themeName === 'mono') {
        applyMode('light');
      }
      console.warn('[Refad] Theme.apply(theme, accent) is deprecated. Use RefadTheme.apply(config) instead.');
    },

    // Legacy: كنا بنعرض الثيمات الـ 8 القديمة — دلوقتي فاضي
    themes: {},
    accents: {}
  };

  console.log('[Refad] theme.js v2.0 ready (lightweight mode manager)');

})();/* ============================================================
   config.js — Refad ERP v4.0
   الإعدادات الموحّدة (Supabase + App + Permissions + Warehouses + Session)
   ⭐ v4.0: Presets + Offline + Forecast + Seasons + Mixed Payment + Logo Fallback
   ⚠️ لا تضع أي API Keys هنا — استخدم Supabase Edge Functions
   ============================================================ */
(function () {
  'use strict';

  window.REFAD_CONFIG = {
    // ═══════════════════════════════════════════════════════════
    // 🔌 SUPABASE
    // ═══════════════════════════════════════════════════════════
    SUPABASE_URL: 'https://caxjllazjhzlgmvtktjh.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNheGpsbGF6amh6bGdtdnRrdGpoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxOTM5MDcsImV4cCI6MjEwODc2OTkwN30.zTon6I41V7bV1xN3ky9hT02O_R2koHv6cWI3NcBGWSo',

    // ═══════════════════════════════════════════════════════════
    // 📱 APP INFO
    // ═══════════════════════════════════════════════════════════
    APP_NAME: 'رفاد سوبرماركت',
    APP_VERSION: '4.0.0',
    LOGO_URL: 'logo.png',

    // ═══════════════════════════════════════════════════════════
    // 🖼️ LOGO — مع fallback احترافي
    // ═══════════════════════════════════════════════════════════
    LOGO: {
      URL: 'logo.png',
      ALT: 'رفاد',
      LOAD_TIMEOUT_MS: 3000,
      // fallback: حرف "ر" في دايرة بلون الـ accent
      FALLBACK_SVG: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%"><defs><linearGradient id="rg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#14B8A6"/><stop offset="100%" style="stop-color:#0d9488"/></linearGradient></defs><rect width="100" height="100" rx="20" fill="url(#rg)"/><text x="50" y="68" font-size="52" font-weight="900" fill="#fff" text-anchor="middle" font-family="Tahoma,Arial,sans-serif">ر</text></svg>',
      FALLBACK_TEXT: 'رفاد'
    },

    // ═══════════════════════════════════════════════════════════
    // 🌍 LOCALE
    // ═══════════════════════════════════════════════════════════
    DEFAULT_CURRENCY: 'EGP',
    DEFAULT_LOCALE: 'ar-EG',
    DEFAULT_DIRECTION: 'rtl',
    DEFAULT_TIMEZONE: 'Africa/Cairo',

    // ═══════════════════════════════════════════════════════════
    // 🎨 THEME
    // ═══════════════════════════════════════════════════════════
    DEFAULT_THEME_SLUG: 'default-blue',
    DEFAULT_THEME_MODE: 'light',
    THEME_KEY: 'refad_theme',
    ACCENT_KEY: 'refad_accent',
    THEME_CACHE_KEY: 'refad_cached_theme',
    BRAND_CACHE_KEY: 'refad_cached_brand',

    // ═══════════════════════════════════════════════════════════
    // 🔐 SESSION
    // ═══════════════════════════════════════════════════════════
    SESSION_KEY: 'refad_token',
    BRANCH_KEY: 'refad_branch',
    COMPANY_KEY: 'refad_company',
    SETTINGS_CACHE_TTL_MS: 5 * 60 * 1000,
    SESSION_TIMEOUT_MINUTES: 480,

    // ═══════════════════════════════════════════════════════════
    // 🎯 PLATFORM ADMIN
    // ═══════════════════════════════════════════════════════════
    PLATFORM_ADMIN_USERNAME: 'admin',
    PLATFORM_ADMIN_EMAIL: 'admin@refad.app',

    // ═══════════════════════════════════════════════════════════
    // 🛡️ PERMISSIONS CATALOG
    // ═══════════════════════════════════════════════════════════
    PERMISSIONS: {
      PLATFORM_ADMIN: 'platform.admin',
      ADMIN_FULL: 'admin.full',

      COMPANY_VIEW: 'company.view',
      COMPANY_EDIT: 'company.edit',
      COMPANY_DELETE: 'company.delete',
      COMPANY_THEME: 'company.theme',
      COMPANY_PRESET_APPLY: 'company.preset_apply',   // ⭐ جديد

      BRANCHES_VIEW: 'branches.view',
      BRANCHES_MANAGE: 'branches.manage',
      BRANCHES_DELETE: 'branches.delete',
      BRANCHES_COMPARE: 'branches.compare',           // ⭐ جديد

      WAREHOUSES_VIEW: 'warehouses.view',
      WAREHOUSES_MANAGE: 'warehouses.manage',
      WAREHOUSES_DELETE: 'warehouses.delete',
      WAREHOUSES_TRANSFER: 'warehouses.transfer',
      WAREHOUSES_COUNT: 'warehouses.count',
      WAREHOUSES_APPROVE_TRANSFER: 'warehouses.approve_transfer',

      PRODUCTS_VIEW: 'products.view',
      PRODUCTS_MANAGE: 'products.manage',
      PRODUCTS_DELETE: 'products.delete',
      PRODUCTS_PRICE: 'products.price_edit',
      PRODUCTS_COST: 'products.cost_view',

      INVENTORY_VIEW: 'inventory.view',
      INVENTORY_USE: 'inventory.use',
      INVENTORY_ADJUST: 'inventory.adjust',
      INVENTORY_SHRINK: 'inventory.shrink',

      FORECAST_VIEW: 'forecast.view',                 // ⭐ جديد
      FORECAST_MANAGE: 'forecast.manage',             // ⭐ جديد
      SEASONS_VIEW: 'seasons.view',                   // ⭐ جديد
      SEASONS_MANAGE: 'seasons.manage',               // ⭐ جديد

      OFFLINE_QUEUE_VIEW: 'offline_queue.view',       // ⭐ جديد
      OFFLINE_QUEUE_MANAGE: 'offline_queue.manage',   // ⭐ جديد

      POS_USE: 'pos.use',
      POS_FULL: 'pos.full',
      POS_DISCOUNT: 'pos.discount',
      POS_VOID: 'pos.void',
      POS_REFUND: 'pos.refund',
      SESSION_USE: 'session.use',
      SESSION_VIEW: 'session.view',
      SESSION_FORCE_CLOSE: 'session.force_close',
      SALES_VIEW: 'sales.view',
      SALES_MANAGE: 'sales.manage',

      PURCHASES_VIEW: 'purchases.view',
      PURCHASES_FULL: 'purchases.full',
      PURCHASES_RECEIVE: 'purchases.receive',
      PURCHASES_APPROVE: 'purchases.approve',

      CUSTOMERS_VIEW: 'customers.view',
      CUSTOMERS_MANAGE: 'customers.manage',
      SUPPLIERS_VIEW: 'suppliers.view',
      SUPPLIERS_MANAGE: 'suppliers.manage',

      PAYMENTS_FULL: 'payments.full',
      PAYMENTS_VIEW: 'payments.view',

      REPORTS_VIEW: 'reports.view',
      REPORTS_FULL: 'reports.full',
      REPORTS_EXPORT: 'reports.export',
      REPORTS_FINANCIAL: 'reports.financial',

      ACCOUNTING_VIEW: 'accounting.view',
      ACCOUNTING_MANAGE: 'accounting.manage',
      ACCOUNTING_POST: 'accounting.post',

      USERS_VIEW: 'users.view',
      USERS_MANAGE: 'users.manage',
      ROLES_VIEW: 'roles.view',
      ROLES_MANAGE: 'roles.manage',

      SETTINGS_VIEW: 'settings.view',
      SETTINGS_EDIT: 'settings.edit',
      SETTINGS_SECURITY: 'settings.security',

      AUDIT_VIEW: 'audit.view',
      AUDIT_EXPORT: 'audit.export',

      LOYALTY_VIEW: 'loyalty.view',
      LOYALTY_MANAGE: 'loyalty.manage',

      PROMOTIONS_VIEW: 'promotions.view',
      PROMOTIONS_MANAGE: 'promotions.manage',

      BARCODE_GENERATE: 'barcode.generate',

      SUBSCRIPTIONS_VIEW: 'subscriptions.view',
      SUBSCRIPTIONS_MANAGE: 'subscriptions.manage'
    },

    // ═══════════════════════════════════════════════════════════
    // 🗺️ ROUTES — كل صفحة والصلاحية المطلوبة
    // ═══════════════════════════════════════════════════════════
    ROUTES: {
      'dashboard.html':       null,
      'pos.html':             'pos.use',
      'session.html':         'session.use',
      'products.html':        'products.view',
      'inventory.html':       'inventory.view',
      'warehouses.html':      'warehouses.view',
      'purchases.html':       'purchases.view',
      'sales.html':           'sales.view',
      'customers.html':       'customers.view',
      'suppliers.html':       'suppliers.view',
      'reports.html':         'reports.view',
      'accounting.html':      'accounting.view',
      'barcode.html':         'barcode.generate',
      'users.html':           'users.view',
      'roles.html':           'roles.view',
      'branches.html':        'branches.view',
      'company.html':         'company.view',
      'audit_log.html':       'audit.view',
      'subscriptions.html':   'subscriptions.view',
      'settings.html':        'settings.view',
      // ⭐ جديد
      'forecast.html':        'forecast.view',
      'branch_compare.html':  'branches.compare',
      'offline_queue.html':   'offline_queue.view',
      'seasons.html':         'seasons.view'
    },

    // ═══════════════════════════════════════════════════════════
    // 🏪 WAREHOUSES — Constants & Types
    // ═══════════════════════════════════════════════════════════
    WAREHOUSES: {
      TYPES: [
        { value: 'main',     label: 'رئيسي',       icon: 'warehouse',       color: 'var(--accent)' },
        { value: 'cold',     label: 'تبريد',       icon: 'snowflake',       color: 'var(--info)' },
        { value: 'frozen',   label: 'تجميد',       icon: 'snowflake',       color: 'var(--purple)' },
        { value: 'dry',      label: 'جاف',         icon: 'package',         color: 'var(--gold)' },
        { value: 'transit',  label: 'عبور',        icon: 'truck',           color: 'var(--text-muted)' },
        { value: 'returns',  label: 'مرتجعات',     icon: 'rotate-ccw',      color: 'var(--warning)' },
        { value: 'damaged',  label: 'تالف',        icon: 'alert-triangle',  color: 'var(--danger)' }
      ],
      ZONE_TYPES: [
        { value: 'cold',     label: 'تبريد',   min_temp: 2,   max_temp: 8 },
        { value: 'frozen',   label: 'تجميد',   min_temp: -25, max_temp: -18 },
        { value: 'dry',      label: 'جاف',     min_temp: 15,  max_temp: 25 },
        { value: 'hazmat',   label: 'خطرة',    min_temp: null, max_temp: null },
        { value: 'bulk',     label: 'سائب',    min_temp: null, max_temp: null },
        { value: 'returns',  label: 'مرتجعات', min_temp: null, max_temp: null }
      ],
      TRANSFER_STATUSES: [
        { value: 'draft',      label: 'مسودة',     color: 'var(--text-muted)' },
        { value: 'pending',    label: 'بانتظار',   color: 'var(--gold)' },
        { value: 'in_transit', label: 'في الطريق', color: 'var(--info)' },
        { value: 'received',   label: 'مستلم',     color: 'var(--success)' },
        { value: 'cancelled',  label: 'ملغي',      color: 'var(--danger)' }
      ],
      COUNT_TYPES: [
        { value: 'full',    label: 'جرد كامل' },
        { value: 'partial', label: 'جرد جزئي' },
        { value: 'spot',    label: 'جرد عشوائي' },
        { value: 'cycle',   label: 'جرد دوري' }
      ],
      DEFAULTS: {
        allow_negative_stock: false,
        require_expiry_date: true,
        auto_reorder: false,
        low_stock_threshold_pct: 20
      },
      FEFO_BUCKETS: [
        { key: 'expired',     label: 'منتهي',        days: [null, 0],    color: 'var(--danger)' },
        { key: 'urgent',      label: '0-30 يوم',     days: [0, 30],      color: 'var(--danger)' },
        { key: 'soon',        label: '31-90 يوم',    days: [31, 90],     color: 'var(--gold)' },
        { key: 'normal',      label: '91-180 يوم',   days: [91, 180],    color: 'var(--info)' },
        { key: 'safe',        label: 'أكثر من 180',  days: [181, null],  color: 'var(--success)' },
        { key: 'no_expiry',   label: 'بدون صلاحية',  days: null,         color: 'var(--text-muted)' }
      ]
    },

    // ═══════════════════════════════════════════════════════════
    // 💰 SESSION / DRAWER — Constants
    // ═══════════════════════════════════════════════════════════
    SESSION: {
      STATUSES: [
        { value: 'open',   label: 'مفتوحة', icon: 'lock-open', color: 'var(--success)' },
        { value: 'closed', label: 'مغلقة', icon: 'lock',      color: 'var(--text-muted)' }
      ],
      CASH_DIFF_THRESHOLD: 10,
      QUICK_CASH_AMOUNTS: [50, 100, 200, 500, 1000],
      DEFAULT_OPENING_CASH: 0,
      AUTO_CLOSE_HOURS: 24,
      // ⭐ جديد: staff-based
      STAFF_BASED: true,
      ALLOW_MULTI_CASHIER_PER_REGISTER: false
    },

    // ═══════════════════════════════════════════════════════════
    // 📦 DEFAULT SETTINGS
    // ═══════════════════════════════════════════════════════════
    DEFAULT_SETTINGS: {
      general: {
        company_name: 'سوبرماركت',
        currency: 'EGP',
        locale: 'ar-EG',
        timezone: 'Africa/Cairo',
        direction: 'rtl'
      },
      theme: {
        active_theme_slug: 'default-blue',
        mode: 'light'
      },
      tax: {
        enabled: false,
        default_rate: 14,
        inclusive: false,
        e_invoicing_enabled: false,
        eta_environment: 'sandbox'
      },
      pos: {
        default_payment: 'cash',
        allow_credit: true,
        require_customer: false,
        auto_print: false,
        sound_scan: true,
        big_ui: false,
        enable_split_payment: true,
        enable_held_orders: true,
        enable_mixed_payment: true,          // ⭐ جديد
        max_mixed_splits: 5,                 // ⭐ جديد
        quick_amounts: [50, 100, 200, 500],
        receipt_footer: 'شكراً لتعاملكم معنا',
        // ⭐ جديد: offline
        offline_enabled: true,
        offline_sync_interval_ms: 30000,
        offline_max_retry: 5
      },
      inventory: {
        fefo: true,
        auto_adjust: false,
        require_count: false,
        count_frequency: 30,
        low_stock_threshold_pct: 20,
        default_shelf_life_days: 365
      },
      forecast: {                            // ⭐ جديد
        enabled: true,
        horizons: [7, 14, 30, 60, 90],
        default_horizon: 30,
        algorithm: 'seasonal',
        refresh_hours: 24,
        min_history_days: 30
      },
      seasons: {                             // ⭐ جديد
        enabled: true,
        auto_detect: true,
        default_multiplier: 1.0
      },
      accounting: {
        fiscal_year_start: '01-01',
        auto_post_invoices: true,
        default_receivable_account: '1200',
        default_payable_account: '2100',
        default_vat_account: '2200',
        default_cogs_account: '5000',
        default_inventory_account: '1300',
        default_sales_account: '4000'
      },
      loyalty: {
        enabled: true,
        point_value: 0.1,
        earn_rate: 0.1,
        expiry_days: 365,
        tiers_enabled: false
      },
      security: {
        min_password_length: 8,
        require_strong: true,
        session_timeout: 480,
        two_factor: false,
        audit_enabled: true
      },
      notifications: {
        email: true,
        whatsapp: false,
        sms: false,
        daily_report: false,
        report_email: ''
      },
      barcode: {
        default_type: 'EAN13',
        prefix: '200',
        auto_generate: true,
        scale_format: 'weight'
      },
      purchase: {
        auto_approve: false,
        require_expiry: true,
        require_supplier_invoice: false,
        payment_terms: 30
      },
      sales: {
        allow_returns: true,
        return_days: 14,
        allow_price_override: false,
        require_discount_approval: false
      },
      alerts: {
        low_stock: true,
        expiry: true,
        expiry_days: 30,
        out_of_stock: true,
        forecast_alert: true                // ⭐ جديد
      },
      promotions: {
        enabled: true,
        stackable: false,
        time_limited: false
      },
      ai: {
        enabled: false
      },
      // ⭐ جديد: features (عشان isFeatureEnabled يشتغل)
      features: {}
    },

    // ═══════════════════════════════════════════════════════════
    // 🎚️ FEATURE FLAGS
    // ═══════════════════════════════════════════════════════════
    FEATURE_FLAGS: {
      POS_OFFLINE: 'pos.offline_mode',
      POS_SPLIT_PAYMENT: 'pos.split_payment',
      POS_HELD_ORDERS: 'pos.held_orders',
      POS_CUSTOMER_DISPLAY: 'pos.customer_display',
      POS_MIXED_PAYMENT: 'pos.mixed_payment',           // ⭐ جديد
      WAREHOUSES_MULTI: 'warehouses.multi',
      WAREHOUSES_TRANSFERS: 'warehouses.transfers',
      WAREHOUSES_ZONES: 'warehouses.zones',
      WAREHOUSES_LOCATIONS: 'warehouses.locations',
      SESSION_FORCE_CLOSE: 'session.force_close',
      SESSION_MULTI_CASHIER: 'session.multi_cashier',
      REPORTS_AI: 'reports.ai_insights',
      REPORTS_SCHEDULED: 'reports.scheduled',
      REPORTS_BRANCH_COMPARE: 'reports.branch_compare', // ⭐ جديد
      FORECAST_ENABLED: 'forecast.enabled',             // ⭐ جديد
      FORECAST_SEASONAL: 'forecast.seasonal',           // ⭐ جديد
      SEASONS_ENABLED: 'seasons.enabled',               // ⭐ جديد
      ETA_E_INVOICING: 'eta.e_invoicing',
      LOYALTY_TIERS: 'loyalty.tiers',
      PROMOTIONS_BOGO: 'promotions.bogo',
      ACCOUNTING_DOUBLE_ENTRY: 'accounting.double_entry',
      ACCOUNTING_MULTI_CURRENCY: 'accounting.multi_currency',
      WEBHOOKS: 'integrations.webhooks',
      CUSTOM_FIELDS: 'custom_fields'
    },

    // ═══════════════════════════════════════════════════════════
    // 🎁 PRESETS — قوالب الإعداد الجاهزة
    // ═══════════════════════════════════════════════════════════
    PRESETS: {
      SMALL_SUPERMARKET: 'small_supermarket',
      CHAIN: 'chain',
      HYPERMARKET: 'hypermarket',
      // metadata للعرض في UI
      META: {
        small_supermarket: {
          name: 'سوبرماركت صغير',
          name_en: 'Small Supermarket',
          description: 'مناسب لمحل واحد، كاشير واحد، مخزن واحد',
          icon: 'store',
          color: 'var(--info)'
        },
        chain: {
          name: 'سلسلة فروع',
          name_en: 'Chain',
          description: 'مناسب لسلسلة 2-10 فروع، تعدد كاشير، تحويلات',
          icon: 'git-branch',
          color: 'var(--accent)'
        },
        hypermarket: {
          name: 'هايبر ماركت',
          name_en: 'Hypermarket',
          description: 'مناسب لهايبر ماركت، ميزان، PLU، باركود، تنبؤات',
          icon: 'building',
          color: 'var(--purple)'
        }
      }
    },

    // ═══════════════════════════════════════════════════════════
    // 📡 OFFLINE QUEUE — إعدادات
    // ═══════════════════════════════════════════════════════════
    OFFLINE: {
      QUEUE_ENABLED: true,
      SYNC_INTERVAL_MS: 30000,
      MAX_RETRY: 5,
      RETRY_BACKOFF_MS: [1000, 5000, 15000, 60000, 300000],
      IDEMPOTENCY_KEY_PREFIX: 'refad_offline_',
      LOCAL_STORAGE_KEY: 'refad_offline_queue',
      OPERATION_TYPES: {
        SALE: 'sale',
        RETURN: 'return',
        SESSION_OPEN: 'session_open',
        SESSION_CLOSE: 'session_close',
        STOCK_ADJUST: 'stock_adjust'
      },
      STATUSES: [
        { value: 'pending',  label: 'بانتظار',  color: 'var(--gold)' },
        { value: 'syncing',  label: 'جاري',     color: 'var(--info)' },
        { value: 'synced',   label: 'تم',       color: 'var(--success)' },
        { value: 'failed',   label: 'فشل',      color: 'var(--danger)' },
        { value: 'conflict', label: 'تعارض',    color: 'var(--warning)' }
      ]
    },

    // ═══════════════════════════════════════════════════════════
    // 📈 FORECAST — إعدادات التنبؤ
    // ═══════════════════════════════════════════════════════════
    FORECAST: {
      HORIZONS: [7, 14, 30, 60, 90],
      DEFAULT_HORIZON: 30,
      ALGORITHMS: [
        { value: 'moving_avg',   label: 'المتوسط المتحرك' },
        { value: 'exp_smoothing', label: 'التنعيم الأسي' },
        { value: 'seasonal',     label: 'موسمي' },
        { value: 'manual',       label: 'يدوي' }
      ],
      REFRESH_HOURS: 24,
      MIN_HISTORY_DAYS: 30,
      CONFIDENCE_THRESHOLD: 60,
      STOCK_STATUSES: [
        { value: 'critical', label: 'حرج',   color: 'var(--danger)' },
        { value: 'low',      label: 'منخفض', color: 'var(--warning)' },
        { value: 'ok',       label: 'جيد',   color: 'var(--success)' }
      ]
    },

    // ═══════════════════════════════════════════════════════════
    // 🗓️ SEASONS — الأنماط الموسمية
    // ═══════════════════════════════════════════════════════════
    SEASONS: {
      TYPES: [
        { value: 'religious', label: 'ديني',   icon: 'moon' },
        { value: 'national',  label: 'وطني',   icon: 'flag' },
        { value: 'school',    label: 'دراسي',  icon: 'graduation-cap' },
        { value: 'weather',   label: 'مناخي',  icon: 'cloud-sun' },
        { value: 'custom',    label: 'مخصص',   icon: 'settings' }
      ],
      BUILTIN: [
        { slug: 'ramadan',   name: 'رمضان',        type: 'religious', start_month: 3,  start_day: 1,  end_month: 4,  end_day: 10, multiplier: 1.8 },
        { slug: 'eid_fitr',  name: 'عيد الفطر',    type: 'religious', start_month: 4,  start_day: 10, end_month: 4,  end_day: 15, multiplier: 1.5 },
        { slug: 'eid_adha',  name: 'عيد الأضحى',   type: 'religious', start_month: 6,  start_day: 10, end_month: 6,  end_day: 20, multiplier: 1.4 },
        { slug: 'school',    name: 'المدارس',      type: 'school',    start_month: 9,  start_day: 1,  end_month: 9,  end_day: 30, multiplier: 1.3 },
        { slug: 'summer',    name: 'الصيف',        type: 'weather',   start_month: 6,  start_day: 1,  end_month: 8,  end_day: 31, multiplier: 1.2 },
        { slug: 'winter',    name: 'الشتاء',       type: 'weather',   start_month: 12, start_day: 1,  end_month: 2,  end_day: 28, multiplier: 1.1 }
      ]
    },

    // ═══════════════════════════════════════════════════════════
    // 💳 MIXED PAYMENT — الدفع المختلط
    // ═══════════════════════════════════════════════════════════
    MIXED_PAYMENT: {
      ENABLED: true,
      METHODS: [
        { value: 'cash',   label: 'نقدي',    icon: 'banknote' },
        { value: 'card',   label: 'بطاقة',   icon: 'credit-card' },
        { value: 'wallet', label: 'محفظة',   icon: 'smartphone' },
        { value: 'credit', label: 'آجل',     icon: 'clock' },
        { value: 'bank',   label: 'بنكي',    icon: 'building-2' }
      ],
      MAX_SPLITS: 5,
      MIN_SPLIT_AMOUNT: 0.01
    },

    // ═══════════════════════════════════════════════════════════
    // 📊 LIMITS
    // ═══════════════════════════════════════════════════════════
    LIMITS: {
      trial: {
        max_users: 5,
        max_branches: 1,
        max_warehouses: 2,
        max_products: 500,
        max_invoices_per_month: 1000,
        max_storage_mb: 100,
        forecast_enabled: false,          // ⭐
        offline_enabled: true             // ⭐
      },
      basic: {
        max_users: 10,
        max_branches: 2,
        max_warehouses: 4,
        max_products: 2000,
        max_invoices_per_month: 5000,
        max_storage_mb: 500,
        forecast_enabled: true,           // ⭐
        offline_enabled: true             // ⭐
      },
      pro: {
        max_users: 50,
        max_branches: 10,
        max_warehouses: 20,
        max_products: 20000,
        max_invoices_per_month: 50000,
        max_storage_mb: 5000,
        forecast_enabled: true,
        offline_enabled: true
      },
      enterprise: {
        max_users: -1,
        max_branches: -1,
        max_warehouses: -1,
        max_products: -1,
        max_invoices_per_month: -1,
        max_storage_mb: -1,
        forecast_enabled: true,
        offline_enabled: true
      }
    },

    // ═══════════════════════════════════════════════════════════
    // 🎯 CACHE KEYS
    // ═══════════════════════════════════════════════════════════
    CACHE_KEYS: {
      THEME: 'refad_cached_theme',
      BRAND: 'refad_cached_brand',
      SETTINGS: 'refad_cached_settings',
      PERMISSIONS: 'refad_cached_permissions',
      USER_PROFILE: 'refad_cached_profile',
      WAREHOUSES: 'refad_cached_warehouses',
      WAREHOUSE_ACTIVE: 'refad_active_warehouse',
      WAREHOUSE_ACTIVE_NAME: 'refad_active_warehouse_name',
      PRODUCTS: 'refad_cached_products',
      CUSTOMERS: 'refad_cached_customers',
      SESSION_STATUS: 'refad_cached_session_status',
      // ⭐ جديد
      FORECAST: 'refad_cached_forecast',
      OFFLINE_QUEUE: 'refad_offline_queue',
      PRESETS: 'refad_cached_presets'
    },

    // ═══════════════════════════════════════════════════════════
    // 📡 EVENTS
    // ═══════════════════════════════════════════════════════════
    EVENTS: {
      SETTINGS_CHANGED: 'refad:settings-changed',
      THEME_CHANGED: 'refad:theme-changed',
      WAREHOUSE_CHANGED: 'refad:warehouse-changed',
      INVENTORY_CHANGED: 'refad:inventory-changed',
      SALE_CREATED: 'refad:sale-created',
      PURCHASE_RECEIVED: 'refad:purchase-received',
      USER_LOGGED_IN: 'refad:user-logged-in',
      USER_LOGGED_OUT: 'refad:user-logged-out',
      SESSION_OPENED: 'refad:session-opened',
      SESSION_CLOSED: 'refad:session-closed',
      // ⭐ جديد
      OFFLINE_QUEUE_CHANGED: 'refad:offline-queue-changed',
      OFFLINE_SYNC_START: 'refad:offline-sync-start',
      OFFLINE_SYNC_END: 'refad:offline-sync-end',
      FORECAST_UPDATED: 'refad:forecast-updated',
      PRESET_APPLIED: 'refad:preset-applied'
    },

    // ═══════════════════════════════════════════════════════════
    // 📊 BARCODE
    // ═══════════════════════════════════════════════════════════
    BARCODE_CACHE_TTL_MS: 300000,
    BARCODE_DEBOUNCE_MS: 1500,
    SCALE_LABEL_FORMAT: 'weight',
    SCALE_FORMAT_KEY: 'refad_scale_format',

    // ═══════════════════════════════════════════════════════════
    // 🤖 AI
    // ═══════════════════════════════════════════════════════════
    AI_ENABLED: true,
    AI_FUNCTION_NAMES: {
      SUGGEST_PURCHASE: 'ai-suggest-purchase',
      SEARCH_PRODUCT: 'ai-search-product',
      ANALYZE_SALES: 'ai-analyze-sales',
      FORECAST_DEMAND: 'ai-forecast-demand'
    },

    // ═══════════════════════════════════════════════════════════
    // 🖨️ PRINT
    // ═══════════════════════════════════════════════════════════
    PRINTER_WIDTH: '80mm',
    PRINT_TEMPLATES: {
      RECEIPT_80MM: 'receipt-80mm',
      RECEIPT_A4: 'receipt-a4',
      Z_REPORT: 'z-report',
      X_REPORT: 'x-report',
      SESSION_CLOSE: 'session-close',
      PURCHASE_ORDER: 'purchase-order',
      TRANSFER_NOTE: 'transfer-note',
      FORECAST_REPORT: 'forecast-report',       // ⭐ جديد
      BRANCH_COMPARE: 'branch-compare'          // ⭐ جديد
    },

    // ═══════════════════════════════════════════════════════════
    // 📲 PWA
    // ═══════════════════════════════════════════════════════════
    PWA_ENABLED: true,
    PWA_THEME_COLOR: '#0B2C4D',
    PWA_BACKGROUND_COLOR: '#F1F5F9',

    // ═══════════════════════════════════════════════════════════
    // 🔗 NAV SECTIONS
    // ═══════════════════════════════════════════════════════════
    NAV_SECTIONS: [
      {
        title: 'الرئيسية',
        items: [
          { href: 'dashboard.html', icon: 'layout-dashboard', label: 'لوحة التحكم', permission: null },
          { href: 'pos.html', icon: 'shopping-cart', label: 'نقطة البيع', permission: 'pos.use' },
          { href: 'session.html', icon: 'wallet', label: 'الوردية والدرج', permission: 'session.use' }
        ]
      },
      {
        title: 'المخزون',
        items: [
          { href: 'products.html', icon: 'package', label: 'المنتجات', permission: 'products.view' },
          { href: 'inventory.html', icon: 'boxes', label: 'المخزون', permission: 'inventory.view' },
          { href: 'warehouses.html', icon: 'warehouse', label: 'المخازن', permission: 'warehouses.view' },
          { href: 'purchases.html', icon: 'truck', label: 'المشتريات', permission: 'purchases.view' },
          // ⭐ جديد
          { href: 'forecast.html', icon: 'trending-up', label: 'تنبؤ المخزون', permission: 'forecast.view' },
          { href: 'seasons.html', icon: 'calendar-days', label: 'المواسم', permission: 'seasons.view' }
        ]
      },
      {
        title: 'المبيعات',
        items: [
          { href: 'sales.html', icon: 'receipt', label: 'المبيعات', permission: 'sales.view' },
          { href: 'customers.html', icon: 'users', label: 'العملاء', permission: 'customers.view' },
          { href: 'suppliers.html', icon: 'building-2', label: 'الموردون', permission: 'suppliers.view' }
        ]
      },
      {
        title: 'الإدارة',
        items: [
          { href: 'reports.html', icon: 'bar-chart-3', label: 'التقارير', permission: 'reports.view' },
          { href: 'branch_compare.html', icon: 'git-compare', label: 'مقارنة الفروع', permission: 'branches.compare' }, // ⭐
          { href: 'accounting.html', icon: 'book-open', label: 'المحاسبة', permission: 'accounting.view' },
          { href: 'barcode.html', icon: 'barcode', label: 'الباركود', permission: 'barcode.generate' },
          { href: 'users.html', icon: 'user-cog', label: 'المستخدمون', permission: 'users.view' },
          { href: 'roles.html', icon: 'shield', label: 'الأدوار', permission: 'roles.view' },
          { href: 'branches.html', icon: 'git-branch', label: 'الفروع', permission: 'branches.view' },
          { href: 'company.html', icon: 'building-2', label: 'الشركة', permission: 'company.view' },
          { href: 'audit_log.html', icon: 'file-text', label: 'سجل النشاط', permission: 'audit.view' },
          { href: 'subscriptions.html', icon: 'credit-card', label: 'الاشتراكات', permission: 'subscriptions.view' },
          { href: 'settings.html', icon: 'settings', label: 'الإعدادات', permission: 'settings.view' }
        ]
      }
    ]
  };

  // ═══════════════════════════════════════════════════════════
  // 🖼️ HELPER: getLogoUrl — بترجع URL مع fallback
  // ═══════════════════════════════════════════════════════════
  window.REFAD_CONFIG.getLogoUrl = function (sessionLogo) {
    const cfg = window.REFAD_CONFIG;
    return sessionLogo || cfg.LOGO.URL || cfg.LOGO_URL || '';
  };

  // ═══════════════════════════════════════════════════════════
  // 🖼️ HELPER: buildLogoElement — يبني <img> مع fallback تلقائي
  // ═══════════════════════════════════════════════════════════
  window.REFAD_CONFIG.buildLogoElement = function (logoUrl, options) {
    options = options || {};
    const cfg = window.REFAD_CONFIG;
    const size = options.size || 44;
    const radius = options.radius || 12;
    const url = logoUrl || cfg.LOGO.URL;

    const wrap = document.createElement('div');
    wrap.className = 'refad-logo-wrap';
    wrap.style.cssText = `width:${size}px;height:${size}px;border-radius:${radius}px;overflow:hidden;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:linear-gradient(135deg,var(--accent,#14B8A6),var(--accent-dark,#0d9488));`;

    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = cfg.LOGO.ALT || 'logo';
      img.style.cssText = `width:100%;height:100%;object-fit:contain;`;
      img.onerror = function () {
        // fallback: SVG inline
        wrap.innerHTML = cfg.LOGO.FALLBACK_SVG;
      };
      wrap.appendChild(img);
    } else {
      wrap.innerHTML = cfg.LOGO.FALLBACK_SVG;
    }
    return wrap;
  };

  console.log('[Refad] config.js loaded — v' + window.REFAD_CONFIG.APP_VERSION);
  console.log('[Refad] Permissions:', Object.keys(window.REFAD_CONFIG.PERMISSIONS).length);
  console.log('[Refad] Routes:', Object.keys(window.REFAD_CONFIG.ROUTES).length);
  console.log('[Refad] Warehouse types:', window.REFAD_CONFIG.WAREHOUSES.TYPES.length);
  console.log('[Refad] Session statuses:', window.REFAD_CONFIG.SESSION.STATUSES.length);
  console.log('[Refad] Presets:', Object.keys(window.REFAD_CONFIG.PRESETS.META).length);
  console.log('[Refad] Forecast horizons:', window.REFAD_CONFIG.FORECAST.HORIZONS.length);
  console.log('[Refad] Seasons built-in:', window.REFAD_CONFIG.SEASONS.BUILTIN.length);

})();