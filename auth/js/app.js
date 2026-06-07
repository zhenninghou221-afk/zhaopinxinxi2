/**
 * Recruitment Platform - Main Application
 * Handles: rendering data rows, search/filter, navigation, auth UI
 */
import { api } from './api.js';

// ──── State ────
let allCompanies = [];
let totalCompanies = 0;  // Total count from server (may be > loaded companies)
let filteredCompanies = [];
let activeChips = { loc: new Set(), job: new Set(), tag: new Set() };
let favoriteIds = new Set(); // Company IDs that user has favorited
const PUBLIC_LIMIT = 15;
const RENDER_BATCH = 100;  // render 100 at a time, load more on scroll
const PRELOAD_COUNT = 200;  // Fetch first 200 for public page (covers 95% of searches)
let renderOffset = 0;
let debounceTimer = null;

// ──── Relative time ────
function timeAgo(isoString) {
  if (!isoString) return '';
  var now = Date.now();
  var then = new Date(isoString).getTime();
  if (isNaN(then)) return '';
  var diff = now - then;
  var minutes = Math.floor(diff / 60000);
  var hours = Math.floor(diff / 3600000);
  var days = Math.floor(diff / 86400000);
  if (minutes < 1) return '刚刚更新';
  if (minutes < 60) return minutes + ' 分钟前更新';
  if (hours < 24) return hours + ' 小时前更新';
  if (days < 30) return days + ' 天前更新';
  return new Date(isoString).toLocaleDateString('zh-CN') + ' 更新';
}

function updateLastUpdatedDisplay(lastUpdated) {
  if (!lastUpdated) return;
  var ago = timeAgo(lastUpdated);
  // Update index.html hero
  setEl('lastUpdated', '🕐 ' + ago, lastUpdated);
  // Update index.html footer
  setEl('lastUpdatedFooter', '🕐 ' + ago, lastUpdated);
  // Update dashboard
  setEl('dashUpdated', '🕐 数据' + ago, lastUpdated);
  function setEl(id, text, iso) {
    var el = document.getElementById(id);
    if (el) {
      el.textContent = text;
      el.title = '最新数据时间：' + new Date(iso).toLocaleString('zh-CN');
    }
  }
}

// ──── Analytics tracking ────
function trackEventFn(event, detail) {
  try {
    fetch((window.API_BASE_URL || '') + '/api/v1/analytics/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, detail }),
    }).catch(() => {});
  } catch(e) {}
}
window.track = trackEventFn;
const track = trackEventFn;

// ──── Init ────
document.addEventListener('DOMContentLoaded', () => {
  initNavbar();
  initSearchBar();
  initAutocomplete();
  detectPageAndLoad();
  initBackToTop();
  initFavDelegate();
  track('pageview', window.location.pathname);
});

// ──── Autocomplete ────
let acDropdown = null;
let acIndex = -1;

function initAutocomplete() {
  const input = document.getElementById('searchInput');
  if (!input) return;

  // Create dropdown
  acDropdown = document.createElement('div');
  acDropdown.className = 'search-autocomplete';
  const row = input.parentElement;
  row.style.position = 'relative';
  row.appendChild(acDropdown);

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (q.length < 1) { hideAutocomplete(); return; }

    const matches = [];
    const data = allCompanies.length > 0 ? allCompanies : [];
    for (let i = 0; i < data.length && matches.length < 8; i++) {
      const c = data[i];
      const name = (c.company_name || '').toLowerCase();
      const jobs = (c.job_positions || '').toLowerCase();
      if (name.includes(q)) {
        matches.push({ company: c, matchType: 'name', matchText: c.company_name });
      } else if (jobs.includes(q)) {
        matches.push({ company: c, matchType: 'job', matchText: extractMatch(jobs, q) });
      }
    }

    if (matches.length === 0) {
      acDropdown.innerHTML = '<div class="ac-empty">未找到匹配，按回车搜索全部</div>';
    } else {
      acDropdown.innerHTML = matches.map((m, i) =>
        `<div class="ac-item" data-index="${i}" data-id="${m.company.id}">
          <span class="ac-name">${escapeHtml(m.company.company_name)}</span>
          <span class="ac-loc">${m.matchType === 'job' ? '💼 ' + escapeHtml(m.matchText) : '📍 ' + escapeHtml(m.company.locations || '')}</span>
        </div>`
      ).join('');
    }
    acIndex = -1;
    acDropdown.classList.add('show');
  });

  // Click on suggestion
  acDropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.ac-item');
    if (!item) return;
    const name = item.querySelector('.ac-name').textContent;
    input.value = name;
    hideAutocomplete();
    // Trigger search
    filterAndRender();
    track('search', name);
  });

  // Keyboard navigation
  input.addEventListener('keydown', (e) => {
    if (!acDropdown.classList.contains('show')) return;
    const items = acDropdown.querySelectorAll('.ac-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      acIndex = Math.min(acIndex + 1, items.length - 1);
      updateAcHighlight(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      acIndex = Math.max(acIndex - 1, 0);
      updateAcHighlight(items);
    } else if (e.key === 'Enter' && acIndex >= 0 && items[acIndex]) {
      e.preventDefault();
      items[acIndex].click();
    } else if (e.key === 'Escape') {
      hideAutocomplete();
    }
  });

  // Hide on blur (delayed so click registers)
  input.addEventListener('blur', () => {
    setTimeout(hideAutocomplete, 150);
  });
}

