/**
 * 演示模式：不连接任何服务器，用内存假数据预览界面。
 * 启动： node src/demo.js   → http://127.0.0.1:7318
 */
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROVIDERS, PROVIDER_OPTIONS } from './providers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.DEMO_PORT) || 7318;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.resolve(__dirname, '..', 'public')));

const ACC = {
  id: 'demo-account',
  name: '林小满',
  email: 'xiaoman@qq.com',
  provider: 'qq',
  username: 'xiaoman@qq.com',
  imap: { host: 'imap.qq.com', port: 993, secure: true },
  smtp: { host: 'smtp.qq.com', port: 465, secure: true },
  proxy: {
    enabled: true,
    type: 'socks5',
    host: '127.0.0.1',
    port: 1080,
    username: 'demo',
    hasPassword: true,
  },
  createdAt: new Date().toISOString(),
  lastError: null,
};

const FOLDERS = [
  { path: 'INBOX', name: '收件箱', specialUse: '\\Inbox', selectable: true, messages: 128, unseen: 5 },
  { path: 'Sent Messages', name: '已发送', specialUse: '\\Sent', selectable: true, messages: 64, unseen: 0 },
  { path: 'Drafts', name: '草稿箱', specialUse: '\\Drafts', selectable: true, messages: 2, unseen: 0 },
  { path: 'Junk', name: '垃圾邮件', specialUse: '\\Junk', selectable: true, messages: 9, unseen: 0 },
  { path: 'Trash', name: '废纸篓', specialUse: '\\Trash', selectable: true, messages: 17, unseen: 0 },
  { path: '工作/项目组', name: '工作/项目组', specialUse: null, selectable: true, messages: 41, unseen: 1 },
];

const now = Date.now();
const mins = (n) => new Date(now - n * 60000).toISOString();

