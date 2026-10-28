/**
 * 新邮件链路测试：把水位线人为退后 2 封，跑一轮轮询，看是否识别成新邮件。
 * 不会真的发信，也不改动服务器上的邮件状态。
 *   node scripts/test-notify.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { listAccounts, getAccountWithSecret, DATA_DIR } from '../src/store.js';
import { fetchNewMessages } from '../src/imap.js';

const acc = getAccountWithSecret(listAccounts()[0].id);
const peek = await fetchNewMessages(acc, { sinceUid: 0, limit: 2 });
const target = Math.max(peek.maxUid - 2, 1);
console.log('账号:', acc.email);
console.log('当前最大 UID:', peek.maxUid, '| 人为把水位线退到:', target);

const stateFile = path.join(DATA_DIR, 'notify-state.json');
const previous = fs.existsSync(stateFile) ? fs.readFileSync(stateFile, 'utf8') : null;
fs.writeFileSync(
  stateFile,
  JSON.stringify({ accounts: { [acc.id]: { lastUid: target, email: acc.email, updatedAt: new Date().toISOString() } } }, null, 2)
);

const poller = await import('../src/poller.js');
const events = [];
poller.onMailEvent((e) => events.push(e));
const out = await poller.checkOnce();
poller.stopPolling();

console.log('本轮结果:', JSON.stringify(out.results));
const mail = events.find((e) => e.type === 'mail');
if (!mail) {
  console.log('❌ 没有识别出新邮件');
} else {
  console.log('✅ 识别到新邮件:', mail.count, '封 | 账号:', mail.accountName, '| 未读:', mail.unseen);
  for (const it of mail.items) console.log('   ·', it.fromName || it.fromAddress, '—', it.subject);
}

// 恢复真实水位线
const after = await fetchNewMessages(acc, { sinceUid: 0, limit: 1 });
fs.writeFileSync(
  stateFile,
  JSON.stringify({ accounts: { [acc.id]: { lastUid: after.maxUid, email: acc.email, updatedAt: new Date().toISOString() } } }, null, 2)
);
console.log('已恢复水位线到', after.maxUid);
if (previous === null) fs.unlinkSync(stateFile);
process.exit(0);