function updateAcHighlight(items) {
  items.forEach((el, i) => el.classList.toggle('active', i === acIndex));
}

function hideAutocomplete() {
  if (acDropdown) acDropdown.classList.remove('show');
  acIndex = -1;
}

// Extract the matching job keyword from job_positions string
function extractMatch(jobsStr, query) {
  if (!jobsStr || !query) return '';
  // job_positions is like "后端开发/Java/全栈开发"
  var parts = jobsStr.split(/[\/,、]/);
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].toLowerCase().includes(query)) {
      return parts[i].trim();
    }
  }
  return query;
}

// ──── Favorites delegate ────
function initFavDelegate() {
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.btn-fav');
    if (!btn) return;
    if (!api.isLoggedIn()) {
      window.location.href = '/auth/login';
      return;
    }
    const cid = parseInt(btn.dataset.cid);
    if (!cid) return;
    btn.style.pointerEvents = 'none';
    const result = await api.toggleFavorite(cid);
    if (result.success) {
      if (result.data.favorited) {
        favoriteIds.add(cid);
        btn.textContent = '⭐';
        btn.title = '取消收藏';
      } else {
        favoriteIds.delete(cid);
        btn.textContent = '☆';
        btn.title = '收藏';
      }
      // Immediately refresh the favorites list in the tab
      const favResult = await api.listFavorites();
      renderFavoritesList(favResult);
    }
    btn.style.pointerEvents = 'auto';
  });
}

// ──── Load favorites ────
async function loadFavoriteIds() {
  if (!api.isLoggedIn()) return;
  const result = await api.listFavorites();
  if (result.success && result.data.favorites) {
    favoriteIds = new Set(result.data.favorites.map(f => f.id));
    // Re-render if dashboard is showing
    if (filteredCompanies.length > 0) {
      renderRows(filteredCompanies, true);
    }
  }
  // Load favorites list into dashboard section
  renderFavoritesList(result);
}

function renderFavoritesList(result) {
  const el = document.getElementById('favoritesList');
  if (!el) return;
  if (!result || !result.success || !result.data.favorites || result.data.favorites.length === 0) {
    el.innerHTML = '<div class="no-result" style="padding:50px;">⭐ 暂无收藏<br><br><span style="font-size:.85em;">在「招聘信息」中点击企业左侧的 ☆ 即可收藏</span></div>';
    updateFavCount(0);
    return;
  }
  updateFavCount(result.data.favorites.length);
  el.innerHTML = `
    <div class="rows">
      <div class="row header-row">
        <span class="row-num">#</span>
        <span class="row-left">企业 / 工作地区</span>
        <span class="row-info">面向对象 / 岗位方向</span>
        <span class="row-actions">操作</span>
      </div>
      ${result.data.favorites.map((f, idx) => {
        const tags = parseTags(f.tags_json);
        const tagsHtml = tags.map(t => {
          let cls = 'tag';
          if (t.includes('热招')) cls += ' hot';
          if (t.includes('转正') || t.includes('留用')) cls += ' green';
          if (t.includes('截止')) cls += ' orange';
          return `<span class="${cls}">${t}</span>`;
        }).join('');
        return `
        <div class="row">
          <span class="row-num">${String(idx + 1).padStart(2, '0')}</span>
          <span class="row-left">
            <a class="row-company" href="/auth/company.html?id=${f.id}" target="_blank" rel="noopener" style="text-decoration:none;color:#0f172a;" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color=''">${escapeHtml(f.company_name)}</a>
            <span class="row-loc">📍${escapeHtml(f.locations)}</span>
            <span class="row-tags">${tagsHtml}</span>
          </span>
          <span class="row-info">
            ${f.target_audience ? `<span class="info-item"><strong>面向：</strong>${escapeHtml(f.target_audience)}</span>` : ''}
            ${f.job_positions ? `<span class="info-item"><strong>岗：</strong>${escapeHtml(f.job_positions)}</span>` : ''}
            ${f.description ? `<span class="info-item">${escapeHtml(f.description)}</span>` : ''}
          </span>
          <span class="row-actions">
            ${(f.apply_url && f.apply_url.startsWith('http') && f.apply_url !== f.website_url) ? `<a class="btn-outline" href="${escapeHtml(f.apply_url)}" target="_blank" rel="noopener">📨 投递</a>` : ''}
            ${(f.website_url && f.website_url.startsWith('http')) ? `<a class="btn-outline" href="${escapeHtml(f.website_url)}" target="_blank" rel="noopener">🏢 ${escapeHtml(f.website_text || '官网')}</a>` : ''}
            <button class="btn-fav" data-cid="${f.id}" style="background:none;border:none;cursor:pointer;font-size:1.2em;padding:2px 8px;" title="取消收藏">⭐</button>
          </span>
        </div>`;
      }).join('')}
    </div>
  `;
}

