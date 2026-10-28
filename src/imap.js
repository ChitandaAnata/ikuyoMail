import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import socksPkg from 'socks';
import { simpleParser } from 'mailparser';
import { recordContacts } from './store.js';
import { toProxyUrl } from './proxy.js';

/**
 * nodemailer 不会自动加载 socks 模块，走 SOCKS 代理时必须手动注入，
 * 否则发送时会报「Socks module not loaded」。
 */
function wireSocksProxy(transport, proxyUrl) {
  if (!proxyUrl || !/^socks/i.test(proxyUrl)) return transport;
  try {
    transport.meta.set('proxy_socks_module', socksPkg);
  } catch {
    /* 版本差异时忽略，让上层报出真实错误 */
  }
  return transport;
}

/**
 * 每账号一个连接 + 串行队列：IMAP 单连接不支持并发命令，
 * 这里用互斥队列保证同一账号的请求按顺序执行。
 */
const pool = new Map(); // id -> { client, queue: Promise, timer, cfgSig }

const IDLE_MS = 2 * 60 * 1000;
/**
 * 连接绝对寿命。有些服务商（典型是网易 Coremail）的 IMAP 会话在
 * 建立时会对邮箱状态做快照，用户之后在网页端改了「收取范围」或
 * 增删了邮件，旧会话依旧返回旧数字 —— 表现为「网页 393 封，客户端 6 封」。
 * 定期重建连接可以让客户端重新拿到服务端的真实视图。
 */
const MAX_CONN_MS = 10 * 60 * 1000;

function makeClient(acc) {
  const client = new ImapFlow({
    host: acc.imap.host,
    port: Number(acc.imap.port) || 993,
    secure: acc.imap.secure !== false,
    auth: { user: acc.username || acc.email, pass: acc.pass },
    // 走代理时不解析本地 DNS，由代理解析目标域名（socks5 默认行为）
    proxy: toProxyUrl(acc.proxy) || undefined,
    logger: false,
    tls: { rejectUnauthorized: acc.imap.allowInvalidCert ? false : true },
    greetingTimeout: 15000,
    socketTimeout: 120000,
    connectionTimeout: 25000,
  });
  client.on('error', () => {});
  return client;
}

function isHealthy(entry) {
  const c = entry?.client;
  return !!c && c.usable && c.authenticated;
}

export function dropConnection(id) {
  const entry = pool.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  pool.delete(id);
  try {
    entry.client.close();
  } catch {
    /* ignore */
  }
}

async function getEntry(acc, { fresh = false } = {}) {
  if (fresh) dropConnection(acc.id);
  let entry = pool.get(acc.id);
  const aged = entry && entry.bornAt && Date.now() - entry.bornAt > MAX_CONN_MS;
  if (!isHealthy(entry) || aged) {
    if (entry) dropConnection(acc.id);
    const client = makeClient(acc);
    await client.connect();
    entry = {
      client,
      queue: Promise.resolve(),
      timer: null,
      bornAt: Date.now(),
      cfgSig: JSON.stringify(acc.imap),
    };
    pool.set(acc.id, entry);
  }
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => dropConnection(acc.id), IDLE_MS);
  if (entry.timer.unref) entry.timer.unref();
  return entry;
}

/** 在独占连接上执行 fn；fresh=true 表示先断开旧会话，强制重新握手 */
export async function withClient(acc, fn, { fresh = false, background = false } = {}) {
  if (!acc) throw new Error('账号不存在');
  if (!background) lastForegroundAt = Date.now();
  const entry = await getEntry(acc, { fresh });
  const run = entry.queue.then(async () => {
    return fn(entry.client);
  });
  // 队列不被失败打断
  entry.queue = run.catch(() => {});
  try {
    return await run;
  } catch (err) {
    if (!entry.client.usable) dropConnection(acc.id);
    throw normalizeError(err);
  }
}

