/* 信箱 · 本地邮件客户端 —— 前端逻辑 */
'use strict';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

const state = {
  accounts: [],
  providers: [],
  provider: 'custom',
  activeId: localStorage.getItem('mailbox.activeAccount') || null,
  folders: [],
  folder: 'INBOX',
  messages: [],
  total: 0,
  page: 1,
  pageSize: 30,
  query: '',
  filter: 'all',
  selectedUid: null,
  totalPages: 1,
  message: null,
  serverInfo: null,
  compose: { mode: 'new', original: null, attachments: [] },
  accountMode: 'create',
  editingId: null,
  editEmail: '',
  provider: 'custom',
  providerKey: 'custom',
  providerOptions: [],
  loadingList: false,
  settings: {
    imagePolicy: 'block',
    closeAction: 'tray',
    trayEnabled: true,
    notifyEnabled: true,
    notifySound: true,
    notifyDesktop: true,
    pollInterval: 120,
  },
  settingsStatus: null,
  settingsError: null,
};

/** 单封邮件的图片放行状态（临时，不写回设置） */
let imageOverride = null;

/** 代理端口是否仍是自动填入的值（用于切换协议时安全地更新默认端口） */
let lastAutoPort = '';

/* ---------------- 基础工具 ---------------- */

async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* 空响应 */
  }
  if (!res.ok) throw new Error(data?.error || `请求失败（${res.status}）`);
  return data;
}

function toast(msg, type = '') {
  const t = el('div', `toast ${type}`, escapeHtml(msg));
  $('#toastWrap').appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .25s, transform .25s';
    t.style.opacity = '0';
    t.style.transform = 'translateY(6px)';
    setTimeout(() => t.remove(), 260);
  }, type === 'error' ? 5200 : 2800);
}

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function initials(name = '', email = '') {
  const src = (name || email || '?').trim();
  if (/[\u4e00-\u9fa5]/.test(src)) return src.slice(-2);
  const parts = src.split(/[\s.@_-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function colorOf(str = '') {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return `linear-gradient(140deg, hsl(${h} 62% 62%), hsl(${(h + 28) % 360} 58% 50%))`;
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const pad = (n) => String(n).padStart(2, '0');
  if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

function fmtFull(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${week} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function addrText(list) {
  return (list || []).map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', ');
}

function activeAccount() {
  return state.accounts.find((a) => a.id === state.activeId) || null;
}

/* ---------------- 账号 ---------------- */

async function loadAccounts() {
  const { accounts } = await api('/accounts');
  state.accounts = accounts;
  if (!accounts.find((a) => a.id === state.activeId)) {
    state.activeId = accounts[0]?.id || null;
    if (state.activeId) localStorage.setItem('mailbox.activeAccount', state.activeId);
  }
  renderAccounts();
}

function renderAccounts() {
  const box = $('#accountList');
  box.innerHTML = '';
  if (!state.accounts.length) {
    box.appendChild(el('div', 'empty-state', '<p style="font-size:12px">还没有账号</p>'));
    return;
  }
  for (const acc of state.accounts) {
    const item = el('button', 'account-item' + (acc.id === state.activeId ? ' active' : ''));
    item.style.border = '1px solid transparent';
    item.innerHTML = `
      <span class="avatar" style="background:${colorOf(acc.email)}">${escapeHtml(initials(acc.name, acc.email))}</span>
      <span class="account-meta">
        <b>${escapeHtml(acc.name || acc.email)}</b>
        <span>${escapeHtml(acc.email)}</span>
      </span>
      <span class="acct-actions">
        <span class="mini" data-edit="${acc.id}" title="账号设置">⚙</span>
        <span class="mini del" data-del="${acc.id}" title="移除账号">✕</span>
      </span>`;
    item.onclick = (e) => {
      if (e.target.closest('[data-del]') || e.target.closest('[data-edit]')) return;
      if (acc.id === state.activeId) return;
      switchAccount(acc.id);
    };
    item.querySelector('[data-edit]').onclick = (e) => {
      e.stopPropagation();
      openAccountModal('edit', acc);
    };
    item.querySelector('[data-del]').onclick = (e) => {
      e.stopPropagation();
      deleteAccount(acc);
    };
    box.appendChild(item);
  }
}

async function deleteAccount(acc) {
  if (!confirm(`移除账号 ${acc.email}？\n仅删除本机保存的登录信息，不会影响邮箱里的邮件。`)) return;
  await api(`/accounts/${acc.id}`, { method: 'DELETE' });
  toast('已移除账号');
  const wasActive = acc.id === state.activeId;
  if (wasActive) {
    state.activeId = null;
    state.folders = [];
    state.messages = [];
    state.message = null;
    state.total = 0;
  }
  await loadAccounts();
  if (state.activeId) await bootAccount();
  else {
    renderFolders([]);
    renderMessages([]);
    showWelcome();
  }
}

async function switchAccount(id) {
  state.activeId = id;
  localStorage.setItem('mailbox.activeAccount', id);
  renderAccounts();
  await bootAccount();
}

function showWelcome() {
  $('#reader').innerHTML = `
    <div class="welcome" id="welcome">
      <div class="welcome-art">✉️</div>
      <h1>一个邮箱，一处收拢</h1>
      <p>添加 QQ、163、Gmail、Outlook 等任意支持 IMAP 的邮箱，<br>所有邮件都留在这台电脑上。</p>
      <button class="primary-btn" id="welcomeAdd">添加第一个邮箱账号</button>
      <div class="welcome-tips"><span>🔒 授权码本地加密存储</span><span>🌐 邮件直连服务器</span><span>📎 支持附件收发</span></div>
    </div>`;
  $('#welcomeAdd').onclick = () => openAccountModal();
  state.message = null;
  syncReaderTools();
}

function showIdleReader() {
  const acc = activeAccount();
  if (!acc) return showWelcome();
  const unread = state.folders.reduce((n, f) => n + (f.unseen || 0), 0);
  $('#reader').innerHTML = `
    <div class="welcome">
      <div class="welcome-art">📬</div>
      <h1>${unread ? `还有 ${unread} 封未读` : '邮件都读完啦'}</h1>
      <p>在左边选个文件夹，再点任意一封邮件开始阅读。<br>
      按 <kbd>C</kbd> 写邮件，<kbd>R</kbd> 刷新列表。</p>
      <div class="welcome-tips"><span>${escapeHtml(acc.email)}</span><span>${state.total} 封邮件</span></div>
    </div>`;
  state.message = null;
  syncReaderTools();
}

async function bootAccount() {
  const acc = activeAccount();
  if (!acc) {
    renderFolders([]);
    renderMessages([]);
    showWelcome();
    return;
  }
  $('#reader').innerHTML = `<div class="welcome"><div class="spinner"></div><p>正在连接 ${escapeHtml(acc.email)} …</p></div>`;
  try {
    await loadFolders();
    const inbox = state.folders.find((f) => f.path === 'INBOX') || state.folders[0];
    state.folder = inbox ? inbox.path : 'INBOX';
    // 换账号时把搜索条件清掉，免得上一个账号的关键词套到新账号上
    state.query = '';
    state.page = 1;
    const searchBox = $('#searchInput');
    if (searchBox) searchBox.value = '';
    renderFolders(state.folders);
    state.selectedUid = null;
    await loadMessages();
    showIdleReader();
  } catch (err) {
    $('#reader').innerHTML = `<div class="welcome"><div class="welcome-art">😕</div><h1>连接失败</h1><p>${escapeHtml(err.message)}</p>
      <button class="primary-btn" onclick="openAccountModal()">换个账号 / 修改配置</button></div>`;
    toast(err.message, 'error');
  }
}

/* ---------------- 文件夹 ---------------- */

async function loadFolders(fresh = false) {
  const { folders } = await api(`/accounts/${state.activeId}/folders${fresh ? '?refresh=1' : ''}`);
  state.folders = folders;
  return folders;
}

const FOLDER_ICONS = {
  '\\Inbox': '📥',
  '\\Sent': '📤',
  '\\Drafts': '📝',
  '\\Junk': '🚫',
  '\\Trash': '🗑',
  '\\Archive': '🗂',
  '\\All': '📚',
  '\\Flagged': '⭐',
};

/** 部分服务商（163）把收件箱直接叫 INBOX，界面上统一显示成中文 */
function folderLabel(folder) {
  if (!folder) return '';
  if (folder.path === 'INBOX' || folder.specialUse === '\\Inbox') return '收件箱';
  return folder.name || folder.path;
}

function renderFolders(folders) {
  const box = $('#folders');
  box.innerHTML = '';
  if (!folders.length) {
    box.appendChild(el('div', '', '<p style="font-size:12px;color:var(--muted);padding:6px 9px">暂无文件夹</p>'));
    return;
  }
  for (const f of folders) {
    if (!f.selectable) continue;
    const b = el('button', 'folder' + (f.path === state.folder ? ' active' : ''));
    const icon = FOLDER_ICONS[f.specialUse] || (f.path === 'INBOX' ? '📥' : '📁');
    b.innerHTML = `<span class="f-ico">${icon}</span><span class="f-name">${escapeHtml(folderLabel(f))}</span>
      ${f.unseen ? `<span class="badge">${f.unseen > 99 ? '99+' : f.unseen}</span>` : ''}`;
    b.onclick = () => {
      if (state.folder === f.path) return;
      state.folder = f.path;
      state.page = 1;
      state.query = '';
      state.filter = 'all';
      document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c.dataset.filter === 'all'));
      $('#searchInput').value = '';
      renderFolders(state.folders);
      loadMessages();
    };
    box.appendChild(b);
  }
}

/* ---------------- 邮件列表 ---------------- */

/** 列表请求序号：快速输入 / 静默刷新时，只认最后一次请求的结果 */
let listReqSeq = 0;

async function loadMessages(fresh = false, { silent = false } = {}) {
  if (!state.activeId) return;
  const seq = ++listReqSeq;
  state.loadingList = true;
  const list = $('#msgList');
  if (!silent) {
    list.innerHTML = `<div class="empty-state"><div class="spinner"></div><p>${state.query ? '正在搜索…' : '加载中…'}</p></div>`;
  }
  try {
    const qs = new URLSearchParams({
      folder: state.folder,
      page: String(state.page),
      pageSize: String(state.pageSize),
    });
    if (state.query) qs.set('q', state.query);
    if (fresh) qs.set('refresh', '1');
    const data = await api(`/accounts/${state.activeId}/messages?${qs}`);
    // 期间用户又输入/翻了页，这次结果已经过期，丢掉
    if (seq !== listReqSeq) return;
    state.messages = data.messages;
    state.total = data.total;
    state.serverInfo = data.server || null;
    renderMessages();
    renderPager();
    // 后台还在扫历史邮件：稍后再拉一次，结果会随索引补全而变多
    if (data.server?.indexPending && state.page === 1) scheduleSearchRefresh();
  } catch (err) {
    if (seq !== listReqSeq) return;
    if (!silent) {
      list.innerHTML = `<div class="empty-state"><div class="big">😕</div><p>${escapeHtml(err.message)}</p>
      <button class="ghost-btn tiny" onclick="loadMessages()">重试</button></div>`;
    }
  } finally {
    if (seq === listReqSeq) state.loadingList = false;
  }
}

/** 后台还在补索引时，隔一会儿把当前搜索结果再拉一次（静默，不闪列表） */
let searchPollTimer = null;
function scheduleSearchRefresh() {
  clearTimeout(searchPollTimer);
  searchPollTimer = setTimeout(() => {
    if (state.loadingList) return scheduleSearchRefresh();
    if (!state.query || state.page !== 1) return;
    if ($('#searchInput').value.trim() !== state.query) return;
    loadMessages(false, { silent: true });
  }, 1300);
}

function visibleMessages() {
  let list = state.messages;
  if (state.filter === 'unread') list = list.filter((m) => m.unread);
  else if (state.filter === 'flagged') list = list.filter((m) => m.flagged);
  else if (state.filter === 'todo') list = list.filter((m) => m.todo);
  // 置顶的排在最前面；sort 是稳定的，其余保持服务端给的「新→旧」顺序
  return list.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
}

function renderMessages() {
  const list = $('#msgList');
  const folder = state.folders.find((f) => f.path === state.folder);
  $('#folderTitle').textContent = folderLabel(folder) || state.folder;
  const info = state.serverInfo;
  const pending = state.query && info?.indexPending;
  $('#listCount').textContent = state.query
    ? `搜索“${state.query}” · ${state.total} 封`
    : state.total
    ? `共 ${state.total} 封`
    : '';
  $('#listCount').title = pending
    ? `已扫描 ${info.scanned} / ${info.total} 封，仍在后台检索更早的邮件`
    : '';
  // 索引还在补的时候用一条细进度条提示，而不是把列表整块换成转圈
  const lp = $('#listProgress');
  lp.hidden = !pending;
  if (pending) $('#listProgressText').textContent = `正在检索更早的邮件 ${info.scanned} / ${info.total}`;
  renderSyncWarn(folder);

  const items = visibleMessages();
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = `<div class="empty-state"><div class="big">${state.query ? '🔍' : '🍃'}</div>
      <p>${state.query ? '没有找到匹配的邮件' : state.filter !== 'all' ? '这个筛选下暂时没有邮件' : '这个文件夹是空的'}</p></div>`;
    return;
  }

  for (const m of items) {
    const node = el('div', 'msg-item' + (m.uid === state.selectedUid ? ' selected' : '') + (m.unread ? ' unread' : ''));
    node.dataset.uid = m.uid;
    if (m.pinned) node.classList.add('pinned');
    const name = m.fromName || m.fromAddress || '(未知发件人)';
    node.innerHTML = `
      <span class="avatar" style="background:${colorOf(m.fromAddress || name)}">${escapeHtml(initials(m.fromName, m.fromAddress))}</span>
      <div class="m-body">
        <div class="m-top">
          ${m.pinned ? '<span class="m-pin" title="已置顶">📌</span>' : ''}
          <span class="m-from">${escapeHtml(name)}</span>
          ${m.flagged ? '<span class="m-star">★</span>' : ''}
          <span class="m-date">${fmtDate(m.date)}</span>
        </div>
        <div class="m-subject">${escapeHtml(m.subject)}</div>
        ${m.note ? `<div class="m-note" title="${escapeHtml(m.note)}">📝 ${escapeHtml(m.note)}</div>` : ''}
        <div class="m-tags">
          ${m.hasAttachments ? '<span class="m-tag att">📎 附件</span>' : ''}
          ${m.todo ? '<span class="m-tag todo">☑ 待办</span>' : ''}
          ${m.unread ? '<span class="m-tag">未读</span>' : ''}
        </div>
      </div>`;
    node.onclick = () => openMessage(m);
    node.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openCtxMenu(e.clientX, e.clientY, m);
    };
    list.appendChild(node);
  }
}

