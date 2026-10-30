/* ============================================================
   config.js — Refad ERP v5.0
   ⭐ v5.0: Notifications + Chat + Storefront + Store Admin
   ⭐ v4.2: transfers + counts
   ⭐ v4.1: expenses + presets
   ⭐ v4.0: Presets + Offline + Forecast + Seasons + Mixed Payment
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
    APP_VERSION: '5.0.0',
    LOGO_URL: 'logo.png',

    // ═══════════════════════════════════════════════════════════
    // 🖼️ LOGO
    // ═══════════════════════════════════════════════════════════
    LOGO: {
      URL: 'logo.png',
      ALT: 'رفاد',
      LOAD_TIMEOUT_MS: 3000,
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
      COMPANY_PRESET_APPLY: 'company.preset_apply',

      BRANCHES_VIEW: 'branches.view',
      BRANCHES_MANAGE: 'branches.manage',
      BRANCHES_DELETE: 'branches.delete',
      BRANCHES_COMPARE: 'branches.compare',

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

      FORECAST_VIEW: 'forecast.view',
      FORECAST_MANAGE: 'forecast.manage',
      SEASONS_VIEW: 'seasons.view',
      SEASONS_MANAGE: 'seasons.manage',

      OFFLINE_QUEUE_VIEW: 'offline_queue.view',
      OFFLINE_QUEUE_MANAGE: 'offline_queue.manage',

      EXPENSES_VIEW: 'expenses.view',
      EXPENSES_MANAGE: 'expenses.manage',

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
      SUBSCRIPTIONS_MANAGE: 'subscriptions.manage',

      // ⭐ v5.0: Notifications
      NOTIFICATIONS_VIEW: 'notifications.view',
      NOTIFICATIONS_MANAGE: 'notifications.manage',

      // ⭐ v5.0: Chat
      CHAT_USE: 'chat.use',
      CHAT_MANAGE: 'chat.manage',

      // ⭐ v5.0: Store
      STORE_VIEW: 'store.view',
      STORE_MANAGE: 'store.manage',
      STORE_ORDERS_VIEW: 'store.orders_view',
      STORE_ORDERS_MANAGE: 'store.orders_manage',
      STORE_SETTINGS_VIEW: 'store.settings_view',
      STORE_SETTINGS_MANAGE: 'store.settings_manage'
    },

    // ═══════════════════════════════════════════════════════════
    // 🗺️ ROUTES
    // ═══════════════════════════════════════════════════════════
    ROUTES: {
      'dashboard.html':       null,
      'pos.html':             'pos.use',
      'session.html':         'session.use',
      'products.html':        'products.view',
      'inventory.html':       'inventory.view',
      'warehouses.html':      'warehouses.view',
      'transfers.html':       'warehouses.transfer',
      'counts.html':          'warehouses.count',
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
      'forecast.html':        'forecast.view',
      'branch_compare.html':  'branches.compare',
      'offline_queue.html':   'offline_queue.view',
      'seasons.html':         'seasons.view',
      'expenses.html':        'expenses.view',
      'presets.html':         'company.preset_apply',
      // ⭐ v5.0: New pages
      'notifications.html':   'notifications.view',
      'chat.html':            'chat.use',
      'store-admin.html':     'store.manage',
      'store-orders.html':    'store.orders_view',
      'store-settings.html':  'store.settings_manage'
    },

    // ═══════════════════════════════════════════════════════════
    // 🔔 NOTIFICATIONS (v5.0)
    // ═══════════════════════════════════════════════════════════
    NOTIFICATIONS: {
      TYPES: [
        { value: 'low_stock',             label: 'مخزون منخفض',        icon: 'alert-triangle', severity: 'warning', color: 'var(--gold)' },
        { value: 'out_of_stock',          label: 'نفاد مخزون',         icon: 'package-x',      severity: 'danger',  color: 'var(--danger)' },
        { value: 'expiring_lot',          label: 'صلاحية قريبة',       icon: 'clock',          severity: 'warning', color: 'var(--gold)' },
        { value: 'expired_lot',           label: 'صلاحية منتهية',      icon: 'alert-octagon',  severity: 'danger',  color: 'var(--danger)' },
        { value: 'store_order',           label: 'طلب متجر جديد',      icon: 'shopping-bag',   severity: 'info',    color: 'var(--info)' },
        { value: 'store_order_paid',      label: 'طلب مدفوع',          icon: 'check-circle',   severity: 'success', color: 'var(--success)' },
        { value: 'store_order_cancelled', label: 'طلب ملغي',           icon: 'x-circle',       severity: 'danger',  color: 'var(--danger)' },
        { value: 'transfer_pending',      label: 'تحويل بانتظار',      icon: 'truck',          severity: 'info',    color: 'var(--info)' },
        { value: 'transfer_received',     label: 'تحويل مستلم',        icon: 'package-check',  severity: 'success', color: 'var(--success)' },
        { value: 'subscription_expiring', label: 'اشتراك ينتهي',       icon: 'credit-card',    severity: 'warning', color: 'var(--gold)' },
        { value: 'subscription_expired',  label: 'اشتراك منتهي',       icon: 'alert-circle',   severity: 'danger',  color: 'var(--danger)' },
        { value: 'payment_due',           label: 'دفعة مستحقة',        icon: 'banknote',       severity: 'warning', color: 'var(--gold)' },
        { value: 'chat_message',          label: 'رسالة جديدة',        icon: 'message-circle', severity: 'info',    color: 'var(--info)' },
        { value: 'system',                label: 'نظام',               icon: 'info',           severity: 'info',    color: 'var(--info)' }
      ],
      SEVERITIES: [
        { value: 'info',    label: 'معلومة',  color: 'var(--info)',    bg: 'var(--info-soft)' },
        { value: 'success', label: 'نجاح',    color: 'var(--success)', bg: 'var(--success-soft)' },
        { value: 'warning', label: 'تحذير',   color: 'var(--gold)',    bg: 'var(--gold-soft)' },
        { value: 'danger',  label: 'خطر',     color: 'var(--danger)',  bg: 'var(--danger-soft)' }
      ],
      POLL_INTERVAL_MS: 30000,
      MAX_DROPDOWN_ITEMS: 10,
      MAX_PAGE_SIZE: 50,
      AUTO_MARK_READ_DELAY_MS: 2000,
      SOUND_ENABLED: true,
      SOUND_URL: 'sounds/notification.mp3',
      BROWSER_NOTIFICATION_ENABLED: false
    },

    // ═══════════════════════════════════════════════════════════
    // 💬 CHAT (v5.0)
    // ═══════════════════════════════════════════════════════════
    CHAT: {
      TYPES: [
        { value: 'direct', label: 'محادثة فردية', icon: 'user', color: 'var(--info)' },
        { value: 'group',  label: 'مجموعة',       icon: 'users', color: 'var(--accent)' }
      ],
      PARTICIPANT_ROLES: [
        { value: 'member', label: 'عضو' },
        { value: 'admin',  label: 'مشرف' }
      ],
      POLL_INTERVAL_MS: 3000,
      MAX_MESSAGE_LENGTH: 5000,
      MAX_ATTACHMENT_SIZE_MB: 10,
      MAX_ATTACHMENTS_PER_MESSAGE: 5,
      ALLOWED_ATTACHMENT_TYPES: [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
        'application/pdf',
        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain', 'text/csv',
        'application/zip'
      ],
      ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
      TYPING_TIMEOUT_MS: 3000,
      ONLINE_TIMEOUT_MS: 60000,
      MESSAGES_PAGE_SIZE: 50,
      CONVERSATIONS_PAGE_SIZE: 30,
      STORAGE_BUCKET: 'chat-attachments',
      EMOJIS: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕']
    },

    // ═══════════════════════════════════════════════════════════
    // 🛒 STORE (v5.0)
    // ═══════════════════════════════════════════════════════════
    STORE: {
      ORDER_STATUSES: [
        { value: 'pending',          label: 'بانتظار التأكيد', icon: 'clock',           color: 'var(--gold)' },
        { value: 'confirmed',        label: 'مؤكد',            icon: 'check-circle',    color: 'var(--info)' },
        { value: 'preparing',        label: 'قيد التحضير',     icon: 'chef-hat',        color: 'var(--info)' },
        { value: 'ready',            label: 'جاهز',            icon: 'package-check',   color: 'var(--accent)' },
        { value: 'out_for_delivery', label: 'في الطريق',       icon: 'truck',           color: 'var(--purple)' },
        { value: 'delivered',        label: 'تم التوصيل',      icon: 'check-circle-2',  color: 'var(--success)' },
        { value: 'cancelled',        label: 'ملغي',            icon: 'x-circle',        color: 'var(--danger)' }
      ],
      PAYMENT_STATUSES: [
        { value: 'pending',   label: 'بانتظار الدفع', icon: 'clock',        color: 'var(--gold)' },
        { value: 'paid',      label: 'مدفوع',         icon: 'check-circle', color: 'var(--success)' },
        { value: 'refunded',  label: 'مسترجع',        icon: 'rotate-ccw',   color: 'var(--info)' }
      ],
      FULFILLMENT_TYPES: [
        { value: 'delivery', label: 'توصيل', icon: 'truck' },
        { value: 'pickup',   label: 'استلام', icon: 'store' }
      ],
      PAYMENT_METHODS: [
        { value: 'cash',   label: 'نقدي عند الاستلام', icon: 'banknote' },
        { value: 'card',   label: 'بطاقة',             icon: 'credit-card' },
        { value: 'wallet', label: 'محفظة إلكترونية',   icon: 'smartphone' },
        { value: 'online', label: 'دفع أونلاين',       icon: 'globe' }
      ],
      DEFAULT_SETTINGS: {
        enabled: true,
        store_name: '',
        store_description: '',
        logo_url: '',
        banner_url: '',
        primary_color: '#0B2C4D',
        accent_color: '#14B8A6',
        phone: '',
        whatsapp: '',
        address: '',
        working_hours: {
          sat: { open: '09:00', close: '23:00', closed: false },
          sun: { open: '09:00', close: '23:00', closed: false },
          mon: { open: '09:00', close: '23:00', closed: false },
          tue: { open: '09:00', close: '23:00', closed: false },
          wed: { open: '09:00', close: '23:00', closed: false },
          thu: { open: '09:00', close: '23:00', closed: false },
          fri: { open: '09:00', close: '23:00', closed: false }
        },
        delivery_enabled: true,
        delivery_fee: 0,
        min_order_amount: 0,
        pickup_enabled: true,
        payment_methods: ['cash', 'card', 'wallet'],
        currency: 'EGP',
        locale: 'ar-EG',
        social_links: {}
      },
      CART_STORAGE_KEY: 'refad_store_cart',
      CUSTOMER_SESSION_KEY: 'refad_store_customer',
      MAX_CART_ITEMS: 100,
      ORDERS_PAGE_SIZE: 20,
      PRODUCTS_PAGE_SIZE: 24,
      CATEGORY_VIEW: 'grid',
      SHOW_OUT_OF_STOCK: false,
      SHOW_STOCK_COUNT: true
    },

    // ═══════════════════════════════════════════════════════════
    // 🏪 WAREHOUSES
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
    // 💰 SESSION / DRAWER
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
        enable_mixed_payment: true,
        max_mixed_splits: 5,
        quick_amounts: [50, 100, 200, 500],
        receipt_footer: 'شكراً لتعاملكم معنا',
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
      forecast: {
        enabled: true,
        horizons: [7, 14, 30, 60, 90],
        default_horizon: 30,
        algorithm: 'seasonal',
        refresh_hours: 24,
        min_history_days: 30
      },
      seasons: {
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
        report_email: '',
        in_app: true,
        sound: true,
        browser_push: false
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
        forecast_alert: true
      },
      promotions: {
        enabled: true,
        stackable: false,
        time_limited: false
      },
      ai: {
        enabled: false
      },
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
      POS_MIXED_PAYMENT: 'pos.mixed_payment',
      WAREHOUSES_MULTI: 'warehouses.multi',
      WAREHOUSES_TRANSFERS: 'warehouses.transfers',
      WAREHOUSES_COUNTS: 'warehouses.counts',
      WAREHOUSES_ZONES: 'warehouses.zones',
      WAREHOUSES_LOCATIONS: 'warehouses.locations',
      SESSION_FORCE_CLOSE: 'session.force_close',
      SESSION_MULTI_CASHIER: 'session.multi_cashier',
      REPORTS_AI: 'reports.ai_insights',
      REPORTS_SCHEDULED: 'reports.scheduled',
      REPORTS_BRANCH_COMPARE: 'reports.branch_compare',
      FORECAST_ENABLED: 'forecast.enabled',
      FORECAST_SEASONAL: 'forecast.seasonal',
      SEASONS_ENABLED: 'seasons.enabled',
      ETA_E_INVOICING: 'eta.e_invoicing',
      LOYALTY_TIERS: 'loyalty.tiers',
      PROMOTIONS_BOGO: 'promotions.bogo',
      ACCOUNTING_DOUBLE_ENTRY: 'accounting.double_entry',
      ACCOUNTING_MULTI_CURRENCY: 'accounting.multi_currency',
      WEBHOOKS: 'integrations.webhooks',
      CUSTOM_FIELDS: 'custom_fields',
      // ⭐ v5.0
      NOTIFICATIONS_ENABLED: 'notifications.enabled',
      NOTIFICATIONS_REALTIME: 'notifications.realtime',
      NOTIFICATIONS_BROWSER_PUSH: 'notifications.browser_push',
      CHAT_ENABLED: 'chat.enabled',
      CHAT_ATTACHMENTS: 'chat.attachments',
      CHAT_GROUPS: 'chat.groups',
      CHAT_READ_RECEIPTS: 'chat.read_receipts',
      STORE_ENABLED: 'store.enabled',
      STORE_DELIVERY: 'store.delivery',
      STORE_PICKUP: 'store.pickup',
      STORE_GUEST_CHECKOUT: 'store.guest_checkout',
      STORE_CUSTOMER_ACCOUNTS: 'store.customer_accounts',
      STORE_ONLINE_PAYMENT: 'store.online_payment',
      STORE_REVIEWS: 'store.reviews',
      STORE_COUPONS: 'store.coupons'
    },

    // ═══════════════════════════════════════════════════════════
    // 🎁 PRESETS
    // ═══════════════════════════════════════════════════════════
    PRESETS: {
      SMALL_SUPERMARKET: 'small_supermarket',
      CHAIN: 'chain',
      HYPERMARKET: 'hypermarket',
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
    // 📡 OFFLINE QUEUE
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
    // 📈 FORECAST
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
    // 🗓️ SEASONS
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
    // 💳 MIXED PAYMENT
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
        forecast_enabled: false,
        offline_enabled: true,
        store_enabled: false,
        chat_enabled: false
      },
      basic: {
        max_users: 10,
        max_branches: 2,
        max_warehouses: 4,
        max_products: 2000,
        max_invoices_per_month: 5000,
        max_storage_mb: 500,
        forecast_enabled: true,
        offline_enabled: true,
        store_enabled: true,
        chat_enabled: true
      },
      pro: {
        max_users: 50,
        max_branches: 10,
        max_warehouses: 20,
        max_products: 20000,
        max_invoices_per_month: 50000,
        max_storage_mb: 5000,
        forecast_enabled: true,
        offline_enabled: true,
        store_enabled: true,
        chat_enabled: true
      },
      enterprise: {
        max_users: -1,
        max_branches: -1,
        max_warehouses: -1,
        max_products: -1,
        max_invoices_per_month: -1,
        max_storage_mb: -1,
        forecast_enabled: true,
        offline_enabled: true,
        store_enabled: true,
        chat_enabled: true
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
      FORECAST: 'refad_cached_forecast',
      OFFLINE_QUEUE: 'refad_offline_queue',
      PRESETS: 'refad_cached_presets',
      // ⭐ v5.0
      NOTIFICATIONS_UNREAD: 'refad_cached_notif_unread',
      NOTIFICATIONS_LIST: 'refad_cached_notif_list',
      CHAT_UNREAD: 'refad_cached_chat_unread',
      CHAT_CONVERSATIONS: 'refad_cached_chat_convs',
      STORE_SETTINGS: 'refad_cached_store_settings',
      STORE_CART: 'refad_store_cart',
      STORE_CUSTOMER: 'refad_store_customer',
      STORE_RECENT_ORDERS: 'refad_cached_store_orders'
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
      OFFLINE_QUEUE_CHANGED: 'refad:offline-queue-changed',
      OFFLINE_SYNC_START: 'refad:offline-sync-start',
      OFFLINE_SYNC_END: 'refad:offline-sync-end',
      FORECAST_UPDATED: 'refad:forecast-updated',
      PRESET_APPLIED: 'refad:preset-applied',
      EXPENSE_CREATED: 'refad:expense-created',
      CASH_MOVEMENT_CREATED: 'refad:cash-movement-created',
      TRANSFER_CREATED: 'refad:transfer-created',
      TRANSFER_SENT: 'refad:transfer-sent',
      TRANSFER_RECEIVED: 'refad:transfer-received',
      TRANSFER_CANCELLED: 'refad:transfer-cancelled',
      COUNT_CREATED: 'refad:count-created',
      COUNT_STARTED: 'refad:count-started',
      COUNT_COMPLETED: 'refad:count-completed',
      COUNT_CANCELLED: 'refad:count-cancelled',
      // ⭐ v5.0
      NOTIFICATION_RECEIVED: 'refad:notification-received',
      NOTIFICATION_READ: 'refad:notification-read',
      NOTIFICATION_UNREAD_CHANGED: 'refad:notification-unread-changed',
      CHAT_MESSAGE_RECEIVED: 'refad:chat-message-received',
      CHAT_MESSAGE_SENT: 'refad:chat-message-sent',
      CHAT_CONVERSATION_OPENED: 'refad:chat-conversation-opened',
      CHAT_UNREAD_CHANGED: 'refad:chat-unread-changed',
      STORE_SETTINGS_CHANGED: 'refad:store-settings-changed',
      STORE_ORDER_CREATED: 'refad:store-order-created',
      STORE_ORDER_STATUS_CHANGED: 'refad:store-order-status-changed',
      STORE_CART_CHANGED: 'refad:store-cart-changed',
      STORE_CUSTOMER_LOGGED_IN: 'refad:store-customer-logged-in',
      STORE_CUSTOMER_LOGGED_OUT: 'refad:store-customer-logged-out'
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
      COUNT_REPORT: 'count-report',
      FORECAST_REPORT: 'forecast-report',
      BRANCH_COMPARE: 'branch-compare',
      // ⭐ v5.0
      STORE_ORDER: 'store-order',
      STORE_ORDER_RECEIPT: 'store-order-receipt',
      CHAT_PRINT: 'chat-print',
      NOTIFICATIONS_REPORT: 'notifications-report'
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
        title: 'التواصل',
        items: [
          { href: 'notifications.html', icon: 'bell', label: 'الإشعارات', permission: 'notifications.view' },
          { href: 'chat.html', icon: 'message-circle', label: 'المحادثات', permission: 'chat.use' }
        ]
      },
      {
        title: 'المتجر الإلكتروني',
        items: [
          { href: 'store-admin.html', icon: 'store', label: 'إدارة المتجر', permission: 'store.manage' },
          { href: 'store-orders.html', icon: 'shopping-bag', label: 'طلبات المتجر', permission: 'store.orders_view' },
          { href: 'store-settings.html', icon: 'settings-2', label: 'إعدادات المتجر', permission: 'store.settings_manage' }
        ]
      },
      {
        title: 'المخزون',
        items: [
          { href: 'products.html', icon: 'package', label: 'المنتجات', permission: 'products.view' },
          { href: 'inventory.html', icon: 'boxes', label: 'المخزون', permission: 'inventory.view' },
          { href: 'warehouses.html', icon: 'warehouse', label: 'المخازن', permission: 'warehouses.view' },
          { href: 'transfers.html', icon: 'arrow-left-right', label: 'تحويلات المخازن', permission: 'warehouses.transfer' },
          { href: 'counts.html', icon: 'clipboard-check', label: 'الجرد', permission: 'warehouses.count' },
          { href: 'purchases.html', icon: 'truck', label: 'المشتريات', permission: 'purchases.view' },
          { href: 'expenses.html', icon: 'receipt', label: 'المصاريف', permission: 'expenses.view' },
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
          { href: 'branch_compare.html', icon: 'git-compare', label: 'مقارنة الفروع', permission: 'branches.compare' },
          { href: 'accounting.html', icon: 'book-open', label: 'المحاسبة', permission: 'accounting.view' },
          { href: 'barcode.html', icon: 'barcode', label: 'الباركود', permission: 'barcode.generate' },
          { href: 'users.html', icon: 'user-cog', label: 'المستخدمون', permission: 'users.view' },
          { href: 'roles.html', icon: 'shield', label: 'الأدوار', permission: 'roles.view' },
          { href: 'branches.html', icon: 'git-branch', label: 'الفروع', permission: 'branches.view' },
          { href: 'company.html', icon: 'building-2', label: 'الشركة', permission: 'company.view' },
          { href: 'audit_log.html', icon: 'file-text', label: 'سجل النشاط', permission: 'audit.view' },
          { href: 'subscriptions.html', icon: 'credit-card', label: 'الاشتراكات', permission: 'subscriptions.view' },
          { href: 'presets.html', icon: 'sparkles', label: 'القوالب الجاهزة', permission: 'company.preset_apply' },
          { href: 'offline_queue.html', icon: 'wifi-off', label: 'العمليات المعلقة', permission: 'offline_queue.view' },
          { href: 'settings.html', icon: 'settings', label: 'الإعدادات', permission: 'settings.view' }
        ]
      }
    ]
  };

  // ═══════════════════════════════════════════════════════════
  // 🖼️ HELPER: getLogoUrl
  // ═══════════════════════════════════════════════════════════
  window.REFAD_CONFIG.getLogoUrl = function (sessionLogo) {
    const cfg = window.REFAD_CONFIG;
    return sessionLogo || cfg.LOGO.URL || cfg.LOGO_URL || '';
  };

  // ═══════════════════════════════════════════════════════════
  // 🖼️ HELPER: buildLogoElement
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
        wrap.innerHTML = cfg.LOGO.FALLBACK_SVG;
      };
      wrap.appendChild(img);
    } else {
      wrap.innerHTML = cfg.LOGO.FALLBACK_SVG;
    }
    return wrap;
  };

  // ═══════════════════════════════════════════════════════════
  // 🔔 HELPER: getNotificationType
  // ═══════════════════════════════════════════════════════════
  window.REFAD_CONFIG.getNotificationType = function (value) {
    return (window.REFAD_CONFIG.NOTIFICATIONS.TYPES || []).find(t => t.value === value) || null;
  };

  // ═══════════════════════════════════════════════════════════
  // 💬 HELPER: getChatType
  // ═══════════════════════════════════════════════════════════
  window.REFAD_CONFIG.getChatType = function (value) {
    return (window.REFAD_CONFIG.CHAT.TYPES || []).find(t => t.value === value) || null;
  };

  // ═══════════════════════════════════════════════════════════
  // 🛒 HELPER: getStoreOrderStatus
  // ═══════════════════════════════════════════════════════════
  window.REFAD_CONFIG.getStoreOrderStatus = function (value) {
    return (window.REFAD_CONFIG.STORE.ORDER_STATUSES || []).find(s => s.value === value) || null;
  };

  // ═══════════════════════════════════════════════════════════
  // 🛒 HELPER: getStorePaymentStatus
  // ═══════════════════════════════════════════════════════════
  window.REFAD_CONFIG.getStorePaymentStatus = function (value) {
    return (window.REFAD_CONFIG.STORE.PAYMENT_STATUSES || []).find(s => s.value === value) || null;
  };

  // ═══════════════════════════════════════════════════════════
  // 🏪 HELPER: getWarehouseType
  // ═══════════════════════════════════════════════════════════
  window.REFAD_CONFIG.getWarehouseType = function (value) {
    return (window.REFAD_CONFIG.WAREHOUSES.TYPES || []).find(t => t.value === value) || null;
  };

  // ═══════════════════════════════════════════════════════════
  // 🏪 HELPER: getTransferStatus
  // ═══════════════════════════════════════════════════════════
  window.REFAD_CONFIG.getTransferStatus = function (value) {
    return (window.REFAD_CONFIG.WAREHOUSES.TRANSFER_STATUSES || []).find(s => s.value === value) || null;
  };

  // ═══════════════════════════════════════════════════════════
  // 💳 HELPER: getPaymentMethod
  // ═══════════════════════════════════════════════════════════
  window.REFAD_CONFIG.getPaymentMethod = function (value) {
    return (window.REFAD_CONFIG.MIXED_PAYMENT.METHODS || []).find(m => m.value === value) || null;
  };

  console.log('[Refad] config.js loaded — v' + window.REFAD_CONFIG.APP_VERSION);
  console.log('[Refad] Permissions:', Object.keys(window.REFAD_CONFIG.PERMISSIONS).length);
  console.log('[Refad] Routes:', Object.keys(window.REFAD_CONFIG.ROUTES).length);
  console.log('[Refad] Nav sections:', window.REFAD_CONFIG.NAV_SECTIONS.length);
  console.log('[Refad] Notification types:', window.REFAD_CONFIG.NOTIFICATIONS.TYPES.length);
  console.log('[Refad] Chat types:', window.REFAD_CONFIG.CHAT.TYPES.length);
  console.log('[Refad] Store order statuses:', window.REFAD_CONFIG.STORE.ORDER_STATUSES.length);
  console.log('[Refad] Feature flags:', Object.keys(window.REFAD_CONFIG.FEATURE_FLAGS).length);

})();