/** 把底层的英文报错翻译成人话 */
export function normalizeError(err) {
  const raw = String(err?.responseText || err?.message || err || '未知错误');
  const map = [
    [/Login fail|Account is abnormal|service is not open/i,
      '登录被拒绝：该邮箱可能没有开启 IMAP 服务，或授权码 / 密码不正确。\nQQ 邮箱请在「设置 → 账号」开启 IMAP/SMTP 服务并获取授权码；若反复失败，可能是登录频率被临时限制，稍后再试。'],
    [/authentication failed|invalid credentials|AUTHENTICATIONFAILED|LOGIN failed|Invalid login/i,
      '登录被拒绝：账号或密码/授权码不正确，或该邮箱未开启 IMAP 服务、被风控限制。'],
    [/LOGIN Login error|password error|账号或密码错误/i,
      '登录被拒绝：账号或密码/授权码不正确。网易邮箱请确认使用的是「客户端授权密码」而不是网页登录密码。'],
    [/A3 NO|AUTHORIZATION failed/i, '登录被拒绝：请检查是否使用了「授权码」而不是登录密码，并确认已开启 IMAP 服务。'],
    [/Too many (failed )?(login )?attempts|频率|频繁/i, '尝试过于频繁，被服务商临时限制，请稍后再试。'],
    [/Failed to setup proxy|ProxyError|proxy.*ECONNREFUSED|proxy.*ENOTFOUND|socks/i,
      '代理连接失败：请检查代理地址、端口、协议类型（SOCKS5 / HTTP）是否正确，代理服务是否已启动，以及用户名密码是否填写正确。'],
    [/getaddrinfo|ENOTFOUND|EAI_AGAIN/i, '无法解析服务器地址：请检查网络，或确认 IMAP 主机名填写正确。'],
    [/ETIMEDOUT|timeout|ECONNRESET|socket hang up/i,
      '连接服务器超时或被重置：可能是网络无法直连（如 Gmail/Outlook 需要能访问），或端口被防火墙拦截。若该邮箱在本地网络下不可用，可尝试在账号设置里配置代理。'],
    [/certificate|self signed|CERT_/i, '服务器证书校验失败。若你确认服务器可信，可在账号设置里勾选「忽略证书错误」。'],
    [/Mailbox does not exist|NONEXISTENT/i, '文件夹不存在或已被删除。'],
    [/Message not found|no such message/i, '这封邮件已被移动或删除，请刷新列表。'],
  ];
  for (const [re, msg] of map) {
    if (re.test(raw)) return new Error(msg);
  }
  const e = new Error(raw);
  return e;
}

const SPECIAL_ORDER = ['\\Inbox', '\\Sent', '\\Drafts', '\\Junk', '\\Trash', '\\Archive', '\\All', '\\Flagged'];

function specialRank(mb) {
  if (mb.path === 'INBOX') return -10;
  const su = mb.specialUse || '';
  const idx = SPECIAL_ORDER.indexOf(su);
  return idx === -1 ? 50 : idx;
}

export async function listFolders(acc, { fresh = false } = {}) {
  return withClient(acc, async (client) => {
    const list = await client.list();
    const folders = [];
    for (const mb of list) {
      const item = {
        path: mb.path,
        name: mb.name,
        specialUse: mb.specialUse || null,
        delimiter: mb.delimiter || '/',
        selectable: !(mb.flags && mb.flags.has && mb.flags.has('\\Noselect')),
        messages: null,
        unseen: null,
      };
      if (item.selectable) {
        try {
          const st = await client.status(mb.path, { messages: true, unseen: true });
          item.messages = st.messages ?? null;
          item.unseen = st.unseen ?? null;
        } catch {
          /* 部分服务器不允许对某些目录 STATUS */
        }
      }
      folders.push(item);
    }
    folders.sort((a, b) => {
      const d = specialRank(a) - specialRank(b);
      return d !== 0 ? d : a.path.localeCompare(b.path, 'zh-Hans-CN');
    });
    return folders;
  }, { fresh });
}

function pick(obj, keys) {
  for (const k of keys) if (obj[k]) return obj[k];
  return null;
}

function msgPreview(envelope) {
  return '';
}

function hasAttachmentFromStructure(node) {
  if (!node) return false;
  if (node.disposition === 'attachment') return true;
  if (node.childNodes) {
    for (const c of node.childNodes) if (hasAttachmentFromStructure(c)) return true;
  }
  return false;
}

const FETCH_QUERY = { uid: true, envelope: true, flags: true, internalDate: true, size: true, bodyStructure: true };

/** SEARCH ALL 拿到的 UID 列表才是"服务端真正开放的邮件数" */
async function collectUids(client) {
  try {
    const uids = await client.search({ all: true }, { uid: true });
    return Array.isArray(uids) ? uids : null;
  } catch {
    return null;
  }
}