/**
 * 邮件数与预期不一致时的提示。
 *
 * 实测结论：163（Coremail）会在 IMAP 会话建立时对邮箱状态做快照。
 * 用户在网页端改了「收取范围」之后，旧会话仍然返回旧数字
 * （网页 393 封、这里 6 封），并不是客户端读错了。
 * 所以主操作是「重新连接」——丢掉旧会话重新握手，而不是让用户反复改设置。
 */
const LIMITED_PROVIDERS = new Set(['163', '126', 'yeah', 'qq', 'qq-exmail', 'sina']);

async function hardRefresh() {
  // 第一次带上 refresh 即完成重新握手，后面复用这条新连接就够了
  await loadFolders(true);
  renderFolders(state.folders);
  await loadMessages();
}

function renderSyncWarn(folder) {
  const box = $('#syncWarn');
  if (!box) return;
  const reported = folder?.messages || 0;
  const readable = state.total || 0;
  const acc = activeAccount();

  if (state.query) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }

  const makeReconnectBtn = (label = '重新连接并刷新') => {
    const btn = el('button', '', label);
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = '重连中…';
      try {
        await hardRefresh();
        toast('已重新连接');
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
        btn.textContent = '重试';
      }
    };
    return btn;
  };

  // 情况一：服务器自己报的总数比能读到的多 —— 会话视图陈旧
  if (reported > readable) {
    box.hidden = false;
    box.className = 'sync-warn';
    box.innerHTML = `<b>这个文件夹共有 ${reported} 封，当前会话只读到 ${readable} 封。</b><br>
      很可能是 IMAP 会话还停在旧状态。点右侧重新握手通常会恢复；若仍不变，再到网页版「设置 → POP3/SMTP/IMAP」确认收取范围是<b>全部邮件</b>。`;
    box.appendChild(makeReconnectBtn());
    return;
  }

  // 情况二：网易 / QQ 这类服务商，能读到的邮件少得可疑
  const dismissKey = `mailbox.syncHint.${state.activeId}.${state.folder}`;
  if (LIMITED_PROVIDERS.has(acc?.provider) && readable > 0 && readable < 30 && !sessionStorage.getItem(dismissKey)) {
    box.hidden = false;
    box.className = 'sync-warn info';
    box.innerHTML = `只读到 ${readable} 封。如果网页版的邮件明显更多，可能是 IMAP 会话没有刷新，或服务端的收取范围仍是「最近 30 天」。`;
    box.appendChild(makeReconnectBtn('重新连接试试'));
    const close = el('button', 'ghost-inline', '忽略');
    close.onclick = () => {
      sessionStorage.setItem(dismissKey, '1');
      box.hidden = true;
    };
    box.appendChild(close);
    return;
  }

  box.hidden = true;
  box.innerHTML = '';
}

function renderPager() {
  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
  state.totalPages = totalPages;
  const input = $('#pageInput');
  // 正在输入时不要去覆盖用户敲的数字
  if (document.activeElement !== input) input.value = String(state.page);
  $('#pageTotal').textContent = String(totalPages);
  $('#prevPage').disabled = state.page <= 1;
  $('#nextPage').disabled = state.page >= totalPages;
}

/** 跳到指定页（越界会夹到 1 ~ 总页数） */
function goToPage(n) {
  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
  const p = Math.min(Math.max(Math.round(Number(n)) || 1, 1), totalPages);
  if (p === state.page) {
    $('#pageInput').value = String(p);
    return;
  }
  state.page = p;
  loadMessages();
  $('#msgList').scrollTop = 0;
}

function commitPageInput() {
  const input = $('#pageInput');
  const raw = input.value.trim();
  input.classList.remove('invalid');
  if (!raw) {
    input.value = String(state.page);
    return;
  }
  const n = Number(raw);
  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
  if (!Number.isInteger(n) || n < 1 || n > totalPages) {
    input.classList.add('invalid');
    input.value = String(state.page);
    toast(`页码需要在 1 ~ ${totalPages} 之间`, 'error');
    return;
  }
  goToPage(n);
}

/* ---------------- 三栏布局：拖动分隔条 / 收起阅读区 / 独立窗口 ---------------- */

const LAYOUT_KEY = 'ikuyoMail.layout';
const LAYOUT_DEFAULT = { sb: 264, list: 384, readerOpen: true };
const SB_MIN = 190, SB_MAX = 460;
/** 列表最小宽度：低于 340 时时间列和工具栏按钮就会开始被裁（与 styles.css 的 --list-min 一致） */
const LIST_MIN = 340, LIST_MAX = 720;
/** 右侧阅读区最小宽度：再小正文就没法读了（与 styles.css 的 --reader-min 一致） */
const READER_MIN = 440;
/** 两条分隔条的宽度（styles.css 里 --split-w） */
const SPLIT_W = 6;

/** 本页是不是「独立阅读窗口」 */
const READER_PANE = new URLSearchParams(location.search).get('pane') === 'reader';

const layout = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}');
    return {
      sb: Number(raw.sb) || LAYOUT_DEFAULT.sb,
      list: Number(raw.list) || LAYOUT_DEFAULT.list,
      readerOpen: raw.readerOpen !== false,
    };
  } catch {
    return { ...LAYOUT_DEFAULT };
  }
})();

/** 实际画到页面上的宽度（窗口不够宽时会临时比 layout 里的偏好值窄） */
let eff = { sb: LAYOUT_DEFAULT.sb, list: LAYOUT_DEFAULT.list };

function saveLayout() {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    /* 隐私模式下 localStorage 可能不可写，忽略 */
  }
}

/** 主界面可用宽度。用视口而不是 .app，因为 .app 有 min-width，被撑大后测不准 */
function paneRoom() {
  const w = document.documentElement.clientWidth || window.innerWidth;
  return Math.max(320, w);
}

/**
 * 窗口变窄时按顺序让位：先缩账号栏，账号栏到最小再缩列表，最后才缩阅读区。
 * 三块都到下限之后窗口就放不下了 —— 这时 .app 的 min-width 会把页面撑住，
 * 多出来的宽度交给横向滚动，绝不把哪一块压到看不清。
 * 这里只算「显示值」，不动 layout 里用户拖出来的偏好值 —— 窗口拉回去会自动恢复。
 */
function computeEffective() {
  let sb = layout.sb;
  let list = layout.list;
  const room = paneRoom();
  if (layout.readerOpen) {
    // 阅读区是 1fr，自己会吃掉剩余空间；不够时按 账号栏 → 列表 的顺序退回各自的偏好值
    let over = sb + list + SPLIT_W * 2 + READER_MIN - room;
    if (over > 0) {
      const cutSb = Math.min(over, sb - SB_MIN);
      sb -= cutSb;
      over -= cutSb;
      const cutList = Math.min(over, list - LIST_MIN);
      list -= cutList;
      over -= cutList;
    }
  } else {
    // 只剩两栏：列表是 1fr 会自己撑满，只要保证账号栏别把列表挤到最小宽度以下
    const need = sb + SPLIT_W + LIST_MIN;
    if (need > room) sb = Math.max(SB_MIN, sb - (need - room));
  }
  return { sb: Math.round(sb), list: Math.round(list) };
}

function applyLayout() {
  eff = computeEffective();
  const root = document.documentElement.style;
  root.setProperty('--sb-w', `${eff.sb}px`);
  root.setProperty('--list-w', `${eff.list}px`);
  const app = document.querySelector('.app');
  const narrow = paneRoom() < uiNeedWidth();
  if (app) {
    app.classList.toggle('no-reader', !layout.readerOpen);
    // 窗口比「三块最窄之和」还窄：页面没法把窗口撑回去，只能提示 + 给个缩小下限的出口
    app.classList.toggle('too-narrow', narrow);
  }
  // 提示条挂在 .app 外面（body 上），所以同时标到 <html> 上
  document.documentElement.classList.toggle('too-narrow', narrow);
  const hintBtn = $('#narrowCollapse');
  if (hintBtn) hintBtn.hidden = !layout.readerOpen;
  reportMinWidth();
}

/* 把「三块都到最小要多少像素」告诉桌面外壳：
   assets/shell.ps1 拿到这个值后就不会让窗口拖得比它更窄，
   于是不会再出现「窗口缩过头、右边内容跑到视口外面」的情况。 */
let lastMinReport = 0;
let minReportTimer = 0;

function uiNeedWidth() {
  return layout.readerOpen
    ? SB_MIN + LIST_MIN + SPLIT_W * 2 + READER_MIN // 账号栏 + 列表 + 阅读区
    : SB_MIN + SPLIT_W + LIST_MIN; // 只剩账号栏 + 列表
}

function uiMinWidth() {
  const need = uiNeedWidth();
  // 窗口外框比页面可视区宽的那点边框/阴影也算进去
  const chrome = Math.min(40, Math.max(0, window.outerWidth - document.documentElement.clientWidth));
  return Math.round(need + chrome);
}

