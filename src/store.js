import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicProxy } from './proxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.MAILBOX_DATA_DIR
  ? path.resolve(process.env.MAILBOX_DATA_DIR)
  : path.resolve(__dirname, '..', 'data');

const KEY_FILE = path.join(DATA_DIR, '.secret');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const CONTACTS_FILE = path.join(DATA_DIR, 'contacts.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadKey() {
  ensureDir();
  if (!fs.existsSync(KEY_FILE)) {
    fs.writeFileSync(KEY_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    try {
      fs.chmodSync(KEY_FILE, 0o600);
    } catch {
      /* windows 下忽略 */
    }
  }
  const hex = fs.readFileSync(KEY_FILE, 'utf8').trim();
  return Buffer.from(hex, 'hex');
}

let _key = null;
function key() {
  if (!_key) _key = loadKey();
  return _key;
}

/** AES-256-GCM 加密，输出 base64(iv|tag|ciphertext) */
export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

export function decrypt(payload) {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function readAll() {
  ensureDir();
  if (!fs.existsSync(ACCOUNTS_FILE)) return { accounts: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    if (!parsed || !Array.isArray(parsed.accounts)) return { accounts: [] };
    return parsed;
  } catch {
    return { accounts: [] };
  }
}

function writeAll(db) {
  ensureDir();
  backupCurrent();
  const tmp = ACCOUNTS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, ACCOUNTS_FILE);
}

/** 每次写入前留一份快照，误删可从这里找回（保留最近 12 份） */
function backupCurrent() {
  if (!fs.existsSync(ACCOUNTS_FILE)) return;
  try {
    const dir = path.join(DATA_DIR, 'backups');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(ACCOUNTS_FILE, path.join(dir, `accounts-${stamp}.json`));
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith('accounts-') && f.endsWith('.json'))
      .sort();
    for (const f of files.slice(0, Math.max(0, files.length - 12))) {
      fs.unlinkSync(path.join(dir, f));
    }
  } catch {
    /* 备份失败不影响主流程 */
  }
}

/** 对外暴露的安全字段（去掉口令） */
export function publicAccount(a) {
  return {
    id: a.id,
    name: a.name,
    email: a.email,
    provider: a.provider,
    username: a.username,
    imap: a.imap,
    smtp: a.smtp,
    proxy: publicProxy(a.proxy),
    createdAt: a.createdAt,
    lastError: a.lastError || null,
  };
}

export function listAccounts() {
  return readAll().accounts.map(publicAccount);
}

export function getAccount(id) {
  return readAll().accounts.find((a) => a.id === id) || null;
}

/** 取出含明文口令的账号（仅在服务端内部使用） */
export function getAccountWithSecret(id) {
  const acc = getAccount(id);
  if (!acc) return null;
  const out = { ...acc, pass: decrypt(acc.encPass) };
  if (acc.proxy && acc.proxy.host) {
    out.proxy = {
      ...acc.proxy,
      password: acc.proxy.passwordEnc ? decrypt(acc.proxy.passwordEnc) : '',
    };
  } else {
    out.proxy = null;
  }
  return out;
}

/** 把前端传来的代理配置转成存储结构（密码单独加密，缺失时保留旧密码） */
function buildStoredProxy(input, previous) {
  if (!input) return null;
  const host = String(input.host || '').trim();
  if (!host) return null;
  const next = {
    enabled: input.enabled !== false,
    type: String(input.type || 'socks5').toLowerCase(),
    host,
    port: Number(input.port) || 1080,
    username: String(input.username || '').trim(),
    passwordEnc: previous?.passwordEnc || null,
  };
  if (input.password) next.passwordEnc = encrypt(String(input.password));
  else if (input.clearPassword) next.passwordEnc = null;
  return next;
}

export function addAccount(input) {
  const db = readAll();
  const acc = {
    id: crypto.randomUUID(),
    name: input.name,
    email: input.email,
    provider: input.provider,
    username: input.username || input.email,
    imap: input.imap,
    smtp: input.smtp,
    proxy: buildStoredProxy(input.proxy, null),
    encPass: encrypt(input.pass),
    createdAt: new Date().toISOString(),
  };
  db.accounts.push(acc);
  writeAll(db);
  return publicAccount(acc);
}