/**
 * 本地搜索索引。
 *
 * 为什么不用 IMAP SEARCH：不少服务商（网易 Coremail 最典型）对
 * FROM / SUBJECT / TO / TEXT 一律回 `* SEARCH`（空列表）再回 OK ——
 * 命令不报错、结果却永远是 0，前端看起来就是「怎么搜都搜不到」。
 * 所以把信封（主题/发件人/收件人/日期/旗标）缓存到内存，搜索时本地匹配。
 *
 * 冷邮件（服务端归档里的旧信）每批要几秒才能读出来，全量同步拉完会让
 * 第一次搜索卡十几秒。于是分两步：列表打开后就在后台按「新→旧」一批批
 * 预取；真正搜索时最多等一小段时间，先给已索引部分的命中，剩下的边扫边刷新。
 */
const searchIndex = new Map(); // key -> { items: Map<uid,item>, uids: number[]（新→旧）, total, next, builtAt }
const pendingBuilds = new Set();
/** 超过这个量只索引最新的一批，避免几万封的邮箱把内存吃掉 */
const INDEX_MAX = 5000;
const INDEX_CHUNK = 100;
/**
 * 后台预取会让出队列给前台请求：每次有正常请求进来就记个时间，
 * 后台发现最近有前台活动就先歇一会儿，别把用户的操作堵住。
 */
let lastForegroundAt = 0;
const foregroundIdleMs = () => Date.now() - lastForegroundAt;

const indexKey = (accountId, folder) => `${accountId}::${folder}`;

export function forgetSearchIndex(accountId) {
  if (!accountId) {
    searchIndex.clear();
    return;
  }
  for (const key of [...searchIndex.keys()]) {
    if (key.startsWith(`${accountId}::`)) searchIndex.delete(key);
  }
}

/** 把索引里已变更的条目修正掉 */
function patchIndex(accountId, folder, uid, patch) {
  const item = searchIndex.get(indexKey(accountId, folder))?.items.get(Number(uid));
  if (item) Object.assign(item, patch);
}

function dropIndexItem(accountId, folder, uid) {
  searchIndex.get(indexKey(accountId, folder))?.items.delete(Number(uid));
}

/**
 * 对齐 UID 列表并预取若干批（受 budgetMs 限制，超时就把剩下的留给后台）。
 */
async function refreshIndex(client, acc, folder, { fresh = false, budgetMs = 0 } = {}) {
  const key = indexKey(acc.id, folder);
  let idx = fresh ? null : searchIndex.get(key);
  if (!idx) idx = { items: new Map(), uids: [], total: 0, next: 0, builtAt: 0 };

  const allUids = await collectUids(client);
  if (!allUids) {
    // SEARCH ALL 都不可用：退回「最近 300 封」（按序号取，不用 UID 集合）
    if (idx.items.size) return idx;
    const exists = client.mailbox?.exists || 0;
    if (exists > 0) {
      const recent = [];
      const from = Math.max(1, exists - 299);
      for await (const m of client.fetch(`${from}:*`, FETCH_QUERY)) recent.push(toListItem(m));
      for (const it of recent) idx.items.set(it.uid, it);
    }
    idx.uids = [...idx.items.keys()].sort((a, b) => b - a);
    idx.next = idx.uids.length;
    idx.total = exists;
    idx.builtAt = Date.now();
    searchIndex.set(key, idx);
    return idx;
  }

  // 新 → 旧：越新的邮件服务端读得越快，先出结果
  const desc = allUids.slice().sort((a, b) => b - a);
  const keep = desc.length > INDEX_MAX ? desc.slice(0, INDEX_MAX) : desc;
  const keepSet = new Set(keep);

  for (const uid of [...idx.items.keys()]) {
    if (!keepSet.has(uid)) idx.items.delete(uid);
  }

  const changed = idx.uids.length !== keep.length || idx.uids[0] !== keep[0];
  idx.uids = keep;
  idx.total = allUids.length;

  // next 之前的部分一律视为已取（可能个别邮件已被删，跳过即可）
  if (changed) idx.next = 0;
  while (idx.next < keep.length && idx.items.has(keep[idx.next])) idx.next++;

  const deadline = Date.now() + Math.max(0, budgetMs);
  while (idx.next < keep.length) {
    const start = idx.next;
    const chunk = keep.slice(start, start + INDEX_CHUNK).filter((u) => !idx.items.has(u));
    if (chunk.length) {
      try {
        const fetched = await fetchByUids(client, chunk);
        for (const it of fetched) idx.items.set(it.uid, it);
      } catch {
        // 某一批失败就让后台稍后重试，当前先返回已索引的部分
        break;
      }
    }
    idx.next = start + INDEX_CHUNK;
    if (Date.now() > deadline) break;
  }
  if (idx.next > keep.length) idx.next = keep.length;

  idx.builtAt = Date.now();
  searchIndex.set(key, idx);
  return idx;
}

