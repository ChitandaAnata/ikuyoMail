/* 邮件 PDF 排版页：只负责把一封邮件的完整内容排成一张可打印的 A4 文档 */
'use strict';

const params = new URLSearchParams(location.search);
const acc = params.get('acc') || '';
const folder = params.get('folder') || 'INBOX';
const uid = Number(params.get('uid'));
const auto = params.get('auto') === '1';

const $ = (id) => document.getElementById(id);

const escapeHtml = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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

const addrText = (list) =>
  (list || []).map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).filter(Boolean).join(', ');

function fail(message) {
  $('doc').hidden = true;
  const box = $('pStatus');
  box.hidden = false;
  box.textContent = message;
  ready();
}

function ready() {
  const wv = window.chrome?.webview;
  if (wv && typeof wv.postMessage === 'function') {
    wv.postMessage({ type: 'print-ready' });
  } else if (auto) {
    // 浏览器里没有外壳：直接调系统打印对话框，目标选「另存为 PDF」
    setTimeout(() => window.print(), 350);
  }
}

/** 正文用 Shadow DOM 装起来：邮件自带的 CSS 不会跑出来污染标题区 */
function renderBody(msg) {
  const host = $('pBody');
  const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  const html = (msg.html || '').trim();
  const style = document.createElement('style');
  style.textContent = `
    :host { display: block; }
    * { max-width: 100%; }
    img { max-width: 100% !important; height: auto !important; }
    table { max-width: 100% !important; }
    a { color: #2f55c8; text-decoration: none; }
    pre { white-space: pre-wrap; word-break: break-word; font-family: inherit; }
    blockquote { margin: 0 0 0 2px; padding: 0 0 0 11px; border-left: 3px solid #e2e5ec; color: #545b6b; }
  `;
  const wrap = document.createElement('div');
  if (html) {
    // shadow root + 内联 CSP：邮件里的 <script>、onerror 都不会执行
    wrap.innerHTML = html;
  } else {
    const pre = document.createElement('pre');
    pre.className = 'plain';
    pre.textContent = msg.text || '（这封邮件没有正文）';
    wrap.appendChild(pre);
  }
  root.appendChild(style);
  root.appendChild(wrap);
  return wrap;
}

/** 等图片加载完再打印，否则 PDF 里会留一片空白 */
async function waitImages(container) {
  const imgs = [...container.querySelectorAll('img')];
  if (!imgs.length) return;
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise((resolve) => {
          if (img.complete && img.naturalWidth > 0) return resolve();
          const done = () => resolve();
          img.addEventListener('load', done, { once: true });
          img.addEventListener('error', done, { once: true });
          setTimeout(done, 4000);
        })
    )
  );
}

(async function init() {
  if (!acc || !Number.isFinite(uid) || !uid) {
    fail('没有指定要导出的邮件。');
    return;
  }
  let message;
  try {
    const res = await fetch(
      `/api/accounts/${encodeURIComponent(acc)}/message?folder=${encodeURIComponent(folder)}&uid=${uid}`
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `读取失败（${res.status}）`);
    message = data.message;
  } catch (err) {
    fail('这封邮件打不开：' + err.message);
    return;
  }

  document.title = `${message.subject || '邮件'} · PDF`;
  $('pSubject').textContent = message.subject || '(无主题)';

  const from = (message.from || [])[0] || {};
  $('pFrom').textContent = from.name ? `${from.name} <${from.address}>` : from.address || '（未知）';
  $('pTo').textContent = addrText(message.to) || '（未知）';
  if ((message.cc || []).length) {
    $('pCcRow').hidden = false;
    $('pCc').textContent = addrText(message.cc);
  }
  $('pDate').textContent = fmtFull(message.date);

  // 本地备注（只有从本机客户端导出时才带得过来，这里读列表里的那份）
  try {
    const res = await fetch(`/api/accounts/${encodeURIComponent(acc)}/marks`);
    if (res.ok) {
      const { marks } = await res.json();
      const mk = marks?.[`${folder}|${uid}`];
      if (mk?.note) {
        $('pNote').hidden = false;
        // 用文字前缀而不是 emoji：PDF 里 emoji 字体不一定有，会变成方框
        $('pNote').textContent = `备注 · ${mk.note}`;
      }
    }
  } catch {
    /* 备注拿不到不影响正文 */
  }

  const body = renderBody(message);

  const atts = (message.attachments || []).filter((a) => !a.inline || a.size > 60000);
  if (atts.length) {
    $('pAtts').hidden = false;
    $('pAttList').innerHTML = atts
      .map((a) => `<li>${escapeHtml(a.filename)}<span style="color:#8b91a1"> · ${fmtSize(a.size)}</span></li>`)
      .join('');
  }

  await waitImages(body);
  // 再等一帧，确保排版稳定（字体、表格宽度都定下来了）
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  ready();
})();
