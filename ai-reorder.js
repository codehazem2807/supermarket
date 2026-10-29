/* ============================================================
   ai-reorder.js — Refad ERP v3.0
   ═══════════════════════════════════════════════════════════════
   ✅ حساب الكميات من المبيعات (median + weighted)
   ✅ Dead stock detection
   ✅ Pending POs (تجنب الازدواج)
   ✅ Coverage periods (7/14/30/60/90/180)
   ✅ Safety factor
   ✅ Critical items (ناقص فوراً)
   ✅ Smart supplier grouping
   ✅ Export to Purchase Order
   ✅ AI insights
   ============================================================ */

(function () {
  'use strict';

  const cfg = window.REFAD_CONFIG;
  if (!cfg || !window.Refad) {
    console.error('[Refad] config.js + app.js لازم يتحمّلوا الأول!');
    return;
  }

  // ═══════════════════════════════════════════════════════════
  // 🎯 SETTINGS
  // ═══════════════════════════════════════════════════════════
  const SETTINGS = {
    lookbackDays: 90,
    minSalesDays: 7,
    defaultCoverageDays: 30,
    safetyFactor: 15,
    deadStockThreshold: 0.01,
    criticalThreshold: 3,
    maxSuggestionsPerRun: 100
  };

  // ═══════════════════════════════════════════════════════════
  // 🧮 CORE ALGORITHMS
  // ═══════════════════════════════════════════════════════════

  /**
   * حساب median من مصفوفة أرقام
   */
  function median(arr) {
    if (!arr || arr.length === 0) return 0;
    var sorted = arr.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
  }

  /**
   * حساب المتوسط المرجح (الأحدث = أهمية أعلى)
   */
  function weightedAvg(values) {
    if (!values || values.length === 0) return 0;
    var sum = 0;
    var weightSum = 0;
    for (var i = 0; i < values.length; i++) {
      var weight = i + 1; // الأحدث وزن أعلى
      sum += values[i] * weight;
      weightSum += weight;
    }
    return weightSum > 0 ? sum / weightSum : 0;
  }

  /**
   * حساب daily rate لكل منتج من المبيعات
   */
  function calcDailyRates(salesItems, lookbackDays) {
    // salesItems: [{ product_id, quantity, invoice_date }]
    var byProductDay = {};

    for (var i = 0; i < salesItems.length; i++) {
      var item = salesItems[i];
      var pid = String(item.product_id);
      var date = item.invoice_date ? item.invoice_date.slice(0, 10) : null;
      var qty = Number(item.quantity) || 0;

      if (!pid || !date || qty <= 0) continue;

      if (!byProductDay[pid]) byProductDay[pid] = {};
      byProductDay[pid][date] = (byProductDay[pid][date] || 0) + qty;
    }

    var rates = {};

    Object.keys(byProductDay).forEach(function (pid) {
      var dailyMap = byProductDay[pid];
      var dailyQtys = [];
      var days = lookbackDays || SETTINGS.lookbackDays;

      // نبني مصفوفة الأيام (0 للأيام بدون مبيعات)
      for (var d = 0; d < days; d++) {
        var dateObj = new Date();
        dateObj.setDate(dateObj.getDate() - d);
        var dateStr = dateObj.toISOString().slice(0, 10);
        dailyQtys.push(dailyMap[dateStr] || 0);
      }

      // Median (الأكثر دقة للأصناف اللي ليها أيام 0 كتير)
      var medRate = median(dailyQtys);
      // Weighted (يراعي الاتجاه)
      var wRate = weightedAvg(dailyQtys);
      // متوسط بسيط
      var totalSold = dailyQtys.reduce(function (s, v) { return s + v; }, 0);
      var avgRate = totalSold / days;

      // نستخدم median كأساس، ولو صفر نستخدم المتوسط
      var finalRate = medRate > 0 ? medRate : avgRate;

      rates[pid] = {
        median: Math.round(medRate * 100) / 100,
        weighted: Math.round(wRate * 100) / 100,
        avg: Math.round(avgRate * 100) / 100,
        rate: Math.round(finalRate * 100) / 100,
        totalSold: totalSold,
        daysWithSales: dailyQtys.filter(function (q) { return q > 0; }).length
      };
    });

    return rates;
  }

  /**
   * حساب الكمية المقترحة للطلب
   */
  function calcSuggestedQty(product, rate, stockQty, pendingQty, coverage) {
    var p = product || {};
    var dailyRate = Number(rate) || 0;
    var stock = Number(stockQty) || 0;
    var pending = Number(pendingQty) || 0;
    var coverageDays = (coverage && coverage.days) || SETTINGS.defaultCoverageDays;

    // الحماية
    if (coverageDays > 180) coverageDays = 180;
    if (coverageDays < 3) coverageDays = 3;

    var safetyMultiplier = 1 + ((coverage && coverage.safetyFactor) || SETTINGS.safetyFactor) / 100;
    var targetStock = Math.ceil(dailyRate * coverageDays * safetyMultiplier);
    var effectiveStock = stock + pending;
    var needed = Math.max(0, targetStock - effectiveStock);

    var reorderLevel = Number(p.reorder_level) || Number(p.min_stock) || 10;
    var minOrderQty = Number(p.min_order_qty) || 1;

    // Dead stock check
    if (coverage && coverage.skipDeadStock && dailyRate < SETTINGS.deadStockThreshold && stock > reorderLevel) {
      return { qty: 0, reason: 'deadstock', targetStock: targetStock };
    }

    // مبيعات = 0
    if (dailyRate < SETTINGS.deadStockThreshold) {
      if (effectiveStock <= reorderLevel) {
        return {
          qty: Math.max(minOrderQty, reorderLevel - effectiveStock + 5),
          reason: 'nosales_lowstock',
          targetStock: targetStock
        };
      }
      return { qty: 0, reason: 'deadstock', targetStock: targetStock };
    }

    // كمية مقترحة
    var suggested = needed;

    // خليها على الأقل = minOrderQty
    if (suggested > 0 && suggested < minOrderQty) {
      suggested = minOrderQty;
    }

    // Hard cap (مش أكتر من 180 يوم)
    var hardCap = Math.ceil(dailyRate * 180);
    if (suggested > hardCap) suggested = hardCap;

    // لو needed = 0 → مفيش حاجة
    if (needed <= 0) {
      return {
        qty: 0,
        reason: 'sufficient',
        targetStock: targetStock,
        currentStock: effectiveStock
      };
    }

    return {
      qty: Math.ceil(suggested),
      reason: 'auto',
      targetStock: targetStock,
      currentStock: effectiveStock
    };
  }

  /**
   * تصنيف الأهمية
   */
  function classifyUrgency(product, stock, dailyRate, reorderLevel) {
    var daysOfStock = dailyRate > 0 ? stock / dailyRate : 999;

    if (stock <= 0) {
      return { level: 'critical', label: 'نفد تماماً', color: '#ef4444', daysOfStock: 0 };
    }
    if (stock <= reorderLevel && daysOfStock < 3) {
      return { level: 'critical', label: 'حرج جداً', color: '#ef4444', daysOfStock: Math.round(daysOfStock) };
    }
    if (daysOfStock < 7) {
      return { level: 'high', label: 'عالي', color: '#f59e0b', daysOfStock: Math.round(daysOfStock) };
    }
    if (daysOfStock < 14) {
      return { level: 'medium', label: 'متوسط', color: '#3b82f6', daysOfStock: Math.round(daysOfStock) };
    }
    if (daysOfStock < 30) {
      return { level: 'low', label: 'منخفض', color: '#10b981', daysOfStock: Math.round(daysOfStock) };
    }
    return { level: 'ok', label: 'كافي', color: '#64748b', daysOfStock: Math.round(daysOfStock) };
  }

  // ═══════════════════════════════════════════════════════════
  // 📊 LOAD DATA
  // ═══════════════════════════════════════════════════════════
  async function loadProducts(session) {
    var res = await window.Refad.sb.from('products')
      .select('id, name, barcode, plu_code, sku, unit, cost_price, sale_price, min_stock, reorder_qty, category_id, is_active, deleted_at')
      .eq('company_id', session.company_id)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name');

    if (res.error) throw res.error;
    return res.data || [];
  }

  async function loadStockOnHand(session) {
    var res = await window.Refad.sb.from('v_stock_on_hand')
      .select('product_id, on_hand')
      .eq('company_id', session.company_id);

    if (res.error) throw res.error;
    var map = {};
    (res.data || []).forEach(function (r) {
      map[String(r.product_id)] = Number(r.on_hand || 0);
    });
    return map;
  }

  async function loadSalesItems(session, lookbackDays) {
    var fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - (lookbackDays || SETTINGS.lookbackDays));
    var fromStr = fromDate.toISOString().slice(0, 10);

    var res = await window.Refad.sb.from('sales_invoice_items')
      .select('product_id, quantity, sales_invoices!inner(invoice_date, company_id, branch_id, status)')
      .eq('sales_invoices.company_id', session.company_id)
      .neq('sales_invoices.status', 'voided')
      .neq('sales_invoices.status', 'returned')
      .gte('sales_invoices.invoice_date', fromStr);

    if (res.error) throw res.error;

    return (res.data || []).map(function (r) {
      return {
        product_id: r.product_id,
        quantity: Number(r.quantity) || 0,
        invoice_date: r.sales_invoices ? r.sales_invoices.invoice_date : null
      };
    });
  }

  async function loadPendingPOs(session) {
    var res = await window.Refad.sb.from('purchase_order_items')
      .select('product_id, quantity, received_qty, purchase_orders!inner(status, company_id)')
      .eq('purchase_orders.company_id', session.company_id)
      .in('purchase_orders.status', ['draft', 'pending', 'approved', 'partially_received']);

    if (res.error) {
      console.warn('[AI Reorder] POs load failed:', res.error);
      return {};
    }

    var map = {};
    (res.data || []).forEach(function (r) {
      var pid = String(r.product_id);
      var remaining = Math.max(0, (Number(r.quantity) || 0) - (Number(r.received_qty) || 0));
      if (remaining > 0) {
        map[pid] = (map[pid] || 0) + remaining;
      }
    });
    return map;
  }

  async function loadSupplierProducts(session) {
    // آخر مورد لكل منتج من الـ PO السابقة
    var res = await window.Refad.sb.from('purchase_order_items')
      .select('product_id, purchase_orders!inner(supplier_id, suppliers(name), created_at, company_id)')
      .eq('purchase_orders.company_id', session.company_id)
      .order('created_at', { ascending: false })
      .limit(1000);

    if (res.error) return {};

    var map = {};
    (res.data || []).forEach(function (r) {
      var pid = String(r.product_id);
      if (!map[pid] && r.purchase_orders && r.purchase_orders.supplier_id) {
        map[pid] = {
          supplier_id: r.purchase_orders.supplier_id,
          supplier_name: r.purchase_orders.suppliers ? r.purchase_orders.suppliers.name : null
        };
      }
    });
    return map;
  }

  // ═══════════════════════════════════════════════════════════
  // 🧠 MAIN ANALYSIS
  // ═══════════════════════════════════════════════════════════
  async function analyze(options) {
    options = options || {};
    var session = options.session;
    if (!session || !session.company_id) {
      throw new Error('Session مطلوب');
    }

    var coverage = {
      days: options.coverageDays || SETTINGS.defaultCoverageDays,
      safetyFactor: options.safetyFactor || SETTINGS.safetyFactor,
      skipDeadStock: options.skipDeadStock !== false
    };

    var lookbackDays = options.lookbackDays || SETTINGS.lookbackDays;

    console.log('[AI Reorder] Loading data...');

    // Load all in parallel
    var results = await Promise.all([
      loadProducts(session),
      loadStockOnHand(session),
      loadSalesItems(session, lookbackDays),
      loadPendingPOs(session),
      loadSupplierProducts(session)
    ]);

    var products = results[0];
    var stockMap = results[1];
    var salesItems = results[2];
    var pendingPOs = results[3];
    var supplierMap = results[4];

    console.log('[AI Reorder] Products:', products.length, '| Sales items:', salesItems.length);

    // حساب معدلات المبيعات
    var dailyRates = calcDailyRates(salesItems, lookbackDays);

    // بناء الاقتراحات
    var suggestions = [];
    var stats = {
      total: products.length,
      needsReorder: 0,
      critical: 0,
      deadstock: 0,
      sufficient: 0,
      totalCost: 0,
      totalQty: 0
    };

    for (var i = 0; i < products.length; i++) {
      var p = products[i];
      var pid = String(p.id);
      var rateInfo = dailyRates[pid] || { rate: 0, median: 0, weighted: 0, avg: 0, totalSold: 0, daysWithSales: 0 };
      var stock = stockMap[pid] || 0;
      var pending = pendingPOs[pid] || 0;
      var reorderLevel = Number(p.min_stock) || Number(p.reorder_qty) || 10;

      var calc = calcSuggestedQty(p, rateInfo.rate, stock, pending, coverage);
      var urgency = classifyUrgency(p, stock, rateInfo.rate, reorderLevel);

      if (urgency.level === 'critical') stats.critical++;
      if (calc.reason === 'deadstock') stats.deadstock++;
      if (calc.reason === 'sufficient') stats.sufficient++;

      if (calc.qty > 0) {
        stats.needsReorder++;
        stats.totalQty += calc.qty;
        var cost = calc.qty * (Number(p.cost_price) || 0);
        stats.totalCost += cost;

        var supplier = supplierMap[pid] || {};

        suggestions.push({
          product_id: p.id,
          product_name: p.name,
          barcode: p.barcode,
          plu_code: p.plu_code,
          sku: p.sku,
          unit: p.unit,
          cost_price: Number(p.cost_price) || 0,
          sale_price: Number(p.sale_price) || 0,
          current_stock: stock,
          pending_po: pending,
          reorder_level: reorderLevel,
          daily_rate: rateInfo.rate,
          median_rate: rateInfo.median,
          weighted_rate: rateInfo.weighted,
          days_with_sales: rateInfo.daysWithSales,
          suggested_qty: calc.qty,
          target_stock: calc.targetStock,
          reason: calc.reason,
          urgency: urgency,
          estimated_cost: Math.round(cost * 100) / 100,
          supplier_id: supplier.supplier_id || null,
          supplier_name: supplier.supplier_name || null,
          coverage_days: coverage.days
        });
      }
    }

    // ترتيب حسب الأهمية
    var urgencyOrder = { critical: 0, high: 1, medium: 2, low: 3, ok: 4 };
    suggestions.sort(function (a, b) {
      var diff = urgencyOrder[a.urgency.level] - urgencyOrder[b.urgency.level];
      if (diff !== 0) return diff;
      // لو نفس المستوى، الأكثر نقصاً أولاً
      return a.current_stock - b.current_stock;
    });

    // تجميع حسب المورد
    var bySupplier = {};
    suggestions.forEach(function (s) {
      var key = s.supplier_id || 'unknown';
      if (!bySupplier[key]) {
        bySupplier[key] = {
          supplier_id: s.supplier_id,
          supplier_name: s.supplier_name || 'غير محدد',
          items: [],
          total_cost: 0,
          total_qty: 0
        };
      }
      bySupplier[key].items.push(s);
      bySupplier[key].total_cost += s.estimated_cost;
      bySupplier[key].total_qty += s.suggested_qty;
    });

    var supplierGroups = Object.values(bySupplier).sort(function (a, b) {
      return b.total_cost - a.total_cost;
    });

    console.log('[AI Reorder] Analysis complete:', stats.needsReorder, 'items need reorder');

    return {
      ok: true,
      stats: stats,
      suggestions: suggestions,
      supplier_groups: supplierGroups,
      coverage: coverage,
      lookback_days: lookbackDays,
      generated_at: new Date().toISOString()
    };
  }

  // ═══════════════════════════════════════════════════════════
  // 📤 EXPORT TO PURCHASE ORDER
  // ═══════════════════════════════════════════════════════════
  async function createPurchaseOrder(session, items, options) {
    options = options || {};
    if (!items || items.length === 0) {
      throw new Error('مفيش أصناف');
    }

    // Group by supplier
    var bySupplier = {};
    items.forEach(function (item) {
      var sid = item.supplier_id || 'unknown';
      if (!bySupplier[sid]) bySupplier[sid] = [];
      bySupplier[sid].push(item);
    });

    var supplierIds = Object.keys(bySupplier).filter(function (k) { return k !== 'unknown'; });
    if (supplierIds.length === 0) {
      throw new Error('كل الأصناف بدون مورد — اربط موردين أولاً');
    }

    if (supplierIds.length > 1 && !options.allowMultiSupplier) {
      throw new Error('الأصناف موزعة على ' + supplierIds.length + ' مورد. اختر مورد واحد أو فعّل allowMultiSupplier');
    }

    var createdPOs = [];

    for (var i = 0; i < supplierIds.length; i++) {
      var supplierId = supplierIds[i];
      var supplierItems = bySupplier[supplierId];

      var total = supplierItems.reduce(function (sum, it) {
        return sum + (Number(it.suggested_qty) || 0) * (Number(it.cost_price) || 0);
      }, 0);

      var poNumber = 'PO-' + new Date().getFullYear() + '-' + Date.now().toString(36).toUpperCase().slice(-6);

      // إنشاء PO
      var poRes = await window.Refad.sb.from('purchase_orders').insert({
        company_id: session.company_id,
        branch_id: session.active_branch_id,
        warehouse_id: options.warehouse_id || null,
        supplier_id: supplierId,
        po_number: poNumber,
        status: 'draft',
        order_date: new Date().toISOString().slice(0, 10),
        expected_date: options.expected_date || null,
        total: total,
        notes: 'AI Reorder — تغطية ' + (options.coverageDays || SETTINGS.defaultCoverageDays) + ' يوم',
        created_by: session.user_id
      }).select('id').single();

      if (poRes.error) throw new Error('فشل إنشاء PO: ' + poRes.error.message);

      var poId = poRes.data.id;

      // إضافة الأصناف
      var poItems = supplierItems.map(function (it) {
        return {
          po_id: poId,
          product_id: it.product_id,
          quantity: it.suggested_qty,
          unit_cost: it.cost_price
        };
      });

      var itemsRes = await window.Refad.sb.from('purchase_order_items').insert(poItems);
      if (itemsRes.error) {
        // حاول تمسح الـ PO
        await window.Refad.sb.from('purchase_orders').delete().eq('id', poId);
        throw new Error('فشل حفظ الأصناف: ' + itemsRes.error.message);
      }

      createdPOs.push({
        po_id: poId,
        po_number: poNumber,
        supplier_id: supplierId,
        items_count: supplierItems.length,
        total: total
      });

      // Audit log
      if (window.Refad.logAudit) {
        await window.Refad.logAudit(session, 'po.create', 'purchase_order', poId, null, {
          po_number: poNumber,
          items_count: supplierItems.length,
          total: total,
          source: 'ai_reorder'
        });
      }
    }

    return createdPOs;
  }

  // ═══════════════════════════════════════════════════════════
  // 🤖 AI INSIGHTS
  // ═══════════════════════════════════════════════════════════
  async function generateInsights(analysis, session) {
    if (!window.AI_CONFIG || !window.AI_CONFIG.chatWithTools) {
      return { ok: false, error: 'AI_CONFIG غير محمّل' };
    }

    var top5 = analysis.suggestions.slice(0, 5).map(function (s) {
      return '• ' + s.product_name + ': مبيعات يومية ' + s.daily_rate + '، مخزون ' + s.current_stock + '، مقترح طلب ' + s.suggested_qty;
    }).join('\n');

    var msg = 'لدي ' + analysis.stats.needsReorder + ' منتج يحتاج طلب شراء.\n\n' +
      'الأهم 5:\n' + top5 + '\n\n' +
      'إجمالي التكلفة المقدرة: ' + analysis.stats.totalCost.toFixed(2) + ' ج.م\n' +
      'عدد المنتجات الحرجة: ' + analysis.stats.critical + '\n' +
      'Dead stock: ' + analysis.stats.deadstock + '\n\n' +
      'أعطني:\n' +
      '1. تحليل سريع (سطرين)\n' +
      '2. 3 توصيات عملية للطلب\n' +
      '3. تحذيرات (لو موجودة)';

    try {
      var result = await window.AI_CONFIG.chatWithTools({
        session: session,
        userMessage: msg,
        personaId: 'inventory'
      });
      return result;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 📤 EXPORTS
  // ═══════════════════════════════════════════════════════════
  window.Refad = window.Refad || {};
  window.Refad.AIReorder = {
    analyze: analyze,
    createPurchaseOrder: createPurchaseOrder,
    generateInsights: generateInsights,

    // Utilities
    calcDailyRates: calcDailyRates,
    calcSuggestedQty: calcSuggestedQty,
    classifyUrgency: classifyUrgency,
    median: median,
    weightedAvg: weightedAvg,

    SETTINGS: SETTINGS
  };

  console.log('[Refad] ai-reorder.js ready ✅');

})();