/** 索引是否还没扫完（前端据此显示「正在检索历史邮件…」） */
export function indexStatus(acc, folder) {
  const idx = searchIndex.get(indexKey(acc.id, folder));
  if (!idx) return null;
  return { scanned: idx.items.size, total: idx.total, pending: idx.next < idx.uids.length };
}

/**
 * 后台把索引补完。每批单独占一次连接，批与批之间会释放队列，
 * 不会把轮询 / 正常读信堵死。
 */
export function warmSearchIndex(acc, folder = 'INBOX') {
  const key = indexKey(acc.id, folder);
  if (pendingBuilds.has(key)) return false;
  const cur = searchIndex.get(key);
  if (cur && cur.next >= cur.uids.length) return false;

  pendingBuilds.add(key);
  (async () => {
    try {
      for (;;) {
        const idx = searchIndex.get(key);
        if (!idx || idx.next >= idx.uids.length) break;
        // 前面一小会儿有前台请求（读信/翻页/搜索）就先让路
        for (let i = 0; i < 20 && foregroundIdleMs() < 1200; i += 1) {
          await new Promise((r) => setTimeout(r, 150));
        }
        await withClient(
          acc,
          async (client) => {
            const lock = await client.getMailboxLock(folder);
            try {
              await refreshIndex(client, acc, folder, { budgetMs: 0 });
            } finally {
              lock.release();
            }
          },
          { background: true }
        );
        // 让出事件循环，避免长时间占着连接
        await new Promise((r) => setTimeout(r, 60));
      }
    } catch {
      /* 网络抖动就下次再补 */
    } finally {
      pendingBuilds.delete(key);
    }
  })();
  return true;
}

