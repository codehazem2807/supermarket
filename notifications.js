/* ============================================================
   sidebar.js — Refad ERP v5.0 Professional
   ⭐ v5.0: Notifications bell + Chat badge + Store link + Warehouse switcher
   ⭐ v4.0: كل الصفحات + ميزات احترافية
   ============================================================ */
(function () {
  'use strict';

  const cfg = window.REFAD_CONFIG;
  if (!cfg) {
    console.error('[Refad] config.js لازم يتحمل الأول!');
    return;
  }

  const SESSION_CACHE_KEY = 'refad_session_cache_v3';
  const SESSION_CACHE_TTL = 5 * 60 * 1000;
  const SIDEBAR_COLLAPSED_KEY = 'refad_sidebar_collapsed';
  const SWIPE_THRESHOLD = 60;
  const SWIPE_EDGE = 30;
  const SESSION_CHECK_INTERVAL = 30 * 1000;
  const ONLINE_CHECK_INTERVAL = 15 * 1000;
  const UNREAD_CHECK_INTERVAL = 30 * 1000;

  const NEW_PAGES = [
    'notifications.html',
    'chat.html',
    'store-admin.html',
    'store-orders.html',
    'store-settings.html',
    'transfers.html',
    'counts.html',
    'branch_compare.html',
    'expenses.html',
    'forecast.html',
    'seasons.html',
    'offline_queue.html',
    'presets.html'
  ];

  const state = {
    isOpen: false,
    isCollapsed: false,
    isMobile: false,
    touchStartX: 0,
    touchStartY: 0,
    isSwiping: false,
    session: null,
    sessionCheckTimer: null,
    onlineCheckTimer: null,
    unreadCheckTimer: null,
    hasOpenSession: false,
    currentWarehouse: null,
    warehouses: [],
    isOnline: true,
    installPromptEvent: null,
    searchOpen: false,
    searchResults: [],
    searchIndex: 0,
    notifUnread: 0,
    chatUnread: 0,
    storeEnabled: false,
    whDropdownOpen: false
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

  function isNewPage(href) {
    return NEW_PAGES.indexOf(href) !== -1;
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
  // SIDEBAR DATA
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

    // Update warehouse name in user card
    const whEl = document.querySelector('.refad-wh-name span');
    if (whEl && data.warehouseName) {
      whEl.textContent = data.warehouseName;
      whEl.title = data.warehouseName;
      const parent = whEl.closest('.refad-wh-name');
      if (parent) parent.title = 'المخزن الحالي: ' + data.warehouseName;
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
  // BADGES
  // ═══════════════════════════════════════════════════════════
  function updateNavBadge(page, count, color) {
    const link = document.querySelector('.refad-nav-item[data-page="' + page + '"]');
    if (!link) return;
    let badge = link.querySelector('.refad-nav-badge');
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'refad-nav-badge';
        link.appendChild(badge);
      }
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.style.background = color || 'var(--danger, #ef4444)';
    } else if (badge) {
      badge.remove();
    }
  }

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

  async function loadUnreadCounts() {
    try {
      if (window.Refad?.notifications) {
        const n = await window.Refad.notifications.unreadCount();
        state.notifUnread = n || 0;
        updateNavBadge('notifications.html', state.notifUnread, 'var(--gold, #F59E0B)');
        updateHeaderBellBadge();
      }
    } catch (e) { /* ignore */ }

    try {
      if (window.Refad?.chat) {
        const c = await window.Refad.chat.unreadCount();
        state.chatUnread = c || 0;
        updateNavBadge('chat.html', state.chatUnread, 'var(--accent, #14B8A6)');
      }
    } catch (e) { /* ignore */ }
  }

  function updateHeaderBellBadge() {
    const b = document.getElementById('refad-notif-badge');
    if (!b) return;
    if (state.notifUnread > 0) {
      b.classList.remove('hidden');
      b.textContent = state.notifUnread > 99 ? '99+' : String(state.notifUnread);
    } else {
      b.classList.add('hidden');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // LOAD SESSION STATUS
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

      // Load warehouses
      if (state.warehouses.length === 0) {
        try {
          state.warehouses = await window.Refad.getWarehouses();
        } catch (e) { state.warehouses = []; }
      }

      const whId = localStorage.getItem('refad_active_warehouse')
        || session.active_warehouse_id
        || (session.default_warehouse && session.default_warehouse.id);

      if (whId && state.warehouses.length > 0) {
        const wh = state.warehouses.find(w => w.id === whId);
        if (wh) {
          state.currentWarehouse = wh;
          try { localStorage.setItem('refad_active_warehouse_name', wh.name); } catch (e) {}
          updateSidebarBrand();
          updateWarehouseSwitcherLabel();
        }
      }

      // Load store enabled
      try {
        const storeSettings = await window.Refad.store?.getSettings?.();
        state.storeEnabled = !!(storeSettings && storeSettings.enabled);
        // Hide store nav items if disabled
        if (!state.storeEnabled) {
          ['store-admin.html', 'store-orders.html', 'store-settings.html'].forEach(p => {
            const el = document.querySelector('.refad-nav-item[data-page="' + p + '"]');
            if (el) el.style.display = 'none';
          });
        }
      } catch (e) { /* ignore */ }

      await loadUnreadCounts();
    } catch (e) {
      console.warn('[Sidebar] loadSessionStatus failed:', e);
    }
  }

  function startSessionStatusCheck() {
    if (state.sessionCheckTimer) clearInterval(state.sessionCheckTimer);
    loadSessionStatus();
    state.sessionCheckTimer = setInterval(loadSessionStatus, SESSION_CHECK_INTERVAL);

    if (state.unreadCheckTimer) clearInterval(state.unreadCheckTimer);
    state.unreadCheckTimer = setInterval(loadUnreadCounts, UNREAD_CHECK_INTERVAL);
  }

  // ═══════════════════════════════════════════════════════════
  // WAREHOUSE SWITCHER
  // ═══════════════════════════════════════════════════════════
  function updateWarehouseSwitcherLabel() {
    const label = document.getElementById('refad-wh-current-label');
    if (label && state.currentWarehouse) {
      label.textContent = state.currentWarehouse.name;
    }
  }

  function toggleWarehouseDropdown() {
    const dd = document.getElementById('refad-wh-dropdown');
    if (!dd) return;
    if (state.whDropdownOpen) {
      dd.classList.remove('show');
      state.whDropdownOpen = false;
    } else {
      renderWarehouseDropdown();
      dd.classList.add('show');
      state.whDropdownOpen = true;
    }
  }

  function renderWarehouseDropdown() {
    const dd = document.getElementById('refad-wh-list');
    if (!dd) return;
    if (state.warehouses.length === 0) {
      dd.innerHTML = '<div class="refad-wh-empty">لا توجد مخازن</div>';
      return;
    }
    dd.innerHTML = state.warehouses.map(w => {
      const active = state.currentWarehouse && w.id === state.currentWarehouse.id;
      return `
        <button class="refad-wh-option ${active ? 'active' : ''}" data-wh-id="${escHtml(w.id)}" data-wh-name="${escHtml(w.name)}">
          <i data-lucide="warehouse"></i>
          <span>${escHtml(w.name)}</span>
          ${w.is_default ? '<span class="refad-wh-default">⭐</span>' : ''}
          ${active ? '<i data-lucide="check" class="refad-wh-check"></i>' : ''}
        </button>
      `;
    }).join('');
    if (window.lucide) window.lucide.createIcons();
    dd.querySelectorAll('.refad-wh-option').forEach(btn => {
      btn.onclick = () => {
        selectWarehouse(btn.dataset.whId, btn.dataset.whName);
      };
    });
  }

  function selectWarehouse(whId, whName) {
    if (!whId) return;
    state.currentWarehouse = { id: whId, name: whName };
    window.Refad.setActiveWarehouse(whId, whName);
    updateSidebarBrand();
    updateWarehouseSwitcherLabel();
    const dd = document.getElementById('refad-wh-dropdown');
    if (dd) dd.classList.remove('show');
    state.whDropdownOpen = false;
    if (window.Refad.toast) window.Refad.toast.success('تم التبديل إلى: ' + whName);
  }

  // ═══════════════════════════════════════════════════════════
  // ONLINE STATUS
  // ═══════════════════════════════════════════════════════════
  function updateOnlineStatus() {
    const isOnline = navigator.onLine;
    if (isOnline === state.isOnline) return;
    state.isOnline = isOnline;

    const indicator = document.getElementById('refad-offline-indicator');
    if (indicator) {
      indicator.style.display = isOnline ? 'none' : 'flex';
    }

    const sidebar = document.getElementById('refad-sidebar-main');
    if (sidebar) {
      sidebar.classList.toggle('refad-offline', !isOnline);
    }
  }

  function startOnlineCheck() {
    if (state.onlineCheckTimer) clearInterval(state.onlineCheckTimer);
    updateOnlineStatus();
    state.onlineCheckTimer = setInterval(updateOnlineStatus, ONLINE_CHECK_INTERVAL);

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
  }

  // ═══════════════════════════════════════════════════════════
  // PWA INSTALL
  // ═══════════════════════════════════════════════════════════
  function setupPWAInstall() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      state.installPromptEvent = e;
      const btn = document.getElementById('refad-pwa-install-btn');
      if (btn) btn.style.display = 'flex';
    });

    window.addEventListener('appinstalled', () => {
      state.installPromptEvent = null;
      const btn = document.getElementById('refad-pwa-install-btn');
      if (btn) btn.style.display = 'none';
    });
  }

  async function installPWA() {
    if (!state.installPromptEvent) return;
    try {
      state.installPromptEvent.prompt();
      const { outcome } = await state.installPromptEvent.userChoice;
      state.installPromptEvent = null;
      const btn = document.getElementById('refad-pwa-install-btn');
      if (btn) btn.style.display = 'none';
    } catch (e) {
      console.warn('[Sidebar] PWA install failed:', e);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // QUICK SEARCH
  // ═══════════════════════════════════════════════════════════
  function openQuickSearch() {
    const modal = document.getElementById('refad-quick-search');
    if (!modal) return;

    modal.classList.add('show');
    state.searchOpen = true;

    const input = document.getElementById('refad-search-input');
    if (input) {
      input.value = '';
      input.focus();
      renderSearchResults('');
    }
  }

  function closeQuickSearch() {
    const modal = document.getElementById('refad-quick-search');
    if (!modal) return;
    modal.classList.remove('show');
    state.searchOpen = false;
  }

  function getAllNavItems() {
    const items = [];
    (cfg.NAV_SECTIONS || []).forEach(section => {
      (section.items || []).forEach(item => {
        items.push({
          href: item.href,
          label: item.label,
          icon: item.icon,
          section: section.title,
          permission: item.permission
        });
      });
    });
    return items;
  }

  function hasPermission(perm) {
    if (!perm) return true;
    if (window.Refad && typeof window.Refad.hasPermission === 'function') {
      return window.Refad.hasPermission(perm);
    }
    return true;
  }

  function renderSearchResults(query) {
    const container = document.getElementById('refad-search-results');
    if (!container) return;

    const allItems = getAllNavItems().filter(item => hasPermission(item.permission));

    let filtered = allItems;
    if (query && query.trim()) {
      const q = query.toLowerCase().trim();
      filtered = allItems.filter(item =>
        item.label.toLowerCase().includes(q) ||
        item.href.toLowerCase().includes(q) ||
        item.section.toLowerCase().includes(q)
      );
    }

    state.searchResults = filtered;
    state.searchIndex = 0;

    if (filtered.length === 0) {
      container.innerHTML = '<div class="refad-search-empty">لا توجد نتائج</div>';
      return;
    }

    container.innerHTML = filtered.map((item, idx) => `
      <a href="${escHtml(item.href)}" class="refad-search-item ${idx === 0 ? 'active' : ''}" data-idx="${idx}" data-href="${escHtml(item.href)}">
        <i data-lucide="${escHtml(item.icon)}"></i>
        <div class="refad-search-item-text">
          <div class="refad-search-item-label">${escHtml(item.label)}</div>
          <div class="refad-search-item-section">${escHtml(item.section)}</div>
        </div>
        <i data-lucide="arrow-left" class="refad-search-item-arrow"></i>
      </a>
    `).join('');

    if (window.lucide) window.lucide.createIcons();

    container.querySelectorAll('.refad-search-item').forEach(item => {
      item.onclick = (e) => {
        e.preventDefault();
        window.location.href = item.dataset.href;
      };
    });
  }

  function handleSearchKeydown(e) {
    if (!state.searchOpen) return;

    const items = document.querySelectorAll('.refad-search-item');
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      state.searchIndex = Math.min(state.searchIndex + 1, items.length - 1);
      updateSearchActive(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      state.searchIndex = Math.max(state.searchIndex - 1, 0);
      updateSearchActive(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const active = items[state.searchIndex];
      if (active) {
        window.location.href = active.dataset.href;
      }
    } else if (e.key === 'Escape') {
      closeQuickSearch();
    }
  }

  function updateSearchActive(items) {
    items.forEach((item, idx) => {
      item.classList.toggle('active', idx === state.searchIndex);
      if (idx === state.searchIndex) {
        item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  // STYLES
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
      .refad-sidebar.collapsed .refad-nav-badge,
      .refad-sidebar.collapsed .refad-nav-new-badge,
      .refad-sidebar.collapsed .refad-user-actions,
      .refad-sidebar.collapsed .refad-search-btn,
      .refad-sidebar.collapsed .refad-wh-switcher { display: none; }
      .refad-sidebar.collapsed .refad-nav-item { justify-content: center; padding: 12px 8px; }
      .refad-sidebar.collapsed .refad-sidebar-brand { justify-content: center; padding: 18px 8px; }
      .refad-sidebar.collapsed .refad-user-card { justify-content: center; padding: 8px; }

      .refad-sidebar-brand {
        padding: 20px 18px;
        display: flex;
        align-items: center;
        gap: 12px;
        border-bottom: 1px solid var(--refad-sidebar-border);
        flex-shrink: 0;
        min-height: 76px;
        position: relative;
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

      .refad-search-btn {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        border: none;
        background: rgba(255,255,255,0.08);
        color: var(--refad-sidebar-muted);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;
        flex-shrink: 0;
      }
      .refad-search-btn:hover {
        background: rgba(255,255,255,0.2);
        color: #fff;
      }
      .refad-search-btn svg { width: 16px; height: 16px; }

      .refad-wh-switcher {
        padding: 10px 14px;
        border-bottom: 1px solid var(--refad-sidebar-border);
        flex-shrink: 0;
        position: relative;
      }
      .refad-wh-switcher-btn {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 10px;
        color: #fff;
        cursor: pointer;
        font-size: 12px;
        font-weight: 700;
        font-family: inherit;
        transition: background 0.15s;
      }
      .refad-wh-switcher-btn:hover { background: rgba(255,255,255,0.15); }
      .refad-wh-switcher-btn svg { width: 14px; height: 14px; flex-shrink: 0; }
      .refad-wh-switcher-btn .refad-wh-label {
        flex: 1;
        text-align: right;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .refad-wh-switcher-btn .refad-wh-chevron {
        width: 12px !important;
        height: 12px !important;
        opacity: 0.6;
      }
      .refad-wh-dropdown {
        position: absolute;
        top: 100%;
        left: 14px;
        right: 14px;
        margin-top: 6px;
        background: var(--card, #fff);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: 10px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        max-height: 300px;
        overflow-y: auto;
        z-index: 100;
        display: none;
        direction: rtl;
      }
      .refad-wh-dropdown.show { display: block; }
      .refad-wh-option {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border: none;
        background: none;
        color: var(--text, #0f172a);
        cursor: pointer;
        font-size: 12.5px;
        font-weight: 600;
        font-family: inherit;
        text-align: right;
        transition: background 0.15s;
      }
      .refad-wh-option:hover { background: var(--bg-soft, #f8fafc); }
      .refad-wh-option.active { background: var(--accent-soft, rgba(20,184,166,0.1)); color: var(--accent, #14B8A6); }
      .refad-wh-option svg { width: 14px; height: 14px; flex-shrink: 0; }
      .refad-wh-option span { flex: 1; }
      .refad-wh-default { font-size: 11px; }
      .refad-wh-check { color: var(--accent, #14B8A6); }
      .refad-wh-empty {
        padding: 20px;
        text-align: center;
        color: var(--text-muted, #64748b);
        font-size: 12px;
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

      .refad-nav-new-badge {
        font-size: 9px;
        font-weight: 800;
        padding: 1px 6px;
        border-radius: 8px;
        background: var(--gold, #F59E0B);
        color: #fff;
        margin-right: 6px;
        flex-shrink: 0;
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

      .refad-offline-indicator {
        display: none;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 12px;
        background: rgba(239,68,68,0.2);
        color: #fca5a5;
        font-size: 11px;
        font-weight: 700;
        border-bottom: 1px solid rgba(239,68,68,0.3);
        flex-shrink: 0;
      }
      .refad-sidebar.refad-offline .refad-offline-indicator {
        display: flex;
      }
      .refad-offline-indicator svg {
        width: 14px;
        height: 14px;
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
        flex-wrap: wrap;
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
        position: relative;
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
      .refad-collapse-btn:hover { transform: scale(1.1); }
      .refad-collapse-btn svg { width: 14px; height: 14px; }

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

      .refad-quick-search-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.7);
        z-index: 99999;
        display: none;
        align-items: flex-start;
        justify-content: center;
        padding-top: 15vh;
        -webkit-backdrop-filter: blur(8px);
        backdrop-filter: blur(8px);
        direction: rtl;
      }
      .refad-quick-search-overlay.show { display: flex; }
      .refad-quick-search-box {
        width: 100%;
        max-width: 560px;
        background: var(--card, #fff);
        border-radius: 16px;
        box-shadow: 0 32px 80px rgba(0,0,0,0.4);
        overflow: hidden;
        animation: refad-search-in 0.2s cubic-bezier(0.34,1.56,0.64,1);
      }
      @keyframes refad-search-in {
        from { opacity: 0; transform: translateY(-20px) scale(0.95); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .refad-search-input-wrap {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 16px 20px;
        border-bottom: 1px solid var(--border, #e2e8f0);
      }
      .refad-search-input-wrap svg {
        width: 20px;
        height: 20px;
        color: var(--text-muted, #64748b);
        flex-shrink: 0;
      }
      .refad-search-input {
        flex: 1;
        border: none;
        background: none;
        font-size: 16px;
        font-family: inherit;
        color: var(--text, #0f172a);
        outline: none;
      }
      .refad-search-input::placeholder {
        color: var(--text-muted, #64748b);
      }
      .refad-search-kbd {
        font-size: 11px;
        font-family: monospace;
        padding: 2px 8px;
        border-radius: 6px;
        background: var(--bg-soft, #f8fafc);
        border: 1px solid var(--border, #e2e8f0);
        color: var(--text-muted, #64748b);
      }
      .refad-search-results {
        max-height: 400px;
        overflow-y: auto;
        padding: 8px;
      }
      .refad-search-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 14px;
        border-radius: 10px;
        text-decoration: none;
        color: var(--text, #0f172a);
        cursor: pointer;
        transition: background 0.1s;
      }
      .refad-search-item:hover,
      .refad-search-item.active {
        background: var(--accent-soft, rgba(20,184,166,0.1));
      }
      .refad-search-item svg {
        width: 18px;
        height: 18px;
        color: var(--accent, #14B8A6);
        flex-shrink: 0;
      }
      .refad-search-item-text {
        flex: 1;
        min-width: 0;
      }
      .refad-search-item-label {
        font-size: 14px;
        font-weight: 700;
        color: var(--text, #0f172a);
      }
      .refad-search-item-section {
        font-size: 11px;
        color: var(--text-muted, #64748b);
        margin-top: 2px;
      }
      .refad-search-item-arrow {
        width: 16px !important;
        height: 16px !important;
        color: var(--text-muted, #64748b) !important;
        opacity: 0.4;
      }
      .refad-search-empty {
        padding: 40px 20px;
        text-align: center;
        color: var(--text-muted, #64748b);
        font-size: 14px;
      }

      /* Bell styles (integrated) */
      .refad-notif-bell {
        position: relative;
        width: 38px;
        height: 38px;
        border-radius: 10px;
        border: none;
        background: rgba(255,255,255,0.08);
        color: var(--refad-sidebar-muted);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.15s;
        flex-shrink: 0;
        -webkit-tap-highlight-color: transparent;
      }
      .refad-notif-bell:hover {
        background: rgba(255,255,255,0.2);
        color: #fff;
      }
      .refad-notif-bell svg { width: 18px; height: 18px; }
      .refad-notif-bell .refad-notif-badge {
        position: absolute;
        top: -4px;
        right: -4px;
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        border-radius: 9px;
        background: var(--danger, #ef4444);
        color: #fff;
        font-size: 10px;
        font-weight: 800;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 0 0 2px var(--refad-sidebar-bg, #0B2C4D);
        line-height: 1;
      }
      .refad-notif-bell .refad-notif-badge.hidden { display: none; }

      @media (max-width: 1024px) {
        .refad-sidebar {
          transform: translateX(100%);
          width: min(280px, 85vw);
          box-shadow: -10px 0 30px rgba(0,0,0,0.3);
        }
        [dir="rtl"] .refad-sidebar { transform: translateX(100%); }
        .refad-sidebar.open { transform: translateX(0); }
        .refad-sidebar-overlay.show { display: block; opacity: 1; }
        .refad-mobile-menu-btn { display: flex; }
        .refad-main-content { margin-right: 0 !important; }
        .refad-collapse-btn { display: none !important; }
        .refad-sidebar-brand { min-height: 68px; padding: 16px 16px; }
        .refad-sidebar-logo { width: 40px; height: 40px; }
        .refad-nav-item { padding: 12px 14px; font-size: 14px; }
        .refad-user-btn { width: 34px; height: 34px; }
      }

      @media (max-width: 480px) {
        .refad-sidebar { width: min(85vw, 320px); }
        .refad-sidebar-brand-text h2 { font-size: 14px; }
        .refad-quick-search-box { max-width: calc(100% - 20px); }
      }

      @media (prefers-reduced-motion: reduce) {
        .refad-sidebar, .refad-sidebar-overlay, .refad-main-content,
        .refad-nav-item, .refad-quick-search-box {
          transition: none !important;
        }
        .refad-sk-line::after, .refad-nav-badge {
          animation: none !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════════════════════
  // BUILD LOGO
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
  // BUILD SIDEBAR HTML
  // ═══════════════════════════════════════════════════════════
  function buildSidebarHTML(session) {
    session = session || {};
    const currentPage = getCurrentPage();
    const navSections = cfg.NAV_SECTIONS || [];
    const data = getSidebarData(session);

    let navHTML = '';
    for (let i = 0; i < navSections.length; i++) {
      const section = navSections[i];
      navHTML += '<div class="refad-nav-section">' + escHtml(section.title) + '</div>';

      const items = section.items || [];
      for (let j = 0; j < items.length; j++) {
        const item = items[j];
        const isActive = currentPage === item.href;
        const isNew = isNewPage(item.href);
        const newBadge = isNew ? '<span class="refad-nav-new-badge">جديد</span>' : '';

        navHTML += '<a href="' + escHtml(item.href) + '" class="refad-nav-item' + (isActive ? ' active' : '') + '" data-page="' + escHtml(item.href) + '">' +
          '<i data-lucide="' + escHtml(item.icon) + '"></i>' +
          '<span>' + escHtml(item.label) + '</span>' +
          newBadge +
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
    html += '<button class="refad-notif-bell" id="refad-notif-bell" title="الإشعارات" aria-label="الإشعارات">';
    html += '<i data-lucide="bell"></i>';
    html += '<span class="refad-notif-badge hidden" id="refad-notif-badge">0</span>';
    html += '</button>';
    html += '<button class="refad-search-btn" id="refad-search-btn" title="بحث سريع (Ctrl+K)" aria-label="بحث">';
    html += '<i data-lucide="search"></i>';
    html += '</button>';
    html += '</div>';

    // Warehouse switcher
    html += '<div class="refad-wh-switcher">';
    html += '<button class="refad-wh-switcher-btn" id="refad-wh-switcher-btn">';
    html += '<i data-lucide="warehouse"></i>';
    html += '<span class="refad-wh-label" id="refad-wh-current-label">' + escHtml(data.warehouseName || 'اختر مخزن') + '</span>';
    html += '<i data-lucide="chevron-down" class="refad-wh-chevron"></i>';
    html += '</button>';
    html += '<div class="refad-wh-dropdown" id="refad-wh-dropdown">';
    html += '<div id="refad-wh-list"></div>';
    html += '</div>';
    html += '</div>';

    html += '<div class="refad-offline-indicator" id="refad-offline-indicator">';
    html += '<i data-lucide="wifi-off"></i>';
    html += '<span>أنت غير متصل بالإنترنت</span>';
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
    html += '<button class="refad-user-btn" id="refad-pwa-install-btn" style="display:none" title="تثبيت التطبيق" aria-label="تثبيت"><i data-lucide="download"></i></button>';
    html += '<button class="refad-user-btn" id="refad-theme-btn" title="الثيم" aria-label="الثيم"><i data-lucide="palette"></i></button>';
    html += '<button class="refad-user-btn danger" id="refad-logout-btn" title="تسجيل الخروج" aria-label="تسجيل الخروج"><i data-lucide="log-out"></i></button>';
    html += '</div>';
    html += '</div>';
    html += '</div>';

    html += '</div>';
    html += '<div class="refad-sidebar-overlay" id="refad-sidebar-overlay" aria-hidden="true"></div>';

    return html;
  }

  // ═══════════════════════════════════════════════════════════
  // BUILD QUICK SEARCH MODAL
  // ═══════════════════════════════════════════════════════════
  function buildQuickSearchHTML() {
    return `
      <div class="refad-quick-search-overlay" id="refad-quick-search">
        <div class="refad-quick-search-box">
          <div class="refad-search-input-wrap">
            <i data-lucide="search"></i>
            <input type="text" class="refad-search-input" id="refad-search-input" placeholder="ابحث في الصفحات..." autocomplete="off">
            <span class="refad-search-kbd">Esc</span>
          </div>
          <div class="refad-search-results" id="refad-search-results"></div>
        </div>
      </div>
    `;
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

    if (!document.getElementById('refad-quick-search')) {
      const searchWrap = document.createElement('div');
      searchWrap.innerHTML = buildQuickSearchHTML();
      document.body.appendChild(searchWrap.firstElementChild);
    }

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
    startOnlineCheck();
    setupPWAInstall();

    if (window.lucide && window.lucide.createIcons) {
      window.lucide.createIcons();
    }

    startSessionStatusCheck();

    // Hook the bell to the notifications dropdown (if notifications.js is loaded)
    const bell = document.getElementById('refad-notif-bell');
    if (bell) {
      bell.onclick = function (e) {
        e.stopPropagation();
        if (window.RefadNotifications && typeof window.RefadNotifications.toggle === 'function') {
          window.RefadNotifications.toggle();
        } else {
          window.location.href = 'notifications.html';
        }
      };
    }
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
    if (window.RefadTheme && typeof window.RefadTheme.openPicker === 'function') {
      window.RefadTheme.openPicker();
      return;
    }
    if (window.Refad && window.Refad.Theme) {
      if (typeof window.Refad.Theme.openThemePicker === 'function') {
        window.Refad.Theme.openThemePicker();
        return;
      }
      if (typeof window.Refad.Theme.toggle === 'function') {
        window.Refad.Theme.toggle();
        return;
      }
    }
    const html = document.documentElement;
    const current = html.getAttribute('data-theme') || 'light';
    html.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
    try { localStorage.setItem(cfg.THEME_KEY || 'refad_theme', current === 'dark' ? 'light' : 'dark'); } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════
  // LOGOUT MODAL
  // ═══════════════════════════════════════════════════════════
  function showLogoutModal() {
    if (document.getElementById('refad-logout-modal')) {
      document.getElementById('refad-logout-modal').classList.add('show');
      return;
    }
    const modal = document.createElement('div');
    modal.className = 'refad-logout-modal';
    modal.id = 'refad-logout-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;direction:rtl;padding:20px;backdrop-filter:blur(4px);';
    modal.innerHTML = `
      <div style="background:var(--card,#fff);border-radius:16px;padding:24px;max-width:400px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
          <div style="width:44px;height:44px;border-radius:12px;background:var(--danger-soft,rgba(239,68,68,0.1));color:var(--danger,#ef4444);display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <i data-lucide="log-out" style="width:22px;height:22px;"></i>
          </div>
          <div>
            <h3 style="font-size:16px;font-weight:800;margin:0;color:var(--text,#0f172a);">تسجيل الخروج</h3>
            <p style="font-size:12.5px;color:var(--text-muted,#64748b);margin:4px 0 0;">هل أنت متأكد؟</p>
          </div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="refad-logout-cancel" style="padding:10px 18px;border-radius:10px;border:1px solid var(--border,#e2e8f0);background:var(--bg-soft,#f8fafc);color:var(--text,#0f172a);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">إلغاء</button>
          <button id="refad-logout-confirm" style="padding:10px 18px;border-radius:10px;border:none;background:var(--danger,#ef4444);color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">تسجيل الخروج</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    if (window.lucide) window.lucide.createIcons();

    modal.querySelector('#refad-logout-cancel').onclick = () => modal.remove();
    modal.querySelector('#refad-logout-confirm').onclick = () => {
      modal.remove();
      clearCachedSession();
      if (state.sessionCheckTimer) clearInterval(state.sessionCheckTimer);
      if (state.unreadCheckTimer) clearInterval(state.unreadCheckTimer);
      if (window.Refad && typeof window.Refad.logout === 'function') {
        window.Refad.logout();
      } else {
        try { localStorage.clear(); } catch (e) {}
        window.location.href = 'index.html';
      }
    };
  }

  // ═══════════════════════════════════════════════════════════
  // BIND EVENTS
  // ═══════════════════════════════════════════════════════════
  function bindEvents() {
    const logoutBtn = document.getElementById('refad-logout-btn');
    if (logoutBtn) logoutBtn.onclick = showLogoutModal;

    const themeBtn = document.getElementById('refad-theme-btn');
    if (themeBtn) themeBtn.onclick = onThemeBtnClick;

    const searchBtn = document.getElementById('refad-search-btn');
    if (searchBtn) searchBtn.onclick = openQuickSearch;

    const pwaBtn = document.getElementById('refad-pwa-install-btn');
    if (pwaBtn) pwaBtn.onclick = installPWA;

    const mobileBtn = document.getElementById('refad-mobile-menu-btn');
    if (mobileBtn) {
      mobileBtn.onclick = function () {
        if (state.isOpen) closeSidebar();
        else openSidebar();
      };
    }

    const overlay = document.getElementById('refad-sidebar-overlay');
    if (overlay) overlay.onclick = function () { closeSidebar(); };

    const collapseBtn = document.getElementById('refad-collapse-btn');
    if (collapseBtn) collapseBtn.onclick = function () { toggleCollapsed(); };

    // Warehouse switcher
    const whBtn = document.getElementById('refad-wh-switcher-btn');
    if (whBtn) whBtn.onclick = function (e) {
      e.stopPropagation();
      toggleWarehouseDropdown();
    };

    // Close warehouse dropdown on outside click
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.refad-wh-switcher')) {
        const dd = document.getElementById('refad-wh-dropdown');
        if (dd) dd.classList.remove('show');
        state.whDropdownOpen = false;
      }
    });

    // Search modal
    const searchModal = document.getElementById('refad-quick-search');
    if (searchModal) {
      searchModal.onclick = function (e) {
        if (e.target === searchModal) closeQuickSearch();
      };
      const searchInput = document.getElementById('refad-search-input');
      if (searchInput) {
        searchInput.oninput = function () { renderSearchResults(this.value); };
        searchInput.onkeydown = handleSearchKeydown;
      }
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        if (state.searchOpen) closeQuickSearch();
        else openQuickSearch();
        return;
      }
      if (e.key === 'Escape') {
        if (state.searchOpen) closeQuickSearch();
        else if (state.isOpen) closeSidebar();
      }
    });

    window.addEventListener('popstate', function (e) {
      if (e.state && e.state.refadSidebarOpen) return;
      if (state.isOpen) closeSidebar();
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
    window.addEventListener('refad:notification-unread-changed', function (e) {
      if (e.detail && typeof e.detail.count === 'number') {
        state.notifUnread = e.detail.count;
        updateNavBadge('notifications.html', state.notifUnread, 'var(--gold, #F59E0B)');
        updateHeaderBellBadge();
      }
    });
    window.addEventListener('refad:chat-unread-changed', function () {
      loadUnreadCounts();
    });
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
    reloadUnread: loadUnreadCounts,
    hasOpenSession: function () { return state.hasOpenSession; },
    openSearch: openQuickSearch,
    closeSearch: closeQuickSearch,
    getWarehouse: function () { return state.currentWarehouse; }
  };

  console.log('[Refad] sidebar.js v5.0 ready — notifications + chat + warehouse switcher');
  console.log('[Refad] Nav sections:', (cfg.NAV_SECTIONS || []).length);
  console.log('[Refad] Total nav items:', (cfg.NAV_SECTIONS || []).reduce((s, sec) => s + (sec.items || []).length, 0));

})();