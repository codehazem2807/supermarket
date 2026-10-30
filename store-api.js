/* ============================================================
   store-api.js — Refad ERP v1.4
   🛒 Storefront API (Public — anon key + RLS)
   ⭐ v1.4: explicit connection state + authenticated customer login
   ⭐ v1.2: Multi-Tenant Stores (slug support + per-store data)
   ⭐ v1.1: registerCustomer with auth.signUp
   ============================================================ */
(function () {
  'use strict';

  const cfg = window.REFAD_CONFIG;
  if (!cfg) {
    console.error('[Refad Store] config.js لازم يتحمل الأول!');
    return;
  }

  let sb = null;
  let clientInitializationError = null;
  const isPlaceholderKey = !cfg.SUPABASE_ANON_KEY ||
    cfg.SUPABASE_ANON_KEY === '******' ||
    cfg.SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY';
  if (!window.supabase || !window.supabase.createClient) {
    clientInitializationError = 'تعذر تحميل مكتبة Supabase.';
  } else if (!cfg.SUPABASE_URL || isPlaceholderKey) {
    clientInitializationError = 'إعدادات Supabase غير مكتملة. تحقق من عنوان المشروع والمفتاح العام.';
  } else {
    try {
      sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    } catch (e) {
      clientInitializationError = 'تعذر تهيئة الاتصال بـ Supabase.';
      console.error('[Refad Store] Supabase client initialization failed:', e);
    }
  }

  const state = {
    settings: null,
    company: null,
    customer: null,
    cart: [],
    wishlist: [],
    stock: {},
    lastError: null
  };

  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const CURRENT_COMPANY_KEY = 'refad_store_current_company';

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
    const c = currency || (state.settings?.currency) || (state.company?.currency) || 'EGP';
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

  function emit(eventName, detail) {
    try {
      window.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
    } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════
  // STORAGE KEYS (per store)
  // ═══════════════════════════════════════════════════════════
  function getCartKey() {
    const cid = state.company?.id || state.settings?.company_id || 'default';
    return (cfg.STORE.CART_STORAGE_KEY || 'refad_store_cart') + '_' + cid;
  }

  function getWishlistKey() {
    const cid = state.company?.id || state.settings?.company_id || 'default';
    return 'refad_store_wishlist_' + cid;
  }

  function getCustomerKey() {
    const cid = state.company?.id || state.settings?.company_id || 'default';
    return (cfg.STORE.CUSTOMER_SESSION_KEY || 'refad_store_customer') + '_auth_v2_' + cid;
  }

  // ═══════════════════════════════════════════════════════════
  // COMPANY & SETTINGS
  // ═══════════════════════════════════════════════════════════

  async function resolveCompany(idOrSlug) {
    if (!sb || !idOrSlug) return null;

    const selectCols = 'id, name, slug, logo_url, currency, locale, direction, is_active, deleted_at';

    try {
      // UUID format?
      if (UUID_REGEX.test(idOrSlug)) {
        const { data, error } = await sb.from('companies')
          .select(selectCols)
          .eq('id', idOrSlug)
          .is('deleted_at', null)
          .maybeSingle();
        if (error) throw error;
        state.lastError = null;
        return data || null;
      }

      // Try slug
      const { data: bySlug, error: slugErr } = await sb.from('companies')
        .select(selectCols)
        .eq('slug', idOrSlug)
        .is('deleted_at', null)
        .maybeSingle();

      if (slugErr) throw slugErr;
      if (bySlug) {
        state.lastError = null;
        return bySlug;
      }

      state.lastError = null;
      return null;
    } catch (e) {
      state.lastError = e.message || String(e);
      console.warn('[Refad Store] resolveCompany failed:', e);
      return null;
    }
  }

  function getConnectionStatus() {
    return {
      configured: !!sb,
      message: clientInitializationError
    };
  }

  function getLastError() {
    return state.lastError;
  }

  async function loadSettings(companyId) {
    if (!sb || !companyId) return null;
    try {
      const { data, error } = await sb.from('store_settings')
        .select('*')
        .eq('company_id', companyId)
        .maybeSingle();

      if (error) throw error;
      state.lastError = null;
      if (!data) return null;
      if (data.enabled === false) return null;

      state.settings = data;
      return data;
    } catch (e) {
      state.lastError = e.message || String(e);
      console.warn('[Refad Store] loadSettings failed:', e);
      return null;
    }
  }

  async function loadTheme(companyId) {
    if (!sb || !companyId) return null;
    try {
      const rpc = await sb.rpc('get_store_theme', { p_company: companyId });
      if (!rpc.error && rpc.data && typeof rpc.data === 'object') return rpc.data;

      const { data: company } = await sb.from('companies')
        .select('active_theme_slug, theme_overrides')
        .eq('id', companyId)
        .maybeSingle();
      if (!company || !company.active_theme_slug) return null;
      const { data: theme } = await sb.from('themes')
        .select('config')
        .eq('slug', company.active_theme_slug)
        .maybeSingle();
      if (!theme || !theme.config) return null;
      return Object.assign({}, theme.config, company.theme_overrides || {});
    } catch (e) {
      console.warn('[Refad Store] loadTheme failed:', e);
      return null;
    }
  }

  async function getStoreDirectory() {
    if (!sb) return [];
    try {
      const { data, error } = await sb.from('store_settings')
        .select(`
          company_id,
          enabled,
          store_name,
          store_description,
          logo_url,
          banner_url,
          primary_color,
          accent_color,
          delivery_enabled,
          pickup_enabled,
          phone,
          address
        `)
        .eq('enabled', true);

      if (error) throw error;
      if (!data || data.length === 0) {
        state.lastError = null;
        return [];
      }

      const companyIds = data.map(s => s.company_id);
      const { data: companies, error: compErr } = await sb.from('companies')
        .select('id, name, slug, is_active, deleted_at')
        .in('id', companyIds)
        .is('deleted_at', null);

      if (compErr) throw compErr;

      const companyMap = {};
      (companies || []).forEach(c => { companyMap[c.id] = c; });

      state.lastError = null;
      return data
        .filter(s => companyMap[s.company_id])
        .map(s => ({
          ...s,
          company_name: companyMap[s.company_id].name,
          company_slug: companyMap[s.company_id].slug,
          store_name: s.store_name || companyMap[s.company_id].name
        }));
    } catch (e) {
      state.lastError = e.message || String(e);
      console.warn('[Refad Store] getStoreDirectory failed:', e);
      return [];
    }
  }

  function setCurrentCompany(company) {
    state.company = company;
    try {
      if (company) {
        localStorage.setItem(CURRENT_COMPANY_KEY, JSON.stringify({
          id: company.id,
          slug: company.slug,
          name: company.name
        }));
      }
    } catch (e) {}
  }

  function getCurrentCompany() {
    try {
      const raw = localStorage.getItem(CURRENT_COMPANY_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function getStoreUrl(slugOrId) {
    const slug = slugOrId || state.company?.slug || state.company?.id;
    if (!slug) return 'store.html';
    return 'store.html?company=' + encodeURIComponent(slug);
  }

  function validateSlug(slug) {
    return /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug);
  }

  // ═══════════════════════════════════════════════════════════
  // STORE OPEN CHECK
  // ═══════════════════════════════════════════════════════════
  function isStoreOpen() {
    const hours = state.settings?.working_hours;
    if (!hours) return true;

    const now = new Date();
    const dayMap = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const dayKey = dayMap[now.getDay()];
    const today = hours[dayKey];

    if (!today || today.closed) return false;

    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [openH, openM] = (today.open || '09:00').split(':').map(Number);
    const [closeH, closeM] = (today.close || '23:00').split(':').map(Number);
    const openMinutes = openH * 60 + openM;
    const closeMinutes = closeH * 60 + closeM;

    return currentMinutes >= openMinutes && currentMinutes <= closeMinutes;
  }

  // ═══════════════════════════════════════════════════════════
  // PRODUCTS
  // ═══════════════════════════════════════════════════════════
  async function getProducts(filter) {
    if (!sb || !state.settings) return [];
    filter = filter || {};
    try {
      let q = sb.from('products')
        .select('id, name, barcode, image_url, sale_price, store_price, is_in_store, is_bundle, store_description, store_sort_order, base_unit, sale_unit, category_id, is_active, created_at')
        .eq('company_id', state.settings.company_id)
        .eq('is_in_store', true)
        .eq('is_active', true)
        .is('deleted_at', null);

      if (filter.search) {
        q = q.or('name.ilike.%' + filter.search + '%,barcode.ilike.%' + filter.search + '%');
      }
      if (filter.category_id) {
        q = q.eq('category_id', filter.category_id);
      }

      q = q.order('store_sort_order').order('name');
      if (filter.limit) q = q.limit(filter.limit);

      const { data, error } = await q;
      if (error) throw error;

      state.lastError = null;
      return (data || []).map(p => ({
        ...p,
        display_price: p.store_price != null ? Number(p.store_price) : Number(p.sale_price || 0)
      }));
    } catch (e) {
      state.lastError = e.message || String(e);
      console.warn('[Refad Store] getProducts failed:', e);
      return [];
    }
  }

  async function getBundleComponents(bundleIds) {
    if (!sb || !state.settings || !Array.isArray(bundleIds) || bundleIds.length === 0) return {};
    try {
      const { data: rows, error } = await sb.from('bundle_items')
        .select('bundle_product_id, component_product_id, quantity')
        .eq('company_id', state.settings.company_id)
        .in('bundle_product_id', bundleIds);
      if (error) throw error;

      const componentIds = Array.from(new Set((rows || []).map(row => row.component_product_id).filter(Boolean)));
      if (componentIds.length === 0) {
        state.lastError = null;
        return {};
      }

      const { data: products, error: productsError } = await sb.from('products')
        .select('id, name, sale_price, store_price, is_in_store, sale_unit, image_url')
        .eq('company_id', state.settings.company_id)
        .in('id', componentIds)
        .is('deleted_at', null);
      if (productsError) throw productsError;

      const productMap = {};
      (products || []).forEach(product => { productMap[product.id] = product; });
      if ((rows || []).some(row => !productMap[row.component_product_id])) {
        throw new Error('Some combo component products are unavailable');
      }
      const bundles = {};
      (rows || []).forEach(row => {
        const product = productMap[row.component_product_id];
        if (!bundles[row.bundle_product_id]) bundles[row.bundle_product_id] = [];
        const useStorePrice = product.is_in_store && product.store_price != null;
        bundles[row.bundle_product_id].push({
          id: product.id,
          name: product.name,
          quantity: Number(row.quantity) || 1,
          unit_price: Number(useStorePrice ? product.store_price : product.sale_price) || 0,
          sale_unit: product.sale_unit || null,
          image_url: product.image_url || null
        });
      });

      state.lastError = null;
      return bundles;
    } catch (e) {
      state.lastError = e.message || String(e);
      console.warn('[Refad Store] getBundleComponents failed:', e);
      return {};
    }
  }

  async function getCategories() {
    if (!sb || !state.settings) return [];
    try {
      const { data, error } = await sb.from('categories')
        .select('id, name, parent_id, sort_order')
        .eq('company_id', state.settings.company_id)
        .eq('is_active', true)
        .order('sort_order')
        .order('name');
      if (error) throw error;
      state.lastError = null;
      return data || [];
    } catch (e) {
      state.lastError = e.message || String(e);
      console.warn('[Refad Store] getCategories failed:', e);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════
  // CART (per store)
  // ═══════════════════════════════════════════════════════════
  function loadCart() {
    try {
      const raw = localStorage.getItem(getCartKey());
      if (!raw) { state.cart = []; return []; }
      state.cart = JSON.parse(raw) || [];
      return state.cart;
    } catch (e) {
      state.cart = [];
      return [];
    }
  }

  function saveCart() {
    try {
      localStorage.setItem(getCartKey(), JSON.stringify(state.cart));
      emit('refad:store-cart-changed', { cart: state.cart });
    } catch (e) {}
  }

  function getAvailable(productId) {
    const v = state.stock[productId];
    return v === undefined ? Infinity : v;
  }

  async function loadAvailability() {
    if (!sb || !state.settings) return state.stock;
    try {
      const { data, error } = await sb.rpc('get_store_availability', { p_company_id: state.settings.company_id });
      if (error) throw error;
      const map = {};
      (data || []).forEach(r => { map[r.product_id] = Number(r.available) || 0; });
      state.stock = map;
    } catch (e) {
      console.warn('[Refad Store] loadAvailability failed:', e);
    }
    return state.stock;
  }

  function addToCart(product, quantity) {
    quantity = Number(quantity) || 1;
    const existing = state.cart.find(x => x.product_id === product.id);
    const max = getAvailable(product.id);
    const wanted = (existing ? existing.quantity : 0) + quantity;
    if (wanted > max) {
      quantity = Math.max(0, max - (existing ? existing.quantity : 0));
      if (quantity <= 0) return state.cart;
    }
    if (existing) {
      existing.quantity += quantity;
    } else {
      state.cart.push({
        product_id: product.id,
        product_name: product.name,
        product_image: product.image_url || null,
        unit_price: Number(product.display_price || product.sale_price || 0),
        quantity: quantity,
        notes: ''
      });
    }
    saveCart();
    return state.cart;
  }

  function updateCartItem(productId, quantity) {
    const item = state.cart.find(x => x.product_id === productId);
    if (!item) return state.cart;
    if (quantity <= 0) {
      removeFromCart(productId);
      return state.cart;
    }
    item.quantity = Math.min(Number(quantity), getAvailable(productId));
    if (item.quantity <= 0) {
      removeFromCart(productId);
      return state.cart;
    }
    saveCart();
    return state.cart;
  }

  function removeFromCart(productId) {
    state.cart = state.cart.filter(x => x.product_id !== productId);
    saveCart();
    return state.cart;
  }

  function clearCart() {
    state.cart = [];
    saveCart();
  }

  function getCartTotals() {
    const subtotal = state.cart.reduce((s, x) => s + (x.unit_price * x.quantity), 0);
    const deliveryFee = (state.settings?.delivery_enabled) ? Number(state.settings.delivery_fee || 0) : 0;
    const minOrder = Number(state.settings?.min_order_amount || 0);
    return {
      subtotal: subtotal,
      delivery_fee: deliveryFee,
      min_order: minOrder,
      total: subtotal + deliveryFee,
      meets_min: subtotal >= minOrder,
      items_count: state.cart.reduce((s, x) => s + x.quantity, 0)
    };
  }

  // ═══════════════════════════════════════════════════════════
  // WISHLIST (per store)
  // ═══════════════════════════════════════════════════════════
  function loadWishlist() {
    try {
      const raw = localStorage.getItem(getWishlistKey());
      if (!raw) { state.wishlist = []; return []; }
      state.wishlist = JSON.parse(raw) || [];
      return state.wishlist;
    } catch (e) {
      state.wishlist = [];
      return [];
    }
  }

  function saveWishlist() {
    try {
      localStorage.setItem(getWishlistKey(), JSON.stringify(state.wishlist));
      emit('refad:store-wishlist-changed', { wishlist: state.wishlist });
    } catch (e) {}
  }

  function toggleWishlist(productId) {
    const idx = state.wishlist.indexOf(productId);
    if (idx >= 0) {
      state.wishlist.splice(idx, 1);
    } else {
      state.wishlist.push(productId);
    }
    saveWishlist();
    return state.wishlist;
  }

  function isInWishlist(productId) {
    return state.wishlist.includes(productId);
  }

  // ═══════════════════════════════════════════════════════════
  // CUSTOMER (per store) — v1.4 authenticated accounts
  // ═══════════════════════════════════════════════════════════
  function loadCustomer() {
    try {
      const raw = localStorage.getItem(getCustomerKey());
      if (!raw) { state.customer = null; return null; }
      state.customer = JSON.parse(raw);
      return state.customer;
    } catch (e) {
      state.customer = null;
      return null;
    }
  }

  function saveCustomer(customer) {
    state.customer = customer;
    try {
      if (customer) {
        localStorage.setItem(getCustomerKey(), JSON.stringify(customer));
      } else {
        localStorage.removeItem(getCustomerKey());
      }
    } catch (e) {}
  }

  async function registerCustomer(data) {
    if (!sb || !state.settings) return { ok: false, error: 'no_settings' };

    const email = data.email || (data.phone + '@store.local');
    let authUserId = null;

    // Customer profiles must always have a password-authenticated identity.
    try {
      const { data: authData, error: authErr } = await sb.auth.signUp({
        email: email,
        password: data.password,
        options: {
          data: {
            full_name: data.full_name,
            phone: data.phone,
            is_store_customer: true
          }
        }
      });

      if (authErr) {
        const msg = (authErr.message || '').toLowerCase();

        // User already exists → try sign in
        if (msg.includes('already') || msg.includes('registered')) {
          try {
            const { data: signInData, error: signInErr } = await sb.auth.signInWithPassword({
              email: email,
              password: data.password
            });
            if (!signInErr && signInData.user) {
              authUserId = signInData.user.id;
            }
          } catch (e) {
            console.warn('[Refad Store] Sign-in after "already exists" failed:', e);
          }
        }
        if (!authUserId) return { ok: false, error: authErr.message || 'auth_failed' };
      } else if (authData?.user) {
        authUserId = authData.user.id;
      }
    } catch (e) {
      console.warn('[Refad Store] Auth signUp threw:', e);
      return { ok: false, error: e.message || 'auth_failed' };
    }
    if (!authUserId) return { ok: false, error: 'auth_failed' };

    // Register the profile only after Supabase Auth has created its identity.
    try {
      const { data: customerId, error: rpcErr } = await sb.rpc('register_store_customer', {
        p_company_id: state.settings.company_id,
        p_full_name: data.full_name,
        p_phone: data.phone,
        p_email: email,
        p_auth_user_id: authUserId
      });

      if (rpcErr) throw rpcErr;

      const customer = {
        id: customerId,
        full_name: data.full_name,
        phone: data.phone,
        email: email,
        auth_user_id: authUserId
      };
      saveCustomer(customer);
      emit('refad:store-customer-logged-in', { customer });

      return {
        ok: true,
        customer
      };
    } catch (e) {
      console.warn('[Refad Store] registerCustomer (DB) failed:', e);
      return { ok: false, error: e.message };
    }
  }

  async function loginCustomer(phone, password) {
    if (!sb || !state.settings) return { ok: false, error: 'no_settings' };
    if (!password) return { ok: false, error: 'password_required' };
    try {
      const { data: profile, error: profileError } = await sb.from('customers')
        .select('id, name, phone, email, auth_user_id')
        .eq('company_id', state.settings.company_id)
        .eq('is_store_customer', true)
        .eq('phone', phone)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile || !profile.email) return { ok: false, error: 'invalid_credentials' };

      const { data: signInData, error: signInError } = await sb.auth.signInWithPassword({
        email: profile.email,
        password: password
      });
      if (signInError || !signInData.user) return { ok: false, error: 'invalid_credentials' };
      if (profile.auth_user_id && profile.auth_user_id !== signInData.user.id) {
        return { ok: false, error: 'invalid_credentials' };
      }

      const customer = {
        id: profile.id,
        full_name: profile.name,
        phone: profile.phone,
        email: profile.email,
        auth_user_id: signInData.user.id
      };
      saveCustomer(customer);
      emit('refad:store-customer-logged-in', { customer });
      return { ok: true, customer };
    } catch (e) {
      console.warn('[Refad Store] loginCustomer failed:', e);
      return { ok: false, error: e.message };
    }
  }

  async function logoutCustomer() {
    try {
      if (sb) await sb.auth.signOut({ scope: 'local' });
    } catch (e) {}
    saveCustomer(null);
    emit('refad:store-customer-logged-out', {});
  }

  // ═══════════════════════════════════════════════════════════
  // ORDERS
  // ═══════════════════════════════════════════════════════════
  async function createOrder(orderData) {
    if (!sb || !state.settings) return { ok: false, error: 'no_settings' };
    if (state.cart.length === 0) return { ok: false, error: 'cart_empty' };
    const totals = getCartTotals();
    if (totals.min_order > 0 && !totals.meets_min) {
      return { ok: false, error: 'min_order_not_met', min_order: totals.min_order };
    }

    try {
      const items = state.cart.map(x => ({
        product_id: x.product_id,
        product_name: x.product_name,
        product_image: x.product_image,
        quantity: x.quantity,
        unit_price: x.unit_price,
        notes: x.notes || null
      }));

      const { data: orderId, error } = await sb.rpc('create_store_order', {
        p_company_id: state.settings.company_id,
        p_customer_id: state.customer?.id || null,
        p_items: items,
        p_payment_method: orderData.payment_method || 'cash',
        p_fulfillment_type: orderData.fulfillment_type || 'delivery',
        p_customer_name: orderData.customer_name,
        p_customer_phone: orderData.customer_phone,
        p_customer_address: orderData.customer_address,
        p_customer_notes: orderData.customer_notes,
        p_scheduled_at: orderData.scheduled_at || null
      });

      if (error) throw error;

      clearCart();
      return { ok: true, order_id: orderId };
    } catch (e) {
      console.warn('[Refad Store] createOrder failed:', e);
      return {
        ok: false,
        error: e.message || 'تعذر إنشاء الطلب.',
        error_code: e.code || null,
        error_details: e.details || null,
        error_hint: e.hint || null
      };
    }
  }

  async function getMyOrders() {
    if (!sb || !state.customer || !state.settings) return [];
    try {
      const { data } = await sb.from('store_orders')
        .select('*')
        .eq('company_id', state.settings.company_id)
        .eq('customer_id', state.customer.id)
        .order('created_at', { ascending: false })
        .limit(20);
      return data || [];
    } catch (e) {
      console.warn('[Refad Store] getMyOrders failed:', e);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════
  function init() {
    loadCart();
    loadWishlist();
    loadCustomer();
    console.log('[Refad Store] store-api.js v1.4 ready');
  }

  init();

  // ═══════════════════════════════════════════════════════════
  // EXPORTS
  // ═══════════════════════════════════════════════════════════
  window.RefadStore = {
    sb: sb,
    state: state,
    esc: esc,
    money: money,
    num: num,
    UUID_REGEX: UUID_REGEX,
    getConnectionStatus: getConnectionStatus,
    getLastError: getLastError,

    // Company & Settings
    resolveCompany: resolveCompany,
    loadSettings: loadSettings,
    loadTheme: loadTheme,
    getStoreDirectory: getStoreDirectory,
    setCurrentCompany: setCurrentCompany,
    getCurrentCompany: getCurrentCompany,
    getStoreUrl: getStoreUrl,
    validateSlug: validateSlug,
    isStoreOpen: isStoreOpen,

    // Products
    getProducts: getProducts,
    loadAvailability: loadAvailability,
    getAvailable: getAvailable,
    getCategories: getCategories,
    getBundleComponents: getBundleComponents,

    // Cart
    loadCart: loadCart,
    addToCart: addToCart,
    updateCartItem: updateCartItem,
    removeFromCart: removeFromCart,
    clearCart: clearCart,
    getCartTotals: getCartTotals,

    // Wishlist
    loadWishlist: loadWishlist,
    toggleWishlist: toggleWishlist,
    isInWishlist: isInWishlist,

    // Customer
    loadCustomer: loadCustomer,
    registerCustomer: registerCustomer,
    loginCustomer: loginCustomer,
    logoutCustomer: logoutCustomer,

    // Orders
    createOrder: createOrder,
    getMyOrders: getMyOrders
  };

})();