const MESSAGES = [
  {
    uid: 401,
    subject: 'Q4 产品路线图评审 —— 会议邀请与议程',
    fromName: '周砚',
    fromAddress: 'zhouyan@company.com',
    to: '林小满 <xiaoman@qq.com>',
    date: mins(12),
    unread: true,
    flagged: true,
    hasAttachments: true,
    text: '小满你好，\n\n下周三上午 10:00 安排 Q4 路线图评审，会议室 A-302，预计 90 分钟。\n\n议程：\n1. 上季度数据复盘\n2. Q4 三个重点方向\n3. 资源与排期确认\n4. 风险项\n\n请提前把负责模块的单页说明发我，方便会前预读。会议材料见附件。\n\n周砚',
    html: `<div style="font-family:-apple-system,'PingFang SC',sans-serif">
      <p>小满你好，</p>
      <p>下周三上午 <b>10:00</b> 安排 Q4 路线图评审，会议室 A-302，预计 90 分钟。</p>
      <p>议程：</p>
      <ol>
        <li>上季度数据复盘</li>
        <li>Q4 三个重点方向</li>
        <li>资源与排期确认</li>
        <li>风险项</li>
      </ol>
      <p>请提前把负责模块的单页说明发我，方便会前预读。会议材料见附件。</p>
      <p style="color:#888;font-size:12px">—— 周砚 / 产品部</p>
    </div>`,
    attachments: [
      { index: 0, filename: 'Q4路线图-草案-v3.pdf', size: 482133, contentType: 'application/pdf', cid: null, inline: false },
      { index: 1, filename: '议程安排.docx', size: 24331, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', cid: null, inline: false },
    ],
  },
  {
    uid: 400,
    subject: '你的 GitHub 账号有一份新的安全提醒',
    fromName: 'GitHub',
    fromAddress: 'noreply@github.com',
    to: 'xiaoman@qq.com',
    date: mins(58),
    unread: true,
    flagged: false,
    hasAttachments: false,
    text: 'Hi xiaoman,\n\nA new personal access token was created for your account. If this was you, no action is needed.',
    html: `<div style="font-family:-apple-system,sans-serif;max-width:560px">
      <div style="border-bottom:1px solid #eee;padding-bottom:10px;margin-bottom:16px">
        <b style="font-size:15px">GitHub</b>
      </div>
      <p>Hi <b>xiaoman</b>,</p>
      <p>A new personal access token was created for your account. If this was you, no action is needed.</p>
      <table style="width:100%;background:#f7f8fa;border-radius:8px;padding:12px;font-size:13px">
        <tr><td style="color:#888;padding:4px 8px">Token</td><td>cli-••••••4f9a</td></tr>
        <tr><td style="color:#888;padding:4px 8px">Created</td><td>2026-10-27 09:12 UTC</td></tr>
        <tr><td style="color:#888;padding:4px 8px">Scopes</td><td>repo, workflow</td></tr>
      </table>
      <p style="margin-top:18px">If you didn't do this, <a href="https://github.com">revoke it now</a>.</p>
    </div>`,
    attachments: [],
  },
  {
    uid: 399,
    subject: '设计稿已更新：邮箱客户端三栏布局（含暗色方案）',
    fromName: '苏念',
    fromAddress: 'sunian@studio.design',
    to: '林小满 <xiaoman@qq.com>',
    date: mins(180),
    unread: true,
    flagged: false,
    hasAttachments: true,
    text: '小满，设计稿更新了一版，主要调整：\n- 列表行高加了一点，读起来更松\n- 阅读区加了正文宽度限制\n- 补了暗色方案的对比度\n\nFigma 链接稍后发你。',
    html: `<div style="font-family:-apple-system,'PingFang SC',sans-serif">
      <p>小满，设计稿更新了一版，主要调整：</p>
      <img src="http://127.0.0.1:7318/demo-banner.svg" alt="新版列表预演" style="width:100%;max-width:520px;border:1px solid #eee;border-radius:10px;margin:6px 0 10px">
      <ul><li>列表行高加了一点，读起来更松</li><li>阅读区加了正文宽度限制</li><li>补了暗色方案的对比度</li></ul>
      <p>Figma 链接稍后发你。</p>
      <p style="color:#999;font-size:12px">苏念 · 设计</p>
    </div>`,
    attachments: [{ index: 0, filename: 'mailbox-ui-v2.png', size: 1284113, contentType: 'image/png', cid: null, inline: false }],
  },
  {
    uid: 398,
    subject: '【通知】10 月水电费账单已生成',
    fromName: '城市生活服务',
    fromAddress: 'service@citylife.cn',
    to: 'xiaoman@qq.com',
    date: mins(300),
    unread: false,
    flagged: false,
    hasAttachments: false,
    text: '您 10 月的水电费账单已生成，应缴金额 186.40 元，请于 11 月 10 日前完成缴费。',
    html: `<div style="font-family:-apple-system,'PingFang SC',sans-serif">
      <p>您 10 月的水电费账单已生成：</p>
      <p style="font-size:22px;color:#3d63dd;font-weight:700">¥ 186.40</p>
      <p style="color:#666">请于 11 月 10 日前完成缴费。</p>
    </div>`,
    attachments: [],
  },
  {
    uid: 397,
    subject: 'Re: 关于邮件同步性能的几个问题',
    fromName: '陈楠',
    fromAddress: 'chennan@company.com',
    to: '林小满 <xiaoman@qq.com>',
    date: mins(420),
    unread: false,
    flagged: true,
    hasAttachments: false,
    text: '大概测了一下，5 万封的收件箱首次打开约 1.8 秒，只拉信封不拉正文，这个量级可以接受。\n\n分页用 sequence range 就够，别用全部 UID 排序。',
    html: `<div style="font-family:-apple-system,'PingFang SC',sans-serif">
      <p>大概测了一下，5 万封的收件箱首次打开约 <b>1.8 秒</b>，只拉信封不拉正文，这个量级可以接受。</p>
      <p>分页用 sequence range 就够，别用全部 UID 排序。</p>
      <blockquote style="border-left:3px solid #e5e7eb;margin:0;padding-left:12px;color:#6b7280">
        <p style="margin:0">之前用的是全量拉取再切片，大邮箱会卡住。</p>
      </blockquote>
    </div>`,
    attachments: [],
  },
  {
    uid: 396,
    subject: '本周技术分享：IMAP 协议到底在聊什么',
    fromName: '技术委员会',
    fromAddress: 'tech-talk@company.com',
    to: 'all@company.com',
    date: mins(1500),
    unread: true,
    flagged: false,
    hasAttachments: false,
    text: '周五下午 4 点，大会议室。会讲 IMAP 的命令模型、文件夹与 UID 的关系、以及为什么浏览器不能直接连 IMAP。',
    html: `<div style="font-family:-apple-system,'PingFang SC',sans-serif">
      <p>周五下午 <b>4:00</b>，大会议室。</p>
      <p>会讲：IMAP 的命令模型、文件夹与 UID 的关系、以及为什么浏览器不能直接连 IMAP。</p>
      <p style="background:#f5f7fa;padding:12px;border-radius:8px;font-size:13px">📌 建议先看一眼 RFC 3501 的 6.4 节，会更跟得上。</p>
    </div>`,
    attachments: [],
  },
  {
    uid: 395,
    subject: 'Your Spotify Wrapped is almost ready',
    fromName: 'Spotify',
    fromAddress: 'no-reply@spotify.com',
    to: 'xiaoman@qq.com',
    date: mins(2600),
    unread: false,
    flagged: false,
    hasAttachments: false,
    text: 'Your year in music is almost here. Get ready.',
    html: `<div style="font-family:sans-serif;background:#121212;color:#fff;padding:24px;border-radius:8px">
      <h2 style="margin:0 0 8px">Your year in music</h2>
      <p style="color:#b3b3b3">Almost ready. Stay tuned.</p>
    </div>`,
    attachments: [],
  },
  {
    uid: 394,
    subject: '发票已开具：2026 年 10 月服务费',
    fromName: '财务共享中心',
    fromAddress: 'finance@vendor.com',
    to: 'xiaoman@qq.com',
    date: mins(4300),
    unread: false,
    flagged: false,
    hasAttachments: true,
    text: '您好，10 月服务费发票已开具，请查收附件。',
    html: `<p>您好，10 月服务费发票已开具，请查收附件。</p>`,
    attachments: [{ index: 0, filename: '发票-202610.pdf', size: 96211, contentType: 'application/pdf', cid: null, inline: false }],
  },
  {
    uid: 393,
    subject: '周末爬山吗？路线定在香山北线',
    fromName: '阿泽',
    fromAddress: 'aze@163.com',
    to: '林小满 <xiaoman@qq.com>',
    date: mins(5800),
    unread: false,
    flagged: false,
    hasAttachments: false,
    text: '周六早上 7 点半地铁站集合，北线上南线下，大概 4 小时。带够水！',
    html: `<p>周六早上 <b>7:30</b> 地铁站集合，北线上南线下，大概 4 小时。带够水！</p>`,
    attachments: [],
  },
  {
    uid: 392,
    subject: '订阅确认：欢迎加入「独立开发者周刊」',
    fromName: '独立开发者周刊',
    fromAddress: 'hello@indiehacker.news',
    to: 'xiaoman@qq.com',
    date: mins(9000),
    unread: false,
    flagged: false,
    hasAttachments: false,
    text: '每周一封，只讲能落地的东西。',
    html: `<div style="font-family:sans-serif"><h3 style="margin:0 0 8px">欢迎加入 👋</h3><p>每周一封，只讲能落地的东西。</p></div>`,
    attachments: [],
  },
];

const ok = (res, data) => res.json(data);

app.get('/api/providers', (req, res) =>
  ok(res, {
    providers: Object.values(PROVIDERS).map((p) => ({
      id: p.id, name: p.name, domain: p.domain, authType: p.authType,
      hint: p.hint, help: p.help, imap: p.imap, smtp: p.smtp,
    })),
    options: PROVIDER_OPTIONS,
  })
);

app.get('/api/accounts', (req, res) => ok(res, { accounts: [ACC] }));
app.post('/api/accounts', (req, res) => res.status(400).json({ error: '演示模式不会真的登录，请运行 npm start 使用真实账号。' }));
app.patch('/api/accounts/:id', (req, res) => ok(res, { account: ACC }));
app.post('/api/accounts/:id/test', (req, res) => ok(res, { imap: true, smtp: true, error: null, folders: 6 }));
app.get('/api/accounts/:id/folders', (req, res) => ok(res, { folders: FOLDERS }));

const CONTACTS = [
  { address: 'zhouyan@company.com', name: '周砚', count: 18, last: now },
  { address: 'sunian@studio.design', name: '苏念', count: 12, last: now },
  { address: 'chennan@company.com', name: '陈楠', count: 31, last: now },
  { address: 'aze@163.com', name: '阿泽', count: 9, last: now },
  { address: 'tech-talk@company.com', name: '技术委员会', count: 5, last: now },
  { address: 'finance@vendor.com', name: '财务共享中心', count: 4, last: now },
  { address: 'no-reply@spotify.com', name: 'Spotify', count: 22, last: now },
  { address: 'noreply@github.com', name: 'GitHub', count: 40, last: now },
];

app.get('/api/contacts', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const limit = Math.min(Math.max(Number(req.query.limit) || 8, 1), 30);
  const list = q
    ? CONTACTS.filter((c) => c.address.includes(q) || (c.name || '').toLowerCase().includes(q))
    : CONTACTS;
  ok(res, { contacts: list.slice(0, limit) });
});

