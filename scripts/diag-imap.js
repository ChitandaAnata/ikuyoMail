/**
 * IMAP 深度诊断：打印服务器返回的原始数字，不做任何推测。
 * 用法：node scripts/diag-imap.js [邮箱关键字]
 */
import { ImapFlow } from 'imapflow';
import { listAccounts, getAccountWithSecret } from '../src/store.js';

const KEY = process.argv[2] || '163.com';

/** modified UTF-7 解码（IMAP 文件夹名编码） */
function decodeMUtf7(s) {
  return String(s).replace(/&([^-]*)-/g, (m, p) => {
    if (p === '') return '&';
    try {
      const buf = Buffer.from(p.replace(/,/g, '/'), 'base64');
      let str = '';
      for (let i = 0; i + 1 < buf.length; i += 2) {
        str += String.fromCharCode((buf[i] << 8) | buf[i + 1]);
      }
      return str;
    } catch {
      return m;
    }
  });
}
const list = listAccounts();
const brief = list.find((a) => String(a.email).includes(KEY));
if (!brief) {
  console.log('未找到匹配账号，现有账号：', list.map((a) => a.email).join(', '));
  process.exit(1);
}
const acc = getAccountWithSecret(brief.id);

const logs = [];
const mkLog = (lvl) => (o) => {
  let m = '';
  try {
    m = typeof o.msg === 'function' ? o.msg() : o.msg;
  } catch {
    m = '<无法解析>';
  }
  if (Buffer.isBuffer(m)) m = m.toString('utf8');
  logs.push(`[${lvl}] ${String(m).replace(/\s+$/, '')}`);
};

const client = new ImapFlow({
  host: acc.imap.host,
  port: Number(acc.imap.port) || 993,
  secure: acc.imap.secure !== false,
  auth: { user: acc.username || acc.email, pass: acc.pass },
  logger: { debug: mkLog('C'), info: mkLog('S'), warn: mkLog('W'), error: mkLog('E') },
  tls: { rejectUnauthorized: true },
  greetingTimeout: 20000,
  socketTimeout: 120000,
  connectionTimeout: 25000,
});

const out = (...a) => console.log(...a);
client.on('error', () => {});

try {
  await client.connect();
  out('=== 已连接 ===');
  out('服务器:', acc.imap.host);
  out('账号:', acc.email);

  // 1. 服务器能力
  const caps = client.capabilities;
  out('\n--- CAPABILITY ---');
  if (caps instanceof Map) out([...caps.keys()].join(' '));
  else out(JSON.stringify(caps));

  // 2. 所有文件夹
  out('\n--- LIST 文件夹 ---');
  const boxes = await client.list();
  for (const b of boxes) {
    out(
      `  ${JSON.stringify(b.path)} -> ${decodeMUtf7(b.path)} | special=${b.specialUse || '-'} ` +
        `| flags=${(b.flags ? [...b.flags] : []).join(',') || '-'} | delimiter=${JSON.stringify(b.delimiter)}`
    );
  }

  // 4. 每个文件夹的 STATUS
  out('\n--- STATUS（MESSAGES / UNSEEN / UIDNEXT / UIDVALIDITY） ---');
  const stat = [];
  for (const b of boxes) {
    try {
      const s = await client.status(b.path, {
        messages: true,
        unseen: true,
        uidNext: true,
        uidValidity: true,
        highestModseq: true,
      });
      stat.push({ path: b.path, ...s });
      out(
        `  ${decodeMUtf7(b.path).padEnd(12)} MESSAGES=${String(s.messages).padStart(4)} ` +
          `UNSEEN=${String(s.unseen).padStart(3)} UIDNEXT=${String(s.uidNext).padStart(4)} ` +
          `UIDVALIDITY=${s.uidValidity} MODSEQ=${s.highestModseq ?? '-'}`
      );
    } catch (e) {
      out(`  ${JSON.stringify(b.path)} -> STATUS 失败: ${e.message}`);
    }
  }

  // 5. 选中 INBOX 看 SELECT 的返回
  out('\n--- SELECT INBOX ---');
  const lock = await client.getMailboxLock('INBOX');
  try {
    const mb = client.mailbox;
    out(
      `EXISTS=${mb.exists}  UIDNEXT=${mb.uidNext}  UIDVALIDITY=${mb.uidValidity}  ` +
        `READ-ONLY=${mb.readOnly}  MODSEQ=${mb.highestModseq ?? '-'}`
    );

    // 6. 三种口径的搜索计数
    out('\n--- SEARCH 计数 ---');
    const all = await client.search({ all: true }, { uid: true });
    out(`  ALL        = ${all.length}`);
    for (const days of [7, 30, 90, 365]) {
      const since = new Date(Date.now() - days * 864e5);
      try {
        const r = await client.search({ since }, { uid: true });
        out(`  SINCE ${String(days).padStart(3)}天 = ${r.length}`);
      } catch (e) {
        out(`  SINCE ${days}天 失败: ${e.message}`);
      }
    }

    // 7. 最早与最新一封的日期：看服务器到底保留了哪个时间段
    if (all.length) {
      const uids = all.slice().sort((a, b) => a - b);
      out('\n--- 邮件时间跨度 ---');
      out(`  UID 范围: ${uids[0]} ~ ${uids[uids.length - 1]}`);
      const probe = [uids[0], uids[uids.length - 1]].join(',');
      for await (const m of client.fetch(probe, { uid: true, internalDate: true, envelope: true }, { uid: true })) {
        const d = m.internalDate ? new Date(m.internalDate) : null;
        out(`  UID ${m.uid} -> ${d ? d.toISOString() : '无日期'} | ${(m.envelope?.subject || '').slice(0, 40)}`);
      }
      // 服务器能取到的最小 UID 是多少（用 SEARCH UID 1:* 的逻辑）
      try {
        const lowest = await client.search({ uid: '1:*' }, { uid: true });
        out(`  UID 1:* 返回 ${lowest.length} 封，最小 UID = ${Math.min(...lowest)}`);
      } catch (e) {
        out('  UID 1:* 查询失败:', e.message);
      }
    } else {
      out('\n--- 收件箱 SEARCH ALL 为 0 ---');
    }
  } finally {
    lock.release();
  }
} catch (e) {
  out('\n!!! 连接/诊断失败:', e.message);
  if (e.responseText) out('服务器原文:', e.responseText);
} finally {
  try {
    await client.logout();
  } catch {
    /* ignore */
  }
  out('\n--- 原始协议日志（尾部 80 行） ---');
  out(logs.slice(-80).join('\n'));
}
