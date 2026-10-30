/* ============================================================
   app.js — Refad ERP v4.1
   ⭐ v4.1: session stability + ensure company_id + settings reload after session
   ⭐ v4.0: Notifications + Chat + Store helpers
   ⭐ v3.8: transfers + counts helpers
   ⭐ v3.7: session stability
   ============================================================ */
(function () {
  'use strict';

  const cfg = window.REFAD_CONFIG;
  if (!cfg) {
    console.error('[Refad] config.js لازم يتحمّل الأول!');
    return;
  }

  let sb = null;
  let connectionIssue = null;
  const isPlaceholderKey = !cfg.SUPABASE_ANON_KEY ||
    cfg.SUPABASE_ANON_KEY === '******' ||
    cfg.SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY';
  if (!window.supabase || !window.supabase.createClient) {
    connectionIssue = 'تعذر تحميل مكتبة Supabase.';
  } else if (!cfg.SUPABASE_URL || isPlaceholderKey) {
    connectionIssue = 'إعدادات Supabase غير مكتملة. تحقق من عنوان المشروع والمفتاح العام.';
  } else {
    try {
      sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    } catch (e) {
      connectionIssue = 'تعذر تهيئة الاتصال بـ Supabase.';
      console.error('[Refad] Supabase client initialization failed:', e);
    }
  }

  window.Refad = window.Refad || {};
  window.Refad.sb = sb;
  window.Refad.CONFIG = cfg;
  window.Refad.connectionIssue = connectionIssue;

  // ═══════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function money(v, currency) {
    const n = Number(v) || 0;
    let c = currency;
    if (!c && window.RefadSettings) {
      try { c = window.RefadSettings.get('general.currency'); } catch (e) {}
    }
    if (!c && window.Refad._session) c = window.Refad._session.currency;
    if (!c) c = cfg.DEFAULT_CURRENCY || 'EGP';
    const symbols = { EGP: 'ج.م', SAR: 'ر.س', AED: 'د.إ', USD: '$', EUR: '€' };
    return n.toLocaleString('ar-EG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + ' ' + (symbols[c] || c);
  }

  function num(v) {
    return Number(v || 0).toLocaleString('ar-EG', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3
    });
  }

  function fmtDate(d, opts) {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleDateString('ar-EG', opts || {
        year: 'numeric', month: 'short', day: 'numeric'
      });
    } catch (e) { return '—'; }
  }

  function fmtDateTime(d) {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleString('ar-EG', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (e) { return '—'; }
  }

  function timeAgo(d) {
    if (!d) return '—';
    const diff = Date.now() - new Date(d).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'الآن';
    if (m < 60) return 'منذ ' + m + ' دقيقة';
    const h = Math.floor(m / 60);
    if (h < 24) return 'منذ ' + h + ' ساعة';
    const days = Math.floor(h / 24);
    if (days < 30) return 'منذ ' + days + ' يوم';
    return fmtDate(d);
  }

  function today() { return new Date().toISOString().slice(0, 10); }

  function monthStart() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01';
  }

  // ═══════════════════════════════════════════════════════════
  // TOAST
  // ═══════════════════════════════════════════════════════════
  function ensureToastContainer() {
    let container = document.getElementById('refad-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'refad-toast-container';
      container.style.cssText = 'position:fixed;top:20px;left:20px;z-index:99999;display:flex;flex-direction:column;gap:10px;pointer-events:none;';
      document.body.appendChild(container);
    }
    return container;
  }

  function toast(type, msg, duration) {
    const container = ensureToastContainer();
    const icons = { error: 'alert-circle', success: 'check-circle', info: 'info', warning: 'alert-triangle' };
    const colors = { error: '#ef4444', success: '#10b981', info: '#3b82f6', warning: '#F59E0B' };

    const el = document.createElement('div');
    el.style.cssText = `
      display:flex;align-items:center;gap:10px;
      background:var(--card,#fff);border:1px solid var(--border,#e2e8f0);
      border-right:4px solid ${colors[type] || colors.info};
      padding:14px 18px;border-radius:12px;
      font-size:13.5px;font-weight:600;
      color:var(--text,#0f172a);
      box-shadow:0 10px 40px rgba(0,0,0,0.2);
      max-width:400px;min-width:280px;
      pointer-events:auto;
      animation:refad-toast-in 0.3s ease-out;
      font-family:'Segoe UI',Tahoma,sans-serif;
      direction:rtl;
    `;
    el.innerHTML = `
      <i data-lucide="${icons[type] || 'info'}" style="width:18px;height:18px;flex-shrink:0;color:${colors[type] || colors.info}"></i>
      <span>${esc(msg)}</span>
    `;
    container.appendChild(el);
    if (window.lucide) window.lucide.createIcons();
    setTimeout(function () {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.3s';
      setTimeout(function () { el.remove(); }, 300);
    }, duration || 3500);
  }

  toast.success = function (msg) { toast('success', msg); };
  toast.error = function (msg) { toast('error', msg); };
  toast.info = function (msg) { toast('info', msg); };
  toast.warning = function (msg) { toast('warning', msg); };

  // ═══════════════════════════════════════════════════════════
  // EVENTS
  // ═══════════════════════════════════════════════════════════
  const _eventBus = {};

  function on(eventName, handler) {
    if (!_eventBus[eventName]) _eventBus[eventName] = [];
    _eventBus[eventName].push(handler);
    return function off() {
      _eventBus[eventName] = _eventBus[eventName].filter(h => h !== handler);
    };
  }

  function off(eventName, handler) {
    if (!_eventBus[eventName]) return;
    if (handler) {
      _eventBus[eventName] = _eventBus[eventName].filter(h => h !== handler);
    } else {
      delete _eventBus[eventName];
    }
  }

  function emit(eventName, detail) {
    try {
      window.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
    } catch (e) { /* ignore */ }

    if (_eventBus[eventName]) {
      _eventBus[eventName].forEach(h => {
        try { h(detail); } catch (e) { console.warn('[Refad] Event handler error:', eventName, e); }
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // CACHE
  // ═══════════════════════════════════════════════════════════
  function cacheGet(key, maxAgeMs) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (maxAgeMs && parsed._ts && (Date.now() - parsed._ts) > maxAgeMs) {
        localStorage.removeItem(key);
        return null;
      }
      return parsed.data !== undefined ? parsed.data : parsed;
    } catch (e) { return null; }
  }

  function cacheSet(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({ data: data, _ts: Date.now() }));
      return true;
    } catch (e) { return false; }
  }

  function cacheRemove(key) {
    try { localStorage.removeItem(key); return true; } catch (e) { return false; }
  }

  function cacheClear(prefix) {
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(k => {
        if (!prefix || k.startsWith(prefix)) localStorage.removeItem(k);
      });
      return true;
    } catch (e) { return false; }
  }

  // ═══════════════════════════════════════════════════════════
  // PERMISSIONS
  // ═══════════════════════════════════════════════════════════
  function _getSessionPermissions(session) {
    const s = session || window.Refad._session;
    if (!s) return [];
    if (s.is_owner) return ['*'];
    return Array.isArray(s.permissions) ? s.permissions : [];
  }

  function hasPermission(perm, session) {
    if (!perm) return true;
    const perms = _getSessionPermissions(session);
    if (perms.indexOf('*') !== -1) return true;
    if (perms.indexOf('admin.full') !== -1) return true;
    return perms.indexOf(perm) !== -1;
  }

  function hasAnyPermission(permList, session) {
    if (!permList || permList.length === 0) return true;
    return permList.some(p => hasPermission(p, session));
  }

  function hasAllPermissions(permList, session) {
    if (!permList || permList.length === 0) return true;
    return permList.every(p => hasPermission(p, session));
  }

  // ═══════════════════════════════════════════════════════════
  // ROUTES
  // ═══════════════════════════════════════════════════════════
  function canAccessRoute(page, session) {
    const routes = cfg.ROUTES || {};
    if (!(page in routes)) return true;
    const required = routes[page];
    if (!required) return true;
    if (Array.isArray(required)) return hasAnyPermission(required, session);
    return hasPermission(required, session);
  }

  async function requirePermission(perm, redirectTo) {
    if (hasPermission(perm)) return true;
    toast('error', 'غير مصرح — صلاحية "' + perm + '" مطلوبة');
    setTimeout(function () {
      location.href = redirectTo || 'dashboard.html';
    }, 1500);
    return false;
  }

  async function requireRoute(page, redirectTo, session) {
    const pageName = page || (location.pathname.split('/').pop() || 'dashboard.html');
    if (canAccessRoute(pageName, session)) return true;
    toast('error', 'غير مصرح بالوصول لهذه الصفحة');
    setTimeout(function () {
      location.href = redirectTo || 'dashboard.html';
    }, 1500);
    return false;
  }

  // ═══════════════════════════════════════════════════════════
  // SETTINGS
  // ═══════════════════════════════════════════════════════════
  function getSetting(path, fallback) {
    if (window.RefadSettings && typeof window.RefadSettings.get === 'function') {
      try {
        const v = window.RefadSettings.get(path);
        if (v !== undefined && v !== null) return v;
      } catch (e) {}
    }

    if (cfg.DEFAULT_SETTINGS) {
      const parts = String(path).split('.');
      let v = cfg.DEFAULT_SETTINGS;
      for (let i = 0; i < parts.length; i++) {
        if (v == null) return fallback;
        v = v[parts[i]];
      }
      if (v !== undefined && v !== null) return v;
    }

    return fallback;
  }

  // ═══════════════════════════════════════════════════════════
  // FEATURE FLAGS
  // ═══════════════════════════════════════════════════════════
  const _featureFlagsCache = {};

  function isFeatureEnabled(flagKey) {
    if (flagKey in _featureFlagsCache) return _featureFlagsCache[flagKey];

    if (window.RefadSettings) {
      try {
        const v = window.RefadSettings.get('features.' + flagKey);
        if (v !== undefined && v !== null) {
          _featureFlagsCache[flagKey] = !!v;
          return !!v;
        }
      } catch (e) {}
    }

    _featureFlagsCache[flagKey] = false;
    return false;
  }

  async function loadFeatureFlags() {
    if (!sb || !window.Refad._session) return;
    try {
      const { data } = await sb.from('feature_flags')
        .select('flag_key, is_enabled, config')
        .or('company_id.eq.' + window.Refad._session.company_id + ',company_id.is.null');
      (data || []).forEach(f => {
        _featureFlagsCache[f.flag_key] = !!f.is_enabled;
      });
    } catch (e) {
      console.warn('[Refad] loadFeatureFlags failed:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // LIMITS
  // ═══════════════════════════════════════════════════════════
  async function getSubscriptionLimits() {
    if (!sb || !window.Refad._session) return null;
    try {
      const { data } = await sb.from('subscriptions')
        .select('plan, status, max_users, max_branches')
        .eq('company_id', window.Refad._session.company_id)
        .eq('status', 'active')
        .maybeSingle();
      if (!data) return cfg.LIMITS?.trial || null;

      const planLimits = cfg.LIMITS?.[data.plan] || cfg.LIMITS?.trial || {};
      return Object.assign({}, planLimits, {
        max_users: data.max_users || planLimits.max_users,
        max_branches: data.max_branches || planLimits.max_branches
      });
    } catch (e) {
      console.warn('[Refad] getSubscriptionLimits failed:', e);
      return cfg.LIMITS?.trial || null;
    }
  }

  async function checkLimit(resource, currentCount) {
    const limits = await getSubscriptionLimits();
    if (!limits) return { ok: true };

    const key = 'max_' + resource;
    const max = limits[key];
    if (max === undefined || max === -1) return { ok: true };
    if (currentCount < max) return { ok: true, remaining: max - currentCount };
    return { ok: false, limit: max, current: currentCount };
  }

  // ═══════════════════════════════════════════════════════════
  // SESSION
  // ═══════════════════════════════════════════════════════════
  async function waitForAuthSession(maxAttempts, delayMs) {
    maxAttempts = maxAttempts || 10;
    delayMs = delayMs || 400;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const { data, error } = await sb.auth.getSession();
        if (!error && data && data.session && data.session.access_token) {
          console.log('[Refad] Auth session ready after ' + (attempt + 1) + ' attempt(s)');
          return data.session;
        }
      } catch (e) {
        console.warn('[Refad] getSession attempt ' + (attempt + 1) + ' failed:', e);
      }
      if (attempt < maxAttempts - 1) {
        await new Promise(function (r) { setTimeout(r, delayMs); });
      }
    }
    console.warn('[Refad] No auth session after ' + maxAttempts + ' attempts');
    return null;
  }

  async function getSession() {
    if (!sb) return null;

    let authSession = await waitForAuthSession(10, 400);

    if (!authSession) {
      const storedToken = localStorage.getItem(cfg.SESSION_KEY);
      if (storedToken) {
        try {
          const { data } = await sb.auth.getUser(storedToken);
          if (data && data.user) {
            console.log('[Refad] Recovered session from stored token');
            const refreshToken = localStorage.getItem('refad_refresh_token');
            if (refreshToken) {
              const { data: sessionData } = await sb.auth.setSession({
                access_token: storedToken,
                refresh_token: refreshToken
              });
              if (sessionData && sessionData.session) {
                authSession = sessionData.session;
              }
            }
            if (!authSession) {
              authSession = { user: data.user, access_token: storedToken };
            }
          }
        } catch (e) {
          console.warn('[Refad] Token recovery failed:', e);
        }
      }
    }

    if (!authSession) {
      console.warn('[Refad] No auth session and no stored token');
      return null;
    }

    try {
      if (authSession.refresh_token) {
        localStorage.setItem('refad_refresh_token', authSession.refresh_token);
      }
      if (authSession.access_token) {
        localStorage.setItem(cfg.SESSION_KEY, authSession.access_token);
      }
    } catch (e) {}

    let profile = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { data: p, error: pErr } = await sb.from('users')
          .select('id, company_id, branch_id, role_id, full_name, email, is_owner, is_active, deleted_at, permissions, username')
          .eq('id', authSession.user.id)
          .maybeSingle();

        if (!pErr && p) {
          profile = p;
          break;
        }
        if (pErr && attempt < 2) {
          console.warn('[Refad] Profile fetch attempt ' + (attempt + 1) + ' failed, retrying...');
          await new Promise(function (r) { setTimeout(r, 500); });
        }
      } catch (e) {
        if (attempt < 2) await new Promise(function (r) { setTimeout(r, 500); });
      }
    }

    if (!profile) {
      console.warn('[Refad] Profile not found after retries');
      return null;
    }

    if (profile.is_active === false || profile.deleted_at) {
      console.warn('[Refad] User inactive or deleted');
      return null;
    }

    let roleData = null;
    if (profile.role_id) {
      try {
        const { data: r } = await sb.from('roles')
          .select('name, is_owner, permissions')
          .eq('id', profile.role_id)
          .maybeSingle();
        roleData = r;
      } catch (e) { console.warn('[Refad] Role fetch failed:', e); }
    }

    let companyData = null;
    if (profile.company_id) {
      try {
        const { data: c } = await sb.from('companies')
          .select('name, logo_url, currency, locale, direction, timezone, active_theme_slug, active_custom_theme_id, theme_overrides')
          .eq('id', profile.company_id)
          .maybeSingle();
        companyData = c;
      } catch (e) { console.warn('[Refad] Company fetch failed:', e); }
    }

    const isOwner = !!(profile.is_owner || (roleData && roleData.is_owner));
    const permissions = (profile.permissions && profile.permissions.length)
      ? profile.permissions
      : ((roleData && roleData.permissions) || []);

    let branchName = '—';
    if (profile.branch_id) {
      try {
        const { data: br } = await sb.from('branches').select('name').eq('id', profile.branch_id).maybeSingle();
        if (br) branchName = br.name;
      } catch (e) { console.warn('[Refad] Branch fetch failed:', e); }
    }

    let defaultWarehouse = null;
    if (profile.company_id) {
      try {
        const { data: wh } = await sb.from('warehouses')
          .select('id, name, warehouse_type')
          .eq('company_id', profile.company_id)
          .eq('is_default', true)
          .is('deleted_at', null)
          .maybeSingle();
        defaultWarehouse = wh;
      } catch (e) { /* ignore */ }
    }

    const session = {
      user_id: authSession.user.id,
      email: authSession.user.email,
      company_id: profile.company_id,
      active_branch_id: profile.branch_id,
      active_warehouse_id: (defaultWarehouse && defaultWarehouse.id) || null,
      default_warehouse: defaultWarehouse,
      is_owner: isOwner,
      permissions: permissions,
      full_name: profile.full_name,
      role_name: (roleData && roleData.name) || (isOwner ? 'مالك' : 'مستخدم'),
      company_name: (companyData && companyData.name) || 'سوبرماركت',
      company_logo: (companyData && companyData.logo_url) || null,
      currency: (companyData && companyData.currency) || 'EGP',
      locale: (companyData && companyData.locale) || 'ar-EG',
      direction: (companyData && companyData.direction) || 'rtl',
      timezone: (companyData && companyData.timezone) || 'Africa/Cairo',
      branch_name: branchName,
      active_theme_slug: (companyData && companyData.active_theme_slug) || 'default-blue',
      active_custom_theme_id: (companyData && companyData.active_custom_theme_id) || null,
      theme_overrides: (companyData && companyData.theme_overrides) || {}
    };

    window.Refad._session = session;
    return session;
  }

  async function requireSession(redirectTo) {
    console.log('[Refad] requireSession started');

    let session = await getSession();

    if (!session) {
      console.log('[Refad] First attempt failed, retrying in 1.5s...');
      await new Promise(function (r) { setTimeout(r, 1500); });
      session = await getSession();
    }

    if (!session) {
      console.log('[Refad] Second attempt failed, retrying in 2s...');
      await new Promise(function (r) { setTimeout(r, 2000); });
      session = await getSession();
    }

    if (!session) {
      console.warn('[Refad] All session attempts failed');
      try {
        sessionStorage.removeItem('refad_session_cache_v2');
        sessionStorage.removeItem('refad_session_cache_v1');
      } catch (e) {}

      toast('warning', 'انتهت الجلسة — جاري التحويل لتسجيل الدخول...');
      setTimeout(function () {
        location.href = redirectTo || 'index.html';
      }, 1500);
      return null;
    }

    // ⭐ v4.1: ensure session.company_id is set
    if (!session.company_id) {
      console.warn('[Refad] Session has no company_id — cannot proceed');
      toast('error', 'خطأ في الجلسة — المستخدم غير مرتبط بشركة. جاري تسجيل الخروج...');
      setTimeout(function () {
        try {
          localStorage.removeItem(cfg.SESSION_KEY);
          localStorage.removeItem('refad_refresh_token');
        } catch (e) {}
        location.href = 'index.html';
      }, 2000);
      return null;
    }

    const currentPage = location.pathname.split('/').pop() || 'dashboard.html';
    if (!await requireRoute(currentPage, 'dashboard.html')) return null;

    // Debug info
    console.log('[DEBUG] Session loaded:', {
      user_id: session.user_id,
      company_id: session.company_id,
      active_branch_id: session.active_branch_id,
      is_owner: session.is_owner,
      role_name: session.role_name
    });

    try {
      await applyThemeAndSettings(session);
    } catch (e) {
      console.warn('[Refad] applyThemeAndSettings threw (ignored):', e);
    }

    // ⭐ v4.1: Force reload settings AFTER session is fully loaded
    if (window.RefadSettings) {
      try {
        // Invalidate stale cache from previous session/company
        if (window.RefadSettings.getCompanyId && window.RefadSettings.getCompanyId() !== session.company_id) {
          console.log('[Refad] Company changed — invalidating settings cache');
          if (window.RefadSettings.invalidate) window.RefadSettings.invalidate();
        }
        await window.RefadSettings.reload(sb);
        if (window.RefadSettings.applyRuntimeEffects) {
          try { window.RefadSettings.applyRuntimeEffects(); } catch (e) {}
        }
        console.log('[Refad] ✅ Settings reloaded after session (company:', session.company_id + ')');
      } catch (e) {
        console.warn('[Refad] Post-session settings reload failed:', e);
      }
    }

    loadFeatureFlags().catch(() => {});

    console.log('[Refad] Session loaded successfully:', session.user_id);
    return session;
  }

  async function applyThemeAndSettings(session) {
    if (window.RefadTheme) {
      try {
        if (!window.RefadTheme._initialized) {
          await window.RefadTheme.init();
        } else {
          if (session.active_theme_slug || session.active_custom_theme_id) {
            const { data: themeData } = await sb
              .from(session.active_custom_theme_id ? 'company_themes' : 'themes')
              .select('config')
              .eq(session.active_custom_theme_id ? 'id' : 'slug',
                  session.active_custom_theme_id || session.active_theme_slug)
              .maybeSingle();
            if (themeData && themeData.config) {
              const merged = Object.assign({}, themeData.config, session.theme_overrides || {});
              window.RefadTheme.apply(merged);
            }
          }
        }
      } catch (e) { console.warn('[Refad] Theme apply failed:', e); }
    }

    try {
      if (session.direction) document.documentElement.dir = session.direction;
      if (session.locale) document.documentElement.lang = session.locale.split('-')[0];
    } catch (e) {}

    if (window.RefadSettings && !window.RefadSettings._loaded) {
      try {
        await window.RefadSettings.load(sb);
        if (window.RefadSettings.applyRuntimeEffects) {
          try { window.RefadSettings.applyRuntimeEffects(); } catch (e) {}
        }
      } catch (e) {
        console.warn('[Refad] Settings load failed (non-blocking):', e);
      }
    }
  }

  async function reloadSettings() {
    if (window.RefadSettings) {
      try {
        if (window.RefadSettings.invalidate) window.RefadSettings.invalidate();
        await window.RefadSettings.load(sb);
        if (window.RefadSettings.applyRuntimeEffects) window.RefadSettings.applyRuntimeEffects();
        emit(cfg.EVENTS?.SETTINGS_CHANGED || 'refad:settings-changed', { source: 'app.js' });
        return true;
      } catch (e) { console.warn('[Refad] reloadSettings failed:', e); }
    }
    return false;
  }

  async function logout() {
    console.log('[Refad] logout called');

    try {
      if (sb) {
        await Promise.race([
          sb.auth.signOut({ scope: 'local' }),
          new Promise(function (_, reject) { setTimeout(function () { reject(new Error('timeout')); }, 2000); })
        ]);
      }
    } catch (e) {
      console.warn('[Refad] signOut failed, will clear manually:', e);
    }

    try {
      localStorage.removeItem(cfg.SESSION_KEY);
      localStorage.removeItem('refad_refresh_token');
      localStorage.removeItem(cfg.BRANCH_KEY);
      localStorage.removeItem(cfg.COMPANY_KEY);
      localStorage.removeItem('refad_pos_cart_v5');
      localStorage.removeItem('refad_active_warehouse');
      localStorage.removeItem('refad_active_warehouse_name');
      localStorage.removeItem(cfg.CACHE_KEYS?.NOTIFICATIONS_UNREAD || 'refad_cached_notif_unread');
      localStorage.removeItem(cfg.CACHE_KEYS?.CHAT_UNREAD || 'refad_cached_chat_unread');
      localStorage.removeItem(cfg.CACHE_KEYS?.CHAT_CONVERSATIONS || 'refad_cached_chat_convs');
    } catch (e) {}

    try { sessionStorage.clear(); } catch (e) {}

    // Clear settings cache
    if (window.RefadSettings && window.RefadSettings.clearAll) {
      try { window.RefadSettings.clearAll(); } catch (e) {}
    }

    window.Refad._session = null;
    emit(cfg.EVENTS?.USER_LOGGED_OUT || 'refad:user-logged-out');
    location.href = 'index.html';
  }

  // ═══════════════════════════════════════════════════════════
  // GENERATORS
  // ═══════════════════════════════════════════════════════════
  function generateNumber(prefix) {
    const year = new Date().getFullYear();
    const ts = Date.now().toString(36).toUpperCase().slice(-5);
    const rand = Math.floor(Math.random() * 100).toString().padStart(2, '0');
    return (prefix || 'DOC') + '-' + year + '-' + ts + rand;
  }

  function generatePassword(len) {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$';
    let p = '';
    for (let i = 0; i < (len || 12); i++) {
      p += chars[Math.floor(Math.random() * chars.length)];
    }
    return p;
  }

  // ═══════════════════════════════════════════════════════════
  // DEBOUNCE / THROTTLE
  // ═══════════════════════════════════════════════════════════
  function debounce(fn, ms) {
    let timer = null;
    return function () {
      const args = arguments;
      const ctx = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, ms || 300);
    };
  }

  function throttle(fn, ms) {
    let last = 0;
    return function () {
      const now = Date.now();
      if (now - last >= (ms || 300)) {
        last = now;
        fn.apply(this, arguments);
      }
    };
  }

  // ═══════════════════════════════════════════════════════════
  // JSON SAFE PARSE
  // ═══════════════════════════════════════════════════════════
  function parseJSONSafe(text) {
    if (!text) return null;
    let cleaned = String(text).trim();
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    try { return JSON.parse(cleaned); } catch (e) {}
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch (e) {}
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════
  // QUERY HELPERS
  // ═══════════════════════════════════════════════════════════
  function scopedQuery(session, table, columns) {
    let q = sb.from(table).select(columns || '*').eq('company_id', session.company_id);
    if (!session.is_owner && session.active_branch_id) {
      q = q.eq('branch_id', session.active_branch_id);
    }
    return q;
  }

  async function fetchAll(query, pageSize) {
    const rows = [];
    const size = pageSize || 1000;
    for (let offset = 0; ; offset += size) {
      const result = await query.range(offset, offset + size - 1);
      if (result.error) throw result.error;
      rows.push.apply(rows, result.data || []);
      if (!result.data || result.data.length < size) return rows;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PWA
  // ═══════════════════════════════════════════════════════════
  function registerPWA() {
    if ('serviceWorker' in navigator && cfg.PWA_ENABLED) {
      navigator.serviceWorker.register('sw.js').catch(function (e) {
        console.warn('[Refad] SW registration failed:', e);
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // AUDIT LOG
  // ═══════════════════════════════════════════════════════════
  async function logAudit(session, action, entityType, entityId, oldValues, newValues) {
    if (!sb || !session) return null;
    try {
      const res = await sb.from('audit_log').insert({
        company_id: session.company_id,
        branch_id: session.active_branch_id,
        user_id: session.user_id,
        user_email: session.email,
        user_name: session.full_name,
        action: action,
        entity_type: entityType,
        entity_id: entityId,
        old_values: oldValues || null,
        new_values: newValues || null,
        user_agent: navigator.userAgent
      }).select('id').maybeSingle();
      return res.data && res.data.id;
    } catch (e) {
      console.warn('[Refad] Audit log failed:', e);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // WAREHOUSE HELPERS
  // ═══════════════════════════════════════════════════════════
  async function getWarehouses() {
    if (!sb || !window.Refad._session) return [];
    try {
      const { data } = await sb.from('v_warehouse_summary')
        .select('id, name, code, warehouse_type, is_default, is_active, total_products, total_units')
        .eq('company_id', window.Refad._session.company_id)
        .order('is_default', { ascending: false })
        .order('name');
      return data || [];
    } catch (e) {
      console.warn('[Refad] getWarehouses failed:', e);
      return [];
    }
  }

  async function getActiveWarehouse() {
    const s = window.Refad._session;
    if (!s) return null;
    const whs = await getWarehouses();
    if (!whs || whs.length === 0) return null;

    let storedId = null;
    try { storedId = localStorage.getItem(cfg.CACHE_KEYS?.WAREHOUSE_ACTIVE || 'refad_active_warehouse'); } catch (e) {}
    if (storedId) {
      const w = whs.find(x => x.id === storedId);
      if (w) return w;
    }

    if (s.active_warehouse_id) {
      const w = whs.find(x => x.id === s.active_warehouse_id);
      if (w) return w;
    }
    return whs.find(w => w.is_default) || whs[0] || null;
  }

  function setActiveWarehouse(warehouseId, warehouseName) {
    if (window.Refad._session) {
      window.Refad._session.active_warehouse_id = warehouseId;
    }
    try {
      localStorage.setItem(cfg.CACHE_KEYS?.WAREHOUSE_ACTIVE || 'refad_active_warehouse', warehouseId);
      if (warehouseName) {
        localStorage.setItem(cfg.CACHE_KEYS?.WAREHOUSE_ACTIVE_NAME || 'refad_active_warehouse_name', warehouseName);
      }
    } catch (e) {}
    emit(cfg.EVENTS?.WAREHOUSE_CHANGED || 'refad:warehouse-changed', {
      warehouse_id: warehouseId,
      warehouse_name: warehouseName
    });
  }

  // ═══════════════════════════════════════════════════════════
  // TRANSFERS HELPERS
  // ═══════════════════════════════════════════════════════════
  async function getTransfers(filter) {
    if (!sb || !window.Refad._session) return [];
    filter = filter || {};
    try {
      let q = sb.from('stock_transfers')
        .select('*')
        .eq('company_id', window.Refad._session.company_id)
        .order('created_at', { ascending: false });

      if (filter.status) q = q.eq('status', filter.status);
      if (filter.from_warehouse) q = q.eq('from_warehouse_id', filter.from_warehouse);
      if (filter.to_warehouse) q = q.eq('to_warehouse_id', filter.to_warehouse);
      if (filter.limit) q = q.limit(filter.limit);

      const { data } = await q;
      return data || [];
    } catch (e) {
      console.warn('[Refad] getTransfers failed:', e);
      return [];
    }
  }

  async function getCounts(filter) {
    if (!sb || !window.Refad._session) return [];
    filter = filter || {};
    try {
      let q = sb.from('v_warehouse_counts_summary')
        .select('*')
        .eq('company_id', window.Refad._session.company_id)
        .order('started_at', { ascending: false });

      if (filter.status) q = q.eq('status', filter.status);
      if (filter.warehouse) q = q.eq('warehouse_id', filter.warehouse);
      if (filter.limit) q = q.limit(filter.limit);

      const { data } = await q;
      return data || [];
    } catch (e) {
      console.warn('[Refad] getCounts failed:', e);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════
  // NOTIFICATIONS HELPERS
  // ═══════════════════════════════════════════════════════════
  let _notifPollTimer = null;
  let _notifChannel = null;
  let _notifUnread = 0;

  async function getNotifications(filter) {
    if (!sb || !window.Refad._session) return [];
    filter = filter || {};
    try {
      let q = sb.from('notifications')
        .select('*')
        .eq('company_id', window.Refad._session.company_id)
        .order('created_at', { ascending: false });

      q = q.or('user_id.is.null,user_id.eq.' + window.Refad._session.user_id);

      if (filter.unread_only) q = q.eq('is_read', false);
      if (filter.type) q = q.eq('type', filter.type);
      if (filter.severity) q = q.eq('severity', filter.severity);
      if (filter.limit) q = q.limit(filter.limit);

      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    } catch (e) {
      console.warn('[Refad] getNotifications failed:', e);
      return [];
    }
  }

  async function getUnreadNotificationCount() {
    if (!sb || !window.Refad._session) return 0;
    try {
      const { count, error } = await sb.from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', window.Refad._session.company_id)
        .eq('is_read', false)
        .or('user_id.is.null,user_id.eq.' + window.Refad._session.user_id);

      if (error) throw error;
      _notifUnread = count || 0;
      return _notifUnread;
    } catch (e) {
      console.warn('[Refad] getUnreadNotificationCount failed:', e);
      return 0;
    }
  }

  async function markNotificationRead(notificationId) {
    if (!sb) return false;
    try {
      await sb.from('notifications').update({
        is_read: true,
        read_at: new Date().toISOString()
      }).eq('id', notificationId);
      _notifUnread = Math.max(0, _notifUnread - 1);
      emit(cfg.EVENTS?.NOTIFICATION_READ || 'refad:notification-read', { id: notificationId });
      emit(cfg.EVENTS?.NOTIFICATION_UNREAD_CHANGED || 'refad:notification-unread-changed', { count: _notifUnread });
      return true;
    } catch (e) {
      console.warn('[Refad] markNotificationRead failed:', e);
      return false;
    }
  }

  async function markAllNotificationsRead() {
    if (!sb || !window.Refad._session) return false;
    try {
      await sb.from('notifications').update({
        is_read: true,
        read_at: new Date().toISOString()
      })
        .eq('company_id', window.Refad._session.company_id)
        .eq('is_read', false)
        .or('user_id.is.null,user_id.eq.' + window.Refad._session.user_id);
      _notifUnread = 0;
      emit(cfg.EVENTS?.NOTIFICATION_UNREAD_CHANGED || 'refad:notification-unread-changed', { count: 0 });
      return true;
    } catch (e) {
      console.warn('[Refad] markAllNotificationsRead failed:', e);
      return false;
    }
  }

  async function deleteNotification(notificationId) {
    if (!sb) return false;
    try {
      await sb.from('notifications').delete().eq('id', notificationId);
      emit(cfg.EVENTS?.NOTIFICATION_RECEIVED || 'refad:notification-received', { removed: notificationId });
      return true;
    } catch (e) {
      console.warn('[Refad] deleteNotification failed:', e);
      return false;
    }
  }

  async function subscribeToNotifications(callback) {
    if (!sb || !window.Refad._session) return null;
    try {
      if (_notifChannel) {
        await sb.removeChannel(_notifChannel);
        _notifChannel = null;
      }
      _notifChannel = sb.channel('refad-notifications-' + window.Refad._session.user_id)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: 'company_id=eq.' + window.Refad._session.company_id
        }, function (payload) {
          const n = payload.new;
          if (!n.user_id || n.user_id === window.Refad._session.user_id) {
            _notifUnread++;
            if (typeof callback === 'function') callback(n);
            emit(cfg.EVENTS?.NOTIFICATION_RECEIVED || 'refad:notification-received', n);
            emit(cfg.EVENTS?.NOTIFICATION_UNREAD_CHANGED || 'refad:notification-unread-changed', { count: _notifUnread });
          }
        })
        .subscribe();
      return _notifChannel;
    } catch (e) {
      console.warn('[Refad] subscribeToNotifications failed:', e);
      return null;
    }
  }

  function startNotificationPolling(intervalMs) {
    if (_notifPollTimer) clearInterval(_notifPollTimer);
    const tick = async function () {
      const count = await getUnreadNotificationCount();
      emit(cfg.EVENTS?.NOTIFICATION_UNREAD_CHANGED || 'refad:notification-unread-changed', { count: count });
    };
    tick();
    _notifPollTimer = setInterval(tick, intervalMs || cfg.NOTIFICATIONS?.POLL_INTERVAL_MS || 30000);
    return _notifPollTimer;
  }

  function stopNotificationPolling() {
    if (_notifPollTimer) {
      clearInterval(_notifPollTimer);
      _notifPollTimer = null;
    }
  }

  function getNotifUnreadCount() {
    return _notifUnread;
  }

  // ═══════════════════════════════════════════════════════════
  // CHAT HELPERS
  // ═══════════════════════════════════════════════════════════
  let _chatPollTimer = null;
  let _chatChannel = null;
  let _chatUnread = 0;

  async function getConversations(filter) {
    if (!sb || !window.Refad._session) return [];
    filter = filter || {};
    try {
      const { data: parts, error: pErr } = await sb.from('chat_participants')
        .select('conversation_id, last_read_at, is_muted, is_pinned')
        .eq('user_id', window.Refad._session.user_id);
      if (pErr) throw pErr;
      const convIds = (parts || []).map(p => p.conversation_id);
      if (convIds.length === 0) return [];

      let q = sb.from('chat_conversations')
        .select('*')
        .in('id', convIds)
        .eq('company_id', window.Refad._session.company_id)
        .order('last_message_at', { ascending: false });

      if (filter.type) q = q.eq('type', filter.type);
      if (filter.limit) q = q.limit(filter.limit);

      const { data, error } = await q;
      if (error) throw error;

      const { data: allParts } = await sb.from('chat_participants')
        .select('conversation_id, user_id, role')
        .in('conversation_id', convIds);
      const partsByConv = {};
      (allParts || []).forEach(p => {
        if (!partsByConv[p.conversation_id]) partsByConv[p.conversation_id] = [];
        partsByConv[p.conversation_id].push(p);
      });

      return (data || []).map(c => ({
        ...c,
        participants: partsByConv[c.id] || []
      }));
    } catch (e) {
      console.warn('[Refad] getConversations failed:', e);
      return [];
    }
  }

  async function getChatMessages(conversationId, options) {
    if (!sb) return [];
    options = options || {};
    try {
      let q = sb.from('chat_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .limit(options.limit || cfg.CHAT?.MESSAGES_PAGE_SIZE || 50);

      if (options.before) q = q.lt('created_at', options.before);

      const { data, error } = await q;
      if (error) throw error;
      return (data || []).reverse();
    } catch (e) {
      console.warn('[Refad] getChatMessages failed:', e);
      return [];
    }
  }

  async function sendChatMessage(conversationId, body, attachments) {
    if (!sb || !window.Refad._session) return null;
    try {
      const payload = {
        conversation_id: conversationId,
        sender_id: window.Refad._session.user_id,
        body: body || '',
        attachments: attachments || []
      };
      const { data, error } = await sb.from('chat_messages').insert(payload).select('*').single();
      if (error) throw error;
      emit(cfg.EVENTS?.CHAT_MESSAGE_SENT || 'refad:chat-message-sent', data);
      return data;
    } catch (e) {
      console.warn('[Refad] sendChatMessage failed:', e);
      return null;
    }
  }

  async function getChatUnreadCount() {
    if (!sb || !window.Refad._session) return 0;
    try {
      const { data: parts } = await sb.from('chat_participants')
        .select('conversation_id, last_read_at')
        .eq('user_id', window.Refad._session.user_id);

      if (!parts || parts.length === 0) return 0;

      let total = 0;
      for (const p of parts) {
        const { count } = await sb.from('chat_messages')
          .select('id', { count: 'exact', head: true })
          .eq('conversation_id', p.conversation_id)
          .eq('is_deleted', false)
          .gt('created_at', p.last_read_at || '1970-01-01');
        total += count || 0;
      }
      _chatUnread = total;
      return total;
    } catch (e) {
      console.warn('[Refad] getChatUnreadCount failed:', e);
      return 0;
    }
  }

  async function markConversationRead(conversationId) {
    if (!sb || !window.Refad._session) return false;
    try {
      await sb.from('chat_participants')
        .update({ last_read_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .eq('user_id', window.Refad._session.user_id);
      emit(cfg.EVENTS?.CHAT_UNREAD_CHANGED || 'refad:chat-unread-changed', { conversation_id: conversationId });
      return true;
    } catch (e) {
      console.warn('[Refad] markConversationRead failed:', e);
      return false;
    }
  }

  async function createDirectConversation(otherUserId) {
    if (!sb) return null;
    try {
      const { data, error } = await sb.rpc('create_direct_conversation', {
        p_other_user_id: otherUserId
      });
      if (error) throw error;
      return data;
    } catch (e) {
      console.warn('[Refad] createDirectConversation failed:', e);
      return null;
    }
  }

  async function createGroupConversation(name, userIds) {
    if (!sb) return null;
    try {
      const { data, error } = await sb.rpc('create_group_conversation', {
        p_name: name,
        p_user_ids: userIds
      });
      if (error) throw error;
      return data;
    } catch (e) {
      console.warn('[Refad] createGroupConversation failed:', e);
      return null;
    }
  }

  async function subscribeToChat(callback) {
    if (!sb || !window.Refad._session) return null;
    try {
      if (_chatChannel) {
        await sb.removeChannel(_chatChannel);
        _chatChannel = null;
      }
      _chatChannel = sb.channel('refad-chat-' + window.Refad._session.user_id)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages'
        }, function (payload) {
          if (typeof callback === 'function') callback(payload.new);
          emit(cfg.EVENTS?.CHAT_MESSAGE_RECEIVED || 'refad:chat-message-received', payload.new);
        })
        .subscribe();
      return _chatChannel;
    } catch (e) {
      console.warn('[Refad] subscribeToChat failed:', e);
      return null;
    }
  }

  function startChatPolling(intervalMs) {
    if (_chatPollTimer) clearInterval(_chatPollTimer);
    const tick = async function () {
      const count = await getChatUnreadCount();
      emit(cfg.EVENTS?.CHAT_UNREAD_CHANGED || 'refad:chat-unread-changed', { count: count });
    };
    tick();
    _chatPollTimer = setInterval(tick, intervalMs || cfg.CHAT?.POLL_INTERVAL_MS || 5000);
    return _chatPollTimer;
  }

  function stopChatPolling() {
    if (_chatPollTimer) {
      clearInterval(_chatPollTimer);
      _chatPollTimer = null;
    }
  }

  function getChatUnread() {
    return _chatUnread;
  }

  // ═══════════════════════════════════════════════════════════
  // STORE HELPERS
  // ═══════════════════════════════════════════════════════════
  async function getStoreSettings() {
    if (!sb || !window.Refad._session) return null;
    try {
      const { data } = await sb.from('store_settings')
        .select('*')
        .eq('company_id', window.Refad._session.company_id)
        .maybeSingle();
      return data;
    } catch (e) {
      console.warn('[Refad] getStoreSettings failed:', e);
      return null;
    }
  }

  async function saveStoreSettings(settings) {
    if (!sb || !window.Refad._session) return false;
    try {
      const payload = Object.assign({}, settings, {
        company_id: window.Refad._session.company_id,
        updated_at: new Date().toISOString()
      });
      const { data: existing } = await sb.from('store_settings')
        .select('id')
        .eq('company_id', window.Refad._session.company_id)
        .maybeSingle();

      if (existing) {
        const { error } = await sb.from('store_settings').update(payload).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await sb.from('store_settings').insert(payload);
        if (error) throw error;
      }

      emit(cfg.EVENTS?.STORE_SETTINGS_CHANGED || 'refad:store-settings-changed', payload);
      return true;
    } catch (e) {
      console.warn('[Refad] saveStoreSettings failed:', e);
      return false;
    }
  }

  async function getStoreOrders(filter) {
    if (!sb || !window.Refad._session) return [];
    filter = filter || {};
    try {
      let q = sb.from('store_orders')
        .select('*')
        .eq('company_id', window.Refad._session.company_id)
        .order('created_at', { ascending: false });

      if (filter.status) q = q.eq('status', filter.status);
      if (filter.payment_status) q = q.eq('payment_status', filter.payment_status);
      if (filter.fulfillment_type) q = q.eq('fulfillment_type', filter.fulfillment_type);
      if (filter.customer_id) q = q.eq('customer_id', filter.customer_id);
      if (filter.from) q = q.gte('created_at', filter.from);
      if (filter.to) q = q.lte('created_at', filter.to);
      if (filter.limit) q = q.limit(filter.limit);

      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    } catch (e) {
      console.warn('[Refad] getStoreOrders failed:', e);
      return [];
    }
  }

  async function getStoreOrderItems(orderId) {
    if (!sb) return [];
    try {
      const { data } = await sb.from('store_order_items')
        .select('*')
        .eq('order_id', orderId);
      return data || [];
    } catch (e) {
      console.warn('[Refad] getStoreOrderItems failed:', e);
      return [];
    }
  }

  async function updateStoreOrderStatus(orderId, status, reason) {
    if (!sb) return false;
    // The RPC settles the invoice/stock/cash on dispatch and reverses them on cancel.
    const { error } = await sb.rpc('set_store_order_status', {
      p_order: orderId, p_status: status, p_reason: reason || null
    });
    if (error) {
      console.warn('[Refad] updateStoreOrderStatus failed:', error);
      throw error;
    }
    emit(cfg.EVENTS?.STORE_ORDER_STATUS_CHANGED || 'refad:store-order-status-changed', { order_id: orderId, status: status });
    return true;
  }

  async function getStoreProducts(filter) {
    if (!sb || !window.Refad._session) return [];
    filter = filter || {};
    try {
      let q = sb.from('products')
        .select('id, name, barcode, image_url, sale_price, store_price, is_in_store, store_description, store_sort_order, is_active, base_unit, sale_unit, min_stock')
        .eq('company_id', window.Refad._session.company_id)
        .is('deleted_at', null)
        .eq('is_active', true);

      if (filter.in_store_only) q = q.eq('is_in_store', true);
      if (filter.search) q = q.or('name.ilike.%' + filter.search + '%,barcode.ilike.%' + filter.search + '%');
      q = q.order('store_sort_order').order('name');
      if (filter.limit) q = q.limit(filter.limit);

      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    } catch (e) {
      console.warn('[Refad] getStoreProducts failed:', e);
      return [];
    }
  }

  async function toggleProductInStore(productId, isInStore) {
    if (!sb) return false;
    try {
      const { error } = await sb.from('products').update({
        is_in_store: !!isInStore
      }).eq('id', productId);
      if (error) throw error;
      return true;
    } catch (e) {
      console.warn('[Refad] toggleProductInStore failed:', e);
      return false;
    }
  }

  async function updateProductStorePrice(productId, storePrice) {
    if (!sb) return false;
    try {
      const { error } = await sb.from('products').update({
        store_price: storePrice
      }).eq('id', productId);
      if (error) throw error;
      return true;
    } catch (e) {
      console.warn('[Refad] updateProductStorePrice failed:', e);
      return false;
    }
  }

  async function uploadProductImage(productId, file) {
    if (!sb) return null;
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = window.Refad._session.company_id + '/' + productId + '/' + Date.now() + '.' + ext;

      const { error: upErr } = await sb.storage
        .from('product-images')
        .upload(path, file, { cacheControl: '3600', upsert: false });
      if (upErr) throw upErr;

      const { data: urlData } = sb.storage.from('product-images').getPublicUrl(path);
      const publicUrl = urlData?.publicUrl || null;

      if (publicUrl) {
        await sb.from('products').update({ image_url: publicUrl }).eq('id', productId);
      }

      return publicUrl;
    } catch (e) {
      console.warn('[Refad] uploadProductImage failed:', e);
      return null;
    }
  }

  async function uploadStoreAsset(file, folder) {
    if (!sb || !window.Refad._session) return null;
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = window.Refad._session.company_id + '/' + (folder || 'assets') + '/' + Date.now() + '.' + ext;

      const { error: upErr } = await sb.storage
        .from('product-images')
        .upload(path, file, { cacheControl: '3600', upsert: false });
      if (upErr) throw upErr;

      const { data: urlData } = sb.storage.from('product-images').getPublicUrl(path);
      return urlData?.publicUrl || null;
    } catch (e) {
      console.warn('[Refad] uploadStoreAsset failed:', e);
      return null;
    }
  }

  async function subscribeToStoreOrders(callback) {
    if (!sb || !window.Refad._session) return null;
    try {
      const channel = sb.channel('refad-store-orders-' + window.Refad._session.company_id)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'store_orders',
          filter: 'company_id=eq.' + window.Refad._session.company_id
        }, function (payload) {
          if (typeof callback === 'function') callback(payload);
          emit(cfg.EVENTS?.STORE_ORDER_CREATED || 'refad:store-order-created', payload.new);
        })
        .subscribe();
      return channel;
    } catch (e) {
      console.warn('[Refad] subscribeToStoreOrders failed:', e);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // INJECT STYLES
  // ═══════════════════════════════════════════════════════════
  (function injectBaseStyles() {
    if (document.getElementById('refad-app-base-styles')) return;
    const style = document.createElement('style');
    style.id = 'refad-app-base-styles';
    style.textContent = `
      @keyframes refad-toast-in {
        from { opacity: 0; transform: translateX(-20px); }
        to { opacity: 1; transform: translateX(0); }
      }
    `;
    document.head.appendChild(style);
  })();

  // ═══════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════
  function init() {
    registerPWA();
    console.log('[Refad] app.js v4.1 ready — Supabase: ' + (sb ? '✅' : '❌'));
    console.log('[Refad] Permissions catalog: ' + Object.keys(cfg.PERMISSIONS || {}).length);
    console.log('[Refad] Routes: ' + Object.keys(cfg.ROUTES || {}).length);

    if (sb) {
      sb.auth.onAuthStateChange(function (event, session) {
        console.log('[Refad] Auth state changed:', event);
        if (event === 'SIGNED_OUT') {
          window.Refad._session = null;
          stopNotificationPolling();
          stopChatPolling();
        } else if (event === 'TOKEN_REFRESHED' && session) {
          try {
            localStorage.setItem(cfg.SESSION_KEY, session.access_token);
            if (session.refresh_token) {
              localStorage.setItem('refad_refresh_token', session.refresh_token);
            }
          } catch (e) {}
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ═══════════════════════════════════════════════════════════
  // EXPORTS
  // ═══════════════════════════════════════════════════════════
  window.Refad.esc = esc;
  window.Refad.money = money;
  window.Refad.num = num;
  window.Refad.fmtDate = fmtDate;
  window.Refad.fmtDateTime = fmtDateTime;
  window.Refad.timeAgo = timeAgo;
  window.Refad.today = today;
  window.Refad.monthStart = monthStart;

  window.Refad.toast = toast;

  window.Refad.on = on;
  window.Refad.off = off;
  window.Refad.emit = emit;

  window.Refad.cache = {
    get: cacheGet,
    set: cacheSet,
    remove: cacheRemove,
    clear: cacheClear
  };

  window.Refad.hasPermission = hasPermission;
  window.Refad.hasAnyPermission = hasAnyPermission;
  window.Refad.hasAllPermissions = hasAllPermissions;
  window.Refad.canAccessRoute = canAccessRoute;
  window.Refad.requirePermission = requirePermission;
  window.Refad.requireRoute = requireRoute;

  window.Refad.getSetting = getSetting;

  window.Refad.isFeatureEnabled = isFeatureEnabled;
  window.Refad.loadFeatureFlags = loadFeatureFlags;

  window.Refad.getSubscriptionLimits = getSubscriptionLimits;
  window.Refad.checkLimit = checkLimit;

  window.Refad.getSession = getSession;
  window.Refad.requireSession = requireSession;
  window.Refad.waitForAuthSession = waitForAuthSession;
  window.Refad.logout = logout;

  window.Refad.generateNumber = generateNumber;
  window.Refad.generatePassword = generatePassword;

  window.Refad.debounce = debounce;
  window.Refad.throttle = throttle;
  window.Refad.parseJSONSafe = parseJSONSafe;
  window.Refad.scopedQuery = scopedQuery;
  window.Refad.fetchAll = fetchAll;

  window.Refad.logAudit = logAudit;

  window.Refad.registerPWA = registerPWA;

  window.Refad.applyThemeAndSettings = applyThemeAndSettings;
  window.Refad.reloadSettings = reloadSettings;

  window.Refad.getWarehouses = getWarehouses;
  window.Refad.getActiveWarehouse = getActiveWarehouse;
  window.Refad.setActiveWarehouse = setActiveWarehouse;

  window.Refad.getTransfers = getTransfers;
  window.Refad.getCounts = getCounts;

  window.Refad.notifications = {
    list: getNotifications,
    unreadCount: getUnreadNotificationCount,
    getUnread: getNotifUnreadCount,
    markRead: markNotificationRead,
    markAllRead: markAllNotificationsRead,
    remove: deleteNotification,
    subscribe: subscribeToNotifications,
    startPolling: startNotificationPolling,
    stopPolling: stopNotificationPolling
  };

  window.Refad.chat = {
    conversations: getConversations,
    messages: getChatMessages,
    send: sendChatMessage,
    unreadCount: getChatUnreadCount,
    getUnread: getChatUnread,
    markRead: markConversationRead,
    createDirect: createDirectConversation,
    createGroup: createGroupConversation,
    subscribe: subscribeToChat,
    startPolling: startChatPolling,
    stopPolling: stopChatPolling
  };

  window.Refad.store = {
    getSettings: getStoreSettings,
    saveSettings: saveStoreSettings,
    getOrders: getStoreOrders,
    getOrderItems: getStoreOrderItems,
    updateOrderStatus: updateStoreOrderStatus,
    getProducts: getStoreProducts,
    toggleInStore: toggleProductInStore,
    updateStorePrice: updateProductStorePrice,
    uploadImage: uploadProductImage,
    uploadAsset: uploadStoreAsset,
    subscribeOrders: subscribeToStoreOrders
  };

})();