app.get('/api/accounts/:id/diagnose', (req, res) =>
  ok(res, {
    folder: String(req.query.folder || 'INBOX'),
    capabilities: ['IMAP4rev1', 'ID', 'IDLE', 'MOVE', 'UIDPLUS', 'LITERAL+'],
    status: { messages: 128, unseen: 5, uidNext: 402 },
    selected: { path: 'INBOX', exists: 128, uidNext: 402, uidValidity: '1512', readOnly: false },
    searchAll: 128,
    sample: MESSAGES.slice(0, 3).map((m) => ({ uid: m.uid, subject: m.subject, from: m.fromAddress, date: m.date })),
    error: null,
  })
);


/** 演示模式的置顶 / 待办 / 备注：只活在内存里，重启就没了 */
const MARKS = new Map();
const markKey = (folder, uid) => `${folder || 'INBOX'}|${Number(uid)}`;

app.get('/api/accounts/:id/marks', (req, res) => {
  ok(res, { marks: Object.fromEntries(MARKS) });
});

app.post('/api/accounts/:id/mark', (req, res) => {
  const { folder = 'INBOX', uid, pinned, todo, note } = req.body || {};
  const key = markKey(folder, uid);
  const cur = MARKS.get(key) || {};
  if (pinned !== undefined) cur.pinned = !!pinned;
  if (todo !== undefined) cur.todo = !!todo;
  if (note !== undefined) {
    const v = String(note || '').trim();
    if (v) cur.note = v;
    else delete cur.note;
  }
  if (!cur.pinned && !cur.todo && !cur.note) MARKS.delete(key);
  else MARKS.set(key, cur);
  ok(res, { ok: true, mark: cur.pinned || cur.todo || cur.note ? cur : null, pinned: !!cur.pinned, todo: !!cur.todo, note: cur.note || '' });
});

