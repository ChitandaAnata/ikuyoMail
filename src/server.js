import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROVIDERS, PROVIDER_OPTIONS, guessProvider, resolveConfig } from './providers.js';
import { normalizeProxy, socksPasswordUnsafe, SOCKS_PASSWORD_HINT } from './proxy.js';
import {
  addAccount,
  getAccountWithSecret,
  listAccounts,
  removeAccount,
  searchContacts,
  updateAccount,
} from './store.js';
import {
  deleteMessage,
  diagnose,
  dropConnection,
  forgetSearchIndex,
  getAttachment,
  getMessage,
  listFolders,
  listMessages,
  normalizeError,
  sendMail,
  setFlags,
  testAccount,
  warmSearchIndex,
} from './imap.js';
import { getSettings, saveSettings } from './settings.js';
import * as marks from './marks.js';
import * as notifier from './notifier.js';
import * as poller from './poller.js';
import * as autostart from './autostart.js';

const APP_NAME = 'ikuyoMail';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 版本号只认 package.json，设置面板和安装程序都从这儿取
const ROOT_DIR = path.resolve(__dirname, '..');
const APP_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version || '1.0.0';
  } catch {
    return '1.0.0';
  }
})();
const app = express();
const PORT = Number(process.env.PORT) || 7317;
const BASE = `http://127.0.0.1:${PORT}`;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.resolve(__dirname, '..', 'public'), { extensions: ['html'] }));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * refresh=1 表示丢弃当前 IMAP 会话、重新握手。
 * 用于「刷新」「重新连接」这类需要看到服务端最新状态的场景：
 * 有些服务商（网易 Coremail）的旧会话会一直返回建立时那一版的邮件数字。
 */
const isRefresh = (req) => ['1', 'true', 'yes'].includes(String(req.query.refresh || '').toLowerCase());

function requireAccount(id) {
  const acc = getAccountWithSecret(id);
  if (!acc) {
    const err = new Error('账号不存在，可能已被删除');
    err.status = 404;
    throw err;
  }
  return acc;
}

app.get('/api/providers', (req, res) => {
  res.json({
    providers: Object.values(PROVIDERS).map((p) => ({
      id: p.id,
      name: p.name,
      domain: p.domain,
      authType: p.authType,
      hint: p.hint,
      help: p.help,
      imap: p.imap,
      smtp: p.smtp,
    })),
    // 下拉菜单用：每项对应一个「服务商 + 域名」组合，选中后域名即锁定
    options: PROVIDER_OPTIONS,
  });
});

app.get('/api/accounts', (req, res) => {
  res.json({ accounts: listAccounts() });
});

app.post(
  '/api/accounts',
  wrap(async (req, res) => {
    const { email, pass, name, provider, imap, smtp, username, proxy } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+$/.test(String(email).trim())) {
      return res.status(400).json({ error: '请填写正确的邮箱地址' });
    }
    if (!pass || !String(pass).trim()) {
      return res.status(400).json({ error: '请填写密码或授权码' });
    }
    const pid = provider && PROVIDERS[provider] ? provider : guessProvider(email);
    let cfg;
    try {
      cfg = resolveConfig({ provider: pid, email: String(email).trim(), imap, smtp });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const proxyCfg = normalizeProxy(proxy);
    if (proxyCfg && (!proxyCfg.host || !proxyCfg.port)) {
      return res.status(400).json({ error: '代理地址不完整，请填写主机与端口' });
    }
    const draft = {
      email: String(email).trim(),
      username: (username || email).trim(),
      provider: pid,
      imap: cfgnorm(cfg.imap),
      smtp: cfgnorm(cfg.smtp),
      pass: String(pass).trim(),
      proxy: proxyCfg,
      name: (name || '').trim() || String(email).split('@')[0],
    };

    // 先验证再落盘，避免存一堆登不上的账号
    const probeId = 'probe-' + crypto.randomUUID();
    const test = await testAccount({ ...draft, id: probeId });
    dropConnection(probeId);
    if (!test.imap) {
      return res.status(400).json({ error: test.error || 'IMAP 登录失败', detail: test });
    }
    const saved = addAccount(draft);
    res.json({
      account: saved,
      test,
      warning: socksPasswordUnsafe(proxyCfg) ? SOCKS_PASSWORD_HINT : null,
    });
  })
);