export function updateAccount(id, patch) {
  const db = readAll();
  const acc = db.accounts.find((a) => a.id === id);
  if (!acc) return null;
  if (patch.name !== undefined) acc.name = patch.name;
  if (patch.pass) acc.encPass = encrypt(patch.pass);
  if (patch.username) acc.username = patch.username;
  if (patch.email) acc.email = patch.email;
  if (patch.imap) acc.imap = { ...acc.imap, ...patch.imap };
  if (patch.smtp) acc.smtp = { ...acc.smtp, ...patch.smtp };
  if (patch.proxy !== undefined) acc.proxy = buildStoredProxy(patch.proxy, acc.proxy);
  if (patch.lastError !== undefined) acc.lastError = patch.lastError;
  writeAll(db);
  return publicAccount(acc);
}

export function removeAccount(id) {
  const db = readAll();
  const before = db.accounts.length;
  db.accounts = db.accounts.filter((a) => a.id !== id);
  writeAll(db);
  return db.accounts.length !== before;
}

/* ------------------------------------------------------------------
 * 联系人自动补全：从收发信的信封里慢慢积累，只存在本机
 * ------------------------------------------------------------------ */

let contactsCache = null;
let contactsTimer = null;
const CONTACTS_MAX = 3000;

function loadContacts() {
  if (contactsCache) return contactsCache;
  ensureDir();
  try {
    const raw = JSON.parse(fs.readFileSync(CONTACTS_FILE, 'utf8'));
    contactsCache = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    contactsCache = {};
  }
  return contactsCache;
}

function scheduleContactsWrite() {
  if (contactsTimer) return;
  contactsTimer = setTimeout(() => {
    contactsTimer = null;
    try {
      const db = loadContacts();
      const keys = Object.keys(db);
      if (keys.length > CONTACTS_MAX) {
        keys
          .sort((a, b) => (db[a].count || 0) - (db[b].count || 0))
          .slice(0, keys.length - CONTACTS_MAX)
          .forEach((k) => delete db[k]);
      }
      const tmp = CONTACTS_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db), { mode: 0o600 });
      fs.renameSync(tmp, CONTACTS_FILE);
    } catch {
      /* 写失败不影响主流程 */
    }
  }, 1500);
  if (contactsTimer.unref) contactsTimer.unref();
}

/** 记录一批联系过的人（来自信封的 from / to / cc） */
export function recordContacts(entries = []) {
  const db = loadContacts();
  let changed = false;
  for (const e of entries) {
    const address = String(e?.address || '').trim();
    if (!address.includes('@')) continue;
    const key = address.toLowerCase();
    const cur = db[key] || { address, name: '', count: 0, last: 0 };
    const name = String(e?.name || '').trim();
    if (name && name !== cur.name) {
      cur.name = name;
      changed = true;
    }
    if (!cur.address) cur.address = address;
    cur.count = (cur.count || 0) + 1;
    cur.last = Math.max(cur.last || 0, Number(e?.last) || Date.now());
    db[key] = cur;
    changed = true;
  }
  if (changed) scheduleContactsWrite();
}

/** 搜索联系人，按“匹配程度 + 历史联系次数”排序 */
export function searchContacts(query = '', limit = 8) {
  const db = loadContacts();
  const q = String(query).trim().toLowerCase();
  const all = Object.values(db);
  if (!q) {
    return all.sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, limit);
  }
  const scored = [];
  for (const c of all) {
    const name = (c.name || '').toLowerCase();
    const addr = (c.address || '').toLowerCase();
    let score = 0;
    if (addr.startsWith(q)) score = 100;
    else if (name.startsWith(q)) score = 90;
    else if (addr.split('@')[0].startsWith(q)) score = 80;
    else if (name.includes(q)) score = 60;
    else if (addr.includes(q)) score = 40;
    if (score > 0) scored.push({ c, score });
  }
  scored.sort((a, b) => b.score - a.score || (b.c.count || 0) - (a.c.count || 0));
  return scored.slice(0, limit).map((s) => s.c);
}
