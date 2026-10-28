/**
 * 新邮件轮询：按设置里的间隔，逐个账号增量检查 INBOX 的新 UID。
 * 只取信封，收到新邮件时把事件抛给上层（server）决定怎么提醒。
 *
 * 水位线（lastUid）存在 data/notify-state.json，重启后不会把历史邮件当新邮件弹出来。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, getAccountWithSecret, listAccounts } from './store.js';
import { fetchNewMessages } from './imap.js';
import { getSettings } from './settings.js';

const STATE_FILE = path.join(DATA_DIR, 'notify-state.json');

const listeners = new Set();
let state = readState();
let timer = null;
let busy = false;
let lastCheckAt = null;
let lastError = null;
let lastResult = null;

function readState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (raw && typeof raw === 'object' && raw.accounts) return raw;
  } catch {
    /* 首次运行没有这个文件 */
  }
  return { accounts: {} };
}

function saveState() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, STATE_FILE);
  } catch {
    /* 记不住水位线只会导致重复提醒，不该影响收信 */
  }
}

export function onMailEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(event) {
  for (const fn of listeners) {
    try {
      fn(event);
    } catch {
      /* 监听器自己的问题不该拖垮轮询 */
    }
  }
}

export function forgetAccount(id) {
  if (state.accounts[id]) {
    delete state.accounts[id];
    saveState();
  }
}

export function getStatus() {
  return {
    lastCheckAt,
    lastError,
    lastResult,
    polling: !!timer,
    baselines: Object.fromEntries(
      Object.entries(state.accounts).map(([id, v]) => [id, { lastUid: v.lastUid, updatedAt: v.updatedAt }])
    ),
  };
}

/**
 * 跑一轮检查。
 * silent=true 时不触发提醒（用于刚启动、刚加账号的基线读取）。
 */
export async function checkOnce({ silent = false } = {}) {
  if (busy) return { skipped: true };
  busy = true;
  const accounts = listAccounts();
  const results = [];
  let newTotal = 0;

  try {
    for (const pub of accounts) {
      const acc = getAccountWithSecret(pub.id);
      if (!acc) continue;
      const prev = state.accounts[acc.id];
      let fresh = [];

      try {
        const res = await fetchNewMessages(acc, { sinceUid: prev?.lastUid || 0 });

        if (!prev) {
          // 第一次见到这个账号：只记水位线。否则 965 封历史邮件会一口气全弹出来
          state.accounts[acc.id] = { lastUid: res.maxUid, email: acc.email, updatedAt: new Date().toISOString() };
          saveState();
          results.push({ id: acc.id, email: acc.email, baseline: true, maxUid: res.maxUid });
          continue;
        }

        if (res.maxUid !== prev.lastUid) {
          // maxUid 变小说明邮箱被清空或 UIDVALIDITY 变了，同样按重置处理
          if (res.maxUid > prev.lastUid) {
            fresh = (res.messages || []).filter((m) => m.uid > prev.lastUid);
          }
          state.accounts[acc.id] = {
            lastUid: res.maxUid,
            email: acc.email,
            updatedAt: new Date().toISOString(),
          };
          saveState();
        }

        if (fresh.length && !silent) {
          newTotal += fresh.length;
          emit({
            type: 'mail',
            accountId: acc.id,
            accountName: acc.name || acc.email,
            accountEmail: acc.email,
            unseen: res.unseen || 0,
            count: fresh.length,
            items: fresh.slice(0, 5).map((m) => ({
              uid: m.uid,
              subject: m.subject,
              fromName: m.fromName,
              fromAddress: m.fromAddress,
              date: m.date,
              hasAttachments: m.hasAttachments,
            })),
          });
        }
        results.push({ id: acc.id, email: acc.email, maxUid: res.maxUid, fresh: fresh.length });
      } catch (err) {
        lastError = { at: new Date().toISOString(), account: acc.email, message: err.message };
        results.push({ id: acc.id, email: acc.email, error: err.message });
      }
    }

    lastCheckAt = new Date().toISOString();
    lastResult = { at: lastCheckAt, newTotal, accounts: results.length };
    if (!silent) emit({ type: 'checked', at: lastCheckAt, newTotal, results });
    return { newTotal, results };
  } finally {
    busy = false;
  }
}

function schedule(delaySeconds) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    timer = null;
    try {
      await checkOnce();
    } catch {
      /* checkOnce 内部已兜住单账号错误 */
    }
    const next = Math.max(Number(getSettings().pollInterval) || 120, 30);
    schedule(next);
  }, Math.max(delaySeconds, 5) * 1000);
  if (timer.unref) timer.unref();
}

/** 启动轮询：先静默跑一轮建立基线，再按间隔循环 */
export async function startPolling() {
  stopPolling();
  try {
    await checkOnce({ silent: true });
  } catch {
    /* ignore */
  }
  const seconds = Math.max(Number(getSettings().pollInterval) || 120, 30);
  schedule(seconds);
  return seconds;
}

export function stopPolling() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

/** 设置里的间隔改了之后，让下一轮按新间隔走 */
export function reschedule() {
  if (timer) schedule(Math.max(Number(getSettings().pollInterval) || 120, 30));
}