function reportMinWidth() {
  if (READER_PANE) return; // 独立阅读窗口不参与
  const w = uiMinWidth();
  if (w === lastMinReport) return;
  lastMinReport = w;
  clearTimeout(minReportTimer);
  minReportTimer = setTimeout(() => {
    fetch('/api/ui/min-width', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ width: w }),
    }).catch(() => {});
  }, 250);
}

const clampSb = (v) => {
  const room = paneRoom() - eff.list - (layout.readerOpen ? READER_MIN + SPLIT_W * 2 : SPLIT_W);
  return Math.round(Math.max(SB_MIN, Math.min(v, Math.min(SB_MAX, Math.max(SB_MIN, room)))));
};
const clampList = (v) => {
  const room = paneRoom() - eff.sb - (layout.readerOpen ? READER_MIN + SPLIT_W * 2 : SPLIT_W);
  return Math.round(Math.max(LIST_MIN, Math.min(v, Math.min(LIST_MAX, Math.max(LIST_MIN, room)))));
};

/** 阅读区工具按钮的状态：弹窗开着时高亮 */
function syncReaderTools() {
  const pop = $('#popoutBtn');
  if (!pop) return;
  pop.classList.toggle('active', !!(readerWin && !readerWin.closed));
}

function setupSplitters() {
  const bind = (node, key, limit) => {
    if (!node) return;
    let startX = 0;
    let startW = 0;
    let dragging = false;

    node.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      startW = eff[key];
      node.classList.add('resizing');
      document.body.classList.add('resizing');
      try {
        node.setPointerCapture(e.pointerId);
      } catch {
        /* 老浏览器忽略 */
      }
    });

    node.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const next = limit(startW + (e.clientX - startX));
      if (next === eff[key]) return;
      layout[key] = next;
      applyLayout();
    });

    const stop = (e) => {
      if (!dragging) return;
      dragging = false;
      node.classList.remove('resizing');
      document.body.classList.remove('resizing');
      saveLayout();
      try {
        node.releasePointerCapture(e.pointerId);
      } catch {
        /* 已释放 */
      }
    };
    node.addEventListener('pointerup', stop);
    node.addEventListener('pointercancel', stop);

    // 双击回到默认宽度，键盘左右方向键微调
    node.addEventListener('dblclick', () => {
      layout[key] = LAYOUT_DEFAULT[key];
      applyLayout();
      saveLayout();
      toast(key === 'sb' ? '侧栏宽度已恢复默认' : '列表宽度已恢复默认');
    });
    node.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const step = e.shiftKey ? 48 : 12;
      layout[key] = limit(layout[key] + (e.key === 'ArrowRight' ? step : -step));
      applyLayout();
      saveLayout();
    });
  };

  bind($('#splitSide'), 'sb', clampSb);
  bind($('#splitList'), 'list', clampList);

  // 窗口宽度变了就重算三栏：窄时自动让位给阅读区，宽回来再恢复用户拖出来的偏好值
  let raf = 0;
  window.addEventListener('resize', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      applyLayout();
    });
  });
}

/** 收起 / 展开阅读区（收起后列表自动占满右侧） */
function setReaderOpen(open, { persist = true } = {}) {
  layout.readerOpen = open;
  applyLayout();
  if (persist) saveLayout();
  if (open) {
    // 重新显示时让正文 iframe 重新算一次高度
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }
}

function toggleReader() {
  if (readerWin && !readerWin.closed) {
    readerWin.close();
    return;
  }
  setReaderOpen(!layout.readerOpen);
}

/* ---- 邮件独立窗口 ---- */

let readerWin = null;
let readerWinTimer = null;
/** 弹窗里最后看的是哪封，关窗后主界面回到这封 */
let lastReaderRef = null;

function syncReaderWin(payload) {
  if (!readerWin || readerWin.closed) return false;
  try {
    readerWin.postMessage({ source: 'ikuyoMail-main', ...payload }, location.origin);
    return true;
  } catch {
    return false;
  }
}

function openReaderWindow() {
  if (!state.message) {
    toast('先打开一封邮件再弹出窗口', 'error');
    return;
  }
  if (readerWin && !readerWin.closed) {
    readerWin.focus();
    return;
  }
  const qs = new URLSearchParams({
    pane: 'reader',
    acc: state.activeId,
    folder: state.folder,
    uid: String(state.message.uid),
  });
  const w = Math.min(980, Math.max(560, window.outerWidth - 320));
  const h = Math.min(1000, Math.max(560, window.outerHeight - 120));
  const left = Math.max(0, window.screenX + Math.round((window.outerWidth - w) / 2));
  const top = Math.max(0, window.screenY + 40);
  lastReaderRef = { acc: state.activeId, folder: state.folder, uid: state.message.uid };

  readerWin = window.open(
    `${location.pathname}?${qs}`,
    'ikuyoMailReader',
    `popup=yes,width=${w},height=${h},left=${left},top=${top}`
  );
  if (!readerWin) {
    toast('浏览器拦截了弹出窗口，请允许本站弹出窗口后重试', 'error');
    return;
  }
  setReaderOpen(false);
  $('#popoutBtn').classList.add('active');
  $('#popoutBar').hidden = false;
  toast('邮件已弹出到独立窗口');

  clearInterval(readerWinTimer);
  readerWinTimer = setInterval(() => {
    if (readerWin && !readerWin.closed) return;
    clearInterval(readerWinTimer);
    readerWinTimer = null;
    readerWin = null;
    $('#popoutBtn').classList.remove('active');
    $('#popoutBar').hidden = true;
    setReaderOpen(true);
    // 回到主界面，并把弹窗里最后看的那封带回来
    if (lastReaderRef && lastReaderRef.acc === state.activeId) {
      state.folder = lastReaderRef.folder;
      openMessage({ uid: lastReaderRef.uid });
    } else if (state.message) {
      renderReader(state.message);
    }
  }, 600);
}

window.addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  const d = e.data || {};
  if (d.source !== 'ikuyoMail-reader') return;
  if (d.type === 'shown' && READER_PANE === false) {
    lastReaderRef = { acc: d.acc, folder: d.folder, uid: d.uid };
  }
});

/* ---------------- 邮件详情 ---------------- */

async function openMessage(item) {
  state.selectedUid = item.uid;
  imageOverride = null; // 换一封邮件就回到设置里的默认策略
  document.querySelectorAll('.msg-item').forEach((n) => n.classList.toggle('selected', Number(n.dataset.uid) === item.uid));

  // 阅读区在独立窗口里：直接把邮件推过去，主界面保持「只有两栏」的清爽样子
  if (syncReaderWin({ type: 'open', acc: state.activeId, folder: state.folder, uid: item.uid })) {
    lastReaderRef = { acc: state.activeId, folder: state.folder, uid: item.uid };
    return;
  }

  // 阅读区被收起了：点邮件时自动展开，否则点了看不到内容
  if (!layout.readerOpen) setReaderOpen(true);

  const reader = $('#reader');
  reader.innerHTML = `<div class="welcome"><div class="spinner"></div><p>正在打开邮件…</p></div>`;

  try {
    const qs = new URLSearchParams({ folder: state.folder, uid: String(item.uid), markRead: '1' });
    const { message } = await api(`/accounts/${state.activeId}/message?${qs}`);
    // 备注/待办/置顶只存在本地列表里，详情接口没有，这里补上
    const listRow = state.messages.find((m) => m.uid === item.uid);
    if (listRow) {
      message.note = listRow.note || '';
      message.pinned = !!listRow.pinned;
      message.todo = !!listRow.todo;
      message.flagged = message.flagged || !!listRow.flagged;
    } else {
      message.note = '';
    }
    state.message = message;
    renderReader(message);
    // 列表里同步已读状态
    const row = state.messages.find((m) => m.uid === item.uid);
    if (row && row.unread) {
      row.unread = false;
      renderMessages();
      const folder = state.folders.find((f) => f.path === state.folder);
      if (folder && folder.unseen > 0) {
        folder.unseen -= 1;
        renderFolders(state.folders);
      }
    }
  } catch (err) {
    reader.innerHTML = `<div class="welcome"><div class="welcome-art">😕</div><h1>打不开这封邮件</h1><p>${escapeHtml(err.message)}</p>
      <button class="ghost-btn" onclick="loadMessages()">返回列表</button></div>`;
  }
}

