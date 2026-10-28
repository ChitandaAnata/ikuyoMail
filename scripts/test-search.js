/** 验证搜索：本地索引首次构建耗时 / 命中数 / 二次查询耗时 */
import { listAccounts, getAccountWithSecret } from '../src/store.js';
import { listMessages, forgetSearchIndex } from '../src/imap.js';

const acc = getAccountWithSecret(listAccounts()[0]?.id);
if (!acc) {
  console.error('没有账号');
  process.exit(1);
}
forgetSearchIndex(acc.id);

const queries = process.argv.slice(2);
if (!queries.length) queries.push('163', '网易', '安全手机', 'NetEase', 'service.netease.com');

for (const q of queries) {
  const t = Date.now();
  const out = await listMessages(acc, { folder: 'INBOX', page: 1, pageSize: 5, query: q });
  console.log(
    `“${q}” → ${out.total} 封  (${Date.now() - t}ms)  scanned=${out.server?.scanned}  total=${out.server?.total}`
  );
  for (const m of out.messages.slice(0, 3)) {
    console.log(`    ${m.fromName || m.fromAddress} | ${m.subject}`);
  }
}
process.exit(0);