function cfgnorm(c) {
  return {
    host: c.host,
    port: Number(c.port) || (c.secure === false ? 143 : 993),
    secure: c.secure !== false,
    allowInvalidCert: !!c.allowInvalidCert,
  };
}

app.patch(
  '/api/accounts/:id',
  wrap(async (req, res) => {
    const patch = { ...(req.body || {}) };
    const current = getAccountWithSecret(req.params.id);
    if (!current) return res.status(404).json({ error: '账号不存在' });

    if (patch.imap) patch.imap = cfgnorm({ ...current.imap, ...patch.imap });
    if (patch.smtp) patch.smtp = cfgnorm({ ...current.smtp, ...patch.smtp });

    // 代理：没填新密码就沿用已保存的，clearPassword 表示主动清空
    if (patch.proxy !== undefined) {
      const clearPassword = !!patch.proxy?.clearPassword;
      const incoming = normalizeProxy(patch.proxy);
      if (incoming) {
        if (!incoming.password && !clearPassword) {
          incoming.password = current.proxy?.password || '';
        }
        if (clearPassword) incoming.clearPassword = true;
      }
      patch.proxy = incoming;
    }

    // 改了口令 / 服务器 / 代理就要重新验证，验证不过不落盘，避免把自己锁在门外
    const needVerify =
      !!patch.pass || !!patch.imap || !!patch.smtp || patch.proxy !== undefined;
    let test = null;
    if (needVerify) {
      const draft = {
        ...current,
        pass: patch.pass || current.pass,
        imap: patch.imap || current.imap,
        smtp: patch.smtp || current.smtp,
        proxy: patch.proxy !== undefined ? patch.proxy : current.proxy,
        name: patch.name !== undefined ? patch.name : current.name,
      };
      test = await testAccount({ ...draft, id: 'verify-' + current.id });
      dropConnection('verify-' + current.id);
      if (!test.imap) {
        return res.status(400).json({ error: test.error || 'IMAP 验证失败，修改未保存', detail: test });
      }
    }

    const acc = updateAccount(req.params.id, patch);
    dropConnection(req.params.id);
    res.json({
      account: acc,
      test,
      warning: socksPasswordUnsafe(patch.proxy) ? SOCKS_PASSWORD_HINT : null,
    });
  })
);

app.get(
  '/api/accounts/:id/diagnose',
  wrap(async (req, res) => {
    const acc = requireAccount(req.params.id);
    const data = await diagnose(acc, { folder: String(req.query.folder || 'INBOX') });
    res.json(data);
  })
);

app.get('/api/contacts', (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(Math.max(Number(req.query.limit) || 8, 1), 30);
  res.json({ contacts: searchContacts(q, limit) });
});

app.delete(
  '/api/accounts/:id',
  wrap(async (req, res) => {
    dropConnection(req.params.id);
    poller.forgetAccount(req.params.id);
    forgetSearchIndex(req.params.id);
    marks.forgetAccount(req.params.id);
    const ok = removeAccount(req.params.id);
    res.json({ ok });
  })
);

app.post(
  '/api/accounts/:id/test',
  wrap(async (req, res) => {
    const acc = requireAccount(req.params.id);
    const test = await testAccount(acc);
    updateAccount(acc.id, { lastError: test.error || null });
    res.json(test);
  })
);

app.get(
  '/api/accounts/:id/folders',
  wrap(async (req, res) => {
    const acc = requireAccount(req.params.id);
    const folders = await listFolders(acc, { fresh: isRefresh(req) });
    res.json({ folders });
  })
);

app.get(
  '/api/accounts/:id/messages',
  wrap(async (req, res) => {
    const acc = requireAccount(req.params.id);
    const { folder = 'INBOX', page = 1, pageSize = 30, q = '' } = req.query;
    const data = await listMessages(acc, {
      folder: String(folder),
      page: Number(page),
      pageSize: Number(pageSize),
      query: String(q || ''),
      fresh: isRefresh(req),
    });
    // 置顶 / 待办 / 备注是纯本地的，直接贴在列表项上
    marks.attachMarks(acc.id, String(folder), data.messages || []);
    res.json(data);
    // 搜索索引还没扫完 / 平时浏览列表时顺手补上，下次搜就是秒出
    if (data.server?.indexPending || (!String(q || '').trim() && data.server?.searched)) {
      warmSearchIndex(acc, String(folder));
    }
  })
);