function renderReader(msg) {
  const reader = $('#reader');
  const from = msg.from[0] || { name: '', address: '' };
  const displayFrom = from.name || from.address;
  const hasRemoteImg = /<img[^>]+src=["'](https?:)?\/\//i.test(msg.html || '');
  const allowImages = imageOverride === null ? state.settings.imagePolicy === 'allow' : imageOverride;
  const attachments = (msg.attachments || []).filter((a) => !a.inline || a.size > 60000);
  const imgBar = !hasRemoteImg
    ? ''
    : allowImages
      ? `<div class="img-bar allowed" id="imgBar"><span>外部图片已显示</span><button id="showImgs">隐藏图片</button></div>`
      : `<div class="img-bar" id="imgBar"><span>为保护隐私，外部图片已被拦截</span><button id="showImgs">显示图片</button>${
          state.settings.imagePolicy === 'block' ? '<button id="allowAlways">以后都显示</button>' : ''
        }</div>`;

  // 「收起阅读区」就长在阅读区自己身上，不再靠列表工具栏那个箭头
  const collapseHtml = READER_PANE
    ? ''
    : `<button class="action-btn collapse-btn" id="readerCollapseBtn" title="收起阅读区（F9），只留账号栏和列表">
        <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
          <path d="M8.5 5.5 15 12l-6.5 6.5" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M19 4.5v15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>收起</button>`;

  reader.innerHTML = `
    <div class="reader-head">
      <div class="reader-actions">
        <button class="action-btn back-btn" id="backBtn">← 返回</button>
        <button class="action-btn" id="replyBtn">↩ 回复</button>
        <button class="action-btn" id="forwardBtn">↪ 转发</button>
        <button class="action-btn ${msg.flagged ? 'starred' : ''}" id="starBtn">${msg.flagged ? '★ 已星标' : '☆ 星标'}</button>
        <button class="action-btn" id="unreadBtn">✉ 标为未读</button>
        <button class="action-btn" id="popoutBtn" title="把这封邮件放到独立窗口里阅读">⧉ 独立窗口</button>
        <span class="spacer"></span>
        ${collapseHtml}
        <button class="action-btn danger" id="deleteBtn">🗑 删除</button>
      </div>
      <h1 class="reader-subject">${escapeHtml(msg.subject)}</h1>
      <div class="reader-note" id="readerNote" ${msg.note ? '' : 'hidden'}>${
        msg.note ? `<span class="rn-ico">📝</span><span class="rn-text">${escapeHtml(msg.note)}</span>` : ''
      }</div>
      <div class="reader-meta">
        <span class="avatar" style="background:${colorOf(from.address || displayFrom)}">${escapeHtml(initials(from.name, from.address))}</span>
        <div class="meta-main">
          <div class="meta-line1">
            <b>${escapeHtml(displayFrom)}</b>
            ${from.name ? `<span class="addr">&lt;${escapeHtml(from.address)}&gt;</span>` : ''}
            <span class="when">${fmtFull(msg.date)}</span>
          </div>
          <div class="meta-line2">收件人：${escapeHtml(addrText(msg.to) || '（未知）')}</div>
          <div class="meta-line2" id="metaMore" hidden>
            ${msg.cc.length ? `<div>抄送：${escapeHtml(addrText(msg.cc))}</div>` : ''}
            ${msg.messageId ? `<div>Message-ID：${escapeHtml(msg.messageId)}</div>` : ''}
          </div>
          <button class="meta-toggle" id="metaToggle">展开详情</button>
        </div>
      </div>
    </div>
    ${imgBar}
    <div class="reader-body" id="readerBody"></div>
    ${attachments.length ? `<div class="attachments">
        <div class="att-title">${attachments.length} 个附件</div>
        <div class="att-grid">${attachments
          .map(
            (a) => `<a class="att-item" href="/api/accounts/${state.activeId}/attachment?folder=${encodeURIComponent(state.folder)}&uid=${msg.uid}&index=${a.index}" download>
              <span class="ico">${iconForType(a.contentType)}</span>
              <span class="nm">${escapeHtml(a.filename)}</span>
              <span class="sz">${fmtSize(a.size)}</span></a>`
          )
          .join('')}</div>
      </div>` : ''}`;

  renderBody(msg, allowImages);

  // 独立阅读窗口里，「返回」没意义，改成关窗（主界面三栏平铺，用不到返回）
  const backBtn = $('#backBtn');
  if (READER_PANE && backBtn) {
    backBtn.textContent = '✕ 关闭窗口';
    backBtn.onclick = () => window.close();
  }
  $('#replyBtn').onclick = () => openCompose('reply', msg);
  $('#forwardBtn').onclick = () => openCompose('forward', msg);
  $('#starBtn').onclick = () => toggleFlag(msg);
  $('#unreadBtn').onclick = () => markUnread(msg);
  $('#deleteBtn').onclick = () => removeMessage(msg);
  const collapseBtn = $('#readerCollapseBtn');
  if (collapseBtn) {
    collapseBtn.onclick = () => {
      if (readerWin && !readerWin.closed) readerWin.close();
      else setReaderOpen(false);
    };
  }
  $('#popoutBtn').onclick = () => openReaderWindow();
  $('#metaToggle').onclick = () => {
    const more = $('#metaMore');
    more.hidden = !more.hidden;
    $('#metaToggle').textContent = more.hidden ? '展开详情' : '收起详情';
  };
  if (hasRemoteImg) {
    $('#showImgs').onclick = () => {
      imageOverride = !allowImages;
      renderReader(msg);
    };
    const always = $('#allowAlways');
    if (always) {
      always.onclick = async () => {
        try {
          await patchSettings({ imagePolicy: 'allow' }, { silent: true });
          imageOverride = null;
          renderReader(msg);
          toast('已设为默认显示外部图片，可在设置里改回来');
        } catch (err) {
          toast(err.message, 'error');
        }
      };
    }
  }

  state.message = msg;
  syncReaderTools();

  if (READER_PANE) {
    document.title = `${msg.subject || '邮件'} · ikuyoMail`;
    try {
      window.opener?.postMessage(
        { source: 'ikuyoMail-reader', type: 'shown', acc: state.activeId, folder: state.folder, uid: msg.uid },
        location.origin
      );
    } catch {
      /* opener 已关，忽略 */
    }
  }
}

function iconForType(type = '') {
  if (/image/.test(type)) return '🖼';
  if (/pdf/.test(type)) return '📄';
  if (/zip|rar|7z|tar|gzip/.test(type)) return '🗜';
  if (/sheet|excel|csv/.test(type)) return '📊';
  if (/word|document/.test(type)) return '📝';
  if (/audio/.test(type)) return '🎵';
  if (/video/.test(type)) return '🎬';
  return '📎';
}

function frameDoc(msg, allowImages) {
  const policy = allowImages
    ? "default-src 'none'; img-src * data: cid: blob:; style-src 'unsafe-inline'; font-src data:; media-src * data:;"
    : "default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'; font-src data:;";
  const body =
    msg.html && msg.html.trim()
      ? msg.html
      : `<pre style="white-space:pre-wrap;word-break:break-word;margin:0">${escapeHtml(msg.text || '（这封邮件没有正文）')}</pre>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<base target="_blank">
<style>
  html,body{margin:0;padding:20px 24px 44px;font-family:"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;font-size:13.5px;line-height:1.85;color:#1c2029;word-break:break-word;background:#fff}
  img{max-width:100%;height:auto}
  a{color:#3d63dd}
  table{max-width:100%;border-collapse:collapse}
  pre{white-space:pre-wrap;font-family:inherit}
  blockquote{border-left:3px solid #e7e9ef;margin:0 0 0 2px;padding:0 0 0 12px;color:#545b6b}
  ::-webkit-scrollbar{width:9px}::-webkit-scrollbar-thumb{background:#d5d9e3;border-radius:8px}
</style></head><body>${body}</body></html>`;
}

function renderBody(msg, allowImages) {
  const box = $('#readerBody');
  box.innerHTML = '';
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('title', '邮件正文');
  frame.srcdoc = frameDoc(msg, allowImages);
  box.appendChild(frame);
}

/** 备注/置顶变了但邮件正文没变时，只更新那一小条，不重载 iframe（否则会丢掉滚动位置） */
function updateReaderNote() {
  const box = $('#readerNote');
  if (!box) return;
  const note = state.message?.note || '';
  box.hidden = !note;
  box.innerHTML = note ? `<span class="rn-ico">📝</span><span class="rn-text">${escapeHtml(note)}</span>` : '';
}

async function toggleFlag(msg) {
  const next = !msg.flagged;
  try {
    await api(`/accounts/${state.activeId}/flags`, {
      method: 'POST',
      body: { folder: state.folder, uid: msg.uid, flagged: next },
    });
    msg.flagged = next;
    const row = state.messages.find((m) => m.uid === msg.uid);
    if (row) row.flagged = next;
    renderMessages();
    const btn = $('#starBtn');
    btn.classList.toggle('starred', next);
    btn.textContent = next ? '★ 已星标' : '☆ 星标';
    toast(next ? '已加星标' : '已取消星标');
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function markUnread(msg) {
  try {
    await api(`/accounts/${state.activeId}/flags`, {
      method: 'POST',
      body: { folder: state.folder, uid: msg.uid, seen: false },
    });
    const row = state.messages.find((m) => m.uid === msg.uid);
    if (row) row.unread = true;
    renderMessages();
    toast('已标为未读');
    loadFolders().then((f) => renderFolders(f)).catch(() => {});
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function removeMessage(msg) {
  if (!confirm('删除这封邮件？会移到邮箱的废纸篓。')) return;
  const wasOpen = state.message && state.message.uid === msg.uid;
  try {
    await api(`/accounts/${state.activeId}/message?folder=${encodeURIComponent(state.folder)}&uid=${msg.uid}`, {
      method: 'DELETE',
    });
    state.messages = state.messages.filter((m) => m.uid !== msg.uid);
    state.total = Math.max(0, state.total - 1);
    if (wasOpen) {
      state.selectedUid = null;
      state.message = null;
    }
    renderMessages();
    renderPager();
    if (wasOpen) {
      $('#reader').innerHTML = `<div class="welcome"><div class="welcome-art">🗑</div><h1>已删除</h1><p>邮件已移到废纸篓。</p></div>`;
    }
    toast('已删除', 'success');
    loadFolders().then((f) => renderFolders(f)).catch(() => {});
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ---------------- 列表右键菜单 / 本地标记 ---------------- */

let ctxTarget = null;
let noteTarget = null;

/** 写入置顶 / 待办 / 备注（走本地 marks 接口，不碰服务器） */
async function patchMark(m, patch) {
  const out = await api(`/accounts/${state.activeId}/mark`, {
    method: 'POST',
    body: { folder: state.folder, uid: m.uid, subject: m.subject, ...patch },
  });
  m.pinned = !!out.pinned;
  m.todo = !!out.todo;
  m.note = out.note || '';
  if (state.message && state.message.uid === m.uid) {
    state.message.pinned = m.pinned;
    state.message.todo = m.todo;
    state.message.note = m.note;
    updateReaderNote();
  }
  renderMessages();
  return out;
}

async function setSeen(m, unread) {
  await api(`/accounts/${state.activeId}/flags`, {
    method: 'POST',
    body: { folder: state.folder, uid: m.uid, seen: !unread },
  });
  m.unread = unread;
  if (state.message && state.message.uid === m.uid) state.message.unread = unread;
  const folder = state.folders.find((f) => f.path === state.folder);
  if (folder) {
    folder.unseen = Math.max(0, (folder.unseen || 0) + (unread ? 1 : -1));
    renderFolders(state.folders);
  }
  renderMessages();
  toast(unread ? '已标为未读' : '已标为已读');
}

function openCtxMenu(x, y, m) {
  const menu = $('#ctxMenu');
  ctxTarget = m;
  const row = (act, icon, label, cls = '') =>
    `<button type="button" class="ctx-item ${cls}" data-act="${act}" role="menuitem">
       <span class="ctx-ico">${icon}</span><span class="ctx-label">${label}</span></button>`;
  menu.innerHTML = [
    row('seen', m.unread ? '◉' : '○', m.unread ? '设为已读' : '设为未读'),
    row('todo', m.todo ? '☑' : '□', m.todo ? '取消待办' : '设为待办'),
    row('pin', m.pinned ? '📍' : '📌', m.pinned ? '取消置顶' : '置顶邮件'),
    row('note', '📝', m.note ? '编辑备注…' : '设置备注…'),
    '<div class="ctx-sep"></div>',
    row('pdf', '⤓', '另存为 PDF'),
    '<div class="ctx-sep"></div>',
    row('delete', '🗑', '删除邮件', 'danger'),
  ].join('');
  menu.hidden = false;

  // 先显示再量尺寸：贴着窗口右下角时往回收，别被裁掉
  const box = menu.getBoundingClientRect();
  const pad = 8;
  let left = x;
  let top = y;
  if (left + box.width > window.innerWidth - pad) left = Math.max(pad, x - box.width);
  if (top + box.height > window.innerHeight - pad) top = Math.max(pad, y - box.height);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function closeCtxMenu() {
  const menu = $('#ctxMenu');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  ctxTarget = null;
}

$('#ctxMenu').addEventListener('click', async (e) => {
  const btn = e.target.closest('.ctx-item');
  if (!btn) return;
  const act = btn.dataset.act;
  const m = ctxTarget;
  closeCtxMenu();
  if (!m) return;
  try {
    if (act === 'seen') await setSeen(m, !m.unread);
    else if (act === 'todo') {
      const out = await patchMark(m, { todo: !m.todo });
      toast(out.todo ? '已加入待办' : '已取消待办');
    } else if (act === 'pin') {
      const out = await patchMark(m, { pinned: !m.pinned });
      toast(out.pinned ? '已置顶' : '已取消置顶');
    } else if (act === 'note') {
      openNoteModal(m);
    } else if (act === 'pdf') {
      saveAsPdf(m);
    } else if (act === 'delete') {
      await removeMessage(m);
    }
  } catch (err) {
    toast(err.message, 'error');
  }
});

document.addEventListener(
  'mousedown',
  (e) => {
    if (!e.target.closest('#ctxMenu')) closeCtxMenu();
  },
  true
);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeCtxMenu();
});
window.addEventListener('resize', closeCtxMenu);
document.addEventListener('scroll', closeCtxMenu, true);

/* ---------------- 备注 ---------------- */

function openNoteModal(m) {
  noteTarget = m;
  $('#noteSubject').textContent = m.subject || '(无主题)';
  $('#noteInput').value = m.note || '';
  $('#noteTip').textContent = m.note ? '备注只保存在这台电脑上，不会同步到邮箱。' : '';
  openModal('noteModal');
  setTimeout(() => {
    const input = $('#noteInput');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, 30);
}

async function saveNote(value) {
  if (!noteTarget) return;
  const m = noteTarget;
  try {
    await patchMark(m, { note: value });
    closeModal('noteModal');
    toast(value.trim() ? '备注已保存' : '备注已清除');
  } catch (err) {
    toast(err.message, 'error');
  }
}

$('#noteSaveBtn').onclick = () => saveNote($('#noteInput').value);
$('#noteClearBtn').onclick = () => saveNote('');
$('#noteInput').addEventListener('keydown', (e) => {
  // Ctrl+Enter 直接保存，Esc 关掉
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    saveNote($('#noteInput').value);
  }
});

/* ---------------- 另存为 PDF ----------------
   把这一封邮件的内容单独排版成 A4，交给外壳（WebView2）打印成 PDF；
   在浏览器里打开时退回到系统打印对话框，「目标打印机」选「另存为 PDF」即可。 */

function saveAsPdf(m) {
  const payload = {
    type: 'save-pdf',
    accountId: state.activeId,
    folder: state.folder,
    uid: m.uid,
    subject: m.subject || '',
  };
  const webview = window.chrome?.webview;
  if (webview && typeof webview.postMessage === 'function') {
    webview.postMessage(payload);
    toast('正在生成 PDF…');
    return;
  }
  const qs = new URLSearchParams({
    acc: state.activeId,
    folder: state.folder,
    uid: String(m.uid),
    auto: '1',
  });
  const win = window.open(`/print.html?${qs}`, '_blank');
  if (!win) toast('浏览器拦截了新窗口，请允许弹出窗口后重试', 'error');
}

/* ---------------- 写邮件 ---------------- */

function openCompose(mode = 'new', original = null) {
  const acc = activeAccount();
  if (!acc) {
    toast('请先添加一个邮箱账号', 'error');
    return;
  }
  state.compose = { mode, original, attachments: [] };
  $('#composeTitle').textContent = mode === 'reply' ? '回复邮件' : mode === 'forward' ? '转发邮件' : '写邮件';
  $('#composeFrom').textContent = `${acc.name ? acc.name + ' · ' : ''}${acc.email}`;
  $('#ccRow').hidden = true;
  $('#bccRow').hidden = true;
  $('#toggleCc').textContent = '添加抄送/密送';
  $('#composeError').hidden = true;
  $('#composeError').textContent = '';
  $('#attachList').innerHTML = '';
  $('#attachInput').value = '';
  $('#composeTo').value = '';
  $('#composeCc').value = '';
  $('#composeBcc').value = '';
  ['#toSuggest', '#ccSuggest', '#bccSuggest'].forEach((s) => ($(s).hidden = true));

  const editor = $('#composeEditor');
  if (mode === 'reply' && original) {
    const from = original.from[0] || {};
    $('#composeTo').value = from.address ? (from.name ? `${from.name} <${from.address}>` : from.address) : '';
    $('#composeSubject').value = /^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`;
    editor.innerHTML = `<p><br></p>${quoteBlock(original, 'reply')}`;
  } else if (mode === 'forward' && original) {
    $('#composeSubject').value = /^fwd:/i.test(original.subject) ? original.subject : `Fwd: ${original.subject}`;
    editor.innerHTML = `<p><br></p>${quoteBlock(original, 'forward')}`;
  } else {
    $('#composeSubject').value = '';
    editor.innerHTML = '';
  }

  openModal('composeModal');
  setTimeout(() => {
    if (mode === 'new') {
      $('#composeTo').focus();
    } else {
      editor.focus();
      // 光标放到引用块前面，方便直接开始打字
      const sel = window.getSelection();
      const range = document.createRange();
      range.setStart(editor.firstChild || editor, 0);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, 80);
}

/** 生成引用块（用纯文本引用，避免把原邮件样式一起带进来） */
function quoteBlock(original, mode) {
  const head = mode === 'forward' ? '———— 转发的邮件 ————' : '———— 原邮件 ————';
  const lines = [
    head,
    `发件人：${addrText(original.from)}`,
    ...(mode === 'forward' ? [`收件人：${addrText(original.to)}`, `主题：${original.subject}`] : []),
    `时间：${fmtFull(original.date)}`,
    '',
  ];
  const meta = lines.map((l) => escapeHtml(l) || '&nbsp;').join('<br>');
  const body = escapeHtml(original.text || '（原文无纯文本内容）').replace(/\n/g, '<br>');
  return `<blockquote>${meta}<br>${body}</blockquote>`;
}

function editorHtml() {
  const editor = $('#composeEditor');
  const html = editor.innerHTML.trim();
  if (!html || html === '<br>' || !editor.innerText.trim()) return '';
  return html;
}

function editorText() {
  return $('#composeEditor').innerText.replace(/\u00a0/g, ' ');
}

function textToHtml(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

async function sendMail() {
  const btn = $('#sendBtn');
  const errBox = $('#composeError');
  const to = $('#composeTo').value.trim();
  if (!to) {
    errBox.hidden = false;
    errBox.textContent = '请填写收件人';
    $('#composeTo').focus();
    return;
  }
  btn.disabled = true;
  btn.textContent = '发送中…';
  errBox.hidden = true;
  try {
    const text = editorText();
    const html = editorHtml();
    const body = {
      to,
      cc: $('#composeCc').value.trim(),
      bcc: $('#composeBcc').value.trim(),
      subject: $('#composeSubject').value.trim(),
      text,
      html: html || textToHtml(text),
      attachments: state.compose.attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, content: a.content })),
    };
    const orig = state.compose.original;
    if (state.compose.mode === 'reply' && orig?.messageId) {
      body.inReplyTo = orig.messageId;
      body.references = orig.references || orig.messageId;
    }
    const out = await api(`/accounts/${state.activeId}/send`, { method: 'POST', body });
    closeModal('composeModal');
    toast(out.savedToSent ? '已发送，并存入「已发送」' : '已发送', 'success');
    loadFolders().then((f) => renderFolders(f)).catch(() => {});
  } catch (err) {
    errBox.hidden = false;
    errBox.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = '发送';
  }
}

/* ---------------- 富文本编辑器 ---------------- */

function setupEditor() {
  const editor = $('#composeEditor');
  const toolbar = $('#editorToolbar');

  // 记录光标位置：点工具栏时不能把光标顶回开头
  let savedRange = null;
  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) {
      savedRange = sel.getRangeAt(0).cloneRange();
    }
  };
  const restoreSelection = () => {
    if (!savedRange) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  };
  editor.addEventListener('keyup', saveSelection);
  editor.addEventListener('mouseup', saveSelection);
  editor.addEventListener('input', saveSelection);
  editor.addEventListener('blur', saveSelection);

  // Chrome 执行「列表 / 引用」后会把光标顶到段落开头，这里按字符偏移量还原
  const BLOCK_CMDS = new Set(['insertUnorderedList', 'insertOrderedList', 'blockquote']);
  const textOffset = () => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.endContainer)) return null;
    const probe = document.createRange();
    probe.selectNodeContents(editor);
    probe.setEnd(range.endContainer, range.endOffset);
    return probe.toString().length;
  };
  const setCaretAt = (offset) => {
    let left = offset;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const len = node.nodeValue.length;
      if (left <= len) {
        const r = document.createRange();
        r.setStart(node, left);
        r.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        return;
      }
      left -= len;
      node = walker.nextNode();
    }
    const r = document.createRange();
    r.selectNodeContents(editor);
    r.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  };

  // 点工具栏不抢走编辑区焦点
  toolbar.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) e.preventDefault();
  });

  toolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const cmd = btn.dataset.cmd;

    if (document.activeElement !== editor) {
      editor.focus();
      restoreSelection();
    }

    const offset = BLOCK_CMDS.has(cmd) ? textOffset() : null;

    if (cmd === 'blockquote') {
      const isQuote = document.queryCommandValue('formatBlock') === 'blockquote';
      document.execCommand('formatBlock', false, isQuote ? 'p' : 'blockquote');
    } else if (cmd === 'createLink') {
      const url = prompt('链接地址（例如 https://example.com）');
      if (url) document.execCommand('createLink', false, url);
    } else {
      document.execCommand(cmd, false, null);
    }

    if (offset != null) {
      editor.focus();
      setCaretAt(offset);
    }
    saveSelection();
    refreshToolbar();
  });

  const stateCmds = ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList'];
  function refreshToolbar() {
    for (const cmd of stateCmds) {
      const btn = toolbar.querySelector(`[data-cmd="${cmd}"]`);
      if (!btn) continue;
      let on = false;
      try {
        on = document.queryCommandState(cmd);
      } catch {
        on = false;
      }
      btn.classList.toggle('on', on);
    }
  }
  editor.addEventListener('keyup', refreshToolbar);
  editor.addEventListener('mouseup', refreshToolbar);

  // 粘贴：去掉脚本和事件属性，避免把网页垃圾一起带进来
  editor.addEventListener('paste', (e) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const html = cd.getData('text/html');
    const text = cd.getData('text/plain');
    if (!html) return; // 纯文本交给浏览器默认处理
    e.preventDefault();
    try {
      document.execCommand('insertHTML', false, sanitizePasted(html));
    } catch {
      document.execCommand('insertText', false, text || '');
    }
  });
}

function sanitizePasted(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input,button,svg,video,audio').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((node) => {
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) node.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(attr.value)) node.removeAttribute(attr.name);
      else if (name === 'class' || name === 'id') node.removeAttribute(attr.name);
    }
  });
  return doc.body.innerHTML;
}

/* ---------------- 收件人自动补全 ---------------- */

function setupAddrField(inputSel, boxSel) {
  const input = $(inputSel);
  const box = $(boxSel);
  let items = [];
  let active = 0;
  let timer = null;

  const token = () => {
    const v = input.value;
    const idx = Math.max(v.lastIndexOf(','), v.lastIndexOf(';'));
    return { start: idx + 1, text: v.slice(idx + 1) };
  };

  const hide = () => {
    box.hidden = true;
    box.innerHTML = '';
    items = [];
    active = 0;
  };

  const highlight = () => {
    box.querySelectorAll('.addr-item').forEach((n, i) => n.classList.toggle('active', i === active));
  };

  const choose = (c) => {
    if (!c) return;
    const { start } = token();
    const before = input.value.slice(0, start);
    const label = c.name ? `${c.name} <${c.address}>` : c.address;
    input.value = `${before}${before.trim() ? ' ' : ''}${label}, `;
    hide();
    input.focus();
  };

  const show = (list) => {
    items = list || [];
    if (!items.length) return hide();
    active = 0;
    box.innerHTML = items
      .map(
        (c, i) => `<div class="addr-item${i === 0 ? ' active' : ''}" data-i="${i}">
          <span class="avatar" style="background:${colorOf(c.address)}">${escapeHtml(initials(c.name, c.address))}</span>
          <span class="nm">${escapeHtml(c.name || c.address.split('@')[0])}</span>
          <span class="ad">${escapeHtml(c.address)}</span>
        </div>`
      )
      .join('');
    box.hidden = false;
    box.querySelectorAll('.addr-item').forEach((node) => {
      node.addEventListener('mousedown', (e) => {
        e.preventDefault();
        choose(items[Number(node.dataset.i)]);
      });
    });
  };

  const query = async (q) => {
    try {
      const { contacts } = await api(`/contacts?q=${encodeURIComponent(q)}&limit=8`);
      show(contacts);
    } catch {
      hide();
    }
  };

  // 只在用户真的去点这个输入框时才弹「最近联系人」，
  // 打开写信窗口时的自动聚焦不弹，免得挡住下面的字段
  let userTouched = false;
  input.addEventListener('focus', () => {
    if (userTouched && !token().text.trim() && box.hidden) query('');
  });
  input.addEventListener('click', () => {
    userTouched = true;
    if (!token().text.trim() && box.hidden) query('');
  });
  input.addEventListener('input', () => {
    userTouched = true;
    clearTimeout(timer);
    timer = setTimeout(() => query(token().text.trim()), 180);
  });

  input.addEventListener('blur', () => setTimeout(hide, 160));

  // 点到别处立刻收起，避免下拉挡住下面的工具栏
  document.addEventListener('mousedown', (e) => {
    if (!input.contains(e.target) && !box.contains(e.target)) hide();
  });

  input.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = (active + 1) % items.length;
      highlight();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active - 1 + items.length) % items.length;
      highlight();
    } else if (e.key === 'Enter') {
      if (items[active]) {
        e.preventDefault();
        choose(items[active]);
      }
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      hide();
    }
  });
}

async function addAttachments(files) {
  for (const file of files) {
    if (file.size > 20 * 1024 * 1024) {
      toast(`${file.name} 超过 20MB，已跳过`, 'error');
      continue;
    }
    const content = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1]);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
    state.compose.attachments.push({ filename: file.name, contentType: file.type || 'application/octet-stream', content, size: file.size });
  }
  renderAttachList();
}

function renderAttachList() {
  const box = $('#attachList');
  box.innerHTML = '';
  state.compose.attachments.forEach((a, i) => {
    const chip = el(
      'span',
      'attach-chip',
      `📎 ${escapeHtml(a.filename)} <span style="color:var(--muted)">${fmtSize(a.size)}</span> <button data-i="${i}" title="移除">✕</button>`
    );
    chip.querySelector('button').onclick = () => {
      state.compose.attachments.splice(i, 1);
      renderAttachList();
    };
    box.appendChild(chip);
  });
}

/* ---------------- 添加 / 编辑账号弹窗 ---------------- */

function openAccountModal(mode = 'create', acc = null) {
  state.accountMode = mode;
  state.editingId = mode === 'edit' && acc ? acc.id : null;
  const isEdit = state.accountMode === 'edit';
  state.editEmail = isEdit && acc ? acc.email : '';

  $('#accountModal .modal-head h3').textContent = isEdit ? '账号设置' : '添加邮箱账号';
  $('#saveAccountBtn').textContent = isEdit ? '保存修改' : '验证并登录';
  $('#deleteAccountBtn').hidden = !isEdit;
  $('#diagBox').hidden = !isEdit;
  $('#diagOut').hidden = true;
  $('#diagOut').textContent = '';
  $('#accPass').value = '';
  $('#accPass').placeholder = isEdit ? '留空表示不修改' : '建议使用授权码';
  $('#accountError').hidden = true;
  $('#accountError').textContent = '';

  if (isEdit && acc) {
    const { local, domain } = splitEmail(acc.email);
    state.providerKey = keyForAccount(acc.email, acc.provider);
    state.provider = acc.provider || 'custom';
    renderProviderSelect();
    $('#accLocal').value = local;
    $('#accDomain').value = domain;
    applyProviderOption(state.providerKey, { keepDomain: true });
    // 地址在编辑模式下不改（改地址等于换账号，容易踩验证坑）
    $('#accLocal').readOnly = true;
    $('#accDomain').readOnly = true;
    $('#accDomain').classList.add('locked');

    $('#accName').value = acc.name || '';
    $('#imapHost').value = acc.imap?.host || '';
    $('#imapPort').value = acc.imap?.port || '';
    $('#smtpHost').value = acc.smtp?.host || '';
    $('#smtpPort').value = acc.smtp?.port || '';
    $('#imapCert').checked = !!acc.imap?.allowInvalidCert;
    $('#smtpCert').checked = !!acc.smtp?.allowInvalidCert;
    fillProxyForm(acc.proxy);

    const p = state.providers.find((x) => x.id === acc.provider);
    $('#hintText').textContent = p
      ? `${p.hint} 留空密码表示沿用原来的授权码。`
      : '修改服务器地址后会重新验证连接。';
    $('#passLabel').textContent = '新密码 / 授权码（可选）';
  } else {
    state.providerKey = 'custom';
    state.provider = 'custom';
    renderProviderSelect();
    $('#accLocal').value = '';
    $('#accDomain').value = '';
    $('#accLocal').readOnly = false;
    $('#accDomain').readOnly = false;
    $('#accDomain').classList.remove('locked');
    $('#accName').value = '';
    ['#imapHost', '#imapPort', '#smtpHost', '#smtpPort'].forEach((s) => ($(s).value = ''));
    $('#imapCert').checked = false;
    $('#smtpCert').checked = false;
    fillProxyForm(null);
    $('#proxyDetails').open = false;
    applyProviderOption('custom');
  }

  openModal('accountModal');
  setTimeout(() => (isEdit ? $('#accName') : $('#accLocal')).focus(), 60);
}

/** 把诊断结果排成人能读的几行，并给出判断 */
function formatDiagnosis(d) {
  if (d.error) return `诊断失败：${d.error}`;
  const lines = [];
  lines.push(`文件夹：${d.folder}`);

  if (d.stale) {
    lines.push('');
    lines.push('⚠ 发现旧会话与服务器不一致：');
    lines.push(`   旧会话读到 ${d.pooled?.searchAll ?? '—'} 封，重新握手后读到 ${d.searchAll ?? '—'} 封。`);
    lines.push('   已自动断开旧会话。关闭本窗口后点一次刷新，列表就会更新。');
    lines.push('');
  }

  if (d.status?.error) lines.push(`STATUS：失败（${d.status.error}）`);
  else if (d.status) lines.push(`STATUS 报告：${d.status.messages ?? '—'} 封，未读 ${d.status.unseen ?? '—'}`);
  lines.push(`打开文件夹 EXISTS：${d.selected?.exists ?? '—'}`);
  lines.push(`SEARCH ALL 可枚举：${d.searchAll ?? '（不支持）'}`);
  if (d.selected) lines.push(`UIDNEXT：${d.selected.uidNext ?? '—'}　UIDVALIDITY：${d.selected.uidValidity ?? '—'}`);
  if (d.pooled) lines.push(`旧会话视图：${d.pooled.searchAll ?? '—'} 封`);
  if (d.capabilities?.length) lines.push(`服务端能力：${d.capabilities.join(' ')}`);
  if (d.sample?.length) {
    lines.push('最近几封：');
    for (const s of d.sample) lines.push(`  · ${s.subject}（${s.from}）`);
  }

  const reported = d.status?.messages ?? null;
  const readable = d.searchAll ?? d.selected?.exists ?? null;
  if (reported != null && readable != null) {
    lines.push('');
    if (reported > readable) {
      lines.push(`⚠ 结论：STATUS 报 ${reported} 封，但只能枚举到 ${readable} 封。`);
      lines.push('   这类差异一般来自服务端的收取范围限制：');
      lines.push('   网易 / QQ 可在「设置 → POP3/SMTP/IMAP」把收取范围改成「全部邮件」，保存后点刷新。');
    } else if (readable >= 30) {
      lines.push(`✅ 结论：服务器共有 ${readable} 封，客户端全部可读，没有限制。`);
    } else {
      lines.push(`✅ 结论：服务器当前就是 ${readable} 封，STATUS 与可枚举数量一致。`);
      lines.push('   如果网页版明显更多，说明服务端的收取范围还是「最近 30 天」；');
      lines.push('   改完设置后必须点刷新（会强制重新握手），旧会话不会自动更新。');
    }
  }
  return lines.join('\n');
}

async function runDiagnosis() {
  const id = state.editingId || state.activeId;
  const out = $('#diagOut');
  if (!id) return;
  out.hidden = false;
  out.textContent = '正在检查…';
  try {
    const d = await api(`/accounts/${id}/diagnose?folder=${encodeURIComponent(state.folder)}`);
    out.textContent = formatDiagnosis(d);
  } catch (err) {
    out.textContent = `诊断失败：${err.message}`;
  }
}


/* ---------------- 服务商下拉 + 域名锁定 ---------------- */

function optionByKey(key) {
  return state.providerOptions.find((o) => o.key === key) || null;
}

function optionForDomainClient(domain) {
  const d = String(domain || '').toLowerCase().trim();
  if (!d) return null;
  return state.providerOptions.find((o) => o.domain && o.domain === d) || null;
}

/** 邮箱地址拆成 用户名 + 域名 */
function splitEmail(email) {
  const s = String(email || '');
  const i = s.lastIndexOf('@');
  if (i < 0) return { local: s, domain: '' };
  return { local: s.slice(0, i), domain: s.slice(i + 1) };
}

function renderProviderSelect() {
  const sel = $('#accProvider');
  if (!sel) return;
  sel.innerHTML = '';
  for (const opt of state.providerOptions) {
    const o = document.createElement('option');
    o.value = opt.key;
    o.textContent = opt.domain ? `${opt.label}　@${opt.domain}` : opt.label;
    sel.appendChild(o);
  }
  sel.value = state.providerKey;
}

/**
 * 应用一个服务商选项：
 * - 有固定域名就填好并锁住，用户只输 @ 前面的部分
 * - 域名可变（企业邮 / 自定义）就留空可编辑
 */
function applyProviderOption(key, { keepDomain = false } = {}) {
  const opt = optionByKey(key);
  if (!opt) return;
  state.providerKey = opt.key;
  state.provider = opt.provider;

  const dom = $('#accDomain');
  if (opt.domain) {
    dom.value = opt.domain;
    dom.readOnly = true;
    dom.classList.add('locked');
    dom.title = '该服务商域名固定，已锁定';
  } else {
    if (!keepDomain) dom.value = '';
    dom.readOnly = false;
    dom.classList.remove('locked');
    dom.title = '';
  }
  $('#accProvider').value = opt.key;

  const p = state.providers.find((x) => x.id === opt.provider);
  if (!p) return;
  $('#hintText').textContent = `${p.hint} ${p.help}`;
  $('#passLabel').textContent = p.authType === 'authcode' ? '密码 / 授权码（需要授权码）' : '密码 / 授权码';

  if (opt.provider !== 'custom') {
    $('#imapHost').value = p.imap.host || '';
    $('#imapPort').value = p.imap.port || '';
    $('#smtpHost').value = p.smtp.host || '';
    $('#smtpPort').value = p.smtp.port || '';
  } else {
    ['#imapHost', '#imapPort', '#smtpHost', '#smtpPort'].forEach((s) => ($(s).value = ''));
  }
}

/** 根据已有邮箱反查下拉项（编辑账号时用） */
function keyForAccount(email, provider) {
  const { domain } = splitEmail(email);
  const byDomain = optionForDomainClient(domain);
  if (byDomain) return byDomain.key;
  const byProvider = state.providerOptions.find((o) => o.provider === provider && !o.domain);
  if (byProvider) return byProvider.key;
  return 'custom';
}

/** 把账号上的代理配置回填到表单 */
function fillProxyForm(proxy) {
  lastAutoPort = '';
  const on = !!(proxy && proxy.host);
  $('#proxyEnabled').checked = on ? proxy.enabled !== false : false;
  $('#proxyType').value = proxy?.type || 'socks5';
  $('#proxyPort').value = proxy?.port || '';
  $('#proxyHost').value = proxy?.host || '';
  $('#proxyUser').value = proxy?.username || '';
  $('#proxyPass').value = '';
  $('#proxyPass').placeholder = proxy?.hasPassword ? '已保存，留空表示不修改' : '可留空';
  if (on) $('#proxyDetails').open = true;
}

/** 从表单读出代理配置；没填主机就视为不使用 */
function readProxyForm() {
  const host = $('#proxyHost').value.trim();
  if (!host) return null;
  const pass = $('#proxyPass').value;
  return {
    enabled: $('#proxyEnabled').checked,
    type: $('#proxyType').value,
    host,
    port: Number($('#proxyPort').value) || undefined,
    username: $('#proxyUser').value.trim(),
    ...(pass ? { password: pass } : {}),
  };
}

async function saveAccount() {
  const btn = $('#saveAccountBtn');
  const errBox = $('#accountError');
  const isEdit = state.accountMode === 'edit';
  const local = $('#accLocal').value.trim();
  const domain = $('#accDomain').value.trim().replace(/^@+/, '');
  const pass = $('#accPass').value;
  const email = isEdit ? state.editEmail : local && domain ? `${local}@${domain}` : '';

  if (!isEdit) {
    if (!local) return showAccountError('请填写 @ 前面的用户名');
    if (!domain) return showAccountError('请选择邮箱服务商，或手动填写 @ 后面的域名');
    if (/[\s@]/.test(local)) return showAccountError('用户名里不能有空格或 @');
    if (/[\s@]/.test(domain)) return showAccountError('域名里不能有空格或 @');
    if (!/^[^\s@]+\.[^\s@]+$/.test(domain)) return showAccountError('域名格式看起来不对，例如 qq.com');
    if (!pass) return showAccountError('请填写密码或授权码');
  }
  if ((state.provider === 'custom' || isEdit) && (!$('#imapHost').value.trim() || !$('#smtpHost').value.trim())) {
    return showAccountError('需要填写 IMAP 与 SMTP 服务器地址');
  }

  const servers = {
    imap: {
      host: $('#imapHost').value.trim(),
      port: Number($('#imapPort').value) || 993,
      secure: Number($('#imapPort').value) !== 143,
      allowInvalidCert: $('#imapCert').checked,
    },
    smtp: {
      host: $('#smtpHost').value.trim(),
      port: Number($('#smtpPort').value) || 465,
      secure: Number($('#smtpPort').value) !== 587,
      allowInvalidCert: $('#smtpCert').checked,
    },
  };

  const proxy = readProxyForm();
  if (proxy && (!$('#proxyHost').value.trim() || !$('#proxyPort').value)) {
    return showAccountError('代理需要同时填写主机和端口');
  }

  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = proxy?.enabled ? '正在通过代理验证…' : '正在验证…';
  errBox.hidden = true;
  try {
    if (isEdit) {
      const body = { name: $('#accName').value.trim(), ...servers, proxy };
      if (pass) body.pass = pass;
      const out = await api(`/accounts/${state.editingId}`, { method: 'PATCH', body });
      closeModal('accountModal');
      const smtpBad = out.test && !out.test.smtp;
      toast(smtpBad ? '已保存，但 SMTP 验证没过，可能发不了信' : '账号设置已保存', smtpBad ? 'error' : 'success');
      if (out.warning) toast(out.warning, 'error');
      await loadAccounts();
      if (state.editingId === state.activeId) await bootAccount();
    } else {
      const payload = {
        email,
        pass,
        name: $('#accName').value.trim(),
        provider: state.provider,
        ...servers,
        proxy,
      };
      const out = await api('/accounts', { method: 'POST', body: payload });
      closeModal('accountModal');
      toast('登录成功，正在同步邮件…', 'success');
      if (out.warning) toast(out.warning, 'error');
      state.activeId = out.account.id;
      localStorage.setItem('mailbox.activeAccount', state.activeId);
      await loadAccounts();
      await switchAccount(out.account.id);
      if (!out.test.smtp) toast('IMAP 已连上，但 SMTP 验证失败，可能发不了信：' + (out.test.error || ''), 'error');
    }
  } catch (err) {
    showAccountError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

function showAccountError(msg) {
  const box = $('#accountError');
  box.hidden = false;
  box.textContent = msg;
}

/* ---------------- 设置 ---------------- */

const SETTINGS_DEFAULTS = {
  imagePolicy: 'block',
  closeAction: 'tray',
  trayEnabled: true,
  notifyEnabled: true,
  notifySound: true,
  notifyDesktop: true,
  pollInterval: 120,
  autoStart: false,
};

const POLL_OPTIONS = [30, 60, 120, 300, 600, 1800];

async function loadSettings() {
  try {
    const out = await api('/settings');
    state.settings = { ...SETTINGS_DEFAULTS, ...(out.settings || {}) };
    state.settingsStatus = out.status || null;
  } catch {
    state.settings = { ...SETTINGS_DEFAULTS };
  }
  return state.settings;
}

async function patchSettings(patch, { silent = false } = {}) {
  const out = await api('/settings', { method: 'PATCH', body: patch });
  state.settings = { ...SETTINGS_DEFAULTS, ...(out.settings || {}) };
  state.settingsStatus = out.status || null;
  state.settingsError = out.autoStartError || null;
  if (!silent) renderSettings();
  return state.settings;
}

function segSet(sel, val) {
  document.querySelectorAll(`${sel} button`).forEach((b) => {
    b.classList.toggle('active', b.dataset.val === val);
  });
}

function fmtClock(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function renderSettings() {
  const s = state.settings;
  segSet('#setImagePolicy', s.imagePolicy);
  segSet('#setCloseAction', s.closeAction);

  $('#setNotify').checked = s.notifyEnabled;
  $('#setSound').checked = s.notifySound;
  $('#setDesktop').checked = s.notifyDesktop;
  $('#setTray').checked = s.trayEnabled;
  $('#notifySub').classList.toggle('off', !s.notifyEnabled);

  const sel = $('#setInterval');
  if (![...sel.options].some((o) => Number(o.value) === Number(s.pollInterval))) {
    const opt = el('option', '', `${Math.round(s.pollInterval / 60) || 1} 分钟`);
    opt.value = String(s.pollInterval);
    sel.appendChild(opt);
  }
  sel.value = String(s.pollInterval);

  $('#imagePolicyTip').textContent =
    s.imagePolicy === 'block'
      ? '正文里的配图会留白，需要时可在阅读区点「显示图片」临时放行。'
      : '邮件一打开就加载远程图片。发件人能借此知道你何时、从哪个网络打开了它。';

  $('#closeTip').textContent = !s.trayEnabled
    ? '已关闭托盘图标，关闭窗口后程序会直接退出。'
    : s.closeAction === 'tray'
      ? '关掉窗口后程序继续在后台收信，右下角会弹提醒；点托盘图标（或双击）可以重新打开，右键菜单里可退出。'
      : '关掉窗口即完全退出，之后不再检查新邮件，也不会有任何提醒。';

  // 开机自启：以「启动」文件夹里的实际状态为准
  const autoOn = state.settingsStatus?.autoStart ?? s.autoStart;
  const autoSupported = state.settingsStatus?.autoStartSupported !== false;
  const autoBox = $('#setAutoStart');
  autoBox.checked = !!autoOn;
  autoBox.disabled = !autoSupported;
  $('#autoStartTip').textContent = !autoSupported
    ? '开机自启仅在 Windows 上可用。'
    : autoOn
      ? '已加入 Windows 启动项：登录后会在后台静默启动并继续收信，托盘图标在通知区域。'
      : '打开后会在 Windows「启动」文件夹里放一个启动项，登录时自动在后台收信，不弹窗。';

  const st = state.settingsStatus;
  const poll = st?.poll;
  const bits = [];
  bits.push(st?.traySupported === false ? '当前系统不支持托盘' : `托盘图标：${st?.tray ? '运行中' : '未运行'}`);
  bits.push(`检查间隔：${formatPoll(s.pollInterval)}`);
  if (poll?.lastCheckAt) bits.push(`上次检查：${fmtClock(poll.lastCheckAt)}`);
  if (poll?.lastError) bits.push(`上次出错：${escapeHtml(poll.lastError.account)} · ${escapeHtml(poll.lastError.message.slice(0, 60))}`);
  $('#setStatus').innerHTML = bits.join('<br>');
}

function formatPoll(sec) {
  const n = Number(sec) || 120;
  if (n < 60) return `${n} 秒`;
  if (n % 60 === 0) return `${n / 60} 分钟`;
  return `${Math.round(n / 60)} 分钟`;
}

async function openSettings() {
  renderSettings();
  openModal('settingsModal');
  try {
    const out = await api('/settings');
    state.settings = { ...SETTINGS_DEFAULTS, ...(out.settings || {}) };
    state.settingsStatus = out.status || null;
    renderSettings();
  } catch {
    /* 拿不到状态就先用缓存值显示 */
  }
}

function bindSeg(sel, key, message) {
  $(sel).addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const val = btn.dataset.val;
    if (state.settings[key] === val) return;
    try {
      await patchSettings({ [key]: val });
      toast(message);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

bindSeg('#setImagePolicy', 'imagePolicy', '已保存，之后打开的邮件按新规则显示');
bindSeg('#setCloseAction', 'closeAction', '关闭行为已保存');

$('#settingsBtn').onclick = () => openSettings();

$('#setNotify').addEventListener('change', (e) => {
  patchSettings({ notifyEnabled: e.target.checked }).catch((err) => toast(err.message, 'error'));
});
$('#setSound').addEventListener('change', async (e) => {
  const on = e.target.checked;
  await patchSettings({ notifySound: on }).catch((err) => toast(err.message, 'error'));
  if (on) playChime();
});
$('#setDesktop').addEventListener('change', (e) => {
  patchSettings({ notifyDesktop: e.target.checked }).catch((err) => toast(err.message, 'error'));
});
$('#setTray').addEventListener('change', async (e) => {
  try {
    await patchSettings({ trayEnabled: e.target.checked });
    toast(e.target.checked ? '托盘图标已开启' : '托盘图标已关闭');
  } catch (err) {
    toast(err.message, 'error');
  }
});
$('#setInterval').addEventListener('change', (e) => {
  patchSettings({ pollInterval: Number(e.target.value) }).catch((err) => toast(err.message, 'error'));
});

$('#setAutoStart').addEventListener('change', async (e) => {
  const want = e.target.checked;
  try {
    await patchSettings({ autoStart: want }, { silent: true });
    if (state.settingsError) toast(state.settingsError, 'error');
    else toast(want ? '已加入开机自启' : '已取消开机自启');
  } catch (err) {
    toast(err.message, 'error');
  }
  renderSettings();
});

$('#testNotifyBtn').onclick = async () => {
  const tip = $('#notifyTestTip');
  const btn = $('#testNotifyBtn');
  btn.disabled = true;
  tip.textContent = '正在发送…';
  try {
    const out = await api('/notify/test', { method: 'POST', body: {} });
    tip.textContent = out.tray
      ? '已发送：页面右下角 + 系统通知'
      : '已发送到页面；托盘未运行，不会有系统通知';
  } catch (err) {
    tip.textContent = '发送失败：' + err.message;
  } finally {
    btn.disabled = false;
    setTimeout(() => (tip.textContent = ''), 6000);
  }
};

/* ---------------- 新邮件提醒（右下角卡片） ---------------- */

let audioCtx = null;

function playChime() {
  if (!state.settings.notifySound) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    return;
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  const t0 = audioCtx.currentTime;
  [[880, 0], [1174.66, 0.13]].forEach(([freq, offset]) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + offset);
    gain.gain.linearRampToValueAtTime(0.09, t0 + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.34);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0 + offset);
    osc.stop(t0 + offset + 0.38);
  });
}

function dismissCard(card) {
  if (!card || card.dataset.gone) return;
  card.dataset.gone = '1';
  card.classList.add('out');
  setTimeout(() => card.remove(), 220);
}

function clearCards() {
  document.querySelectorAll('.notify-card').forEach(dismissCard);
}

function showMailCards(evt) {
  const wrap = $('#notifyWrap');
  const items = (evt.items || []).slice(0, 3);

  // 最多留 4 张，多了把最旧的顶掉
  while (wrap.children.length >= 4) dismissCard(wrap.firstElementChild);

  for (const it of items) {
    const name = it.fromName || it.fromAddress || '未知发件人';
    const card = el('div', 'notify-card');
    card.innerHTML = `
      <div class="nc-avatar" style="background:${colorOf(it.fromAddress || name)}">${escapeHtml(initials(it.fromName, it.fromAddress))}</div>
      <div class="nc-main">
        <div class="nc-top">
          <span class="nc-from">${escapeHtml(name)}</span>
          <span class="nc-time">${fmtClock(it.date)}</span>
        </div>
        <div class="nc-subject">${escapeHtml(it.subject || '(无主题)')}</div>
        <div class="nc-account">${escapeHtml(evt.accountName || '')}${
          evt.count > 1 ? ` · 共 ${evt.count} 封新邮件` : ''
        }</div>
      </div>
      <button class="nc-close" title="关闭">✕</button>`;

    card.querySelector('.nc-close').onclick = (e) => {
      e.stopPropagation();
      dismissCard(card);
    };
    card.onclick = () => openFromNotification(evt, it);

    // 鼠标悬停时先别消失，免得刚要点就跑了
    let timer = setTimeout(() => dismissCard(card), 9000);
    card.addEventListener('mouseenter', () => clearTimeout(timer));
    card.addEventListener('mouseleave', () => {
      timer = setTimeout(() => dismissCard(card), 3200);
    });

    wrap.appendChild(card);
  }
}

async function openFromNotification(evt, item) {
  clearCards();
  if (!item?.uid || !evt.accountId || evt.accountId === 'test') {
    return;
  }
  try {
    if (evt.accountId !== state.activeId) await switchAccount(evt.accountId);
    state.folder = 'INBOX';
    state.page = 1;
    state.query = '';
    $('#searchInput').value = '';
    renderFolders(state.folders);
    await loadMessages();
    const row = state.messages.find((m) => m.uid === item.uid);
    if (row) await openMessage(row);
    else toast('这封邮件不在当前页，已切回收件箱');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function onNewMail(evt) {
  showMailCards(evt);
  playChime();

  if (!state.settings.notifyEnabled) return;
  // 正在看这个账号的收件箱就顺手刷新一下，让列表和未读数对上
  if (evt.accountId && evt.accountId === state.activeId) {
    loadFolders()
      .then((f) => {
        renderFolders(f);
        const viewingInbox = state.folder === 'INBOX' && state.page === 1 && !state.query;
        if (viewingInbox) loadMessages();
      })
      .catch(() => {});
  }
}

/* ---------------- 实时连接与心跳 ---------------- */

const CLIENT_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

function connectEvents() {
  let es;
  try {
    es = new EventSource('/api/events');
  } catch {
    return;
  }
  es.addEventListener('mail', (e) => {
    let data;
    try {
      data = JSON.parse(e.data);
    } catch {
      return;
    }
    if (data.test || state.settings.notifyEnabled) onNewMail(data);
  });
  es.addEventListener('bye', () => {
    toast('本地服务已退出，请重新启动程序', 'error');
  });
}

function sendHeartbeat() {
  const visible = document.visibilityState === 'visible' && document.hasFocus();
  fetch('/api/heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: CLIENT_ID, visible }),
    keepalive: true,
  }).catch(() => {});
}

/* ---------------- 弹窗基础 ---------------- */

function openModal(id) {
  $(`#${id}`).hidden = false;
}
function closeModal(id) {
  $(`#${id}`).hidden = true;
}

document.querySelectorAll('[data-close]').forEach((b) => {
  b.onclick = () => closeModal(b.dataset.close);
});
document.querySelectorAll('.modal-backdrop').forEach((bd) => {
  bd.addEventListener('mousedown', (e) => {
    if (e.target === bd) bd.hidden = true;
  });
});

/* ---------------- 事件绑定 ---------------- */

let searchTimer = null;
function runSearchNow() {
  clearTimeout(searchTimer);
  const v = $('#searchInput').value.trim();
  if (v === state.query) return;
  state.query = v;
  state.page = 1;
  loadMessages();
}
$('#searchInput').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const v = e.target.value.trim();
  searchTimer = setTimeout(() => {
    state.query = v;
    state.page = 1;
    loadMessages();
  }, 420);
});
$('#searchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    runSearchNow();
  } else if (e.key === 'Escape') {
    e.target.value = '';
    runSearchNow();
  }
});

$('#refreshBtn').onclick = async () => {
  const btn = $('#refreshBtn');
  btn.disabled = true;
  btn.classList.add('spinning');
  try {
    // 强制重新握手：否则某些服务商的旧会话会一直返回旧的邮件数
    await hardRefresh();
    toast('已刷新');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.classList.remove('spinning');
  }
};

$('#prevPage').onclick = () => {
  if (state.page > 1) goToPage(state.page - 1);
};
$('#nextPage').onclick = () => {
  const totalPages = Math.max(1, Math.ceil(state.total / state.pageSize));
  if (state.page < totalPages) goToPage(state.page + 1);
};

$('#pageInput').addEventListener('input', (e) => {
  // 只允许数字，顺手挡掉粘贴进来的奇怪字符
  const cleaned = e.target.value.replace(/[^\d]/g, '').slice(0, 6);
  if (cleaned !== e.target.value) e.target.value = cleaned;
  e.target.classList.remove('invalid');
});
$('#pageInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitPageInput();
    e.target.blur();
  } else if (e.key === 'Escape') {
    e.target.value = String(state.page);
    e.target.blur();
  }
});
$('#pageInput').addEventListener('blur', () => commitPageInput());

document.querySelectorAll('.chip').forEach((chip) => {
  chip.onclick = () => {
    state.filter = chip.dataset.filter;
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
    renderMessages();
  };
});

$('#addAccountBtn').onclick = () => openAccountModal('create');
$('#composeBtn').onclick = () => openCompose('new');
$('#saveAccountBtn').onclick = saveAccount;

/* ---- 三栏布局控件 ---- */
setupSplitters();
applyLayout();
// 窗口窄到下限时的提示条：点「收起阅读区」把下限从三栏降成两栏
$('#narrowCollapse').onclick = () => setReaderOpen(false);
$('#popoutBack').onclick = () => {
  if (readerWin && !readerWin.closed) readerWin.close();
};

$('#deleteAccountBtn').onclick = async () => {
  const acc = state.accounts.find((a) => a.id === state.editingId);
  if (!acc) return;
  closeModal('accountModal');
  await deleteAccount(acc);
};

$('#diagBtn').onclick = runDiagnosis;

setupEditor();
setupAddrField('#composeTo', '#toSuggest');
setupAddrField('#composeCc', '#ccSuggest');
setupAddrField('#composeBcc', '#bccSuggest');

$('#sendBtn').onclick = sendMail;

$('#toggleCc').onclick = () => {
  const show = $('#ccRow').hidden;
  $('#ccRow').hidden = !show;
  $('#bccRow').hidden = !show;
  $('#toggleCc').textContent = show ? '收起抄送/密送' : '添加抄送/密送';
};

$('#attachInput').onchange = (e) => {
  addAttachments([...e.target.files]);
  e.target.value = '';
};

/* ---- 添加账号表单：下拉选服务商 + 域名自动锁定 ---- */

$('#accProvider').onchange = (e) => applyProviderOption(e.target.value);

// 手填域名时反查服务商：输入 163.com 会自动切到「网易 163」
$('#accDomain').addEventListener('input', (e) => {
  if ($('#accDomain').readOnly) return;
  const opt = optionForDomainClient(e.target.value);
  if (opt && opt.key !== state.providerKey) {
    applyProviderOption(opt.key, { keepDomain: true });
  }
});

// 切换代理协议时同步默认端口（用户手动改过的端口不会被覆盖）
const defaultProxyPort = (t) => (t === 'http' || t === 'https' ? 8080 : 1080);

$('#proxyType').onchange = (e) => {
  const t = e.target.value;
  const cur = $('#proxyPort').value.trim();
  const def = String(defaultProxyPort(t));
  if (!cur || cur === lastAutoPort) {
    $('#proxyPort').value = def;
    lastAutoPort = def;
  }
  checkProxyPasswordHint();
};

// 填了主机就默认启用代理，避免「填了但没勾选」导致静默失效
$('#proxyHost').addEventListener('input', (e) => {
  if (e.target.value.trim()) $('#proxyEnabled').checked = true;
});

$('#proxyPass').addEventListener('input', checkProxyPasswordHint);

/** SOCKS 认证拿不到编码前的密码，含特殊字符时提前说清楚 */
function checkProxyPasswordHint() {
  const box = $('#proxyWarn');
  if (!box) return;
  const pass = $('#proxyPass').value;
  const type = $('#proxyType').value;
  const unsafe = /^socks/i.test(type) && !!pass && !/^[A-Za-z0-9\-._~!$&'()*+,;=]*$/.test(pass);
  box.hidden = !unsafe;
  if (unsafe) {
    box.textContent =
      '这个密码含 @ : / % 或空格，SOCKS 认证可能失败。可改用 HTTP 代理，或给代理设置一个只含字母数字的密码。';
  }
}

// 勾了「启用代理」但忘了填密码，之前保存在本机的密码继续沿用
$('#proxyEnabled').onchange = (e) => {
  if (e.target.checked && !$('#proxyHost').value) $('#proxyHost').focus();
};

document.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '');
  if (e.key === 'F9') {
    e.preventDefault();
    toggleReader();
    return;
  }
  if (e.key === 'Escape') {
    ['composeModal', 'accountModal', 'noteModal'].forEach((id) => {
      const box = document.getElementById(id);
      if (box && !box.hidden) closeModal(id);
    });
  }
  if (!typing && e.key === 'c' && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    openCompose('new');
  }
  if (!typing && e.key === 'r' && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    $('#refreshBtn').click();
  }
});