function detectPageAndLoad() {
  var path = window.location.pathname;
  if (path.indexOf('dashboard') >= 0) {
    loadDashboard();
  } else if (path.indexOf('payment') >= 0) {
    loadPaymentPage();
  } else if (path.indexOf('admin') >= 0) {
    loadAdminPage();
  } else if (path.indexOf('register') >= 0 || path.indexOf('login') >= 0 || path.indexOf('verify-email') >= 0) {
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
    const isAdmin = user.isAdmin === true;
    navbarEl.innerHTML = `
      <a href="/auth/dashboard">📋 完整信息</a>
      <a href="/auth/payment">💳 订阅管理</a>
      ${isAdmin ? '<a href="/auth/admin" style="background:#f59e0b;color:#fff;padding:6px 14px;border-radius:6px;font-weight:700;">⚙️ 进入后台</a>' : ''}
      <span style="font-size:.78em;color:var(--text2);">${user.email || ''}</span>
      <a href="#" id="navLogoutBtn">退出</a>
    `;
    // Bind logout after navbar rendered
    setTimeout(() => {
      const btn = document.getElementById('navLogoutBtn');
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          localStorage.removeItem('recruitment_token');
          localStorage.removeItem('recruitment_user');
          window.location.href = '/';
        });
      }
    }, 0);
  } else {
    navbarEl.innerHTML = `
      <a href="/auth/login">登录</a>
      <a href="/auth/register" class="btn-nav">免费注册</a>
    `;
  }
}

// ──── Search Bar ────
let chipBinded = false;

function initSearchBar() {
  const input = document.getElementById('searchInput');
  if (!input) return;

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => filterAndRender(), 300);
  });

  // Chip clicks handled via event delegation on the chips container
  const chipsContainer = document.getElementById('searchChips');
  if (chipsContainer && !chipBinded) {
    chipBinded = true;
    chipsContainer.addEventListener('click', function (e) {
      const chip = e.target.closest('.search-chip');
      if (!chip) return;

      const cat = chip.dataset.cat;
      const keyword = chip.textContent.trim();

      if (keyword === '✕ 清除' || keyword.includes('清除')) {
        clearAllFilters();
        return;
      }

      if (cat === 'loc') {
        toggleChip(activeChips.loc, keyword, chip);
      } else if (cat === 'job') {
        toggleChip(activeChips.job, keyword, chip);
      } else if (cat === 'tag') {
        toggleChip(activeChips.tag, keyword, chip);
      }

      filterAndRender();
      updateSummary();
    });
  }

  // Clear link
  const clearLink = document.querySelector('.clear-link');
  if (clearLink) {
    clearLink.addEventListener('click', clearAllFilters);
  }
}

// ──── Dynamic Chip Builder ────
function buildAllChips(companies) {
  buildLocationChips(companies);
  buildJobChips(companies);
}

function buildLocationChips(companies) {
  const row = document.getElementById('locationChipsRow');
  if (!row) return;

  // Count companies per city (descending), normalize names
  const cityCount = new Map();
  for (const c of companies) {
    if (c.locations) {
      c.locations.split('/').forEach(city => {
        let t = city.trim();
        if (!t) return;
        // Normalize: strip 📍 prefix (legacy data artifact)
        t = t.replace(/^📍/, '').trim();
        if (!t) return;
        cityCount.set(t, (cityCount.get(t) || 0) + 1);
      });
    }
  }

  const cities = Array.from(cityCount.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([city, count]) => city);

  const chipsHtml = cities.map(c =>
    `<span class="search-chip" data-cat="loc">${escapeHtml(c)}</span>`
  ).join('');

  row.innerHTML = '<span class="search-chip-cat">📍 地区</span>' + chipsHtml;
}