/** 按空白拆词，全部命中才算匹配（大小写不敏感） */
function matchTokens(item, tokens) {
  const hay = `${item.subject || ''}\n${item.fromName || ''}\n${item.fromAddress || ''}\n${item.to || ''}`.toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

/** 按 UID 精确取信封（分批，避免单条命令过长） */
async function fetchByUids(client, uids) {
  const items = [];
  for (let i = 0; i < uids.length; i += 150) {
    const chunk = uids.slice(i, i + 150);
    if (!chunk.length) continue;
    for await (const m of client.fetch(chunk.join(','), FETCH_QUERY, { uid: true })) {
      items.push(toListItem(m));
    }
  }
  return items;
}

/**
 * 邮件列表
 * 注意：163 / QQ 等服务商默认只把「最近 30 天」的邮件开放给 IMAP，
 * 此时 EXISTS 会是 6 而网页版有 393 —— 这不是客户端 bug，需要用户在
 * 网页版设置里把收取范围改成「全部邮件」。这里把服务端真实数字一并返回，
 * 前端据此给出提示。
 */
export async function listMessages(
  acc,
  { folder = 'INBOX', page = 1, pageSize = 30, query = '', fresh = false } = {}
) {
  return withClient(acc, async (client) => {
    const size = Math.min(Math.max(Number(pageSize) || 30, 1), 100);
    const pg = Math.max(Number(page) || 1, 1);
    const lock = await client.getMailboxLock(folder);
    let items = [];
    let totalHit = 0;
    let server;

    try {
      const exists = client.mailbox?.exists || 0;
      const allUids = await collectUids(client);
      const baseTotal = allUids ? allUids.length : exists;
      server = {
        exists,
        total: baseTotal,
        uidNext: client.mailbox?.uidNext ?? null,
        searched: !!allUids,
      };

      const q = String(query || '').trim();
      if (q) {
        const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
        // 索引空着就先抓一两批（最新邮件在服务端是热的，很快），
        // 剩下的交给后台慢慢补，别让第一次搜索干等十几秒。
        const cold = !searchIndex.has(indexKey(acc.id, folder));
        const idx = await refreshIndex(client, acc, folder, {
          fresh,
          budgetMs: cold ? 1200 : 2500,
        });
        const hits = [];
        for (const item of idx.items.values()) {
          if (matchTokens(item, tokens)) hits.push(item);
        }
        hits.sort((a, b) => b.uid - a.uid);
        totalHit = hits.length;
        items = hits.slice((pg - 1) * size, pg * size).map((m) => ({ ...m }));
        server.localSearch = true;
        server.scanned = idx.items.size;
        server.indexPending = idx.next < idx.uids.length;
      } else if (allUids) {
        totalHit = allUids.length;
        const desc = allUids.slice().reverse();
        items = await fetchByUids(client, desc.slice((pg - 1) * size, pg * size));
      } else {
        // SEARCH 不可用，退回序号分页
        totalHit = exists;
        const end = exists - (pg - 1) * size;
        if (end >= 1) {
          const start = Math.max(1, end - size + 1);
          for await (const m of client.fetch(`${start}:${end}`, FETCH_QUERY)) {
            items.push(toListItem(m));
          }
        }
      }
    } finally {
      lock.release();
    }

    items.sort((a, b) => b.uid - a.uid);

    // 顺手积累联系人（失败不影响列表）
    try {
      const people = [];
      for (const m of items) {
        if (m.fromAddress) people.push({ address: m.fromAddress, name: m.fromName, last: Date.parse(m.date) || Date.now() });
        for (const t of m.toList || []) people.push({ address: t.address, name: t.name });
        delete m.toList;
      }
      recordContacts(people);
    } catch {
      /* ignore */
    }

    return { total: totalHit, page: pg, pageSize: size, folder, messages: items, server };
  }, { fresh });
}

/**
 * 增量取新邮件：以 UID 当水位线，只取水位线之后的那几封。
 * 只读信封不读正文，轮询成本很低。
 */
export async function fetchNewMessages(
  acc,
  { folder = 'INBOX', sinceUid = 0, limit = 5, fresh = false } = {}
) {
  return withClient(
    acc,
    async (client) => {
      const lock = await client.getMailboxLock(folder);
      try {
        const mb = client.mailbox || {};
        const floor = Math.max(Number(sinceUid) || 0, 0);
        const exists = mb.exists || 0;

        // 注意：imapflow 的 client.mailbox 里没有 uidNext / unseen，
        // 只能靠 UID 范围搜索来确定水位线（搜 floor+1:*，* 就是当前最大 UID）。
        let uids = [];
        try {
          uids = await client.search({ uid: `${floor + 1}:*` }, { uid: true });
        } catch {
          uids = [];
        }
        uids = (uids || []).filter((u) => u > floor).sort((a, b) => a - b);

        const maxUid = uids.length ? uids[uids.length - 1] : floor;
        const base = { maxUid, exists, unseen: 0, count: uids.length, messages: [] };
        if (!uids.length) return base;

        // 未读数只在真有新邮件时查一次，避免每轮都扫一遍
        try {
          const unseenUids = await client.search({ unseen: true }, { uid: true });
          base.unseen = Array.isArray(unseenUids) ? unseenUids.length : 0;
        } catch {
          base.unseen = 0;
        }

        const take = uids.slice(-Math.max(limit, 1));
        const items = [];
        for await (const m of client.fetch(
          take.join(','),
          { uid: true, envelope: true, flags: true, internalDate: true },
          { uid: true }
        )) {
          items.push(toListItem(m));
        }
        items.sort((a, b) => b.uid - a.uid);
        return { ...base, messages: items };
      } finally {
        lock.release();
      }
    },
    { fresh }
  );
}

function toListItem(m) {
  const env = m.envelope || {};
  const from = env.from?.[0] || {};
  const flags = m.flags instanceof Set ? [...m.flags] : Array.isArray(m.flags) ? m.flags : [];
  return {
    uid: m.uid,
    subject: env.subject || '(无主题)',
    fromName: from.name || '',
    fromAddress: from.address || '',
    to: (env.to || []).map((a) => a.address).filter(Boolean).join(', '),
    toList: addr(env.to),
    date: (m.internalDate || env.date || new Date()).toISOString(),
    size: m.size || 0,
    unread: !flags.includes('\\Seen'),
    flagged: flags.includes('\\Flagged'),
    answered: flags.includes('\\Answered'),
    hasAttachments: hasAttachmentFromStructure(m.bodyStructure),
  };
}

function addr(list) {
  const arr = Array.isArray(list) ? list : list ? [list] : [];
  return arr.map((a) => ({ name: a.name || '', address: a.address || '' })).filter((a) => a.address || a.name);
}

/** 邮件详情（含完整 HTML / 纯文本 / 附件清单） */
export async function getMessage(acc, { folder = 'INBOX', uid }) {
  return withClient(acc, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const msg = await client.fetchOne(String(uid), { uid: true, source: true, flags: true }, { uid: true });
      if (!msg || !msg.source) throw new Error('这封邮件已被移动或删除，请刷新列表。');
      const parsed = await simpleParser(msg.source);
      const flags = msg.flags instanceof Set ? [...msg.flags] : [];

      // 把 cid: 内嵌图片替换成 data URI，正文里的图片才能直接显示
      const cidMap = new Map();
      for (const a of parsed.attachments || []) {
        if (a.cid && a.content && a.content.length <= 4 * 1024 * 1024) {
          const key = String(a.cid).replace(/^<|>$/g, '');
          cidMap.set(key, `data:${a.contentType || 'image/png'};base64,${a.content.toString('base64')}`);
        }
      }
      let html = typeof parsed.html === 'string' ? parsed.html : '';
      if (cidMap.size) {
        html = html.replace(/cid:([^"'\s)]+)/gi, (full, id) => {
          const clean = decodeURIComponent(id).replace(/^<|>$/g, '');
          return cidMap.get(clean) || cidMap.get(id) || full;
        });
      }

      return {
        uid: Number(uid),
        subject: parsed.subject || '(无主题)',
        from: addr(parsed.from?.value),
        to: addr(parsed.to?.value),
        cc: addr(parsed.cc?.value),
        bcc: addr(parsed.bcc?.value),
        replyTo: addr(parsed.replyTo?.value),
        date: (parsed.date || new Date()).toISOString(),
        messageId: parsed.messageId || null,
        references: parsed.references || null,
        inReplyTo: parsed.inReplyTo || null,
        text: parsed.text || '',
        html,
        unread: !flags.includes('\\Seen'),
        flagged: flags.includes('\\Flagged'),
        attachments: (parsed.attachments || []).map((a, i) => ({
          index: i,
          filename: a.filename || `附件-${i + 1}`,
          size: a.size || a.content?.length || 0,
          contentType: a.contentType || 'application/octet-stream',
          cid: a.cid || null,
          inline: !!a.cid,
        })),
      };
    } finally {
      lock.release();
    }
  });
}

