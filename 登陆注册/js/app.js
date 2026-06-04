/**
 * Recruitment Platform - Main Application
 * Handles: rendering data rows, search/filter, navigation, auth UI
 */
import { api } from './api.js';

// ──── State ────
let allCompanies = [];
let filteredCompanies = [];
let activeChips = { loc: new Set(), job: new Set(), tag: new Set() };

// ──── Init ────
document.addEventListener('DOMContentLoaded', () => {
  initNavbar();
  initSearchBar();
  detectPageAndLoad();
});

function detectPageAndLoad() {
  const path = window.location.pathname;
  if (path.includes('dashboard.html')) {
    loadDashboard();
  } else if (path.includes('payment.html')) {
    loadPaymentPage();
  } else if (path.includes('admin.html')) {
    loadAdminPage();
  } else if (path.includes('register.html') || path.includes('login.html') || path.includes('verify-email.html')) {
    // Handled by page-specific inline scripts
  } else {
    loadPublicIndex();
  }
}

// ──── Navbar ────
function initNavbar() {
  const navbarEl = document.querySelector('.navbar .nav-links');
  if (!navbarEl) return;

  if (api.isLoggedIn()) {
    const user = api.user || {};
    navbarEl.innerHTML = `
      <a href="/登陆注册/dashboard.html">📋 完整信息</a>
      <a href="/登陆注册/payment.html">💳 订阅管理</a>
      <span style="font-size:.78em;color:var(--text2);">${user.email || ''}</span>
      <a href="#" onclick="event.preventDefault();import('./api.js').then(m=>m.api.logout())">退出</a>
    `;
  } else {
    navbarEl.innerHTML = `
      <a href="/登陆注册/login.html">登录</a>
      <a href="/登陆注册/register.html" class="btn-nav">免费注册</a>
    `;
  }
}

// ──── Search Bar ────
function initSearchBar() {
  const input = document.getElementById('searchInput');
  if (!input) return;

  input.addEventListener('input', () => {
    filterAndRender();
  });

  // Chip clicks
  document.querySelectorAll('.search-chip').forEach(chip => {
    chip.addEventListener('click', function () {
      const cat = this.dataset.cat;
      const keyword = this.textContent.trim();

      if (cat === 'loc') {
        toggleChip(activeChips.loc, keyword, this);
      } else if (cat === 'job') {
        toggleChip(activeChips.job, keyword, this);
      } else if (cat === 'tag') {
        toggleChip(activeChips.tag, keyword, this);
      } else if (keyword === '✕ 清除' || keyword.includes('清除')) {
        clearAllFilters();
        return;
      }

      filterAndRender();
      updateSummary();
    });
  });

  // Clear link
  const clearLink = document.querySelector('.clear-link');
  if (clearLink) {
    clearLink.addEventListener('click', clearAllFilters);
  }
}

function toggleChip(set, value, el) {
  if (set.has(value)) {
    set.delete(value);
    el.classList.remove('active');
  } else {
    set.add(value);
    el.classList.add('active');
  }
}

function clearAllFilters() {
  activeChips.loc.clear();
  activeChips.job.clear();
  activeChips.tag.clear();
  document.getElementById('searchInput').value = '';
  document.querySelectorAll('.search-chip.active').forEach(c => c.classList.remove('active'));
  const summary = document.getElementById('searchSummary');
  if (summary) summary.style.display = 'none';
  filterAndRender();
}

function updateSummary() {
  const summaryDiv = document.getElementById('searchSummary');
  const filterSpan = document.getElementById('filterSummary');
  if (!summaryDiv || !filterSpan) return;

  const all = [
    ...Array.from(activeChips.loc).map(k => '📍' + k),
    ...Array.from(activeChips.job).map(k => '💼' + k),
    ...Array.from(activeChips.tag).map(k => '🏷️' + k),
  ];

  if (all.length > 0) {
    filterSpan.textContent = all.join(' + ');
    summaryDiv.style.display = 'block';
  } else {
    summaryDiv.style.display = 'none';
  }
}