function buildJobChips(companies) {
  const row = document.getElementById('jobChipsRow');
  if (!row) return;

  // Hardcoded detailed job categories — always shown
  const JOB_CATEGORIES = [
    '💻 计算机/软件', '🤖 AI/算法/大模型', '🔧 硬件/芯片/电子',
    '📱 通信/5G/6G', '🚗 汽车/自动驾驶', '🔋 新能源/电池',
    '💰 金融/银行/证券', '🏥 医药/医疗/生物',
    '🎮 游戏/娱乐/内容', '🏗️ 建筑/工程/地产',
    '🛒 电商/物流/零售', '🔐 网络安全',
    '☁️ 云计算/大数据', '🎓 教育/培训',
    '⚡ 电力/能源/化工', '✈️ 航空/航天/军工',
    '🤖 机器人/智能硬件', '🛰️ 卫星/遥感/测绘',
    '🍔 快消/食品/餐饮', '📰 媒体/出版/广告',
    '🏨 酒店/旅游/会展', '👔 咨询/法律/人力',
    '🏭 制造/机械/材料', '🌾 农业/食品/粮食',
  ];

  // Also collect from actual data
  const dataJobs = new Set();
  for (const c of companies) {
    if (c.job_positions) {
      c.job_positions.split(/[\/、]/).forEach(job => {
        const t = job.trim();
        if (t && t.length > 0 && t.length < 20) dataJobs.add(t);
      });
    }
  }

  const allJobs = [...new Set([...JOB_CATEGORIES, ...Array.from(dataJobs).sort()])];
  const showCount = 12;
  const visible = allJobs.slice(0, showCount);
  const hidden = allJobs.slice(showCount);

  const chipsHtml = visible.map(j =>
    `<span class="search-chip" data-cat="job">${escapeHtml(j)}</span>`
  ).join('');

  const expandHtml = hidden.length > 0 ?
    `<span class="search-chip" id="expandJobsBtn" data-cat="expand" style="background:#f0f4ff;font-weight:600;">📂 展开更多 (${hidden.length})</span>` +
    hidden.map(j => `<span class="search-chip hidden-chip" data-cat="job" style="display:none;">${escapeHtml(j)}</span>`).join('') : '';

  row.innerHTML = '<span class="search-chip-cat">💼 岗位</span>' + chipsHtml + expandHtml +
    '<span class="search-chip" data-cat="clear" style="border-color:#ef4444;color:#dc2626;margin-left:4px;">✕ 清除</span>';

  // Expand handler
  setTimeout(() => {
    const expandBtn = document.getElementById('expandJobsBtn');
    if (expandBtn) {
      expandBtn.addEventListener('click', function() {
        this.style.display = 'none';
        document.querySelectorAll('.hidden-chip').forEach(c => c.style.display = '');
      });
    }
  }, 0);
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
  const subRow = document.getElementById('subJobChipsRow');
  if (subRow) { subRow.style.display = 'none'; subRow.innerHTML = '<span class="search-chip-cat">🔍 细分方向</span>'; }
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


// ──── Sub-category cascading ────
const SUB_CATEGORIES = {
  '💻 计算机/软件': ['后端开发', '前端开发', '全栈开发', 'Java', 'Python', 'Go/C++', '测试/QA', '运维/DevOps', '移动端开发', '数据库'],
  '🤖 AI/算法/大模型': ['大模型/LLM', 'CV/计算机视觉', 'NLP/自然语言', '推荐系统', '深度学习', '机器学习', '自动驾驶算法', '语音/音频'],
  '🔧 硬件/芯片/电子': ['芯片设计', 'IC验证', 'FPGA', '嵌入式开发', 'PCB/电路', 'GPU开发', '半导体工艺', 'EDA工具'],
  '📱 通信/5G/6G': ['5G通信', '射频/RF', '天线设计', '基带开发', '网络协议', '光通信'],
  '🚗 汽车/自动驾驶': ['自动驾驶', '智能座舱', '三电系统', '整车研发', '车联网', 'ADAS'],
  '🔋 新能源/电池': ['锂电池', '固态电池', '光伏', '风电', '氢能', '储能系统', 'BMS'],
  '💰 金融/银行/证券': ['银行', '证券/投行', '保险', '基金/资管', '风控/合规', '量化交易', '支付'],
  '🏥 医药/医疗/生物': ['药物研发', '临床研究', '生物技术', '医疗器械', '诊断试剂', '基因检测'],
  '🎮 游戏/娱乐/内容': ['游戏开发', '游戏策划', '游戏美术', '视频/直播', '音乐/音频', 'IP运营'],
  '🏗️ 建筑/工程/地产': ['建筑设计', '土木工程', '地产开发', '物业管理', 'BIM', '施工管理'],
  '🛒 电商/物流/零售': ['电商运营', '供应链', '仓储物流', '零售管理', '采购', '跨境电商'],
  '☁️ 云计算/大数据': ['云架构', '大数据平台', '数据仓库', 'ETL', '数据治理', 'BI/分析'],
  '⚡ 电力/能源/化工': ['电力系统', '发电', '石化', '化工工艺', '电网调度', '核电'],
  '✈️ 航空/航天/军工': ['飞行器设计', '火箭/导弹', '卫星', '雷达/电子战', '船舶', '兵器'],
};

function showSubCategories(mainCat, active) {
  const row = document.getElementById('subJobChipsRow');
  if (!row) return;
  if (!active) { row.style.display = 'none'; row.innerHTML = '<span class="search-chip-cat">🔍 细分方向</span>'; return; }
  const subs = SUB_CATEGORIES[mainCat];
  if (!subs) { row.style.display = 'none'; return; }
  row.style.display = 'flex';
  row.innerHTML = '<span class="search-chip-cat">🔍 细分方向</span>' +
    subs.map(s => `<span class="search-chip" data-cat="subjob">${s}</span>`).join('') +
    '<span class="search-chip" data-cat="clear" style="color:#999;">✕ 取消</span>';
}
function filterAndRender() {
  const q = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
  if (q) track('search', q);
  // Remove load more button
  const oldBtn = document.getElementById('loadMoreBtn');
  if (oldBtn) oldBtn.remove();

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

    // Job filter — smart matching with category expansion
    if (activeChips.job.size > 0) {
      const CATEGORY_MAP = {
        '💻 计算机/软件': ['软件', '开发', '后端', '前端', 'Java', 'Python', 'Go', '程序员', 'IT', '互联网', '计算机', '编程'],
        '🤖 AI/算法/大模型': ['AI', '算法', '大模型', 'LLM', '深度学习', '机器学习', 'NLP', 'CV', '神经网络', '推荐', '智能'],
        '🔧 硬件/芯片/电子': ['芯片', 'IC', '半导体', '硬件', 'FPGA', '嵌入式', '电路', '电子', 'GPU', 'CPU', 'SOC'],
        '📱 通信/5G/6G': ['通信', '5G', '6G', '射频', '天线', '基站', '无线', '光纤', '电信', '移动', '联通'],
        '🚗 汽车/自动驾驶': ['汽车', '自动驾驶', '智能驾驶', '座舱', '新能源车', '电驱', '出行', '网约车', '整车'],
        '🔋 新能源/电池': ['电池', '储能', '光伏', '风电', '锂电', '氢能', '太阳能', '新能源', '充电桩'],
        '💰 金融/银行/证券': ['银行', '证券', '金融', '保险', '基金', '投资', '信托', '支付', '风控', '理财'],
        '🏥 医药/医疗/生物': ['医药', '医疗', '药', '生物', '基因', '临床', '制药', '诊断', '疫苗', '器械'],
        '🎮 游戏/娱乐/内容': ['游戏', '娱乐', '视频', '直播', '音乐', '影视', '动画', 'IP', '内容', '短剧'],
        '🏗️ 建筑/工程/地产': ['建筑', '工程', '地产', '房地产', '物业', '施工', '基建', '隧道', '桥梁'],
        '🛒 电商/物流/零售': ['电商', '物流', '零售', '快递', '仓储', '供应链', '外卖', '配送', '货运'],
        '🔐 网络安全': ['安全', '渗透', '漏洞', '防火墙', '加密', '攻防', '网安', '信息安全'],
        '☁️ 云计算/大数据': ['云', '大数据', '数据', '数据中心', '分布式', 'Spark', 'Hadoop'],
        '🎓 教育/培训': ['教育', '培训', '考研', '留学', '辅导', '课程', '教师', 'K12', '学校'],
        '⚡ 电力/能源/化工': ['电力', '电网', '能源', '化工', '石油', '天然气', '煤炭', '核电', '石化'],
        '✈️ 航空/航天/军工': ['航空', '航天', '军工', '飞机', '卫星', '火箭', '导弹', '雷达', '战机'],
        '🤖 机器人/智能硬件': ['机器人', '智能硬件', '机械臂', '无人机', '传感', '自动化', 'AGV'],
        '🛰️ 卫星/遥感/测绘': ['卫星', '遥感', '测绘', 'GIS', '导航', '北斗', 'GPS', '空间'],
        '🍔 快消/食品/餐饮': ['快消', '食品', '饮料', '餐饮', '零食', '啤酒', '白酒', '连锁', '餐厅'],
        '📰 媒体/出版/广告': ['媒体', '出版', '广告', '营销', '公关', '新媒体', '短视频', '公众号'],
        '🏨 酒店/旅游/会展': ['酒店', '旅游', '景区', '会展', '民宿', '票务', '航旅', '差旅'],
        '👔 咨询/法律/人力': ['咨询', '律师', '法律', '人力', '猎头', 'HR', '法务', '审计', '会计'],
        '🏭 制造/机械/材料': ['制造', '机械', '材料', '钢铁', '冶金', '纺织', '重工', '装备', '工厂'],
        '🌾 农业/食品/粮食': ['农业', '种业', '粮食', '养殖', '渔业', '林业', '农资', '中粮', '食品'],
      };
      let match = false;
      for (const job of activeChips.job) {
        const kw = job.replace(/^[^ ]+ /, '').toLowerCase();
        if (rowText.includes(kw)) { match = true; break; }
        const keywords = CATEGORY_MAP[job];
        if (keywords) {
          for (const k of keywords) {
            if (rowText.includes(k)) { match = true; break; }
          }
          if (match) break;
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

  const isPublic = !api.isLoggedIn();
  const display = isPublic ? filteredCompanies.slice(0, PUBLIC_LIMIT) : filteredCompanies;
  renderRows(display, !isPublic);
  updateResultCount();

  if (isPublic && filteredCompanies.length > PUBLIC_LIMIT) {
    addPublicLimitBanner();
  } else if (!isPublic) {
    removePublicLimitBanner();
  }
}

function updateResultCount() {
  const el = document.getElementById('resultCount');
  if (!el) return;
  const isPublic = !api.isLoggedIn();
  const hasFilter = document.getElementById('searchInput')?.value ||
    activeChips.loc.size > 0 || activeChips.job.size > 0 || activeChips.tag.size > 0;
  const total = totalCompanies || allCompanies.length;
  if (isPublic) {
    const showing = Math.min(filteredCompanies.length, PUBLIC_LIMIT);
    el.textContent = hasFilter
      ? `匹配 ${filteredCompanies.length} 条 · 显示前${showing}条`
      : `共 ${total} 条 · 显示前${showing}条`;
  } else {
    el.textContent = hasFilter
      ? `匹配 ${filteredCompanies.length} 条`
      : `共 ${allCompanies.length} 条`;
  }
}

function addPublicLimitBanner() {
  removePublicLimitBanner();
  const container = document.getElementById('dataRows');
  if (!container) return;
  const total = totalCompanies || filteredCompanies.length;
  const banner = document.createElement('div');
  banner.id = 'publicLimitBanner';
  banner.className = 'banner preview';
  banner.style.marginTop = '12px';
  banner.innerHTML = `🔒 仅显示前${PUBLIC_LIMIT}条 · 还有 <strong>${total - PUBLIC_LIMIT}+ 条</strong> 招聘信息 · <a href="/auth/register.html">免费注册查看全部</a> · <a href="/auth/login.html">已有账号？登录</a>`;
  container.appendChild(banner);
}

function removePublicLimitBanner() {
  const el = document.getElementById('publicLimitBanner');
  if (el) el.remove();
}

// ──── Render Rows ────
function renderRows(companies, isFull = false, append = false) {
  const container = document.getElementById('dataRows');
  if (!container) return;

  if (!append) {
    renderOffset = 0;
    if (companies.length === 0) {
      container.innerHTML = '<div class="no-result">😕 没有匹配的结果，试试调整筛选条件</div>';
      return;
    }
  }

  // Only render a batch
  const batch = companies.slice(renderOffset, renderOffset + RENDER_BATCH);
  const html = batch.map((row, idx) => {
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
      // Full view - all data visible, company name links to detail
      const detailUrl = row.id ? `/auth/company.html?id=${row.id}` : '#';
      const isFav = favoriteIds.has(row.id);
      const starIcon = isFav ? '⭐' : '☆';
      return `
        <div class="row">
          <span class="row-num">${String(row.row_num).padStart(2, '0')}</span>
          <span class="row-left">
            <a class="row-company" href="${detailUrl}" target="_blank" rel="noopener" style="text-decoration:none;color:#0f172a;" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color=''">${escapeHtml(row.company_name)}</a>
            <span class="row-loc">📍${escapeHtml(row.locations)}</span>
            <span class="row-tags">${tagsHtml}</span>
          </span>
          <span class="row-info">
            ${row.target_audience ? `<span class="info-item"><strong>面向：</strong>${escapeHtml(row.target_audience)}</span>` : ''}
            ${row.job_positions ? `<span class="info-item"><strong>岗：</strong>${escapeHtml(row.job_positions)}</span>` : ''}
            ${row.description ? `<span class="info-item">${escapeHtml(row.description)}</span>` : ''}
          </span>
          <span class="row-actions">
            <button class="btn-fav" data-cid="${row.id}" title="${isFav ? '取消收藏' : '收藏'}" style="background:none;border:none;cursor:pointer;font-size:1.2em;padding:2px 6px;">${starIcon}</button>
            ${(row.apply_url && row.apply_url.startsWith('http') && row.apply_url !== row.website_url) ? `<a class="btn-outline" href="${escapeHtml(row.apply_url)}" target="_blank" rel="noopener" onclick="track('click','${escapeHtml(row.company_name)}|投递')">📨 投递</a>` : ''}
            ${(row.website_url && row.website_url.startsWith('http')) ? `<a class="btn-outline" href="${escapeHtml(row.website_url)}" target="_blank" rel="noopener">🏢 ${escapeHtml(row.website_text || '官网')}</a>` : ''}
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
            <a class="btn-locked" href="/auth/login">🔒 登录查看</a>
            ${(row.apply_url && row.apply_url.startsWith('http') && row.apply_url !== row.website_url) ? `<a class="btn-outline" href="${escapeHtml(row.apply_url)}" target="_blank" rel="noopener" onclick="track('click','${escapeHtml(row.company_name)}|投递')">📨 投递</a>` : ''}
            ${(row.website_url && row.website_url.startsWith('http')) ? `<a class="btn-outline" href="${escapeHtml(row.website_url)}" target="_blank" rel="noopener">🏢 ${escapeHtml(row.website_text || '官网')}</a>` : ''}
          </span>
        </div>`;
    }
  }).join('');

  if (append) {
    container.insertAdjacentHTML('beforeend', html);
  } else {
    container.innerHTML = html;
  }

  renderOffset += batch.length;

  // Add "load more" button if there are more results
  const existingBtn = document.getElementById('loadMoreBtn');
  if (existingBtn) existingBtn.remove();

  if (renderOffset < companies.length) {
    const remaining = companies.length - renderOffset;
    const btn = document.createElement('button');
    btn.id = 'loadMoreBtn';
    btn.textContent = '加载更多 (' + remaining + ' 条剩余)';
    btn.style.cssText = 'display:block;width:100%;padding:12px;margin:12px 0;background:#f0f4ff;border:1px solid var(--accent);color:var(--accent);border-radius:8px;cursor:pointer;font-size:.9em;';
    btn.onclick = () => renderRows(companies, isFull, true);
    container.parentNode.insertBefore(btn, container.nextSibling);
  }
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

  // Try cache first
  const cacheKey = 'recruit_data_v2';
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed.ts && (Date.now() - parsed.ts < 300000)) { // 5 min cache
        allCompanies = parsed.data;
        totalCompanies = parsed.total || allCompanies.length;
        buildAllChips(allCompanies);
        filteredCompanies = allCompanies.slice(0, PUBLIC_LIMIT);
        renderRows(filteredCompanies, false);
        updateResultCount();
        addPublicLimitBanner();
        // Refresh in background
        setTimeout(() => refreshCache(), 100);
        return;
      }
    } catch(e) {}
  }

  await refreshCache();
}