/** 取附件原始内容 */
export async function getAttachment(acc, { folder = 'INBOX', uid, index }) {
  return withClient(acc, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !msg.source) throw new Error('这封邮件已被移动或删除，请刷新列表。');
      const parsed = await simpleParser(msg.source);
      const att = parsed.attachments?.[Number(index)];
      if (!att) throw new Error('附件不存在');
      return {
        filename: att.filename || `附件-${Number(index) + 1}`,
        contentType: att.contentType || 'application/octet-stream',
        content: att.content,
      };
    } finally {
      lock.release();
    }
  });
}

/** 设置已读 / 星标 */
export async function setFlags(acc, { folder = 'INBOX', uid, seen, flagged }) {
  return withClient(acc, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      if (typeof seen === 'boolean') {
        if (seen) await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
        else await client.messageFlagsRemove(String(uid), ['\\Seen'], { uid: true });
      }
      if (typeof flagged === 'boolean') {
        if (flagged) await client.messageFlagsAdd(String(uid), ['\\Flagged'], { uid: true });
        else await client.messageFlagsRemove(String(uid), ['\\Flagged'], { uid: true });
      }
      // 搜索索引里的旗标也要跟着变，否则搜索结果里的未读/星标是旧的
      if (typeof seen === 'boolean' || typeof flagged === 'boolean') {
        const patch = {};
        if (typeof seen === 'boolean') patch.unread = !seen;
        if (typeof flagged === 'boolean') patch.flagged = flagged;
        patchIndex(acc.id, folder, uid, patch);
      }
      return { ok: true };
    } finally {
      lock.release();
    }
  });
}