function filterAndRender() {
  const q = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();

  filteredCompanies = allCompanies.filter(row => {
    const rowText = [
      row.company_name,
      row.locations,
      row.tags_json || '',
      row.target_audience || '',
      row.job_positions || '',
      row.description || '',
    ].join(' ').toLowerCase();

    // Text search
    if (q && !rowText.includes(q)) return false;

    // Location filter
    if (activeChips.loc.size > 0) {
      let match = false;
      for (const loc of activeChips.loc) {
        if (row.locations.includes(loc)) { match = true; break; }
      }
      if (!match) return false;
    }

    // Job filter
    if (activeChips.job.size > 0) {
      let match = false;
      for (const job of activeChips.job) {
        const kw = job.toLowerCase();
        // Handle compound keywords
        if (kw.includes('ai') || kw.includes('大模型')) {
          if (rowText.includes('ai') || rowText.includes('大模型') || rowText.includes('llm')) { match = true; break; }
        } else if (kw.includes('金融') || kw.includes('银行')) {
          if (rowText.includes('银行') || rowText.includes('金融') || rowText.includes('券商') || rowText.includes('保险')) { match = true; break; }
        } else if (kw.includes('新能源')) {
          if (rowText.includes('新能源') || rowText.includes('电池') || rowText.includes('储能') || rowText.includes('光伏') || rowText.includes('风电')) { match = true; break; }
        } else if (kw.includes('医药')) {
          if (rowText.includes('医药') || rowText.includes('医疗') || rowText.includes('药') || rowText.includes('生物')) { match = true; break; }
        } else if (kw.includes('游戏')) {
          if (rowText.includes('游戏') || rowText.includes('互娱')) { match = true; break; }
        } else if (kw.includes('央企') || kw.includes('国企')) {
          if (rowText.includes('央企') || rowText.includes('国企') || rowText.includes('国资委')) { match = true; break; }
        } else if (kw.includes('芯片')) {
          if (rowText.includes('芯片') || rowText.includes('ic') || rowText.includes('cpu') || rowText.includes('gpu') || rowText.includes('半导体')) { match = true; break; }
        } else if (kw.includes('自动驾驶')) {
          if (rowText.includes('自动驾驶') || rowText.includes('智能驾驶') || rowText.includes('智驾')) { match = true; break; }
        } else if (kw.includes('快消')) {
          if (rowText.includes('快消') || rowText.includes('零售') || rowText.includes('食品') || rowText.includes('饮料') || rowText.includes('化妆品')) { match = true; break; }
        } else {
          if (rowText.includes(kw)) { match = true; break; }
        }
      }
      if (!match) return false;
    }

    // Tag filter
    if (activeChips.tag.size > 0) {
      let match = false;
      const tags = (row.tags_json || '[]');
      for (const tag of activeChips.tag) {
        if (tags.includes('热招') && tag.includes('热招')) { match = true; break; }
        if ((tags.includes('转正') || tags.includes('留用') || tags.includes('offer')) && tag.includes('转正')) { match = true; break; }
        if (tags.includes('截止') && tag.includes('截止')) { match = true; break; }
      }
      if (!match) return false;
    }

    return true;
  });

  renderRows(filteredCompanies);
  updateResultCount();
}

function updateResultCount() {
  const el = document.getElementById('resultCount');
  if (!el) return;
  const hasFilter = document.getElementById('searchInput')?.value ||
    activeChips.loc.size > 0 || activeChips.job.size > 0 || activeChips.tag.size > 0;
  el.textContent = hasFilter
    ? `匹配 ${filteredCompanies.length} 条`
    : `共 ${allCompanies.length} 条`;
}

// ──── Render Rows ────
function renderRows(companies, isFull = false) {
  const container = document.getElementById('dataRows');
  if (!container) return;

  if (companies.length === 0) {
    container.innerHTML = '<div class="no-result">😕 没有匹配的结果，试试调整筛选条件</div>';
    return;
  }

  container.innerHTML = companies.map((row, idx) => {
    const tags = parseTags(row.tags_json);
    const tagsHtml = tags.map(t => {
      let cls = 'tag';
      if (t.includes('热招')) cls += ' hot';
      if (t.includes('转正') || t.includes('留用') || t.includes('offer')) cls += ' green';
      if (t.includes('截止')) cls += ' orange';
      if (t.includes('关注官网') || t.includes('⚠️')) cls += ' purple';
      return `<span class="${cls}">${t}</span>`;
    }).join('');

    if (isFull) {
      // Full view - all data visible
      return `
        <div class="row">
          <span class="row-num">${String(row.row_num).padStart(2, '0')}</span>
          <span class="row-left">
            <span class="row-company">${escapeHtml(row.company_name)}</span>
            <span class="row-loc">📍${escapeHtml(row.locations)}</span>
            <span class="row-tags">${tagsHtml}</span>
          </span>
          <span class="row-info">
            ${row.target_audience ? `<span class="info-item"><strong>面向：</strong>${escapeHtml(row.target_audience)}</span>` : ''}
            ${row.job_positions ? `<span class="info-item"><strong>岗：</strong>${escapeHtml(row.job_positions)}</span>` : ''}
            ${row.description ? `<span class="info-item">${escapeHtml(row.description)}</span>` : ''}
          </span>
          <span class="row-actions">
            ${row.apply_url ? `<a class="btn-primary" href="${escapeHtml(row.apply_url)}" target="_blank" rel="noopener">${escapeHtml(row.apply_text || '投递')}</a>` : ''}
            ${row.website_url ? `<a class="btn-outline" href="${escapeHtml(row.website_url)}" target="_blank" rel="noopener">${escapeHtml(row.website_text || '网址')}</a>` : ''}
          </span>
        </div>`;
    } else {
      // Public view - masked sensitive data
      return `
        <div class="row">
          <span class="row-num">${String(row.row_num).padStart(2, '0')}</span>
          <span class="row-left">
            <span class="row-company">${escapeHtml(row.company_name)}</span>
            <span class="row-loc">📍${escapeHtml(row.locations)}</span>
            <span class="row-tags">${tagsHtml}</span>
          </span>
          <span class="row-info masked">
            <span class="info-item masked-text">🔒 登录后查看完整信息</span>
          </span>
          <span class="row-actions">
            <a class="btn-locked" href="/登陆注册/login.html">🔒 登录查看</a>
            ${row.website_url ? `<a class="btn-outline" href="${escapeHtml(row.website_url)}" target="_blank" rel="noopener">${escapeHtml(row.website_text || '网址')}</a>` : ''}
          </span>
        </div>`;
    }
  }).join('');
}