async function refreshCache() {
  const rowsContainer = document.getElementById('dataRows');
  // Fetch first PRELOAD_COUNT (200) — enough for search/filter on public page
  // Backend also returns total count so we show accurate numbers
  const result = await api.getCompanies({ limit: PRELOAD_COUNT });
  if (result.success) {
    allCompanies = result.data.companies;
    totalCompanies = result.data.total || allCompanies.length;
    updateLastUpdatedDisplay(result.data.lastUpdated);
    localStorage.setItem('recruit_data_v2', JSON.stringify({ ts: Date.now(), data: allCompanies, total: totalCompanies, lastUpdated: result.data.lastUpdated }));
    buildAllChips(allCompanies);
    filteredCompanies = allCompanies.slice(0, PUBLIC_LIMIT);
    renderRows(filteredCompanies, false);
    updateResultCount();
    addPublicLimitBanner();
  } else if (allCompanies.length === 0) {
    rowsContainer.innerHTML = '<div class=\"no-result\">加载失败：' + result.message + '</div>';
  }
}

async function loadDashboard() {
  if (!api.isLoggedIn()) {
    window.location.href = '/auth/login';
    return;
  }

  // Check subscription status
  const subResult = await api.getSubscriptionStatus();
  let isReadOnly = false;
  if (subResult.success) {
    renderSubscriptionBanner(subResult.data);
    if (!subResult.data.hasAccess && subResult.data.status !== 'none') {
      // Expired but had subscription → read-only mode (don't redirect)
      isReadOnly = true;
    } else if (!subResult.data.hasAccess && subResult.data.status === 'none') {
      // Never subscribed → redirect to payment
      window.location.href = '/auth/payment';
      return;
    }
  }

  // Load full data
  const rowsContainer = document.getElementById('dataRows');
  if (!rowsContainer) return;
  rowsContainer.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>加载中...</p></div>';

  // Try cache
  const cacheKey = 'recruit_full_v2';
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed.ts && (Date.now() - parsed.ts < 120000)) { // 2 min cache
        allCompanies = parsed.data;
        updateLastUpdatedDisplay(parsed.lastUpdated);
        filteredCompanies = [...allCompanies];
        buildAllChips(allCompanies);
        renderRows(filteredCompanies, true);
        updateResultCount();
        loadFavoriteIds();
      }
    } catch(e) {}
  }

  const result = await api.getCompaniesFull();
  if (result.success) {
    allCompanies = result.data.companies;
    updateLastUpdatedDisplay(result.data.lastUpdated);
    localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: allCompanies, lastUpdated: result.data.lastUpdated }));
    filteredCompanies = [...allCompanies];
    buildAllChips(allCompanies);
    renderRows(filteredCompanies, true);
    updateResultCount();
    loadFavoriteIds();
    if (result.data.readOnly) {
      disableSearchForReadOnly();
    }
  } else if (result.code === 'SUBSCRIPTION_REQUIRED') {
    window.location.href = '/auth/payment';
  } else {
    rowsContainer.innerHTML = `<div class="no-result">加载失败：${result.message}</div>`;
  }
}