/** 删除（按服务商规则移入废纸篓） */
export async function deleteMessage(acc, { folder = 'INBOX', uid }) {
  return withClient(acc, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      await client.messageDelete(String(uid), { uid: true });
      dropIndexItem(acc.id, folder, uid);
      return { ok: true };
    } finally {
      lock.release();
    }
  });
}

async function findSentFolder(client) {
  const list = await client.list();
  const bySpecial = list.find((m) => m.specialUse === '\\Sent');
  if (bySpecial) return bySpecial.path;
  const names = ['Sent', 'Sent Messages', 'Sent Items', '已发送', '已发送邮件', '已发送文件夹', 'Sent Mail'];
  for (const n of names) {
    const hit = list.find((m) => m.path === n || m.name === n);
    if (hit) return hit.path;
  }
  return null;
}

/** 发信，并尝试归档到「已发送」 */
export async function sendMail(acc, payload) {
  const { to, cc, bcc, subject = '', text = '', html = '', attachments = [], inReplyTo, references } = payload;
  if (!to || !String(to).trim()) throw new Error('收件人不能为空');

  const transport = wireSocksProxy(
    nodemailer.createTransport({
      host: acc.smtp.host,
      port: Number(acc.smtp.port) || 465,
      secure: acc.smtp.secure !== false,
      auth: { user: acc.username || acc.email, pass: acc.pass },
      proxy: toProxyUrl(acc.proxy) || undefined,
      tls: { rejectUnauthorized: acc.smtp.allowInvalidCert ? false : true },
      connectionTimeout: 25000,
      greetingTimeout: 15000,
      socketTimeout: 60000,
    }),
    toProxyUrl(acc.proxy)
  );

  const mail = {
    from: acc.name ? `"${acc.name}" <${acc.email}>` : acc.email,
    to: String(to).trim(),
    subject,
    text: text || undefined,
    html: html || undefined,
    attachments: (attachments || [])
      .filter((a) => a && a.filename && a.content)
      .map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content, 'base64'),
        contentType: a.contentType || undefined,
      })),
  };
  if (cc && String(cc).trim()) mail.cc = String(cc).trim();
  if (bcc && String(bcc).trim()) mail.bcc = String(bcc).trim();
  if (inReplyTo) {
    mail.inReplyTo = inReplyTo;
    mail.references = references || inReplyTo;
  }

  const info = await transport.sendMail(mail);
  transport.close();

  // 把收件人记进联系人库，方便下次自动补全
  try {
    const people = [];
    for (const field of [to, cc, bcc]) {
      for (const part of String(field || '').split(/[,;]/)) {
        const m = part.match(/^\s*(?:"?([^"<]*)"?\s*<\s*([^>]+)\s*>|([^\s,]+@[^\s,]+))\s*$/);
        if (!m) continue;
        const address = (m[2] || m[3] || '').trim();
        if (address.includes('@')) people.push({ address, name: (m[1] || '').trim() });
      }
    }
    recordContacts(people);
  } catch {
    /* ignore */
  }

  let saved = false;
  try {
    const raw = await new Promise((resolve, reject) => {
      // 复用 nodemailer 的构建能力，生成可归档的原始报文
      import('nodemailer/lib/mail-composer/index.js')
        .then(({ default: MailComposer }) => {
          const composer = new MailComposer({
            ...mail,
            from: acc.email,
            date: new Date(),
          });
          composer.compile().build((err, buf) => (err ? reject(err) : resolve(buf)));
        })
        .catch(reject);
    });
    await withClient(acc, async (client) => {
      const sentPath = await findSentFolder(client);
      if (sentPath) {
        await client.append(sentPath, raw, ['\\Seen']);
        saved = true;
      }
    });
  } catch {
    saved = false;
  }

  return { ok: true, messageId: info.messageId, accepted: info.accepted, savedToSent: saved };
}

/**
 * 连接诊断：把服务端真实口径摊开，用于排查「邮件数量对不上」这类问题。
 * 关键看三个数字：
 *   status.messages  —— STATUS 报告的总数
 *   selected.exists  —— 打开文件夹时的 EXISTS
 *   searchAll        —— SEARCH ALL 能枚举到的 UID 数量
 * 如果三个都远小于网页版，说明是服务商限制了 IMAP 收取范围（163/QQ 常见的坑）。
 */
