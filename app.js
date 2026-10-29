/* ============================================================
   app.js — Refad ERP v3.8
   FIX: session stability + no auto-logout + retry + cache
   ⭐ v3.8: تحسينات للتوافق مع config v4.2 (transfers + counts)
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
  if (window.supabase && window.supabase.createClient) {
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }

  window.Refad = window.Refad || {};
  window.Refad.sb = sb;
  window.Refad.CONFIG = cfg;

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
    return 'منذ ' + days + ' يوم';
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
  function _getSessionPermissions() {
    const s = window.Refad._session;
    if (!s) return [];
    if (s.is_owner) return ['*'];
    return Array.isArray(s.permissions) ? s.permissions : [];
  }

  function hasPermission(perm) {
    if (!perm) return true;
    const perms = _getSessionPermissions();
    if (perms.indexOf('*') !== -1) return true;
    if (perms.indexOf('admin.full') !== -1) return true;
    return perms.indexOf(perm) !== -1;
  }

  function hasAnyPermission(permList) {
    if (!permList || permList.length === 0) return true;
    return permList.some(p => hasPermission(p));
  }

  function hasAllPermissions(permList) {
    if (!permList || permList.length === 0) return true;
    return permList.every(p => hasPermission(p));
  }

  // ═══════════════════════════════════════════════════════════
  // ROUTES
  // ═══════════════════════════════════════════════════════════
  function canAccessRoute(page) {
    const routes = cfg.ROUTES || {};
    if (!(page in routes)) return true;
    const required = routes[page];
    if (!required) return true;
    if (Array.isArray(required)) return hasAnyPermission(required);
    return hasPermission(required);
  }

  async function requirePermission(perm, redirectTo) {
    if (hasPermission(perm)) return true;
    toast('error', 'غير مصرح — صلاحية "' + perm + '" مطلوبة');
    setTimeout(function () {
      location.href = redirectTo || 'dashboard.html';
    }, 1500);
    return false;
  }

  async function requireRoute(page, redirectTo) {
    const pageName = page || (location.pathname.split('/').pop() || 'dashboard.html');
    if (canAccessRoute(pageName)) return true;
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
  // ⭐ SESSION
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

    try {
      await applyThemeAndSettings(session);
    } catch (e) {
      console.warn('[Refad] applyThemeAndSettings threw (ignored):', e);
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
    } catch (e) {}

    try { sessionStorage.clear(); } catch (e) {}

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
    if (s.active_warehouse_id) {
      const w = whs.find(x => x.id === s.active_warehouse_id);
      if (w) return w;
    }
    return whs.find(w => w.is_default) || whs[0] || null;
  }

  function setActiveWarehouse(warehouseId) {
    if (window.Refad._session) {
      window.Refad._session.active_warehouse_id = warehouseId;
    }
    try { localStorage.setItem('refad_active_warehouse', warehouseId); } catch (e) {}
    emit(cfg.EVENTS?.WAREHOUSE_CHANGED || 'refad:warehouse-changed', { warehouse_id: warehouseId });
  }

  // ═══════════════════════════════════════════════════════════
  // ⭐ NEW: TRANSFERS HELPERS (v3.8)
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
    console.log('[Refad] app.js v3.8 ready — Supabase: ' + (sb ? '✅' : '❌'));
    console.log('[Refad] Permissions catalog: ' + Object.keys(cfg.PERMISSIONS || {}).length);
    console.log('[Refad] Routes: ' + Object.keys(cfg.ROUTES || {}).length);

    if (sb) {
      sb.auth.onAuthStateChange(function (event, session) {
        console.log('[Refad] Auth state changed:', event);
        if (event === 'SIGNED_OUT') {
          window.Refad._session = null;
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

  // ⭐ NEW: Transfers & Counts helpers (v3.8)
  window.Refad.getTransfers = getTransfers;
  window.Refad.getCounts = getCounts;

})();