function disableSearchForReadOnly() {
  var input = document.getElementById('searchInput');
  if (input) {
    input.disabled = true;
    input.placeholder = '🔒 订阅已过期，续费后恢复搜索';
    input.style.cursor = 'not-allowed';
    input.style.opacity = '0.6';
  }
  // Disable chips
  document.querySelectorAll('.search-chip').forEach(function(c) { c.style.pointerEvents = 'none'; c.style.opacity = '0.5'; });
}

function renderSubscriptionBanner(sub) {
  const bannerEl = document.getElementById('subBanner');
  if (!bannerEl) return;

  if (sub.status === 'trial') {
    bannerEl.innerHTML = `<div class="banner trial">🎁 免费试用中 · ${sub.remaining} · <a href="/auth/payment">立即订阅（¥9.90/3个月）</a></div>`;
  } else if (sub.status === 'active') {
    bannerEl.innerHTML = `<div class="banner active">✅ 订阅有效 · ${sub.remaining} · <a href="/auth/payment">续费叠加</a></div>`;
  } else if (sub.status === 'trial_expired') {
    bannerEl.innerHTML = `<div class="banner expired">⏰ 免费试用已过期 · 当前<strong>只读模式</strong>，仅可浏览企业名称 · <a href="/auth/payment">立即订阅 ¥9.90/3个月</a> 恢复全部功能</div>`;
  } else if (sub.status === 'expired') {
    bannerEl.innerHTML = `<div class="banner expired">⏰ 订阅已过期 · 当前<strong>只读模式</strong>，仅可浏览企业名称 · <a href="/auth/payment">续费 ¥9.90/3个月</a> 恢复全部功能</div>`;
  } else {
    bannerEl.innerHTML = `<div class="banner preview">👋 新用户注册即享<strong>3天免费试用</strong> · <a href="/auth/register">免费注册</a></div>`;
  }
}

