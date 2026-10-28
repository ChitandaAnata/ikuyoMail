/**
 * 本地标记：置顶 / 待办 / 备注
 *
 * 这些状态邮件服务器上没有对应字段（IMAP 只有 \Seen、\Flagged 这些标准标记），
 * 所以存在本机的 data/marks.json 里，按「账号 → 文件夹+UID」索引。
 * 只在本地生效，换一台电脑或换一个客户端看不到，也不会同步回邮箱。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './store.js';

const MARKS_FILE = path.join(DATA_DIR, 'marks.json');
const NOTE_MAX = 2000;

let cache = null;
let writeTimer = null;

/** 统一 key 规则（文件夹名里偶尔带空格/中文，用 | 分隔足够） */
export function markKey(folder, uid) {
  return `${String(folder || 'INBOX')}|${Number(uid) || 0}`;
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  if (cache) return cache;
  ensureDir();
  try {
    const raw = JSON.parse(fs.readFileSync(MARKS_FILE, 'utf8'));
    cache = raw && typeof raw === 'object' && raw.accounts && typeof raw.accounts === 'object' ? raw : { accounts: {} };
  } catch {
    cache = { accounts: {} };
  }
  return cache;
}

function scheduleWrite() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    flush();
  }, 600);
  if (writeTimer.unref) writeTimer.unref();
}

/** 立刻落盘（退出前、批量改动后调用都安全） */
export function flush() {
  if (!cache) return;
  try {
    ensureDir();
    // 清空的账号整段删掉，别让文件里攒一堆空对象
    for (const [id, bucket] of Object.entries(cache.accounts || {})) {
      if (!bucket || Object.keys(bucket).length === 0) delete cache.accounts[id];
    }
    const tmp = MARKS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, MARKS_FILE);
  } catch {
    /* 写失败不影响读取，下次改动会再试 */
  }
}

function bucket(accountId, create = false) {
  const db = load();
  const id = String(accountId || '');
  if (!db.accounts[id] && create) db.accounts[id] = {};
  return db.accounts[id] || null;
}

/** 某个账号下的全部标记：{ "INBOX|123": { pinned, todo, note } } */
export function listMarks(accountId) {
  return bucket(accountId) || {};
}

export function getMark(accountId, folder, uid) {
  const b = bucket(accountId);
  return (b && b[markKey(folder, uid)]) || null;
}

/** 合并写入；三项都为空时把这一条删掉，别让文件越攒越大 */
export function patchMark(accountId, folder, uid, patch = {}) {
  const b = bucket(accountId, true);
  if (!b) return null;
  const key = markKey(folder, uid);
  const cur = b[key] || {};

  if (patch.pinned !== undefined) cur.pinned = !!patch.pinned;
  if (patch.todo !== undefined) cur.todo = !!patch.todo;
  if (patch.note !== undefined) {
    const note = String(patch.note || '').trim().slice(0, NOTE_MAX);
    if (note) cur.note = note;
    else delete cur.note;
  }
  if (patch.messageId !== undefined && patch.messageId) cur.messageId = String(patch.messageId);
  if (patch.subject !== undefined && patch.subject) cur.subject = String(patch.subject).slice(0, 300);

  const empty = !cur.pinned && !cur.todo && !cur.note;
  if (empty) delete b[key];
  else {
    cur.updatedAt = new Date().toISOString();
    b[key] = cur;
  }
  scheduleWrite();
  return empty ? null : cur;
}

export function removeMark(accountId, folder, uid) {
  const b = bucket(accountId);
  if (!b) return false;
  const key = markKey(folder, uid);
  if (!(key in b)) return false;
  delete b[key];
  scheduleWrite();
  return true;
}

/** 删账号时连带清掉它的本地标记 */
export function forgetAccount(accountId) {
  const db = load();
  const id = String(accountId || '');
  if (!db.accounts[id]) return false;
  delete db.accounts[id];
  scheduleWrite();
  return true;
}

/** 把标记贴到邮件列表项上（listMessages 的返回里直接带上，前端不用再拉一次） */
export function attachMarks(accountId, folder, items = []) {
  const b = bucket(accountId);
  if (!b) return items;
  for (const m of items) {
    const mk = b[markKey(folder, m.uid)];
    if (!mk) continue;
    if (mk.pinned) m.pinned = true;
    if (mk.todo) m.todo = true;
    if (mk.note) m.note = mk.note;
  }
  return items;
}