export async function diagnose(acc, { folder = 'INBOX' } = {}) {
  const out = {
    folder,
    capabilities: [],
    status: null,
    selected: null,
    searchAll: null,
    sample: [],
    error: null,
    pooled: null,
    stale: false,
    reconnected: false,
  };

  // 1) 先记录「当前复用的旧会话」看到的数字，用于判断会话是否陈旧
  const entry = pool.get(acc.id);
  if (isHealthy(entry)) {
    try {
      out.pooled = await withClient(acc, async (client) => {
        const lock = await client.getMailboxLock(folder);
        try {
          const uids = await client.search({ all: true }, { uid: true });
          return {
            exists: client.mailbox?.exists ?? null,
            searchAll: Array.isArray(uids) ? uids.length : null,
          };
        } finally {
          lock.release();
        }
      });
    } catch {
      out.pooled = null;
    }
  }

  // 2) 强制新建连接，拿服务端的真实视图
  try {
    await withClient(
      acc,
      async (client) => {
        try {
          out.capabilities = client.capabilities ? [...client.capabilities.keys()] : [];
        } catch {
          out.capabilities = [];
        }

        try {
          const st = await client.status(folder, { messages: true, unseen: true, uidNext: true });
          out.status = { messages: st.messages ?? null, unseen: st.unseen ?? null, uidNext: st.uidNext ?? null };
        } catch (e) {
          out.status = { error: normalizeError(e).message };
        }

        const lock = await client.getMailboxLock(folder);
        try {
          const mb = client.mailbox || {};
          out.selected = {
            path: mb.path || folder,
            exists: mb.exists ?? null,
            uidNext: mb.uidNext ?? null,
            uidValidity: mb.uidValidity != null ? String(mb.uidValidity) : null,
            readOnly: !!mb.readOnly,
          };
          try {
            const uids = await client.search({ all: true }, { uid: true });
            out.searchAll = Array.isArray(uids) ? uids.length : null;
            const tail = (uids || []).slice(-3).reverse();
            for (const uid of tail) {
              const m = await client.fetchOne(
                String(uid),
                { uid: true, envelope: true, internalDate: true },
                { uid: true }
              );
              if (m) {
                out.sample.push({
                  uid: m.uid,
                  subject: m.envelope?.subject || '(无主题)',
                  from: m.envelope?.from?.[0]?.address || '',
                  date: (m.internalDate || m.envelope?.date || new Date()).toISOString(),
                });
              }
            }
          } catch (e) {
            out.searchAll = null;
            out.searchError = normalizeError(e).message;
          }
        } finally {
          lock.release();
        }
      },
      { fresh: true }
    );
    out.reconnected = true;
  } catch (err) {
    out.error = normalizeError(err).message;
  }

  // 3) 新旧会话数字不一致 => 旧会话陈旧，已被强制重连修正
  if (
    out.pooled &&
    out.pooled.searchAll != null &&
    out.searchAll != null &&
    out.pooled.searchAll !== out.searchAll
  ) {
    out.stale = true;
  }
  return out;
}

/** 连接测试 */
export async function testAccount(acc) {
  const result = { imap: false, smtp: false, error: null, folders: 0 };
  try {
    await withClient(acc, async (client) => {
      const list = await client.list();
      result.folders = list.length;
      result.imap = true;
    });
  } catch (err) {
    result.error = normalizeError(err).message;
    return result;
  }
  try {
    const transport = wireSocksProxy(
      nodemailer.createTransport({
        host: acc.smtp.host,
        port: Number(acc.smtp.port) || 465,
        secure: acc.smtp.secure !== false,
        auth: { user: acc.username || acc.email, pass: acc.pass },
        proxy: toProxyUrl(acc.proxy) || undefined,
        tls: { rejectUnauthorized: acc.smtp.allowInvalidCert ? false : true },
        connectionTimeout: 20000,
        greetingTimeout: 15000,
      }),
      toProxyUrl(acc.proxy)
    );
    await transport.verify();
    transport.close();
    result.smtp = true;
  } catch (err) {
    result.error = normalizeError(err).message;
  }
  return result;
}

process.on('exit', () => {
  for (const id of [...pool.keys()]) dropConnection(id);
});