async function loadPaymentPage() {
  if (!api.isLoggedIn()) {
    window.location.href = '/auth/login';
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
  // Check if already authenticated via sessionStorage
  var password = sessionStorage.getItem('admin_password');
  if (!password) {
    window.location.href = '/auth/admin-login.html';
    return;
  }

  // Check access
  const statsResult = await api.adminGetStats(password);
  if (!statsResult || !statsResult.success) {
    sessionStorage.removeItem('admin_password');
    window.location.href = '/auth/admin-login.html';
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

// ──── Back to Top ────
function initBackToTop() {
  // Create button if it doesn't exist
  if (document.getElementById('backToTopBtn')) return;
  const btn = document.createElement('button');
  btn.id = 'backToTopBtn';
  btn.innerHTML = '↑';
  btn.title = '返回顶部';
  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  document.body.appendChild(btn);

  let scrollTicking = false;
  window.addEventListener('scroll', () => {
    if (!scrollTicking) {
      requestAnimationFrame(() => {
        const show = window.scrollY > 600;
        btn.classList.toggle('show', show);
        scrollTicking = false;
      });
      scrollTicking = true;
    }
  }, { passive: true });
}

function updateFavCount(count) {
  const badge = document.getElementById('favCount');
  if (badge) {
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline' : 'none';
  }
}

// Export for page-specific use
window.api = api;
window.loadPendingPayments = loadPendingPayments;