app.get('/api/accounts/:id/messages', (req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  const page = Number(req.query.page) || 1;
  const size = Number(req.query.pageSize) || 30;
  let list = MESSAGES;
  if (q) list = list.filter((m) => (m.subject + m.fromName + m.fromAddress).toLowerCase().includes(q));
  const total = q ? list.length : 128;
  const slice = q ? list.slice((page - 1) * size, page * size) : list;
  ok(res, {
    total,
    page,
    pageSize: size,
    folder: req.query.folder,
    server: { exists: total, total, uidNext: 402, searched: true },
    messages: slice.map(({ text, html, attachments, ...rest }) => {
      const mk = MARKS.get(markKey(req.query.folder, rest.uid));
      return {
        uid: rest.uid, subject: rest.subject, fromName: rest.fromName, fromAddress: rest.fromAddress,
        to: rest.to, date: rest.date, size: 24000, unread: rest.unread, flagged: rest.flagged,
        answered: false, hasAttachments: rest.hasAttachments,
        ...(mk ? { pinned: !!mk.pinned, todo: !!mk.todo, note: mk.note || '' } : {}),
      };
    }),
  });
});

app.get('/api/accounts/:id/message', (req, res) => {
  const msg = MESSAGES.find((m) => m.uid === Number(req.query.uid));
  if (!msg) return res.status(404).json({ error: '这封邮件已被移动或删除，请刷新列表。' });
  ok(res, {
    message: {
      ...msg,
      from: [{ name: msg.fromName, address: msg.fromAddress }],
      to: [{ name: '林小满', address: 'xiaoman@qq.com' }],
      cc: [],
      bcc: [],
      replyTo: [],
      messageId: `<demo-${msg.uid}@qq.com>`,
      references: null,
      inReplyTo: null,
    },
  });
});

