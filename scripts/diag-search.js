/**
 * 排查 IMAP 搜索：把几种不同的 SEARCH 语法各试一遍，看谁能返回结果。
 * 用法：node scripts/diag-search.js [关键词] [邮箱地址]
 */
import { listAccounts, getAccountWithSecret } from '../src/store.js';
import { withClient } from '../src/imap.js';

const keyword = process.argv[2] || '163';
const fromAddr = process.argv[3] || 'safe@service.netease.com';
const aid = process.argv[4] || listAccounts()[0]?.id;
const acc = getAccountWithSecret(aid);
if (!acc) {
  console.error('没有可用的账号（data/accounts.json 为空）');
  process.exit(1);
}
console.log('账号：', acc.email, '→', acc.imap.host);

const cases = [
  ['or(subject,from,to)', { or: [{ subject: keyword }, { from: keyword }, { to: keyword }] }],
  ['subject', { subject: keyword }],
  ['from', { from: keyword }],
  ['to', { to: keyword }],
  ['from(完整地址)', { from: fromAddr }],
  ['header from', { header: { 'message-id': '' } }],
  ['text', { text: keyword }],
  ['body', { body: keyword }],
  ['or(from,subject) 带完整地址', { or: [{ from: fromAddr }, { subject: keyword }] }],
  ['or(to,subject)', { or: [{ to: keyword }, { subject: keyword }] }],
  ['or(from,to)', { or: [{ from: keyword }, { to: keyword }] }],
];

await withClient(acc, async (client) => {
  const lock = await client.getMailboxLock('INBOX');
  try {
    for (const [label, query] of cases) {
      const t = Date.now();
      try {
        const uids = await client.search(query, { uid: true });
        console.log(
          `${label.padEnd(34)} → ${String(uids.length).padStart(5)} 条  (${Date.now() - t}ms)`,
          uids.slice(-3).join(',')
        );
      } catch (e) {
        console.log(`${label.padEnd(34)} → 报错: ${e.message}`);
      }
    }
  } finally {
    lock.release();
  }
});
process.exit(0);
