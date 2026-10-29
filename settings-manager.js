/* ============================================================
   settings-manager.js — Refad ERP v2.2
   - ✅ يحفظ JSON من RPC في cache (مش fallback)
   - ✅ fallback فقط عند الفشل الكامل
   - ✅ save() بيطلق event
   - ✅ invalidate() + reload()
   - ✅ theme defaults
   - ⭐ v2.2: features (feature flags) محملة من feature_flags
   - ⭐ v2.2: forecast + seasons + offline + mixed payment defaults
   ============================================================ */
(function () {
  'use strict';

  let cache = null;
  let companyId = null;
  let loadAttempted = false;
  let loadingPromise = null;

  // ═══════════════════════════════════════════════════════════
  // FALLBACK CACHE — يُستخدم فقط لو RPC فشل تماماً
  // ═══════════════════════════════════════════════════════════
  function buildFallbackCache() {
    const sess = window.Refad && window.Refad._session;
    return {
      general: {
        currency: (sess && sess.currency) || 'EGP',
        company_name: (sess && sess.company_name) || 'سوبرماركت',
        locale: (sess && sess.locale) || 'ar-EG',
        direction: (sess && sess.direction) || 'rtl',
        timezone: (sess && sess.timezone) || 'Africa/Cairo'
      },
      theme: {
        active_theme_slug: (sess && sess.active_theme_slug) || 'default-blue',
        active_custom_theme_id: (sess && sess.active_custom_theme_id) || null,
        overrides: (sess && sess.theme_overrides) || {}
      },
      tax: { enabled: false, default_rate: 0, inclusive: false },
      pos: {
        quick_amounts: [50, 100, 200, 500],
        allow_credit: true,
        require_customer: false,
        enable_split_payment: true,
        allow_negative_stock: false,
        enable_held_orders: true,
        enable_mixed_payment: true,
        max_mixed_splits: 5,
        default_payment: 'cash',
        offline_enabled: true,
        offline_sync_interval_ms: 30000,
        offline_max_retry: 5
      },
      inventory: { require_expiry_date: true, default_shelf_life_days: 365, fefo: true },
      forecast: {
        enabled: true,
        horizons: [7, 14, 30, 60, 90],
        default_horizon: 30,
        algorithm: 'seasonal',
        refresh_hours: 24,
        min_history_days: 30
      },
      seasons: { enabled: true, auto_detect: true, default_multiplier: 1.0 },
      barcode: { default_type: 'EAN13', prefix: '200', auto_generate: true },
      purchase: { auto_approve: false, require_supplier_invoice: false, payment_terms: 30 },
      loyalty: { enabled: false, points_per_egp: 1 },
      features: {}
    };
  }

  // ═══════════════════════════════════════════════════════════
  // LOAD
  // ═══════════════════════════════════════════════════════════
  async function load(sb) {
    if (cache) return cache;
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
      try {
        // 1) auth session
        const { data: sessData, error: sessErr } = await sb.auth.getSession();
        if (sessErr || !sessData || !sessData.session) {
          console.warn('[RefadSettings] No auth session — using fallback');
          cache = buildFallbackCache();
          return cache;
        }

        // 2) company_id
        const { data: profile, error: profErr } = await sb.from('users')
          .select('company_id').eq('id', sessData.session.user.id).maybeSingle();

        companyId = profile && profile.company_id;
        if (profErr || !companyId) {
          console.warn('[RefadSettings] No company_id — using fallback');
          cache = buildFallbackCache();
          return cache;
        }

        // 3) RPC
        try {
          const { data, error } = await sb.rpc('get_company_settings', { p_company_id: companyId });
          if (!error && data && typeof data === 'object') {
            cache = data;

            if (!cache.theme) {
              cache.theme = {
                active_theme_slug: 'default-blue',
                active_custom_theme_id: null,
                overrides: {}
              };
            }

            if (!cache.features) cache.features = {};

            console.log('[RefadSettings] ✅ Loaded via RPC:', Object.keys(cache));

            // ⭐ NEW: load feature flags (non-blocking)
            try {
              const { data: flags } = await sb.from('feature_flags')
                .select('flag_key, is_enabled')
                .or('company_id.eq.' + companyId + ',company_id.is.null');
              (flags || []).forEach(function (f) {
                cache.features[f.flag_key] = !!f.is_enabled;
              });
              console.log('[RefadSettings] ✅ Feature flags loaded:', Object.keys(cache.features).length);
            } catch (flagErr) {
              console.warn('[RefadSettings] Feature flags load failed:', flagErr);
            }

            return cache;
          } else if (error) {
            console.warn('[RefadSettings] RPC failed:', error.message);
          }
        } catch (rpcErr) {
          console.warn('[RefadSettings] RPC threw:', rpcErr);
        }

        // 4) fallback لو RPC فشل
        cache = buildFallbackCache();
        return cache;

      } catch (e) {
        console.warn('[RefadSettings] load failed:', e);
        cache = buildFallbackCache();
        return cache;
      } finally {
        loadingPromise = null;
        loadAttempted = true;
      }
    })();

    return loadingPromise;
  }

  // ═══════════════════════════════════════════════════════════
  // GET
  // ═══════════════════════════════════════════════════════════
  function get(path, fallback) {
    const c = cache || buildFallbackCache();
    const parts = String(path).split('.');
    let v = c;
    for (const p of parts) {
      if (v == null) return fallback;
      v = v[p];
    }
    return v != null ? v : fallback;
  }

  // ═══════════════════════════════════════════════════════════
  // SAVE
  // ═══════════════════════════════════════════════════════════
  async function save(sb, category, key, value, branchId) {
    if (!companyId) {
      console.warn('[RefadSettings] save: no companyId');
      return false;
    }
    try {
      const { error } = await sb.rpc('save_company_setting', {
        p_company_id: companyId,
        p_category: category,
        p_key: key,
        p_value: value,
        p_branch_id: branchId || null
      });
      if (error) throw error;

      // ⭐ حدّث الـ cache
      if (cache) {
        if (!cache[category]) cache[category] = {};
        cache[category][key] = value;
      }

      // ⭐ أطلق event
      try {
        window.dispatchEvent(new CustomEvent('refad:settings-changed', {
          detail: { category, key, value }
        }));
      } catch (e) {}

      return true;
    } catch (e) {
      console.warn('[RefadSettings] save failed:', e);
      return false;
    }
  }

  async function saveMany(sb, updates) {
    for (const u of updates) {
      await save(sb, u.category, u.key, u.value, u.branchId || null);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // RUNTIME EFFECTS
  // ═══════════════════════════════════════════════════════════
  function applyRuntimeEffects() {
    const c = cache || buildFallbackCache();
    try {
      const locale = get('general.locale', 'ar-EG');
      const dir = get('general.direction', 'rtl');
      document.documentElement.lang = String(locale).split('-')[0] || 'ar';
      document.documentElement.dir = dir;
      window.REFAD_CURRENCY = get('general.currency', 'EGP');
      window.REFAD_QUICK_AMOUNTS = get('pos.quick_amounts', [50, 100, 200, 500]);
      console.log('[RefadSettings] Runtime effects applied:', {
        currency: window.REFAD_CURRENCY,
        locale,
        dir
      });
    } catch (e) {
      console.warn('[RefadSettings] applyRuntimeEffects failed:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // INVALIDATE / RELOAD
  // ═══════════════════════════════════════════════════════════
  function invalidate() {
    cache = null;
    loadAttempted = false;
    loadingPromise = null;
    console.log('[RefadSettings] Cache invalidated');
  }

  async function reload(sb) {
    invalidate();
    return await load(sb);
  }

  // ═══════════════════════════════════════════════════════════
  // MONEY
  // ═══════════════════════════════════════════════════════════
  function money(v) {
    const n = Number(v) || 0;
    const currency = get('general.currency', 'EGP');
    const symbols = { EGP: 'ج.م', SAR: 'ر.س', AED: 'د.إ', USD: '$', EUR: '€' };
    return n.toLocaleString('ar-EG', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + ' ' + (symbols[currency] || currency);
  }

  // ═══════════════════════════════════════════════════════════
  // EXPORTS
  // ═══════════════════════════════════════════════════════════
  window.RefadSettings = {
    load: async function (sb) {
      try {
        const r = await load(sb);
        this._loaded = true;
        return r;
      } catch (e) {
        this._loaded = true;
        cache = buildFallbackCache();
        return cache;
      }
    },
    reload: async function (sb) {
      try {
        const r = await reload(sb);
        this._loaded = true;
        return r;
      } catch (e) {
        this._loaded = true;
        cache = buildFallbackCache();
        return cache;
      }
    },
    get: get,
    save: save,
    saveMany: saveMany,
    applyRuntimeEffects: applyRuntimeEffects,
    getCompanyId: function () { return companyId; },
    invalidate: invalidate,
    money: money,
    _loaded: false
  };

  console.log('[Refad] settings-manager.js v2.2 ready');
})();