function parseTags(tagsJson) {
  try {
    return JSON.parse(tagsJson);
  } catch {
    return [];
  }
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ──── Page Loaders ────

async function loadPublicIndex() {
  const rowsContainer = document.getElementById('dataRows');
  if (!rowsContainer) return;

  rowsContainer.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>加载中...</p></div>';

  const result = await api.getCompanies();
  if (result.success) {
    allCompanies = result.data.companies;
    filteredCompanies = [...allCompanies];
    renderRows(filteredCompanies, false);
    updateResultCount();
  } else {
    rowsContainer.innerHTML = `<div class="no-result">加载失败：${result.message}</div>`;
  }
}

async function loadDashboard() {
  if (!api.isLoggedIn()) {
    window.location.href = '/登陆注册/login.html';
    return;
  }

  // Check subscription status
  const subResult = await api.getSubscriptionStatus();
  if (subResult.success) {
    renderSubscriptionBanner(subResult.data);
    if (!subResult.data.hasAccess && subResult.data.status !== 'none') {
      // No access - redirect to payment
      window.location.href = '/登陆注册/payment.html';
      return;
    }
  }

  // Load full data
  const rowsContainer = document.getElementById('dataRows');
  if (!rowsContainer) return;

  rowsContainer.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>加载中...</p></div>';

  const result = await api.getCompaniesFull();
  if (result.success) {
    allCompanies = result.data.companies;
    filteredCompanies = [...allCompanies];
    renderRows(filteredCompanies, true);
    updateResultCount();
  } else if (result.code === 'SUBSCRIPTION_REQUIRED') {
    window.location.href = '/登陆注册/payment.html';
  } else {
    rowsContainer.innerHTML = `<div class="no-result">加载失败：${result.message}</div>`;
  }
}

function renderSubscriptionBanner(sub) {
  const bannerEl = document.getElementById('subBanner');
  if (!bannerEl) return;

  if (sub.status === 'trial') {
    bannerEl.innerHTML = `<div class="banner trial">🎁 免费试用中 · ${sub.remaining} · <a href="/登陆注册/payment.html">立即订阅（¥9.90/3个月）</a></div>`;
  } else if (sub.status === 'active') {
    bannerEl.innerHTML = `<div class="banner active">✅ 订阅有效 · ${sub.remaining} · <a href="/登陆注册/payment.html">续费叠加</a></div>`;
  } else if (sub.status === 'trial_expired') {
    bannerEl.innerHTML = `<div class="banner expired">⏰ 免费试用已过期 · <a href="/登陆注册/payment.html">立即订阅 ¥9.90/3个月</a></div>`;
  } else if (sub.status === 'expired') {
    bannerEl.innerHTML = `<div class="banner expired">⏰ 订阅已过期 · <a href="/登陆注册/payment.html">续费 ¥9.90/3个月</a></div>`;
  } else {
    bannerEl.innerHTML = `<div class="banner preview">👋 新用户注册即享<strong>1天免费试用</strong> · <a href="/登陆注册/register.html">免费注册</a></div>`;
  }
}

async function loadPaymentPage() {
  if (!api.isLoggedIn()) {
    window.location.href = '/登陆注册/login.html';
    return;
  }

  // Load subscription status
  const subResult = await api.getSubscriptionStatus();
  if (subResult.success) {
    renderSubscriptionBanner(subResult.data);
    const statusEl = document.getElementById('subscriptionStatus');
    if (statusEl) {
      statusEl.innerHTML = formatSubscriptionStatus(subResult.data);
    }
  }

  // Load payment history
  const ordersResult = await api.getPaymentOrders();
  if (ordersResult.success) {
    renderPaymentHistory(ordersResult.data.orders);
  }
}

function formatSubscriptionStatus(sub) {
  if (sub.hasAccess) {
    return `
      <div class="banner ${sub.status === 'trial' ? 'trial' : 'active'}">
        ${sub.status === 'trial' ? '🎁 免费试用中' : '✅ 已订阅'} · ${sub.remaining}
      </div>
    `;
  }
  return `
    <div class="banner expired">
      ${sub.message}
    </div>
  `;
}

function renderPaymentHistory(orders) {
  const el = document.getElementById('paymentHistory');
  if (!el) return;

  if (!orders || orders.length === 0) {
    el.innerHTML = '<p style="text-align:center;color:var(--text2);">暂无支付记录</p>';
    return;
  }

  el.innerHTML = `
    <table>
      <thead><tr><th>订单号</th><th>金额</th><th>状态</th><th>时间</th></tr></thead>
      <tbody>
        ${orders.map(o => `
          <tr>
            <td>${o.order_id}</td>
            <td>¥${o.amount.toFixed(2)}</td>
            <td><span class="status-badge ${o.status}">${statusLabel(o.status)}</span></td>
            <td>${o.created_at ? o.created_at.slice(0, 10) : ''}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function statusLabel(status) {
  const labels = {
    pending: '待支付',
    pending_verify: '审核中',
    completed: '已完成',
    cancelled: '已取消',
    expired: '已过期',
  };
  return labels[status] || status;
}

// ──── Admin Page ────
async function loadAdminPage() {
  const password = prompt('请输入管理员密码：');
  if (!password) {
    document.body.innerHTML = '<div class="no-result">需要管理员密码才能访问</div>';
    return;
  }

  // Check access
  const statsResult = await api.adminGetStats(password);
  if (!statsResult || !statsResult.success) {
    document.body.innerHTML = '<div class="no-result">密码错误或无权访问</div>';
    return;
  }

  // Store password for subsequent requests
  window._adminPassword = password;

  // Render stats
  const statsEl = document.getElementById('adminStats');
  if (statsEl && statsResult.success) {
    const s = statsResult.data;
    statsEl.innerHTML = `
      <div class="admin-stat-card"><div class="num">${s.totalUsers}</div><div class="label">注册用户</div></div>
      <div class="admin-stat-card"><div class="num">${s.activeSubscriptions}</div><div class="label">活跃订阅</div></div>
      <div class="admin-stat-card"><div class="num">${s.totalCompletedPayments}</div><div class="label">完成付款</div></div>
      <div class="admin-stat-card"><div class="num">¥${s.totalRevenue.toFixed(2)}</div><div class="label">总收入</div></div>
    `;
  }

  // Load pending payments
  await loadPendingPayments();
}

async function loadPendingPayments() {
  const container = document.getElementById('pendingPayments');
  if (!container) return;

  const password = window._adminPassword;
  if (!password) return;

  const result = await api.adminGetPendingPayments(password);
  if (!result.success) {
    container.innerHTML = `<div class="no-result">加载失败：${result.message}</div>`;
    return;
  }

  const payments = result.data.payments;
  if (payments.length === 0) {
    container.innerHTML = '<div class="no-result">✅ 暂无待审核的付款</div>';
    return;
  }

  container.innerHTML = payments.map(p => `
    <div class="admin-payment-card">
      <div class="info">
        <strong>${p.user_email}</strong><br>
        订单号：${p.order_id}<br>
        金额：¥${p.amount.toFixed(2)}<br>
        时间：${p.created_at ? p.created_at.slice(0, 16) : ''}
        ${p.payment_proof ? `<br>截图：<a href="#" onclick="viewProof('${p.payment_proof}')">查看</a>` : ''}
      </div>
      <div class="actions">
        <button class="btn-sm btn-approve" onclick="verifyPayment('${p.order_id}', 'approve')">✅ 确认</button>
        <button class="btn-sm btn-reject" onclick="verifyPayment('${p.order_id}', 'reject')">❌ 拒绝</button>
      </div>
    </div>
  `).join('');
}

// Make these global for onclick handlers
window.verifyPayment = async function (orderId, action) {
  const password = window._adminPassword;
  if (!confirm(`确定要${action === 'approve' ? '确认' : '拒绝'}该付款吗？`)) return;

  const result = await api.adminVerifyPayment(orderId, action, password);
  alert(result.message);
  if (result.success) {
    loadPendingPayments();
  }
};

window.viewProof = function (filename) {
  // R2 public URL - adjust based on your R2 config
  alert('截图文件名：' + filename + '\n请在R2存储桶中查看');
};

// Export for page-specific use
window.api = api;
window.loadPendingPayments = loadPendingPayments;