app.get('/api/accounts/:id/attachment', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send('演示模式的附件占位内容。');
});

app.post('/api/accounts/:id/flags', (req, res) => {
  const msg = MESSAGES.find((m) => m.uid === Number(req.body.uid));
  if (msg) {
    if (typeof req.body.seen === 'boolean') msg.unread = !req.body.seen;
    if (typeof req.body.flagged === 'boolean') msg.flagged = req.body.flagged;
  }
  ok(res, { ok: true });
});
app.delete('/api/accounts/:id/message', (req, res) => ok(res, { ok: true }));
app.post('/api/accounts/:id/send', (req, res) => ok(res, { ok: true, messageId: '<demo@qq.com>', accepted: [req.body.to], savedToSent: true }));

/* ---------- 设置与提醒（演示版：内存里存，不落盘） ---------- */

const demoSettings = {
  imagePolicy: 'block',
  closeAction: 'tray',
  trayEnabled: true,
  notifyEnabled: true,
  notifySound: true,
  notifyDesktop: true,
  pollInterval: 120,
  autoStart: false,
};

const demoClients = new Set();

const demoStatus = () => ({
  tray: false,
  traySupported: false,
  visibleClients: demoClients.size,
  poll: { lastCheckAt: null, polling: true, lastError: null },
  autoStart: !!demoSettings.autoStart,
  autoStartSupported: true,
});

app.get('/api/settings', (req, res) => ok(res, { settings: demoSettings, status: demoStatus() }));

app.patch('/api/settings', (req, res) => {
  const patch = req.body || {};
  for (const k of ['imagePolicy', 'closeAction']) {
    if (typeof patch[k] === 'string') demoSettings[k] = patch[k];
  }
  for (const k of ['trayEnabled', 'notifyEnabled', 'notifySound', 'notifyDesktop']) {
    if (patch[k] !== undefined) demoSettings[k] = !!patch[k];
  }
  if (patch.pollInterval !== undefined) demoSettings.pollInterval = Number(patch.pollInterval) || 120;
  if (patch.autoStart !== undefined) demoSettings.autoStart = !!patch.autoStart;
  if (!demoSettings.trayEnabled) demoSettings.closeAction = 'quit';
  ok(res, { settings: demoSettings, status: demoStatus() });
});

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.write(': demo connected\n\n');
  demoClients.add(res);
  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* ignore */
    }
  }, 25000);
  req.on('close', () => {
    clearInterval(ping);
    demoClients.delete(res);
  });
});

app.post('/api/heartbeat', (req, res) => res.json({ ok: true, tray: false }));
// 页面会把「当前最少要多少像素」报给外壳，演示模式没有外壳，收下即可
app.post('/api/ui/min-width', (req, res) => res.json({ ok: true, width: Number(req.body?.width) || 998 }));
app.get('/api/ui/min-width', (req, res) => res.json({ width: 998 }));
app.get('/api/version', (req, res) => res.json({ name: 'ikuyoMail', version: '1.0.0' }));
app.get('/api/identity', (req, res) =>
  res.json({ name: 'ikuyoMail', version: '1.0.0', root: process.cwd(), pid: process.pid, port: PORT }));
app.post('/api/check-now', (req, res) => ok(res, { newTotal: 0, results: [] }));
app.post('/api/power/quit', (req, res) => ok(res, { ok: true }));

app.post('/api/notify/test', (req, res) => {
  const sample = {
    type: 'mail',
    test: true,
    accountId: 'demo-account',
    accountName: ACC.name,
    accountEmail: ACC.email,
    unseen: 6,
    count: 1,
    items: [
      {
        uid: 999,
        subject: '这是一条测试提醒：右下角出现的就是收到新邮件时的样子',
        fromName: '信箱体验官',
        fromAddress: 'hello@mailbox.local',
        date: new Date().toISOString(),
        hasAttachments: false,
      },
    ],
  };
  const payload = `event: mail\ndata: ${JSON.stringify(sample)}\n\n`;
  for (const c of demoClients) {
    try {
      c.write(payload);
    } catch {
      /* ignore */
    }
  }
  ok(res, { ok: true, inApp: demoClients.size > 0, desktop: false, tray: false });
});


app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  🎨 演示模式（假数据）： http://127.0.0.1:${PORT}\n`);
});
