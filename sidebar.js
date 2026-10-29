/* ============================================================
   sidebar.js — Refad ERP v3.6 Professional
   - ✅ يقرأ من RefadSettings + session
   - ✅ RefadTheme integration كامل
   - ✅ زر الثيمات (light/dark/auto)
   - ✅ Cache يتحدث لما الإعدادات تتغير
   - ✅ Swipe + Focus trap + Back button + Session cache
   - ⭐ NEW: عرض اسم المخزن الحالي في الـ user card
   - ⭐ NEW: badge "●" على الوردية المفتوحة
   - ⭐ NEW: تحديث تلقائي كل 30 ثانية (للوردية)
   - ⭐ v3.5: staff-based session filtering (cashier_id)
   - ⭐ v3.5: logo fallback احترافي (SVG inline)
   - ⭐ v3.6: يقرأ من config.js (NAV_SECTIONS) — فيه transfers + counts
   ============================================================ */
(function () {
  'use strict';

  const cfg = window.REFAD_CONFIG;
  if (!cfg) {
    console.error('[Refad] config.js لازم يتحمّل الأول!');
    return;
  }

  const SESSION_CACHE_KEY = 'refad_session_cache_v2';
  const SESSION_CACHE_TTL = 5 * 60 * 1000;
  const SIDEBAR_COLLAPSED_KEY = 'refad_sidebar_collapsed';
  const SWIPE_THRESHOLD = 60;
  const SWIPE_EDGE = 30;
  const SESSION_CHECK_INTERVAL = 30 * 1000;

  // ═══════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════
  const state = {
    isOpen: false,
    isCollapsed: false,
    isMobile: false,
    touchStartX: 0,
    touchStartY: 0,
    isSwiping: false,
    session: null,
    sessionCheckTimer: null,
    hasOpenSession: false,
    currentWarehouse: null
  };

  // ═══════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════
  function escHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getCurrentPage() {
    let path = window.location.pathname.split('/').pop() || 'dashboard.html';
    if (!path) return 'dashboard.html';
    path = path.split('?')[0].split('#')[0];
    return path;
  }

  function isMobileView() {
    return window.innerWidth <= 1024;
  }

  // ═══════════════════════════════════════════════════════════
  // SESSION CACHE
  // ═══════════════════════════════════════════════════════════
  function getCachedSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_CACHE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data.expiresAt && Date.now() > data.expiresAt) {
        sessionStorage.removeItem(SESSION_CACHE_KEY);
        return null;
      }
      return data.session;
    } catch (e) { return null; }
  }

  function setCachedSession(session) {
    try {
      sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({
        session: session,
        expiresAt: Date.now() + SESSION_CACHE_TTL
      }));
    } catch (e) {}
  }

  function clearCachedSession() {
    try { sessionStorage.removeItem(SESSION_CACHE_KEY); } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════
  // ⭐ GET SIDEBAR DATA
  // ═══════════════════════════════════════════════════════════
  function getSidebarData(session) {
    session = session || {};

    let companyName = session.company_name || cfg.APP_NAME || 'رفاد';
    let roleName = session.role_name || 'سوبرماركت';
    let userName = session.full_name || 'مستخدم';
    let companyLogo = session.company_logo || cfg.LOGO?.URL || cfg.LOGO_URL || '';
    let warehouseName = '';

    if (state.currentWarehouse && state.currentWarehouse.name) {
      warehouseName = state.currentWarehouse.name;
    } else if (session.default_warehouse && session.default_warehouse.name) {
      warehouseName = session.default_warehouse.name;
    } else {
      try {
        const cached = localStorage.getItem('refad_active_warehouse_name');
        if (cached) warehouseName = cached;
      } catch (e) {}
    }

    if (window.RefadSettings) {
      try {
        const settingsCompanyName = window.RefadSettings.get('general.company_name');
        if (settingsCompanyName) companyName = settingsCompanyName;
      } catch (e) {}
    }

    return {
      companyName,
      roleName,
      userName,
      companyLogo,
      warehouseName,
      userInitial: String(userName).charAt(0).toUpperCase() || 'U'
    };
  }

  // ═══════════════════════════════════════════════════════════
  // ⭐ UPDATE BRAND
  // ═══════════════════════════════════════════════════════════
  function updateSidebarBrand() {
    if (!state.session) return;
    const data = getSidebarData(state.session);

    const nameEl = document.querySelector('.refad-sidebar-brand-text h2');
    if (nameEl && nameEl.textContent !== data.companyName) {
      nameEl.textContent = data.companyName;
      nameEl.title = data.companyName;
    }

    const roleEl = document.querySelector('.refad-sidebar-brand-text p');
    if (roleEl && roleEl.textContent !== data.roleName) {
      roleEl.textContent = data.roleName;
    }

    const userEl = document.querySelector('.refad-user-info h4');
    if (userEl && userEl.textContent !== data.userName) {
      userEl.textContent = data.userName;
      userEl.title = data.userName;
    }

    const avatarEl = document.querySelector('.refad-user-avatar');
    if (avatarEl) {
      avatarEl.textContent = data.userInitial;
      avatarEl.title = data.userName;
    }

    const infoEl = document.querySelector('.refad-user-info');
    if (infoEl) {
      const oldWh = infoEl.querySelector('.refad-wh-name');
      if (oldWh) oldWh.remove();

      if (data.warehouseName) {
        const whP = document.createElement('p');
        whP.className = 'refad-wh-name';
        whP.style.cssText = 'font-size:10px;color:var(--accent);font-weight:700;display:flex;align-items:center;gap:3px;margin-top:2px;line-height:1.2';
        whP.title = 'المخزن الحالي: ' + data.warehouseName;
        whP.innerHTML =
          '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">' +
            '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>' +
            '<polyline points="9 22 9 12 15 12 15 22"/>' +
          '</svg>' +
          '<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(data.warehouseName) + '</span>';
        infoEl.appendChild(whP);
      }
    }

    const logoEl = document.querySelector('.refad-sidebar-logo');
    if (logoEl && data.companyLogo) {
      const currentImg = logoEl.querySelector('img');
      const currentSrc = currentImg ? currentImg.getAttribute('src') : '';
      if (currentSrc !== data.companyLogo) {
        logoEl.innerHTML = buildLogoHTML(data.companyLogo);
        if (window.lucide) window.lucide.createIcons();
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ⭐ UPDATE SESSION BADGE
  // ═══════════════════════════════════════════════════════════
  function updateSessionBadge(hasOpenSession) {
    state.hasOpenSession = hasOpenSession;
    const sessionLink = document.querySelector('.refad-nav-item[data-page="session.html"]');
    if (!sessionLink) return;

    let badge = sessionLink.querySelector('.refad-nav-badge');
    if (hasOpenSession) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'refad-nav-badge';
        badge.style.cssText = 'background:var(--success,#10b981);animation:none;font-size:12px;padding:1px 6px;min-width:auto';
        badge.textContent = '●';
        badge.title = 'وردية مفتوحة';
        sessionLink.appendChild(badge);
      } else {
        badge.style.background = 'var(--success,#10b981)';
        badge.style.animation = 'none';
        badge.textContent = '●';
        badge.title = 'وردية مفتوحة';
      }
    } else {
      if (badge) badge.remove();
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ⭐ LOAD SESSION STATUS
  // ═══════════════════════════════════════════════════════════
  async function loadSessionStatus() {
    if (!window.Refad || !window.Refad.sb) return;
    const session = window.Refad._session || state.session;
    if (!session || !session.company_id) return;

    try {
      const sb = window.Refad.sb;

      let query = sb.from('pos_sessions')
        .select('id, opened_at, cashier_id, register_id, opening_cash, total_sales')
        .eq('company_id', session.company_id)
        .eq('status', 'open');

      if (cfg.SESSION?.STAFF_BASED && session.user_id) {
        query = query.eq('cashier_id', session.user_id);
      }

      const { data: posSession, error: sessErr } = await query
        .order('opened_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (sessErr) {
        console.warn('[Sidebar] session query error:', sessErr);
      }

      updateSessionBadge(!!posSession);

      const whId = localStorage.getItem('refad_active_warehouse')
        || session.active_warehouse_id
        || (session.default_warehouse && session.default_warehouse.id);

      if (whId) {
        const { data: wh } = await sb.from('warehouses')
          .select('id, name')
          .eq('id', whId)
          .eq('company_id', session.company_id)
          .maybeSingle();

        if (wh) {
          state.currentWarehouse = wh;
          try { localStorage.setItem('refad_active_warehouse_name', wh.name); } catch (e) {}
          updateSidebarBrand();
        }
      }
    } catch (e) {
      console.warn('[Sidebar] loadSessionStatus failed:', e);
    }
  }

  function startSessionStatusCheck() {
    if (state.sessionCheckTimer) clearInterval(state.sessionCheckTimer);
    loadSessionStatus();
    state.sessionCheckTimer = setInterval(loadSessionStatus, SESSION_CHECK_INTERVAL);
  }

  // ═══════════════════════════════════════════════════════════
  // STYLES (injected once)
  // ═══════════════════════════════════════════════════════════
  function injectStyles() {
    if (document.getElementById('refad-sidebar-styles')) return;
    const style = document.createElement('style');
    style.id = 'refad-sidebar-styles';
    style.textContent = `
      :root {
        --refad-sidebar-w: 260px;
        --refad-sidebar-w-collapsed: 72px;
        --refad-sidebar-bg: var(--bg-sidebar, var(--primary, #0B2C4D));
        --refad-sidebar-text: #fff;
        --refad-sidebar-muted: rgba(255,255,255,0.65);
        --refad-sidebar-muted-strong: rgba(255,255,255,0.4);
        --refad-sidebar-border: rgba(255,255,255,0.1);
        --refad-sidebar-hover: rgba(255,255,255,0.08);
        --refad-sidebar-active: var(--accent, #14B8A6);
        --refad-sidebar-active-shadow: var(--accent-soft, rgba(20,184,166,0.3));
      }

      .refad-sidebar {
        width: var(--refad-sidebar-w);
        background: var(--refad-sidebar-bg);
        color: var(--refad-sidebar-text);
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        display: flex;
        flex-direction: column;
        z-index: 1000;
        transition: transform 0.3s cubic-bezier(0.4,0,0.2,1), width 0.3s cubic-bezier(0.4,0,0.2,1), background 0.2s;
        font-family: inherit;
        direction: rtl;
        padding-bottom: env(safe-area-inset-bottom, 0);
        padding-top: env(safe-area-inset-top, 0);
        box-shadow: -1px 0 0 var(--refad-sidebar-border);
        will-change: transform;
      }
      [dir="rtl"] .refad-sidebar { right: 0; left: auto; }

      .refad-sidebar.collapsed { width: var(--refad-sidebar-w-collapsed); }
      .refad-sidebar.collapsed .refad-sidebar-brand-text,
      .refad-sidebar.collapsed .refad-nav-item span,
      .refad-sidebar.collapsed .refad-nav-section,
      .refad-sidebar.collapsed .refad-user-info,
      .refad-sidebar.collapsed .refad-nav-badge { display: none; }
      .refad-sidebar.collapsed .refad-nav-item { justify-content: center; padding: 12px 8px; }
      .refad-sidebar.collapsed .refad-sidebar-brand { justify-content: center; padding: 18px 8px; }
      .refad-sidebar.collapsed .refad-user-card { justify-content: center; padding: 8px; }
      .refad-sidebar.collapsed .refad-user-actions { display: none; }

      .refad-sidebar-brand {
        padding: 20px 18px;
        display: flex;
        align-items: center;
        gap: 12px;
        border-bottom: 1px solid var(--refad-sidebar-border);
        flex-shrink: 0;
        min-height: 76px;
      }
      .refad-sidebar-logo {
        width: 44px;
        height: 44px;
        border-radius: 12px;
        background: linear-gradient(135deg, var(--accent, #14B8A6), var(--accent-dark, #0d9488));
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        overflow: hidden;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      }
      .refad-sidebar-logo img { width: 100%; height: 100%; object-fit: contain; }
      .refad-sidebar-logo svg { width: 100%; height: 100%; }
      .refad-sidebar-brand-text { flex: 1; min-width: 0; }
      .refad-sidebar-brand-text h2 {
        font-size: 15px;
        font-weight: 800;
        margin: 0 0 2px;
        color: #fff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.3;
      }
      .refad-sidebar-brand-text p {
        font-size: 11px;
        color: var(--refad-sidebar-muted);
        margin: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.3;
      }

      .refad-sidebar-nav {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 12px 10px;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: thin;
        scrollbar-color: rgba(255,255,255,0.2) transparent;
      }
      .refad-sidebar-nav::-webkit-scrollbar { width: 4px; }
      .refad-sidebar-nav::-webkit-scrollbar-track { background: transparent; }
      .refad-sidebar-nav::-webkit-scrollbar-thumb {
        background: rgba(255,255,255,0.2);
        border-radius: 2px;
      }
      .refad-sidebar-nav::-webkit-scrollbar-thumb:hover {
        background: rgba(255,255,255,0.35);
      }

      .refad-nav-section {
        font-size: 10px;
        font-weight: 800;
        color: var(--refad-sidebar-muted-strong);
        text-transform: uppercase;
        letter-spacing: 0.8px;
        padding: 12px 12px 6px;
        user-select: none;
      }
      .refad-nav-section:first-child { padding-top: 4px; }

      .refad-nav-item {
        display: flex;
        align-items: center;
        gap: 11px;
        padding: 10px 14px;
        border-radius: 10px;
        color: var(--refad-sidebar-muted);
        text-decoration: none;
        font-size: 13.5px;
        font-weight: 600;
        transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease;
        margin-bottom: 2px;
        border: none;
        background: none;
        width: 100%;
        text-align: right;
        cursor: pointer;
        font-family: inherit;
        position: relative;
        -webkit-tap-highlight-color: transparent;
      }
      .refad-nav-item:hover { background: var(--refad-sidebar-hover); color: #fff; }
      .refad-nav-item:active { transform: scale(0.98); }
      .refad-nav-item.active {
        background: var(--refad-sidebar-active);
        color: #fff;
        font-weight: 700;
        box-shadow: 0 4px 12px var(--refad-sidebar-active-shadow);
      }
      .refad-nav-item.active::after {
        content: '';
        position: absolute;
        left: 8px;
        top: 50%;
        transform: translateY(-50%);
        width: 4px;
        height: 60%;
        background: rgba(255,255,255,0.6);
        border-radius: 2px;
      }
      .refad-sidebar.collapsed .refad-nav-item.active::after { display: none; }
      .refad-nav-item svg {
        width: 18px;
        height: 18px;
        flex-shrink: 0;
        stroke-width: 2;
      }
      .refad-nav-item span {
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .refad-nav-badge {
        background: var(--danger, #ef4444);
        color: #fff;
        font-size: 10px;
        font-weight: 800;
        padding: 2px 7px;
        border-radius: 10px;
        min-width: 18px;
        text-align: center;
        line-height: 1.3;
        flex-shrink: 0;
        animation: refad-pulse 2s infinite;
      }
      @keyframes refad-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.5); }
        50% { box-shadow: 0 0 0 6px rgba(239,68,68,0); }
      }

      .refad-sidebar-footer {
        padding: 12px;
        border-top: 1px solid var(--refad-sidebar-border);
        flex-shrink: 0;
        padding-bottom: calc(12px + env(safe-area-inset-bottom, 0));
      }
      .refad-user-card {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px;
        background: rgba(255,255,255,0.06);
        border-radius: 12px;
      }
      .refad-user-avatar {
        width: 38px;
        height: 38px;
        border-radius: 10px;
        background: linear-gradient(135deg, var(--accent, #14B8A6), var(--accent-dark, #0d9488));
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        font-weight: 800;
        color: #fff;
        flex-shrink: 0;
      }
      .refad-user-info {
        flex: 1;
        min-width: 0;
      }
      .refad-user-info h4 {
        font-size: 13px;
        font-weight: 700;
        color: #fff;
        margin: 0 0 2px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .refad-user-info p {
        font-size: 11px;
        color: var(--refad-sidebar-muted);
        margin: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .refad-user-actions {
        display: flex;
        gap: 4px;
      }
      .refad-user-btn {
        width: 30px;
        height: 30px;
        border-radius: 8px;
        border: none;
        background: rgba(255,255,255,0.08);
        color: var(--refad-sidebar-muted);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s, color 0.15s;
        -webkit-tap-highlight-color: transparent;
      }
      .refad-user-btn:hover {
        background: rgba(255,255,255,0.2);
        color: #fff;
      }
      .refad-user-btn.danger:hover {
        background: var(--danger, #ef4444);
        color: #fff;
      }
      .refad-user-btn svg { width: 15px; height: 15px; }

      .refad-sidebar-overlay {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.5);
        z-index: 999;
        opacity: 0;
        transition: opacity 0.3s ease;
        -webkit-backdrop-filter: blur(2px);
        backdrop-filter: blur(2px);
      }
      .refad-sidebar-overlay.show {
        display: block;
        opacity: 1;
      }

      .refad-mobile-menu-btn {
        display: none;
        width: 40px;
        height: 40px;
        border-radius: 10px;
        background: var(--card, #fff);
        border: 1px solid var(--border, #e2e8f0);
        align-items: center;
        justify-content: center;
        color: var(--text, #0f172a);
        cursor: pointer;
        flex-shrink: 0;
        -webkit-tap-highlight-color: transparent;
        transition: background 0.15s;
      }
      .refad-mobile-menu-btn:active {
        background: var(--bg-soft, #f8fafc);
      }
      .refad-mobile-menu-btn svg { width: 20px; height: 20px; }

      .refad-collapse-btn {
        display: none;
        position: absolute;
        top: 26px;
        left: -14px;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: var(--card, #fff);
        border: 1px solid var(--border, #e2e8f0);
        color: var(--text, #0f172a);
        cursor: pointer;
        z-index: 1001;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        transition: transform 0.15s;
      }
      .refad-collapse-btn:hover {
        transform: scale(1.1);
      }
      .refad-collapse-btn svg {
        width: 14px;
        height: 14px;
      }

      .refad-main-content {
        margin-right: var(--refad-sidebar-w);
        min-height: 100vh;
        transition: margin-right 0.3s cubic-bezier(0.4,0,0.2,1);
      }
      body.sidebar-collapsed .refad-main-content {
        margin-right: var(--refad-sidebar-w-collapsed);
      }

      .refad-sidebar-skeleton {
        width: var(--refad-sidebar-w);
        background: var(--primary, #0B2C4D);
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        z-index: 1000;
        padding: 20px 18px;
        direction: rtl;
      }
      .refad-sk-line {
        height: 12px;
        background: rgba(255,255,255,0.1);
        border-radius: 6px;
        margin-bottom: 10px;
        position: relative;
        overflow: hidden;
      }
      .refad-sk-line::after {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent);
        animation: refad-shimmer 1.5s infinite;
      }
      @keyframes refad-shimmer {
        0% { transform: translateX(100%); }
        100% { transform: translateX(-100%); }
      }
      .refad-sk-circle {
        width: 44px;
        height: 44px;
        border-radius: 12px;
        background: rgba(255,255,255,0.1);
        margin-bottom: 20px;
      }

      body.refad-sidebar-locked {
        overflow: hidden;
      }

      @media (max-width: 1024px) {
        .refad-sidebar {
          transform: translateX(100%);
          width: min(280px, 85vw);
          box-shadow: -10px 0 30px rgba(0,0,0,0.3);
        }
        [dir="rtl"] .refad-sidebar {
          transform: translateX(100%);
        }
        .refad-sidebar.open {
          transform: translateX(0);
        }
        .refad-sidebar-overlay.show {
          display: block;
          opacity: 1;
        }
        .refad-mobile-menu-btn { display: flex; }
        .refad-main-content {
          margin-right: 0 !important;
        }
        .refad-collapse-btn { display: none !important; }
        .refad-sidebar-brand {
          min-height: 68px;
          padding: 16px 16px;
        }
        .refad-sidebar-logo {
          width: 40px;
          height: 40px;
        }
        .refad-nav-item {
          padding: 12px 14px;
          font-size: 14px;
        }
        .refad-user-btn {
          width: 34px;
          height: 34px;
        }
      }

      @media (max-width: 480px) {
        .refad-sidebar {
          width: min(85vw, 320px);
        }
        .refad-sidebar-brand-text h2 {
          font-size: 14px;
        }
      }

      @media (max-height: 500px) and (orientation: landscape) {
        .refad-sidebar-brand {
          padding: 10px 16px;
          min-height: 56px;
        }
        .refad-sidebar-brand-text p {
          display: none;
        }
        .refad-nav-item {
          padding: 8px 12px;
          font-size: 13px;
        }
        .refad-nav-section {
          padding: 8px 12px 4px;
        }
        .refad-sidebar-footer {
          padding: 8px;
        }
        .refad-user-card {
          padding: 6px;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .refad-sidebar,
        .refad-sidebar-overlay,
        .refad-main-content,
        .refad-nav-item {
          transition: none !important;
        }
        .refad-sk-line::after,
        .refad-nav-badge {
          animation: none !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════════════════════
  // ⭐ BUILD LOGO
  // ═══════════════════════════════════════════════════════════
  function buildLogoHTML(logoUrl) {
    const config = window.REFAD_CONFIG || {};
    const fallbackSvg = (config.LOGO && config.LOGO.FALLBACK_SVG)
      ? config.LOGO.FALLBACK_SVG
      : '<i data-lucide="shopping-cart"></i>';

    if (logoUrl && String(logoUrl).trim() !== '') {
      const escapedUrl = escHtml(logoUrl);
      const escapedFallback = fallbackSvg.replace(/'/g, '&#39;').replace(/"/g, '&quot;');
      return '<img src="' + escapedUrl + '" alt="logo" ' +
        'onerror="this.style.display=\'none\';this.parentElement.innerHTML=\'' + escapedFallback + '\';if(window.lucide)lucide.createIcons();">';
    }
    return fallbackSvg;
  }

  // ═══════════════════════════════════════════════════════════
  // BUILD SKELETON
  // ═══════════════════════════════════════════════════════════
  function buildSkeletonHTML() {
    let html = '<div class="refad-sidebar-skeleton">';
    html += '<div class="refad-sk-circle"></div>';
    for (let i = 0; i < 8; i++) {
      html += '<div class="refad-sk-line"></div>';
    }
    html += '</div>';
    return html;
  }

  // ═══════════════════════════════════════════════════════════
  // BUILD SIDEBAR HTML ⭐ (يقرأ من cfg.NAV_SECTIONS)
  // ═══════════════════════════════════════════════════════════
  function buildSidebarHTML(session) {
    session = session || {};
    const currentPage = getCurrentPage();
    const navSections = cfg.NAV_SECTIONS || [];
    const badges = session.badges || {};
    const data = getSidebarData(session);

    let navHTML = '';
    for (let i = 0; i < navSections.length; i++) {
      const section = navSections[i];
      navHTML += '<div class="refad-nav-section">' + escHtml(section.title) + '</div>';

      const items = section.items || [];
      for (let j = 0; j < items.length; j++) {
        const item = items[j];
        const isActive = currentPage === item.href;
        const badge = badges[item.href];
        navHTML += '<a href="' + escHtml(item.href) + '" class="refad-nav-item' + (isActive ? ' active' : '') + '" data-page="' + escHtml(item.href) + '">' +
          '<i data-lucide="' + escHtml(item.icon) + '"></i>' +
          '<span>' + escHtml(item.label) + '</span>' +
          (badge ? '<span class="refad-nav-badge">' + escHtml(badge) + '</span>' : '') +
        '</a>';
      }
    }

    let html = '';
    html += '<div class="refad-sidebar' + (state.isCollapsed ? ' collapsed' : '') + '" id="refad-sidebar-main" role="navigation" aria-label="القائمة الرئيسية">';

    html += '<button class="refad-collapse-btn" id="refad-collapse-btn" title="طي/فتح القائمة" aria-label="طي القائمة">';
    html += '<i data-lucide="' + (state.isCollapsed ? 'chevron-left' : 'chevron-right') + '"></i>';
    html += '</button>';

    html += '<div class="refad-sidebar-brand">';
    html += '<div class="refad-sidebar-logo">' + buildLogoHTML(data.companyLogo) + '</div>';
    html += '<div class="refad-sidebar-brand-text">';
    html += '<h2 title="' + escHtml(data.companyName) + '">' + escHtml(data.companyName) + '</h2>';
    html += '<p title="' + escHtml(data.roleName) + '">' + escHtml(data.roleName) + '</p>';
    html += '</div>';
    html += '</div>';

    html += '<nav class="refad-sidebar-nav" aria-label="روابط">' + navHTML + '</nav>';

    html += '<div class="refad-sidebar-footer">';
    html += '<div class="refad-user-card">';
    html += '<div class="refad-user-avatar" title="' + escHtml(data.userName) + '">' + escHtml(data.userInitial) + '</div>';
    html += '<div class="refad-user-info">';
    html += '<h4 title="' + escHtml(data.userName) + '">' + escHtml(data.userName) + '</h4>';
    html += '<p title="' + escHtml(data.roleName) + '">' + escHtml(data.roleName) + '</p>';
    if (data.warehouseName) {
      html += '<p class="refad-wh-name" style="font-size:10px;color:var(--accent);font-weight:700;display:flex;align-items:center;gap:3px;margin-top:2px;line-height:1.2" title="المخزن الحالي: ' + escHtml(data.warehouseName) + '">' +
        '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">' +
          '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>' +
          '<polyline points="9 22 9 12 15 12 15 22"/>' +
        '</svg>' +
        '<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(data.warehouseName) + '</span>' +
      '</p>';
    }
    html += '</div>';
    html += '<div class="refad-user-actions">';
    html += '<button class="refad-user-btn" id="refad-theme-btn" title="وضع العرض" aria-label="وضع العرض"><i data-lucide="palette"></i></button>';
    html += '<button class="refad-user-btn danger" id="refad-logout-btn" title="تسجيل الخروج" aria-label="تسجيل الخروج"><i data-lucide="log-out"></i></button>';
    html += '</div>';
    html += '</div>';
    html += '</div>';

    html += '</div>';
    html += '<div class="refad-sidebar-overlay" id="refad-sidebar-overlay" aria-hidden="true"></div>';

    return html;
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════
  function renderSidebar(session) {
    injectStyles();

    const container = document.getElementById('refad-sidebar');
    if (!container) {
      console.warn('[Refad] #refad-sidebar element not found');
      return;
    }

    if (document.getElementById('refad-sidebar-main')) {
      state.session = session;
      updateSidebarBrand();
      loadSessionStatus();
      return;
    }

    state.session = session;

    try {
      state.isCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
    } catch (e) {}

    container.innerHTML = buildSidebarHTML(session);

    if (state.isCollapsed && !isMobileView()) {
      document.body.classList.add('sidebar-collapsed');
    }

    const mains = document.querySelectorAll('main, .main');
    for (let i = 0; i < mains.length; i++) {
      if (!mains[i].classList.contains('refad-main-content')) {
        mains[i].classList.add('refad-main-content');
      }
    }

    document.querySelectorAll('.refad-mobile-menu-btn').forEach(function (oldBtn) {
      oldBtn.remove();
    });

    let targetTopbar = null;
    const priorities = [
      '.topbar .topbar-left',
      '.topbar-left',
      '.topbar',
      '.topbar-actions',
      'main .content',
      'main'
    ];
    for (let k = 0; k < priorities.length; k++) {
      const found = document.querySelector(priorities[k]);
      if (found) {
        targetTopbar = found;
        break;
      }
    }
    if (targetTopbar && !targetTopbar.querySelector('.refad-mobile-menu-btn')) {
      const btn = document.createElement('button');
      btn.className = 'refad-mobile-menu-btn';
      btn.id = 'refad-mobile-menu-btn';
      btn.type = 'button';
      btn.setAttribute('aria-label', 'فتح القائمة');
      btn.innerHTML = '<i data-lucide="menu"></i>';
      targetTopbar.insertBefore(btn, targetTopbar.firstChild);
    }

    bindEvents();
    initSwipeGestures();
    updateMobileState();

    if (window.lucide && window.lucide.createIcons) {
      window.lucide.createIcons();
    }

    startSessionStatusCheck();
  }

  // ═══════════════════════════════════════════════════════════
  // OPEN / CLOSE
  // ═══════════════════════════════════════════════════════════
  function openSidebar() {
    const sidebar = document.getElementById('refad-sidebar-main');
    const overlay = document.getElementById('refad-sidebar-overlay');
    if (!sidebar) return;

    sidebar.classList.add('open');
    if (overlay) overlay.classList.add('show');
    document.body.classList.add('refad-sidebar-locked');
    state.isOpen = true;

    document.body.dataset.scrollY = String(window.scrollY);

    try { history.pushState({ refadSidebarOpen: true }, ''); } catch (e) {}

    setTimeout(() => {
      const firstItem = sidebar.querySelector('.refad-nav-item');
      if (firstItem) firstItem.focus();
    }, 300);
  }

  function closeSidebar(popHistory) {
    const sidebar = document.getElementById('refad-sidebar-main');
    const overlay = document.getElementById('refad-sidebar-overlay');
    if (!sidebar) return;

    sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
    document.body.classList.remove('refad-sidebar-locked');

    const scrollY = Number(document.body.dataset.scrollY || 0);
    window.scrollTo(0, scrollY);
    state.isOpen = false;

    if (popHistory && history.state && history.state.refadSidebarOpen) {
      try { history.back(); } catch (e) {}
    }
  }

  function toggleCollapsed() {
    state.isCollapsed = !state.isCollapsed;
    const sidebar = document.getElementById('refad-sidebar-main');
    if (sidebar) sidebar.classList.toggle('collapsed', state.isCollapsed);
    document.body.classList.toggle('sidebar-collapsed', state.isCollapsed);
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, state.isCollapsed ? '1' : '0');
    } catch (e) {}
    const btn = document.getElementById('refad-collapse-btn');
    if (btn) {
      btn.innerHTML = '<i data-lucide="' + (state.isCollapsed ? 'chevron-left' : 'chevron-right') + '"></i>';
      if (window.lucide) window.lucide.createIcons();
    }
  }

  // ═══════════════════════════════════════════════════════════
  // SWIPE
  // ═══════════════════════════════════════════════════════════
  function initSwipeGestures() {
    if (!isMobileView()) return;
    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
  }

  function handleTouchStart(e) {
    if (!isMobileView()) return;
    const touch = e.touches[0];
    if (!touch) return;
    state.touchStartX = touch.clientX;
    state.touchStartY = touch.clientY;
    state.isSwiping = false;
  }

  function handleTouchMove(e) {
    if (!isMobileView()) return;
    const touch = e.touches[0];
    if (!touch) return;
    const deltaX = touch.clientX - state.touchStartX;
    const deltaY = touch.clientY - state.touchStartY;
    if (Math.abs(deltaY) > Math.abs(deltaX)) return;
    if (!state.isOpen && deltaX > SWIPE_EDGE && state.touchStartX > window.innerWidth - SWIPE_EDGE * 2) {
      state.isSwiping = true;
    }
    if (state.isOpen && deltaX < -SWIPE_EDGE) {
      state.isSwiping = true;
    }
  }

  function handleTouchEnd(e) {
    if (!isMobileView() || !state.isSwiping) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const deltaX = touch.clientX - state.touchStartX;
    if (!state.isOpen && deltaX > SWIPE_THRESHOLD) {
      openSidebar();
    } else if (state.isOpen && deltaX < -SWIPE_THRESHOLD) {
      closeSidebar();
    }
    state.isSwiping = false;
  }

  // ═══════════════════════════════════════════════════════════
  // THEME BUTTON
  // ═══════════════════════════════════════════════════════════
  function onThemeBtnClick() {
    if (window.Refad && window.Refad.Theme && typeof window.Refad.Theme.openSwitcher === 'function') {
      window.Refad.Theme.openSwitcher();
      return;
    }
    if (window.Refad && window.Refad.Theme && typeof window.Refad.Theme.toggle === 'function') {
      window.Refad.Theme.toggle();
      return;
    }
    const html = document.documentElement;
    const current = html.getAttribute('data-theme') || 'light';
    html.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
    try { localStorage.setItem(cfg.THEME_KEY || 'refad_theme', current === 'dark' ? 'light' : 'dark'); } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════
  // BIND EVENTS
  // ═══════════════════════════════════════════════════════════
  function bindEvents() {
    const logoutBtn = document.getElementById('refad-logout-btn');
    if (logoutBtn) {
      logoutBtn.onclick = function () {
        if (!confirm('تسجيل الخروج؟')) return;
        clearCachedSession();
        if (state.sessionCheckTimer) clearInterval(state.sessionCheckTimer);
        if (window.Refad && typeof window.Refad.logout === 'function') {
          window.Refad.logout();
        } else {
          try { localStorage.clear(); } catch (e) {}
          window.location.href = 'index.html';
        }
      };
    }

    const themeBtn = document.getElementById('refad-theme-btn');
    if (themeBtn) {
      themeBtn.onclick = onThemeBtnClick;
    }

    const mobileBtn = document.getElementById('refad-mobile-menu-btn');
    if (mobileBtn) {
      mobileBtn.onclick = function () {
        if (state.isOpen) closeSidebar();
        else openSidebar();
      };
    }

    const overlay = document.getElementById('refad-sidebar-overlay');
    if (overlay) {
      overlay.onclick = function () {
        closeSidebar();
      };
    }

    const collapseBtn = document.getElementById('refad-collapse-btn');
    if (collapseBtn) {
      collapseBtn.onclick = function () {
        toggleCollapsed();
      };
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.isOpen) {
        closeSidebar();
      }
    });

    window.addEventListener('popstate', function (e) {
      if (e.state && e.state.refadSidebarOpen) return;
      if (state.isOpen) {
        closeSidebar();
      }
    });

    document.querySelectorAll('.refad-nav-item').forEach(function (item) {
      item.addEventListener('click', function () {
        if (isMobileView()) {
          setTimeout(function () { closeSidebar(); }, 150);
        }
      });
    });

    let resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(updateMobileState, 150);
    });

    window.addEventListener('refad:settings-changed', updateSidebarBrand);
    window.addEventListener('refad:theme-changed', updateSidebarBrand);
    window.addEventListener('refad:warehouse-changed', function (e) {
      if (e.detail && e.detail.warehouse_id) {
        loadSessionStatus();
      }
    });
    window.addEventListener('refad:sale-created', loadSessionStatus);
    window.addEventListener('refad:session-opened', loadSessionStatus);
    window.addEventListener('refad:session-closed', loadSessionStatus);
  }

  // ═══════════════════════════════════════════════════════════
  // MOBILE STATE
  // ═══════════════════════════════════════════════════════════
  function updateMobileState() {
    const wasMobile = state.isMobile;
    state.isMobile = isMobileView();

    if (wasMobile && !state.isMobile) {
      closeSidebar();
      const sidebar = document.getElementById('refad-sidebar-main');
      if (sidebar && state.isCollapsed) {
        sidebar.classList.add('collapsed');
        document.body.classList.add('sidebar-collapsed');
      }
    } else if (!wasMobile && state.isMobile) {
      const sidebar = document.getElementById('refad-sidebar-main');
      if (sidebar) sidebar.classList.remove('collapsed');
      document.body.classList.remove('sidebar-collapsed');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════
  function init() {
    injectStyles();

    const container = document.getElementById('refad-sidebar');
    if (container && !document.getElementById('refad-sidebar-main')) {
      container.innerHTML = buildSkeletonHTML();
    }

    const cached = getCachedSession();
    if (cached) {
      renderSidebar(cached);
      refreshSessionInBackground();
      return;
    }

    let attempts = 0;
    const maxAttempts = 60;

    function tryRender() {
      attempts++;
      if (window.Refad && typeof window.Refad.getSession === 'function') {
        window.Refad.getSession().then(function (session) {
          if (!session) {
            console.warn('[Refad] No session — sidebar skipped');
            const sk = document.querySelector('.refad-sidebar-skeleton');
            if (sk) sk.remove();
            return;
          }
          setCachedSession(session);
          renderSidebar(session);
        }).catch(function (e) {
          console.error('[Refad] getSession failed:', e);
          const sk = document.querySelector('.refad-sidebar-skeleton');
          if (sk) sk.remove();
        });
      } else if (attempts < maxAttempts) {
        setTimeout(tryRender, 50);
      } else {
        console.error('[Refad] app.js didn\'t load within 3 seconds');
        const sk = document.querySelector('.refad-sidebar-skeleton');
        if (sk) sk.remove();
      }
    }

    tryRender();
  }

  async function refreshSessionInBackground() {
    if (!window.Refad || typeof window.Refad.getSession !== 'function') return;
    try {
      const fresh = await window.Refad.getSession();
      if (fresh) {
        setCachedSession(fresh);
        state.session = fresh;
        updateSidebarBrand();
        loadSessionStatus();
      }
    } catch (e) {
      console.warn('[Refad] Background session refresh failed:', e);
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
  window.Refad = window.Refad || {};
  window.Refad.Sidebar = {
    render: renderSidebar,
    open: openSidebar,
    close: closeSidebar,
    toggle: function () { state.isOpen ? closeSidebar() : openSidebar(); },
    collapse: toggleCollapsed,
    clearCache: clearCachedSession,
    isOpen: function () { return state.isOpen; },
    updateBrand: updateSidebarBrand,
    reloadStatus: loadSessionStatus,
    hasOpenSession: function () { return state.hasOpenSession; }
  };

  console.log('[Refad] sidebar.js v3.6 ready — reads from cfg.NAV_SECTIONS');
  console.log('[Refad] Nav sections:', (cfg.NAV_SECTIONS || []).length);
  console.log('[Refad] Total nav items:', (cfg.NAV_SECTIONS || []).reduce((s, sec) => s + (sec.items || []).length, 0));

})();