/* ---------------- 启动 ---------------- */

/** 独立阅读窗口：只渲染一封邮件，关掉就回主界面 */
async function initReaderPane() {
  document.body.classList.add('pane-reader');
  document.querySelector('.app').classList.add('reader-only');
  try {
    await loadSettings();
  } catch {
    /* 拿不到设置就用默认策略（拦截外部图片） */
  }

  const p = new URLSearchParams(location.search);
  state.activeId = p.get('acc');
  state.folder = p.get('folder') || 'INBOX';
  const uid = Number(p.get('uid'));
  if (!state.activeId || !Number.isFinite(uid) || !uid) {
    $('#reader').innerHTML = `<div class="welcome">
      <div class="welcome-art">😕</div><h1>没有指定邮件</h1>
      <p>请回到主窗口，点列表上方的「在新窗口打开」。</p>
      <button class="ghost-btn" onclick="window.close()">关闭这个窗口</button></div>`;
    return;
  }

  // 主窗口换邮件时，这里跟着换
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin) return;
    const d = e.data || {};
    if (d.source !== 'ikuyoMail-main' || d.type !== 'open') return;
    if (d.acc !== state.activeId) return;
    state.folder = d.folder || state.folder;
    openMessage({ uid: d.uid });
  });

  await openMessage({ uid });
}