app.get(
  '/api/accounts/:id/message',
  wrap(async (req, res) => {
    const acc = requireAccount(req.params.id);
    const { folder = 'INBOX', uid, markRead } = req.query;
    if (!uid) return res.status(400).json({ error: '缺少 uid' });
    const data = await getMessage(acc, { folder: String(folder), uid: Number(uid) });
    res.json({ message: data });
    if (String(markRead) === '1' && data.unread) {
      setFlags(acc, { folder: String(folder), uid: Number(uid), seen: true }).catch(() => {});
    }
  })
);

app.get(
  '/api/accounts/:id/attachment',
  wrap(async (req, res) => {
    const acc = requireAccount(req.params.id);
    const { folder = 'INBOX', uid, index = 0 } = req.query;
    const att = await getAttachment(acc, { folder: String(folder), uid: Number(uid), index: Number(index) });
    res.setHeader('Content-Type', att.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(att.filename)}`
    );
    res.send(att.content);
  })
);

app.post(
  '/api/accounts/:id/flags',
  wrap(async (req, res) => {
    const acc = requireAccount(req.params.id);
    const { folder = 'INBOX', uid, seen, flagged } = req.body || {};
    const out = await setFlags(acc, { folder, uid: Number(uid), seen, flagged });
    res.json(out);
  })
);

app.delete(
  '/api/accounts/:id/message',
  wrap(async (req, res) => {
    const acc = requireAccount(req.params.id);
    const { folder = 'INBOX', uid } = req.query;
    const out = await deleteMessage(acc, { folder: String(folder), uid: Number(uid) });
    // 邮件没了，本地的置顶 / 待办 / 备注也不用留着
    marks.removeMark(acc.id, String(folder), Number(uid));
    res.json(out);
  })
);

/* ---------------- 本地标记（置顶 / 待办 / 备注） ----------------
   服务器上没有这类字段，全部存在本机 data/marks.json。 */

app.get('/api/accounts/:id/marks', (req, res) => {
  const acc = requireAccount(req.params.id);
  res.json({ marks: marks.listMarks(acc.id) });
});

app.post(
  '/api/accounts/:id/mark',
  wrap(async (req, res) => {
    const acc = requireAccount(req.params.id);
    const { folder = 'INBOX', uid, pinned, todo, note, messageId, subject } = req.body || {};
    if (!Number(uid)) return res.status(400).json({ error: '缺少 uid' });
    const mark = marks.patchMark(acc.id, String(folder), Number(uid), {
      pinned,
      todo,
      note,
      messageId,
      subject,
    });
    res.json({
      ok: true,
      mark: mark || null,
      pinned: !!mark?.pinned,
      todo: !!mark?.todo,
      note: mark?.note || '',
    });
  })
);

app.post(
  '/api/accounts/:id/send',
  wrap(async (req, res) => {
    const acc = requireAccount(req.params.id);
    const out = await sendMail(acc, req.body || {});
    res.json(out);
  })
);

/* ---------------- 实时事件（SSE）：新邮件推给页面 ---------------- */

const sseClients = new Set();
const presence = new Map(); // clientId -> { visible, at }

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of sseClients) {
    try {
      c.res.write(payload);
    } catch {
      /* 已经断开的连接会在 close 事件里清掉 */
    }
  }
}

/** 窗口在前台且有心跳的客户端数量——有的话就用应用内提醒，不再弹系统通知 */
function visibleCount() {
  const now = Date.now();
  let n = 0;
  for (const v of presence.values()) {
    if (v.visible && now - v.at < 30000) n++;
  }
  return n;
}

let everHadClient = false;
let quitTimer = null;
const CLOSE_GRACE_MS = 15000;

function onClientGone() {
  if (sseClients.size > 0) return;
  if (quitTimer) clearTimeout(quitTimer);
  quitTimer = setTimeout(() => {
    quitTimer = null;
    if (sseClients.size > 0) return;
    const s = getSettings();
    if (everHadClient && s.closeAction === 'quit') shutdown('窗口已关闭');
  }, CLOSE_GRACE_MS);
  if (quitTimer.unref) quitTimer.unref();
}

function shutdown(reason = '') {
  console.log(`  [ikuyoMail] 正在退出${reason ? '：' + reason : ''}`);
  poller.stopPolling();
  marks.flush();
  broadcast('bye', { reason });
  for (const c of sseClients) {
    try {
      c.res.end();
    } catch {
      /* ignore */
    }
  }
  sseClients.clear();
  // 这里必须硬杀：走「写命令等它自己退出」会和本进程的 exit 抢时间，容易留孤儿托盘进程
  notifier.stopTray({ hard: true });
  setTimeout(() => process.exit(0), 500);
}

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
  const client = { res };
  sseClients.add(client);
  everHadClient = true;
  if (quitTimer) {
    clearTimeout(quitTimer);
    quitTimer = null;
  }

  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* ignore */
    }
  }, 25000);
  if (ping.unref) ping.unref();

  req.on('close', () => {
    clearInterval(ping);
    sseClients.delete(client);
    onClientGone();
  });
});

app.post('/api/heartbeat', (req, res) => {
  const { clientId = 'anon', visible } = req.body || {};
  const now = Date.now();
  presence.set(String(clientId), { visible: !!visible, at: now });
  for (const [k, v] of presence) {
    if (now - v.at > 120000) presence.delete(k);
  }
  res.json({ ok: true, tray: notifier.isTrayRunning() });
});

/* ---------------- 界面最小宽度（给桌面外壳用） ----------------
   页面知道自己三块加起来最少要多少像素（收起阅读区时和展开时不一样），
   把它报上来；assets/shell.ps1 轮询这个值，窗口就不会被拖到把内容挤出视口。 */
let uiMinWidth = 998;
let uiMinWidthAt = Date.now();

app.post('/api/ui/min-width', (req, res) => {
  const w = Number((req.body || {}).width);
  if (Number.isFinite(w) && w >= 300 && w <= 2400) {
    uiMinWidth = Math.round(w);
    uiMinWidthAt = Date.now();
  }
  res.json({ ok: true, width: uiMinWidth });
});

// 身份：exe 用它判断这个端口上的服务是不是「自己这一份程序」拉起来的。
// 不同目录里的多份安装各自 serve 各自的界面，不能随便串。
app.get('/api/identity', (req, res) => {
  res.json({ name: APP_NAME, version: APP_VERSION, root: ROOT_DIR, pid: process.pid, port: PORT });
});

app.get('/api/version', (req, res) => {
  res.json({ name: APP_NAME, version: APP_VERSION });
});

app.get('/api/ui/min-width', (req, res) => {
  res.json({ width: uiMinWidth, at: uiMinWidthAt });
});

/* ---------------- 设置 ---------------- */

function settingsPayload() {
  return {
    settings: { ...getSettings(), autoStart: autostart.isEnabled() },
    status: {
      tray: notifier.isTrayRunning(),
      traySupported: notifier.isSupported(),
      visibleClients: visibleCount(),
      poll: poller.getStatus(),
      autoStart: autostart.isEnabled(),
      autoStartSupported: autostart.isSupported(),
      autoStartPath: autostart.isSupported() ? autostart.entryPath() : null,
    },
  };
}

function applyTrayPreference(before, after) {
  if (after.trayEnabled && !notifier.isTrayRunning()) {
    notifier.startTray({ baseUrl: BASE, appUrl: BASE + '/', tip: APP_NAME });
  } else if (!after.trayEnabled && before.trayEnabled) {
    notifier.stopTray({ hard: true });
  }
}

app.get('/api/settings', (req, res) => res.json(settingsPayload()));

app.patch('/api/settings', (req, res) => {
  const before = getSettings();
  const patch = { ...(req.body || {}) };
  let autoStartError = null;

  // 开机自启的真实来源是「启动」文件夹里的那个文件，成功与否都要如实回报
  if (patch.autoStart !== undefined) {
    const r = autostart.setEnabled(!!patch.autoStart);
    if (!r.ok) autoStartError = r.error;
    patch.autoStart = r.enabled;
  }

  const after = saveSettings(patch);
  if (after.pollInterval !== before.pollInterval) poller.reschedule();
  applyTrayPreference(before, after);
  res.json({ ...settingsPayload(), autoStartError });
});

app.post(
  '/api/check-now',
  wrap(async (req, res) => {
    const out = await poller.checkOnce();
    res.json({ ...out, status: poller.getStatus() });
  })
);

app.post('/api/notify/test', (req, res) => {
  const s = getSettings();
  const sample = {
    type: 'mail',
    test: true,
    accountId: 'test',
    accountName: '示例账号',
    accountEmail: 'demo@example.com',
    unseen: 1,
    count: 1,
    items: [
      {
        uid: 0,
        subject: '这是一条测试通知，用来确认提醒和提示音是否正常',
        fromName: 'ikuyoMail',
        fromAddress: 'ikuyo@local',
        date: new Date().toISOString(),
        hasAttachments: false,
      },
    ],
  };
  broadcast('mail', sample);
  let desktop = false;
  if (s.notifyDesktop && notifier.isTrayRunning()) {
    desktop = notifier.notifyDesktop({
      title: '新邮件 · 示例账号',
      body: 'ikuyoMail：这是一条测试通知，用来确认提醒和提示音是否正常',
      sound: s.notifySound,
    });
  }
  res.json({ ok: true, inApp: sseClients.size > 0, desktop, tray: notifier.isTrayRunning() });
});

app.post('/api/power/quit', (req, res) => {
  res.json({ ok: true });
  setTimeout(() => shutdown('用户从托盘或界面退出'), 120);
});

/* ---------------- 新邮件提醒 ---------------- */

poller.onMailEvent((evt) => {
  if (evt.type !== 'mail') return;
  broadcast('mail', evt);

  const s = getSettings();
  if (!s.notifyEnabled) return;

  if (evt.unseen > 0) notifier.setTip(`ikuyoMail · ${evt.unseen} 封未读`);

  // 页面在前台就用应用内提醒（已有），窗口不在前台才额外弹系统通知，避免重复打扰
  if (!s.notifyDesktop || !notifier.isTrayRunning() || visibleCount() > 0) return;

  const first = evt.items[0] || {};
  const title =
    evt.count > 1 ? `${evt.accountName} 收到 ${evt.count} 封新邮件` : `新邮件 · ${evt.accountName}`;
  const body =
    evt.count > 1
      ? evt.items.map((i) => `${i.fromName || i.fromAddress}：${i.subject}`).join('\n')
      : `${first.fromName || first.fromAddress || '未知发件人'}：${first.subject || '(无主题)'}`;
  notifier.notifyDesktop({ title, body, sound: s.notifySound });
});

app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));


app.use((err, req, res, next) => {
  const e = normalizeError(err);
  const status = err.status || (/登录被拒绝|超时|无法解析/.test(e.message) ? 400 : 500);
  if (status >= 500) console.error('[ikuyoMail]', err?.stack || err);
  res.status(status).json({ error: e.message });
});

app.listen(PORT, '127.0.0.1', async () => {
  console.log(`\n  ✉️  ${APP_NAME} 已启动： ${BASE}\n`);
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    console.warn(
      '  ⚠️  检测到 NODE_TLS_REJECT_UNAUTHORIZED=0：这会关闭 Node 的证书校验。\n' +
      '      本程序对每台邮件服务器单独指定了校验策略，但建议取消该环境变量后再运行。\n'
    );
  }

  const s = getSettings();
  // 启动文件夹里的文件才是开机自启的真实状态，设置项跟着它对齐
  if (autostart.isSupported()) {
    const actual = autostart.isEnabled();
    if (s.autoStart !== actual) saveSettings({ autoStart: actual });
  }
  if (s.trayEnabled && notifier.isSupported()) {
    const ok = notifier.startTray({ baseUrl: BASE, appUrl: BASE + '/', tip: APP_NAME });
    console.log(ok ? '  📌 托盘图标已启动（关闭窗口后仍在后台收信）' : '  📌 托盘图标启动失败，仅保留后台进程');
  }
  try {
    const sec = await poller.startPolling();
    console.log(`  ⏱  每 ${sec} 秒检查一次新邮件${s.notifyEnabled ? '' : '（提醒已关闭）'}`);
  } catch {
    /* 轮询失败不影响收信 */
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try {
      marks.flush();
    } catch {
      /* ignore */
    }
    try {
      notifier.stopTray({ hard: true });
    } catch {
      /* ignore */
    }
    process.exit(0);
  });
}

