/* ============================================================
   ai-config.js — Refad ERP v9.0
   ⭐ v9.0: إصلاح الموديلات + إضافة الإحصائيات + قراءة الفواتير
   ─────────────────────────────────────────────────────────────
   ✅ Groq Vision (qwen/qwen3.8-27b) لقراءة الفواتير
   ✅ Gemini fallback
   ✅ getSystemStats() — إحصائيات السيستم
   ✅ scanInvoice() — قراءة فواتير الشراء
   ✅ chatWithStats() — شات مع الإحصائيات
   ✅ ai_execute_query RPC
   ============================================================ */
(function () {
  'use strict';

  const cfg = window.REFAD_CONFIG;
  if (!cfg) {
    console.error('[AI] config.js لازم يتحمل الأول!');
    return;
  }

  // ═══════════════════════════════════════════════════════════
  // 🔑 API KEYS
  // ═══════════════════════════════════════════════════════════
  const KEYS = {
    GEMINI: 'AQ.Ab8RN6L26KH3vEkvsgGUuGmj6Q_WXvB9H1ewpNqh-mkTd-yufA',
    GROQ: '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',
    OPENROUTER: ''
  };

  // ═══════════════════════════════════════════════════════════
  // 🌐 ENDPOINTS
  // ═══════════════════════════════════════════════════════════
  const ENDPOINTS = {
    GEMINI: 'https://generativelanguage.googleapis.com/v1beta/models',
    GROQ: 'https://api.groq.com/openai/v1/chat/completions'
  };

  // ═══════════════════════════════════════════════════════════
  // 🎯 GROQ MODELS
  // ═══════════════════════════════════════════════════════════
  const GROQ_MODELS = {
    VISION: 'qwen/qwen3.8-27b',        // ✅ Vision + OCR
    SMART: 'openai/gpt-oss-120b',
    FAST: 'openai/gpt-oss-20b',
    ARABIC: 'allam-2-7b',
    STT: 'whisper-large-v3-turbo',
    GUARD: 'meta-llama/llama-prompt-guard-2-86m'
  };

  // ═══════════════════════════════════════════════════════════
  // 🎯 GEMINI MODELS
  // ═══════════════════════════════════════════════════════════
  const GEMINI_MODELS = {
    FLASH: 'gemini-2.0-flash-exp',
    FLASH_LITE: 'gemini-2.0-flash-lite',
    FLASH_15: 'gemini-1.5-flash',
    PRO: 'gemini-1.5-pro'
  };

  // ═══════════════════════════════════════════════════════════
  // 📊 MODEL INFO (للـ UI)
  // ═══════════════════════════════════════════════════════════
  const MODEL_INFO = {
    'gemini-2.0-flash-exp': { label: 'Gemini 2.0 Flash', badge: 'Google', provider: 'gemini' },
    'gemini-2.0-flash-lite': { label: 'Gemini 2.0 Lite', badge: 'Google', provider: 'gemini' },
    'gemini-1.5-flash': { label: 'Gemini 1.5 Flash', badge: 'Google', provider: 'gemini' },
    'gemini-1.5-pro': { label: 'Gemini 1.5 Pro', badge: 'Google', provider: 'gemini' },
    'openai/gpt-oss-120b': { label: 'GPT-OSS-120B', badge: 'Groq', provider: 'groq' },
    'openai/gpt-oss-20b': { label: 'GPT-OSS-20B', badge: 'Groq', provider: 'groq' },
    'qwen/qwen3.8-27b': { label: 'Qwen 3.8 27B (Vision)', badge: 'Groq', provider: 'groq' },
    'allam-2-7b': { label: 'ALLaM 2 7B (عربي)', badge: 'Groq', provider: 'groq' }
  };

  // ═══════════════════════════════════════════════════════════
  // 🎯 TASK ROUTING
  // ═══════════════════════════════════════════════════════════
  const TASK_ROUTING = {
    // قراءة الفواتير — Groq Vision أولاً
    invoice: [
      { provider: 'groq', model: GROQ_MODELS.VISION },
      { provider: 'gemini', model: GEMINI_MODELS.FLASH }
    ],

    // إحصائيات
    stats: [
      { provider: 'gemini', model: GEMINI_MODELS.FLASH },
      { provider: 'groq', model: GROQ_MODELS.SMART }
    ],

    // شات عام
    chat: [
      { provider: 'gemini', model: GEMINI_MODELS.FLASH },
      { provider: 'groq', model: GROQ_MODELS.SMART },
      { provider: 'gemini', model: GEMINI_MODELS.FLASH_15 },
      { provider: 'groq', model: GROQ_MODELS.FAST }
    ],

    // عربي قصير
    arabic_short: [
      { provider: 'groq', model: GROQ_MODELS.ARABIC },
      { provider: 'gemini', model: GEMINI_MODELS.FLASH },
      { provider: 'groq', model: GROQ_MODELS.SMART }
    ],

    // ردود سريعة
    quick: [
      { provider: 'gemini', model: GEMINI_MODELS.FLASH_LITE },
      { provider: 'groq', model: GROQ_MODELS.FAST }
    ],

    // تحليل عميق
    analysis: [
      { provider: 'gemini', model: GEMINI_MODELS.PRO },
      { provider: 'gemini', model: GEMINI_MODELS.FLASH },
      { provider: 'groq', model: GROQ_MODELS.SMART }
    ]
  };

  // ═══════════════════════════════════════════════════════════
  // 🔐 KEY VALIDATION
  // ═══════════════════════════════════════════════════════════
  function isKeyValid(key, type) {
    if (!key || typeof key !== 'string') return false;
    const t = key.trim();
    if (t.length < 20) return false;
    if (/[\u0600-\u06FF]/.test(t)) return false;
    if (t.indexOf('ضع_') !== -1 || t.indexOf('YOUR_') !== -1) return false;

    if (type === 'gemini') {
      return /^(AIza[0-9A-Za-z_-]{30,}|AQ\.[0-9A-Za-z_.-]{25,})$/.test(t);
    }
    if (type === 'groq') return /^gsk_[0-9A-Za-z]{40,}$/.test(t);
    return false;
  }

  function getEngineStatus() {
    return {
      gemini: isKeyValid(KEYS.GEMINI, 'gemini'),
      groq: isKeyValid(KEYS.GROQ, 'groq'),
      openrouter: isKeyValid(KEYS.OPENROUTER, 'openrouter')
    };
  }

  let ENGINE_STATUS = getEngineStatus();

  function setApiKey(provider, newKey) {
    if (!provider || !newKey) return false;
    const p = provider.toUpperCase();
    if (!KEYS.hasOwnProperty(p)) return false;
    KEYS[p] = newKey.trim();
    try { localStorage.setItem('refad_key_' + provider.toLowerCase(), KEYS[p]); } catch (e) {}
    ENGINE_STATUS = getEngineStatus();
    console.log('%c[AI] ✅ Updated ' + p + ' key', 'color:#10b981;font-weight:bold');
    return true;
  }

  // ═══════════════════════════════════════════════════════════
  // 🌐 FETCH WITH TIMEOUT
  // ═══════════════════════════════════════════════════════════
  async function fetchWithTimeout(url, options, timeoutMs) {
    const ms = timeoutMs || 45000;
    const controller = new AbortController();
    const timer = setTimeout(function () {
      controller.abort(new Error('AI request timeout after ' + ms + 'ms'));
    }, ms);
    try {
      const opts = Object.assign({}, options, { signal: controller.signal });
      return await fetch(url, opts);
    } finally {
      clearTimeout(timer);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 🔄 RETRY LOGIC
  // ═══════════════════════════════════════════════════════════
  function isRetryableError(errorMsg) {
    if (!errorMsg) return false;
    const msg = String(errorMsg).toLowerCase();
    return msg.indexOf('high demand') !== -1 ||
           msg.indexOf('overloaded') !== -1 ||
           msg.indexOf('unavailable') !== -1 ||
           msg.indexOf('503') !== -1 ||
           msg.indexOf('429') !== -1 ||
           msg.indexOf('rate limit') !== -1 ||
           msg.indexOf('too many') !== -1;
  }

  async function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  async function callWithRetry(fn, maxAttempts, baseDelayMs) {
    const attempts = maxAttempts || 2;
    const delay = baseDelayMs || 500;
    let lastError = null;
    for (let i = 0; i < attempts; i++) {
      try {
        const result = await fn();
        if (result.ok) return result;
        lastError = result.error;
        if (!isRetryableError(result.error)) return result;
        if (i < attempts - 1) {
          const waitMs = delay * Math.pow(2, i) + Math.random() * 300;
          console.warn('[AI Retry] Attempt ' + (i + 1) + '/' + attempts + ' in ' + Math.round(waitMs) + 'ms');
          await sleep(waitMs);
        }
      } catch (e) {
        lastError = String(e.message || e);
        if (!isRetryableError(lastError)) throw e;
        if (i < attempts - 1) {
          const waitMs = delay * Math.pow(2, i) + Math.random() * 300;
          await sleep(waitMs);
        }
      }
    }
    return { ok: false, error: lastError };
  }

  // ═══════════════════════════════════════════════════════════
  // 🎯 SCHEMA
  // ═══════════════════════════════════════════════════════════
  const SCHEMA = {
    companies: { description: 'الشركات', columns: ['id','name','email','phone','address','logo_url','currency','is_active'] },
    branches: { description: 'الفروع', columns: ['id','company_id','name','code','phone','address','is_active'] },
    users: { description: 'المستخدمون', columns: ['id','company_id','branch_id','role_id','full_name','email','phone','is_owner','is_active'] },
    roles: { description: 'الأدوار', columns: ['id','company_id','name','code','permissions','is_owner','is_system'] },
    products: { description: 'المنتجات', columns: ['id','company_id','category_id','name','sku','barcode','plu_code','unit','is_weighed','cost_price','sale_price','min_stock','is_active'] },
    categories: { description: 'الفئات', columns: ['id','company_id','name','parent_id','sort_order','is_active'] },
    warehouses: { description: 'المخازن', columns: ['id','company_id','branch_id','name','code','is_active'] },
    stock_lots: { description: 'دفعات المخزون', columns: ['id','company_id','branch_id','warehouse_id','product_id','lot_number','quantity_in','quantity_left','effective_unit_cost','sale_price','expiry_date','is_quarantined'] },
    inventory_movements: { description: 'حركات المخزون', columns: ['id','company_id','branch_id','warehouse_id','product_id','lot_id','movement_type','quantity','unit_cost','reference_type','reference_id','reason'] },
    suppliers: { description: 'الموردون', columns: ['id','company_id','name','phone','email','address','opening_balance','is_active'] },
    customers: { description: 'العملاء', columns: ['id','company_id','name','phone','email','address','opening_balance','credit_limit','loyalty_points','is_active'] },
    purchase_orders: { description: 'أوامر الشراء', columns: ['id','company_id','branch_id','warehouse_id','supplier_id','po_number','status','order_date','expected_date','total'] },
    purchase_order_items: { description: 'أصناف PO', columns: ['id','po_id','product_id','quantity','unit_cost','total','received_qty'] },
    sales_invoices: { description: 'فواتير المبيعات', columns: ['id','company_id','branch_id','warehouse_id','register_id','session_id','customer_id','invoice_number','invoice_date','subtotal','discount','tax','total','paid','remaining','payment_method','status'] },
    sales_invoice_items: { description: 'أصناف الفواتير', columns: ['id','invoice_id','product_id','lot_id','quantity','unit_price','unit_cost','discount','total'] },
    sales_returns: { description: 'المرتجعات', columns: ['id','company_id','branch_id','original_invoice_id','return_number','total','reason'] },
    accounts: { description: 'الحسابات', columns: ['id','company_id','branch_id','name','account_type','opening_balance','is_active'] },
    account_transactions: { description: 'الحركات المالية', columns: ['id','company_id','branch_id','account_id','direction','amount','operation_type','reference_type','reference_id'] },
    payments: { description: 'المدفوعات', columns: ['id','company_id','branch_id','payment_number','direction','account_id','customer_id','supplier_id','amount','method','payment_date'] },
    v_party_balances: { description: 'أرصدة العملاء والموردين', columns: ['party_type','party_id','company_id','name','balance','total_debit','total_credit'] },
    v_low_stock: { description: 'منتجات ناقصة', columns: ['company_id','product_id','name','min_stock','on_hand'] },
    v_expiring_lots: { description: 'دفعات قرب الانتهاء', columns: ['company_id','branch_id','warehouse_id','product_id','lot_id','lot_number','quantity_left','expiry_date','days_to_expiry'] },
    v_daily_sales: { description: 'ملخص المبيعات اليومية', columns: ['company_id','branch_id','sale_date','invoice_count','subtotal','discount','tax','total','paid'] },
    v_stock_on_hand: { description: 'المخزون الحالي', columns: ['company_id','branch_id','warehouse_id','product_id','on_hand'] },
    company_settings: { description: 'إعدادات الشركة', columns: ['company_id','category','key','value'] },
    audit_log: { description: 'سجل النشاط', columns: ['id','company_id','user_id','user_email','action','entity_type','entity_id','created_at'] }
  };

  const SCHEMA_TEXT = Object.keys(SCHEMA).map(function (t) {
    const info = SCHEMA[t];
    return '### ' + t + ' — ' + info.description + '\nالأعمدة: ' + info.columns.join(', ');
  }).join('\n\n');

  // ═══════════════════════════════════════════════════════════
  // 🎯 SOURCE OF TRUTH
  // ═══════════════════════════════════════════════════════════
  const SOURCE_OF_TRUTH = {
    'رصيد العميل': "v_party_balances WHERE party_type='customer'",
    'رصيد المورد': "v_party_balances WHERE party_type='supplier'",
    'المخزون': 'v_stock_on_hand',
    'الأرباح': 'SUM(sales_invoice_items.total - (sales_invoice_items.quantity * sales_invoice_items.unit_cost))',
    'المبيعات اليومية': 'v_daily_sales'
  };

  // ═══════════════════════════════════════════════════════════
  // 🎯 PROMPTS
  // ═══════════════════════════════════════════════════════════
  const PROMPTS = {
    sqlGenerator: function (companyId) {
      return 'أنت خبير SQL في PostgreSQL (Supabase).\n\n' +
        '## مهمتك\nتوليد استعلام SQL واحد فقط (SELECT) لخدمة طلب المستخدم.\n\n' +
        '## Schema\n' + SCHEMA_TEXT + '\n\n' +
        '## قواعد\n' +
        '1. SELECT فقط\n' +
        '2. company_id = ' + companyId + ' دائماً\n' +
        '3. LIMIT 500 دائماً\n\n' +
        '## المخرجات\nJSON فقط:\n' +
        '{"query": "SELECT ... WHERE company_id = \'' + companyId + '\' ... LIMIT 500", "explanation": "شرح"}';
    },

    sqlFixer: function (companyId) {
      return 'أنت خبير SQL. الاستعلام ده فشل، صلحه.\n\n' +
        '## Schema\n' + SCHEMA_TEXT + '\n\n' +
        '## المخرجات\nJSON فقط:\n' +
        '{"query": "SELECT المُصلَّح ... WHERE company_id = \'' + companyId + '\' ... LIMIT 500", "fix_reason": "السبب"}';
    },

    analysis: 'أنت محلل أعمال ذكي في ERP سوبرماركت.\n\n' +
      '## الهيكل\n### الملخص\n### التفاصيل\n### التوصيات',

    invoice: `أنت محلل فواتير شراء سوبرماركت. استخرج البيانات التالية وأرجع JSON فقط:

{
  "supplier_name": "اسم المورد أو null",
  "invoice_number": "رقم الفاتورة أو null",
  "invoice_date": "YYYY-MM-DD أو null",
  "total_amount": 0,
  "items": [
    {
      "name": "اسم المنتج",
      "barcode": "الباركود أو null",
      "quantity": 0,
      "unit_price": 0,
      "discount": 0,
      "unit": "الوحدة أو null",
      "expiry_date": "YYYY-MM-DD أو null"
    }
  ]
}

قواعد:
1. اقرأ كل الأرقام بدقة
2. لو حقل مش موجود → null
3. التأكد من تطابق الإجمالي مع مجموع الأصناف
4. أرجع JSON فقط بدون أي نص إضافي`
  };

  // ═══════════════════════════════════════════════════════════
  // 🎯 TOOLS
  // ═══════════════════════════════════════════════════════════
  const TOOLS = [
    {
      type: 'function',
      function: {
        name: 'query_database',
        description: 'استعلام آمن على قاعدة البيانات. SELECT فقط.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            reason: { type: 'string' }
          },
          required: ['query', 'reason']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_party_balance',
        description: 'جلب رصيد عميل/مورد',
        parameters: {
          type: 'object',
          properties: {
            party_type: { type: 'string', enum: ['customer', 'supplier'] },
            party_id: { type: 'string' }
          },
          required: ['party_type', 'party_id']
        }
      }
    }
  ];

  // ═══════════════════════════════════════════════════════════
  // 🎯 PERSONAS
  // ═══════════════════════════════════════════════════════════
  const PERSONAS = {
    general: {
      id: 'general', name: 'المستشار العام', emoji: '🤖', color: '#10b981',
      description: 'مساعد عام', roles: ['owner', 'manager', 'employee'],
      systemPrompt: 'أنت مستشار أعمال ذكي في Refad ERP (سوبرماركت).',
      suggestions: [
        'إيه ملخص أداء الشركة اليوم؟',
        'إيه أعلى 5 منتجات مبيعاً؟',
        'مين العملاء اللي عليهم مديونية؟'
      ]
    },
    financial: {
      id: 'financial', name: 'المحلل المالي', emoji: '💰', color: '#f59e0b',
      description: 'تحليل مالي', roles: ['owner', 'manager'],
      systemPrompt: 'أنت محلل مالي. ركز على الأرباح والمبيعات والأرصدة.',
      suggestions: [
        'إيه أرباح الشهر الحالي؟',
        'إيه أعلى العملاء مديونية؟',
        'قارن مبيعات هذا الشهر بالشهر الماضي'
      ]
    },
    inventory: {
      id: 'inventory', name: 'خبير المخزون', emoji: '📦', color: '#3b82f6',
      description: 'تحليل مخزون', roles: ['owner', 'manager'],
      systemPrompt: 'أنت خبير مخزون. ركز على الصلاحية والنواقص والدفعات.',
      suggestions: [
        'المنتجات اللي هتنتهي خلال 30 يوم',
        'المنتجات اللي قاربت تخلص',
        'إيه الدفعات المحجوزة؟'
      ]
    },
    risk: {
      id: 'risk', name: 'محلل المخاطر', emoji: '⚠️', color: '#ef4444',
      description: 'تحليل مخاطر', roles: ['owner'],
      systemPrompt: 'أنت محلل مخاطر. ركز على الائتمان والمستحقات.',
      suggestions: [
        'العملاء اللي تجاوزوا حد الائتمان',
        'الموردين اللي عليهم مستحقات كبيرة',
        'إيه أعلى المخاطر المالية؟'
      ]
    }
  };

  // ═══════════════════════════════════════════════════════════
  // 🎯 SETTINGS
  // ═══════════════════════════════════════════════════════════
  const SETTINGS = {
    context: { maxHistory: 10 },
    rateLimit: { cooldownMs: 500 },
    functionCalling: { maxIterations: 3 },
    maxTokens: 8192,
    temperature: 0.2,
    timeout: 45000,
    maxImageSize: 10 * 1024 * 1024
  };

  // ═══════════════════════════════════════════════════════════
  // 🎯 HELPERS
  // ═══════════════════════════════════════════════════════════
  function getUserRole(session) {
    if (!session) return 'employee';
    if (session.is_owner === true) return 'owner';
    try {
      if (window.Refad && Refad.Session) {
        if (Refad.Session.has && Refad.Session.has('company.owner')) return 'owner';
        if (Refad.Session.has && Refad.Session.has('admin.full')) return 'manager';
      }
    } catch (e) {}
    return 'employee';
  }

  function getPersonasForRole(role) {
    return Object.keys(PERSONAS).map(function (k) { return PERSONAS[k]; })
      .filter(function (p) { return p.roles.indexOf(role) !== -1; });
  }

  function canAccessPersona(personaId, role) {
    const p = PERSONAS[personaId];
    return p ? p.roles.indexOf(role) !== -1 : false;
  }

  function getSuggestions(personaId) {
    const p = PERSONAS[personaId] || PERSONAS.general;
    return p.suggestions || [];
  }

  function getModelInfo(model) {
    return MODEL_INFO[model] || { label: model || 'AI', badge: 'AI', provider: 'unknown' };
  }

  function estimateTokens(str) {
    return Math.ceil(String(str || '').length / 3.5);
  }

  function isInputValid(text) {
    if (!text || typeof text !== 'string' || !text.trim()) {
      return { valid: false, error: 'الرسالة فارغة' };
    }
    if (text.length > 5000) {
      return { valid: false, error: 'الرسالة طويلة جداً (حد أقصى 5000 حرف)' };
    }
    return { valid: true };
  }

  // ═══════════════════════════════════════════════════════════
  // 🛡️ SANITIZE SQL QUERY
  // ═══════════════════════════════════════════════════════════
  function sanitizeQuery(rawQuery, companyId) {
    if (!rawQuery || typeof rawQuery !== 'string') {
      return { error: 'الاستعلام مطلوب' };
    }

    let q = rawQuery.trim();
    q = q.replace(/^```sql\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    q = q.replace(/;+\s*$/, '').trim();

    if (!/^\s*(SELECT|WITH)\s/i.test(q)) {
      return { error: 'SELECT فقط مسموح' };
    }

    const dangerous = /\b(DROP|DELETE|UPDATE|INSERT|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|EXEC|EXECUTE|COPY|PG_SLEEP|INTO\s+OUTFILE)\b/i;
    if (dangerous.test(q)) {
      return { error: 'أوامر غير مسموحة (ممنوع الكتابة أو الحذف)' };
    }

    if (companyId && q.indexOf('company_id') === -1) {
      return { error: 'الاستعلام لازم يحتوي على company_id = ' + companyId };
    }

    if (!/\bLIMIT\s+\d+/i.test(q)) {
      q = q + ' LIMIT 500';
    }

    return { query: q };
  }

  // ═══════════════════════════════════════════════════════════
  // 📝 BUILD SYSTEM PROMPT
  // ═══════════════════════════════════════════════════════════
  function buildSystemPrompt(personaId, companyId, role, dashboardContext, fullSnapshot) {
    const p = PERSONAS[personaId] || PERSONAS.general;
    const today = new Date().toISOString().split('T')[0];

    let prompt = 'أنت مستشار أعمال ذكي في Refad ERP (نظام إدارة سوبرماركت).\n\n' +
      '## شخصيتك\n' +
      p.emoji + ' **' + p.name + '** — ' + p.description + '\n' +
      p.systemPrompt + '\n\n' +
      '## معلومات الجلسة\n' +
      '- company_id = `' + companyId + '`\n' +
      '- role = `' + role + '`\n' +
      '- date = `' + today + '`\n' +
      '- language = العربية\n\n';

    if (dashboardContext) {
      prompt += '## بيانات الداشبورد الحالية\n';
      if (dashboardContext.period) prompt += 'الفترة: ' + dashboardContext.period + '\n';
      if (dashboardContext.kpis) {
        prompt += '### KPIs:\n';
        Object.keys(dashboardContext.kpis).forEach(function (key) {
          const val = dashboardContext.kpis[key];
          prompt += '- ' + key + ' = ' + (typeof val === 'object' ? JSON.stringify(val) : val) + '\n';
        });
      }
    }

    if (fullSnapshot && !fullSnapshot.error) {
      prompt += '\n## Full Company Snapshot\n```json\n' +
        JSON.stringify(fullSnapshot, null, 2) + '\n```\n';
    }

    prompt += '\n## Schema\n' + SCHEMA_TEXT + '\n\n' +
      '## Source of Truth\n' +
      Object.keys(SOURCE_OF_TRUTH).map(function (k) {
        return '- **' + k + '**: `' + SOURCE_OF_TRUTH[k] + '`';
      }).join('\n') + '\n\n' +
      '## قواعد صارمة\n' +
      '1. استخدم `query_database` لأي بيانات (مفيش تخمين)\n' +
      '2. company_id = ' + companyId + ' تلقائياً في كل استعلام\n' +
      '3. اعرض النتائج في جداول Markdown\n' +
      '4. الأرقام المهمة بـ **bold**\n' +
      '5. للأرصدة استخدم v_party_balances\n';

    return prompt;
  }

  // ═══════════════════════════════════════════════════════════
  // ⚠️ [الجزء 1 ينتهي هنا]
  // ═══════════════════════════════════════════════════════════
  // المحتوى التالي في الجزء 2:
  //   - callGemini()
  //   - callGroq()
  //   - directAiCall()
  //   - executeTool()
  // ═══════════════════════════════════════════════════════════
    // ═══════════════════════════════════════════════════════════
  // 🤖 GEMINI CALL
  // ═══════════════════════════════════════════════════════════
  async function callGemini(model, messages, systemPrompt, maxTokens, tools, imageBase64, imageMime, timeoutMs) {
    const key = (KEYS.GEMINI || '').trim();
    if (!key) return { ok: false, error: 'Gemini key missing' };

    const url = ENDPOINTS.GEMINI + '/' + model + ':generateContent?key=' + encodeURIComponent(key);

    const contents = [];
    let sysText = systemPrompt || '';

    messages.forEach(function (m) {
      if (m.role === 'system') {
        sysText = (sysText ? sysText + '\n\n' : '') + (m.content || '');
        return;
      }
      const role = m.role === 'assistant' ? 'model' : 'user';
      const parts = [{ text: String(m.content || '') }];
      if (imageBase64 && m.role === 'user') {
        parts.push({ inline_data: { mime_type: imageMime || 'image/jpeg', data: imageBase64 } });
      }
      contents.push({ role: role, parts: parts });
    });

    if (contents.length === 0) {
      contents.push({ role: 'user', parts: [{ text: sysText || 'مرحباً' }] });
      sysText = '';
    }

    const body = {
      contents: contents,
      generationConfig: { maxOutputTokens: maxTokens }
    };

    if (sysText) body.systemInstruction = { parts: [{ text: sysText }] };
    if (tools && tools.length) {
      body.tools = [{
        functionDeclarations: tools.map(function (t) {
          return {
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters
          };
        })
      }];
    }

    try {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }, timeoutMs || 30000);

      const json = await res.json().catch(function () { return {}; });

      if (!res.ok) {
        const errMsg = (json && json.error && json.error.message) || ('HTTP ' + res.status);
        return { ok: false, error: 'Gemini: ' + errMsg, status: res.status };
      }

      const cand = json.candidates && json.candidates[0];
      if (!cand) return { ok: false, error: 'Gemini: empty response' };

      const parts = (cand.content && cand.content.parts) || [];
      let text = '';
      const tool_calls = [];

      parts.forEach(function (p) {
        if (p.text) text += p.text;
        if (p.functionCall) {
          tool_calls.push({
            id: 'call_' + Math.random().toString(36).slice(2, 10),
            type: 'function',
            function: {
              name: p.functionCall.name,
              arguments: JSON.stringify(p.functionCall.args || {})
            }
          });
        }
      });

      return {
        ok: true,
        text: text,
        tool_calls: tool_calls.length ? tool_calls : null
      };
    } catch (e) {
      return { ok: false, error: 'Gemini network error: ' + (e.message || String(e)) };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ⚡ GROQ CALL
  // ═══════════════════════════════════════════════════════════
  async function callGroq(model, messages, systemPrompt, temperature, maxTokens, tools, imageBase64, imageMime, timeoutMs) {
    const key = (KEYS.GROQ || '').trim();
    if (!key) return { ok: false, error: 'Groq key missing' };

    let finalMessages = systemPrompt
      ? [{ role: 'system', content: systemPrompt }].concat(messages)
      : messages;

    // لو فيه صورة، لازم نستخدم صيغة الرؤية
    if (imageBase64) {
      finalMessages = finalMessages.map(function (m) {
        if (m.role !== 'user') return m;
        return {
          role: 'user',
          content: [
            { type: 'text', text: m.content || '' },
            {
              type: 'image_url',
              image_url: { url: 'data:' + (imageMime || 'image/jpeg') + ';base64,' + imageBase64 }
            }
          ]
        };
      });
    }

    const body = {
      model: model,
      messages: finalMessages,
      temperature: temperature,
      max_tokens: maxTokens
    };

    if (tools && tools.length && !imageBase64) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    try {
      const res = await fetchWithTimeout(ENDPOINTS.GROQ, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + key
        },
        body: JSON.stringify(body)
      }, timeoutMs || 25000);

      const json = await res.json().catch(function () { return {}; });

      if (!res.ok) {
        const errMsg = (json && json.error && json.error.message) || ('HTTP ' + res.status);
        return { ok: false, error: 'Groq: ' + errMsg, status: res.status };
      }

      const ch = json.choices && json.choices[0];
      if (!ch) return { ok: false, error: 'Groq: empty response' };

      return {
        ok: true,
        text: (ch.message && ch.message.content) || '',
        tool_calls: (ch.message && ch.message.tool_calls) || null
      };
    } catch (e) {
      return { ok: false, error: 'Groq network error: ' + (e.message || String(e)) };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 🎯 DIRECT AI CALL — المحرك الأساسي مع التبديل
  // ═══════════════════════════════════════════════════════════
  async function directAiCall(params) {
    const p = params || {};
    const messages = p.messages || [];
    const systemPrompt = p.systemPrompt || '';
    const temperature = typeof p.temperature === 'number' ? p.temperature : SETTINGS.temperature;
    const maxTokens = p.maxTokens || SETTINGS.maxTokens;
    const tools = p.tools || null;
    const imgB64 = p.imageBase64 || null;
    const imgMime = p.imageMime || 'image/jpeg';

    // اختيار المسار حسب نوع المهمة
    let task = p.task || 'chat';
    if (imgB64 && task === 'chat') task = 'invoice'; // لو فيه صورة، حوّل لـ invoice

    let attempts = TASK_ROUTING[task] || TASK_ROUTING.chat;

    // فلترة المحركات المتاحة
    attempts = attempts.filter(function (a) {
      if (a.provider === 'gemini') return ENGINE_STATUS.gemini;
      if (a.provider === 'groq') return ENGINE_STATUS.groq;
      if (a.provider === 'openrouter') return ENGINE_STATUS.openrouter;
      return false;
    });

    // لو مفيش أي محرك متاح
    if (attempts.length === 0) {
      if (ENGINE_STATUS.gemini) {
        attempts = [{ provider: 'gemini', model: GEMINI_MODELS.FLASH }];
      } else if (ENGINE_STATUS.groq) {
        attempts = [{ provider: 'groq', model: GROQ_MODELS.SMART }];
      } else {
        return { ok: false, error: 'لا يوجد مفتاح صالح — ضيف Gemini أو Groq' };
      }
    }

    let lastErr = null;
    const startTime = Date.now();
    const globalTimeout = 90000;

    for (let a = 0; a < attempts.length; a++) {
      if (Date.now() - startTime > globalTimeout) {
        lastErr = 'تجاوز الوقت الإجمالي (' + globalTimeout + 'ms)';
        break;
      }

      const att = attempts[a];

      const callFn = async function () {
        if (att.provider === 'gemini') {
          return await callGemini(
            att.model, messages, systemPrompt, maxTokens, tools, imgB64, imgMime, 30000
          );
        }
        if (att.provider === 'groq') {
          return await callGroq(
            att.model, messages, systemPrompt, temperature, maxTokens, tools, imgB64, imgMime, 25000
          );
        }
        return { ok: false, error: 'unknown provider' };
      };

      const result = await callWithRetry(callFn, 2, 500);

      if (result.ok) {
        return {
          ok: true,
          text: result.text,
          tool_calls: result.tool_calls,
          provider: att.provider,
          model: att.model,
          task: task
        };
      }

      lastErr = result.error;
      console.warn('[AI] ' + att.provider + '/' + att.model + ' failed: ' + lastErr);
    }

    return { ok: false, error: 'كل المحركات فشلت: ' + lastErr };
  }

  // ═══════════════════════════════════════════════════════════
  // 🔧 EXECUTE TOOL
  // ═══════════════════════════════════════════════════════════
  async function executeTool(toolName, args, companyId) {
    if (!window.Refad || !Refad.sb) {
      return { error: 'Refad.sb غير متاح' };
    }

    const sb = Refad.sb;

    try {
      // ─── query_database ───
      if (toolName === 'query_database') {
        const s = sanitizeQuery(args.query, companyId);
        if (s.error) return { error: s.error };

        console.log('[AI Tool] Query:', s.query.slice(0, 120) + '...');

        const { data, error } = await sb.rpc('ai_execute_query', {
          p_company_id: companyId,
          p_query: s.query
        });

        if (error) {
          const errMsg = error.message || error.details || JSON.stringify(error);
          console.error('[AI Tool] RPC failed:', errMsg);
          if (errMsg.includes('does not exist') || errMsg.includes('Could not find')) {
            return {
              error: 'ai_execute_query RPC غير موجودة',
              hint: 'شغّل CREATE FUNCTION ai_execute_query في Supabase SQL Editor'
            };
          }
          return { error: errMsg };
        }

        // Handle error response from RPC
        if (data && typeof data === 'object' && data.error) {
          return { error: data.error, detail: data.detail };
        }

        const rows = Array.isArray(data) ? data : (data && data.rows ? data.rows : []);
        console.log('[AI Tool] Query returned', rows.length, 'rows');

        return { query: s.query, result: rows, rows_count: rows.length };
      }

      // ─── get_party_balance ───
      if (toolName === 'get_party_balance') {
        const { data, error } = await sb.from('v_party_balances')
          .select('party_type, party_id, name, balance, total_debit, total_credit')
          .eq('company_id', companyId)
          .eq('party_type', args.party_type)
          .eq('party_id', args.party_id)
          .maybeSingle();

        if (error) return { error: error.message };
        if (!data) return { error: 'الطرف غير موجود' };

        const v = data.balance !== null && data.balance !== undefined
          ? Number(data.balance)
          : (Number(data.total_debit || 0) - Number(data.total_credit || 0));

        return {
          party_type: data.party_type,
          party_id: data.party_id,
          name: data.name,
          balance: Math.round(v * 100) / 100
        };
      }

      return { error: 'أداة غير معروفة: ' + toolName };
    } catch (e) {
      console.error('[AI Tool] Exception:', e);
      return { error: String(e.message || e) };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ⚠️ [الجزء 2 ينتهي هنا]
  // ═══════════════════════════════════════════════════════════
  // المحتوى التالي في الجزء 3:
  //   - chatWithTools() — Agent loop
  //   - scanInvoice() — قراءة الفواتير
  //   - getSystemStats() — الإحصائيات
  //   - chatWithStats() — شات مع الإحصائيات
  //   - getStatus()
  //   - EXPORTS النهائية
  //   - console.log
  // ═══════════════════════════════════════════════════════════


  console.log('[AI] v9.0 Part 1 loaded');  // ═══════════════════════════════════════════════════════════
  // 🎯 CHAT WITH TOOLS — Agent Loop
  // ═══════════════════════════════════════════════════════════
  async function chatWithTools(opts) {
    const o = opts || {};
    const session = o.session;
    const userMessage = o.userMessage || '';
    const personaId = o.personaId || 'general';
    const maxIter = SETTINGS.functionCalling.maxIterations || 3;

    const valid = isInputValid(userMessage);
    if (!valid.valid) return { ok: false, error: valid.error };

    const companyId = session && session.company_id;
    const role = getUserRole(session);

    const systemPrompt = buildSystemPrompt(personaId, companyId, role, o.dashboardContext || null, null);

    let messages = (o.history || []).slice(-SETTINGS.context.maxHistory);
    messages.push({ role: 'user', content: userMessage });

    for (let iter = 0; iter < maxIter; iter++) {
      const result = await directAiCall({
        messages: messages,
        systemPrompt: systemPrompt,
        maxTokens: SETTINGS.maxTokens,
        tools: TOOLS,
        task: 'chat'
      });

      if (!result.ok) {
        return { ok: false, error: result.error, iter: iter };
      }

      // لو فيه tool calls
      if (result.tool_calls && result.tool_calls.length > 0) {
        messages.push({
          role: 'assistant',
          content: result.text || '',
          tool_calls: result.tool_calls
        });

        for (let i = 0; i < result.tool_calls.length; i++) {
          const call = result.tool_calls[i];
          let args = {};
          try {
            args = JSON.parse(call.function.arguments || '{}');
          } catch (e) {
            args = {};
          }

          const toolResult = await executeTool(call.function.name, args, companyId);

          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(toolResult)
          });
        }
        continue;
      }

      // رد نهائي
      return {
        ok: true,
        text: result.text,
        provider: result.provider,
        model: result.model,
        iterations: iter + 1
      };
    }

    return { ok: false, error: 'وصل للحد الأقصى من التكرارات (' + maxIter + ')' };
  }

  // ═══════════════════════════════════════════════════════════
  // 📸 SCAN INVOICE — قراءة فواتير الشراء
  // ═══════════════════════════════════════════════════════════
  async function scanInvoice(imageBase64, mimeType) {
    if (!imageBase64) return { ok: false, error: 'الصورة مطلوبة' };

    const result = await directAiCall({
      messages: [{
        role: 'user',
        content: 'استخرج بيانات هذه الفاتورة وأرجع JSON فقط بدون أي نص إضافي.'
      }],
      systemPrompt: PROMPTS.invoice,
      maxTokens: 4096,
      imageBase64: imageBase64,
      imageMime: mimeType || 'image/jpeg',
      task: 'invoice'
    });

    if (!result.ok) return { ok: false, error: result.error };

    // Parse JSON
    let parsed = null;
    try {
      let cleaned = String(result.text || '').trim();
      cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      const match = String(result.text || '').match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch (e2) {}
      }
    }

    if (!parsed) {
      return {
        ok: false,
        error: 'AI لم يرجع JSON صالح',
        raw: String(result.text || '').slice(0, 300)
      };
    }

    return {
      ok: true,
      data: parsed,
      provider: result.provider,
      model: result.model
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 📊 GET SYSTEM STATS — إحصائيات السيستم
  // ═══════════════════════════════════════════════════════════
  const STATS_QUERIES = {
    overview: function (companyId) {
      return `SELECT 
        (SELECT count(*) FROM products WHERE company_id = '${companyId}' AND deleted_at IS NULL) AS total_products,
        (SELECT count(*) FROM customers WHERE company_id = '${companyId}' AND deleted_at IS NULL) AS total_customers,
        (SELECT count(*) FROM suppliers WHERE company_id = '${companyId}' AND deleted_at IS NULL) AS total_suppliers,
        (SELECT count(*) FROM sales_invoices WHERE company_id = '${companyId}' AND status <> 'voided') AS total_invoices,
        (SELECT COALESCE(SUM(total), 0) FROM sales_invoices WHERE company_id = '${companyId}' AND status <> 'voided') AS total_sales,
        (SELECT COALESCE(SUM(total), 0) FROM purchase_orders WHERE company_id = '${companyId}' AND status = 'received') AS total_purchases
      LIMIT 1`;
    },

    low_stock: function (companyId) {
      return `SELECT p.name, p.min_stock, COALESCE(SUM(sl.quantity_left), 0) AS on_hand
      FROM products p
      LEFT JOIN stock_lots sl ON sl.product_id = p.id AND sl.is_quarantined = false
      WHERE p.company_id = '${companyId}' AND p.is_active = true AND p.deleted_at IS NULL
      GROUP BY p.id, p.name, p.min_stock
      HAVING COALESCE(SUM(sl.quantity_left), 0) <= p.min_stock
      ORDER BY COALESCE(SUM(sl.quantity_left), 0) ASC
      LIMIT 20`;
    },

    expiring: function (companyId) {
      return `SELECT p.name, sl.lot_number, sl.quantity_left, sl.expiry_date,
        (sl.expiry_date - CURRENT_DATE) AS days_left
      FROM stock_lots sl
      JOIN products p ON p.id = sl.product_id
      WHERE sl.company_id = '${companyId}' AND sl.quantity_left > 0 AND sl.is_quarantined = false
        AND sl.expiry_date <= CURRENT_DATE + INTERVAL '30 days'
      ORDER BY sl.expiry_date ASC
      LIMIT 20`;
    },

    top_products: function (companyId) {
      return `SELECT p.name, SUM(sii.quantity) AS total_qty, SUM(sii.total) AS total_revenue
      FROM sales_invoice_items sii
      JOIN products p ON p.id = sii.product_id
      JOIN sales_invoices si ON si.id = sii.invoice_id
      WHERE si.company_id = '${companyId}' AND si.status <> 'voided'
      GROUP BY p.id, p.name
      ORDER BY total_qty DESC
      LIMIT 10`;
    },

    party_balances: function (companyId) {
      return `SELECT party_type, name, balance
      FROM v_party_balances
      WHERE company_id = '${companyId}' AND balance > 0
      ORDER BY balance DESC
      LIMIT 20`;
    },

    sales_today: function (companyId) {
      return `SELECT 
        COUNT(*) AS invoices_count,
        COALESCE(SUM(total), 0) AS total_sales,
        COALESCE(SUM(paid), 0) AS total_paid,
        COALESCE(SUM(remaining), 0) AS total_remaining
      FROM sales_invoices
      WHERE company_id = '${companyId}' 
        AND status <> 'voided'
        AND invoice_date::date = CURRENT_DATE
      LIMIT 1`;
    },

    sales_month: function (companyId) {
      return `SELECT 
        COUNT(*) AS invoices_count,
        COALESCE(SUM(total), 0) AS total_sales,
        COALESCE(SUM(paid), 0) AS total_paid
      FROM sales_invoices
      WHERE company_id = '${companyId}' 
        AND status <> 'voided'
        AND invoice_date >= date_trunc('month', CURRENT_DATE)
      LIMIT 1`;
    }
  };

  async function getSystemStats(companyId) {
    const sb = window.Refad && window.Refad.sb;
    if (!sb) return { ok: false, error: 'Supabase not ready' };
    if (!companyId) return { ok: false, error: 'company_id مطلوب' };

    try {
      const results = {};
      const tasks = Object.keys(STATS_QUERIES).map(async (key) => {
        try {
          const query = STATS_QUERIES[key](companyId);
          const { data, error } = await sb.rpc('ai_execute_query', {
            p_company_id: companyId,
            p_query: query
          });

          if (error) {
            console.warn('[AI Stats] ' + key + ' failed:', error.message);
            results[key] = [];
            return;
          }

          // Handle error response from RPC
          if (data && typeof data === 'object' && !Array.isArray(data) && data.error) {
            console.warn('[AI Stats] ' + key + ' RPC error:', data.error);
            results[key] = [];
            return;
          }

          results[key] = Array.isArray(data) ? data : (data && data.rows ? data.rows : []);
        } catch (e) {
          console.warn('[AI Stats] ' + key + ' exception:', e);
          results[key] = [];
        }
      });

      await Promise.all(tasks);

      return { ok: true, data: results };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 💬 CHAT WITH STATS — شات مع الإحصائيات
  // ═══════════════════════════════════════════════════════════
  async function chatWithStats(userMessage, companyId, history) {
    if (!userMessage || !userMessage.trim()) {
      return { ok: false, error: 'الرسالة مطلوبة' };
    }

    // 1) Get stats
    const stats = await getSystemStats(companyId);
    if (!stats.ok) return { ok: false, error: stats.error };

    // 2) Build context
    const statsContext = Object.keys(stats.data).map(function (key) {
      const rows = stats.data[key];
      if (!rows || rows.length === 0) {
        return '## ' + key + '\n(لا توجد بيانات)';
      }
      return '## ' + key + '\n```json\n' + JSON.stringify(rows, null, 2) + '\n```';
    }).join('\n\n');

    const systemPrompt = 'أنت محلل أعمال ذكي في Refad ERP (سوبرماركت).\n\n' +
      '## بيانات الشركة الحالية\n' + statsContext + '\n\n' +
      '## قواعد\n' +
      '1. استخدم البيانات أعلاه للإجابة\n' +
      '2. اعرض النتائج في جداول Markdown\n' +
      '3. الأرقام المهمة بـ **bold**\n' +
      '4. لو السؤال عن حاجة مش موجودة في البيانات، قول "مش موجود في البيانات الحالية"\n' +
      '5. ردودك بالعربية';

    const messages = (history || []).slice(-6).concat([
      { role: 'user', content: userMessage }
    ]);

    // 3) Call AI
    const result = await directAiCall({
      messages: messages,
      systemPrompt: systemPrompt,
      maxTokens: 4096,
      task: 'stats'
    });

    if (!result.ok) return { ok: false, error: result.error };

    return {
      ok: true,
      text: result.text,
      provider: result.provider,
      model: result.model,
      stats: stats.data
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 📊 GET ENGINE STATUS
  // ═══════════════════════════════════════════════════════════
  function getStatus() {
    return {
      gemini: ENGINE_STATUS.gemini,
      groq: ENGINE_STATUS.groq,
      openrouter: ENGINE_STATUS.openrouter,
      models: {
        chat_primary: TASK_ROUTING.chat[0],
        invoice_primary: TASK_ROUTING.invoice[0],
        stats_primary: TASK_ROUTING.stats[0],
        quick_primary: TASK_ROUTING.quick[0]
      }
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 📤 EXPORTS
  // ═══════════════════════════════════════════════════════════
  window.AI_CONFIG = {
    VERSION: '9.0.0-production',
    KEYS: KEYS,
    ENDPOINTS: ENDPOINTS,
    GROQ_MODELS: GROQ_MODELS,
    GEMINI_MODELS: GEMINI_MODELS,
    MODEL_INFO: MODEL_INFO,
    TASK_ROUTING: TASK_ROUTING,
    SCHEMA: SCHEMA,
    SCHEMA_TEXT: SCHEMA_TEXT,
    SOURCE_OF_TRUTH: SOURCE_OF_TRUTH,
    PROMPTS: PROMPTS,
    TOOLS: TOOLS,
    PERSONAS: PERSONAS,
    SETTINGS: SETTINGS,
    STATS_QUERIES: STATS_QUERIES,
    ENGINE_STATUS: ENGINE_STATUS,

    // Methods
    setApiKey: setApiKey,
    getUserRole: getUserRole,
    getPersonasForRole: getPersonasForRole,
    canAccessPersona: canAccessPersona,
    getSuggestions: getSuggestions,
    getModelInfo: getModelInfo,
    buildSystemPrompt: buildSystemPrompt,
    sanitizeQuery: sanitizeQuery,
    isInputValid: isInputValid,
    estimateTokens: estimateTokens,
    isKeyValid: isKeyValid,
    isRetryableError: isRetryableError,
    fetchWithTimeout: fetchWithTimeout,

    // Core
    directAiCall: directAiCall,
    executeTool: executeTool,
    chatWithTools: chatWithTools,

    // ⭐ New in v9.0
    scanInvoice: scanInvoice,
    getSystemStats: getSystemStats,
    chatWithStats: chatWithStats,

    // Status
    getStatus: getStatus
  };

  // ═══════════════════════════════════════════════════════════
  // ✅ STATUS CHECK ON LOAD
  // ═══════════════════════════════════════════════════════════
  (function checkStatus() {
    console.log('%c[AI Config] v9.0.0 Production', 'color:#8b5cf6;font-weight:bold;font-size:13px');
    console.log('%c📊 Engine Status:', 'color:#3b82f6;font-weight:bold');
    console.log('  Gemini:', ENGINE_STATUS.gemini ? '✅' : '❌');
    console.log('  Groq:', ENGINE_STATUS.groq ? '✅' : '❌');

    if (ENGINE_STATUS.gemini && ENGINE_STATUS.groq) {
      console.log('%c✅ Gemini + Groq شغالين — استقرار عالي', 'color:#10b981;font-weight:bold');
    } else if (ENGINE_STATUS.gemini) {
      console.log('%c✅ Gemini فقط شغال', 'color:#10b981;font-weight:bold');
    } else if (ENGINE_STATUS.groq) {
      console.log('%c✅ Groq فقط شغال', 'color:#f59e0b;font-weight:bold');
    } else {
      console.error('%c❌ مفيش أي مفتاح شغال!', 'color:#ef4444;font-weight:bold;font-size:13px');
    }

    console.log('%c🎯 Routing:', 'color:#8b5cf6;font-weight:bold');
    console.log('  Chat:', TASK_ROUTING.chat[0].provider + '/' + TASK_ROUTING.chat[0].model);
    console.log('  Invoice:', TASK_ROUTING.invoice[0].provider + '/' + TASK_ROUTING.invoice[0].model);
    console.log('  Stats:', TASK_ROUTING.stats[0].provider + '/' + TASK_ROUTING.stats[0].model);

    console.log('%c✨ New Functions:', 'color:#10b981;font-weight:bold');
    console.log('  - AI_CONFIG.getSystemStats(companyId)');
    console.log('  - AI_CONFIG.scanInvoice(base64, mimeType)');
    console.log('  - AI_CONFIG.chatWithStats(message, companyId, history)');
  })();

})();