(async function init() {
  if (READER_PANE) {
    await initReaderPane();
    return;
  }
  try {
    const { providers, options } = await api('/providers');
    state.providers = providers || [];
    state.providerOptions = options || [];
  } catch {
    state.providers = [];
    state.providerOptions = [];
  }
  await loadSettings();
  connectEvents();
  sendHeartbeat();
  setInterval(sendHeartbeat, 10000);
  document.addEventListener('visibilitychange', sendHeartbeat);
  window.addEventListener('focus', sendHeartbeat);
  window.addEventListener('blur', sendHeartbeat);

  try {
    await loadAccounts();
  } catch (err) {
    toast('无法连接本地服务：' + err.message, 'error');
    return;
  }
  if (state.accounts.length) {
    await bootAccount();
  } else {
    renderFolders([]);
    renderMessages();
    showWelcome();
  }

  // 从托盘菜单的「设置…」进来时直接打开设置面板
  applyRoute();
})();

/* ---------------- 版本号 ---------------- */

// 以服务端的 package.json 为准，界面里不写死
fetch('/api/version')
  .then((r) => (r.ok ? r.json() : null))
  .then((info) => {
    const el = document.getElementById('appVer');
    if (el && info && info.version) el.innerHTML = `ikuyoMail <b>V${info.version}</b>`;
  })
  .catch(() => {});

/* ---------------- 外部指令（托盘菜单 / 桌面外壳） ---------------- */

/** #settings 由托盘菜单、桌面外壳传进来；处理完就把 hash 擦掉，免得刷新又弹一次 */
function applyRoute() {
  if (location.hash === '#settings') {
    history.replaceState(null, '', location.pathname);
    openSettings().catch((err) => toast(err.message, 'error'));
    return true;
  }
  return false;
}
window.addEventListener('hashchange', applyRoute);

/** 桌面外壳（WebView2）通过它回话：PDF 存好了、要看设置面板 */
window.ikuyoMail = {
  openSettings: () => {
    location.hash = '#settings';
  },
  pdfDone: (ok, filePath, message) => {
    if (ok) {
      const name = String(filePath || '').split(/[\\/]/).pop();
      toast(`已保存为 ${name || 'PDF'}`, 'success');
    } else {
      toast(message || 'PDF 生成失败', 'error');
    }
  },
};
