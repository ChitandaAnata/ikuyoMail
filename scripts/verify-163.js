/**
 * 验证「陈旧 IMAP 会话」修复：
 * 1. 正常取列表（复用连接）
 * 2. force refresh 取列表
 * 3. 诊断接口（应自动发现并重建会话）
 * 4. 各文件夹数量与分页
 */
const BASE = 'http://127.0.0.1:7317/api';

const get = async (p) => {
  const r = await fetch(BASE + p);
  const t = await r.text();
  try {
    return { status: r.status, json: JSON.parse(t) };
  } catch {
    return { status: r.status, text: t };
  }
};

const accs = await get('/accounts');
const acc = accs.json.accounts.find((a) => a.email.includes('163.com'));
if (!acc) {
  console.log('没有 163 账号');
  process.exit(1);
}
console.log('账号:', acc.email, '| id:', acc.id);

console.log('\n=== 1. 文件夹 ===');
const f = await get(`/accounts/${acc.id}/folders`);
for (const x of f.json.folders) {
  console.log(`  ${String(x.name).padEnd(8)} messages=${String(x.messages).padStart(4)} unseen=${String(x.unseen).padStart(4)} special=${x.specialUse || '-'}`);
}

console.log('\n=== 2. 收件箱 ===');
const m1 = await get(`/accounts/${acc.id}/messages?folder=INBOX&pageSize=5`);
console.log('total =', m1.json.total, '| server =', JSON.stringify(m1.json.server));
for (const m of m1.json.messages) console.log(`  UID ${m.uid} | ${m.date.slice(0, 10)} | ${m.subject.slice(0, 40)}`);

console.log('\n=== 3. 第 2 页 ===');
const m2 = await get(`/accounts/${acc.id}/messages?folder=INBOX&page=2&pageSize=5`);
console.log('total =', m2.json.total, '| 返回', m2.json.messages.length, '封');
for (const m of m2.json.messages) console.log(`  UID ${m.uid} | ${m.date.slice(0, 10)} | ${m.subject.slice(0, 40)}`);

console.log('\n=== 4. 第 33 页（验证能翻到最后） ===');
const m33 = await get(`/accounts/${acc.id}/messages?folder=INBOX&page=193&pageSize=5`);
console.log('total =', m33.json.total, '| 返回', m33.json.messages.length, '封');
for (const m of m33.json.messages) console.log(`  UID ${m.uid} | ${m.date.slice(0, 10)} | ${m.subject.slice(0, 40)}`);

console.log('\n=== 5. 已发送 ===');
const sent = await get(`/accounts/${acc.id}/messages?folder=${encodeURIComponent('已发送')}&pageSize=3`);
console.log('total =', sent.json.total, '| server =', JSON.stringify(sent.json.server));

console.log('\n=== 6. 强制重连（refresh=1） ===');
const rf = await get(`/accounts/${acc.id}/messages?folder=INBOX&pageSize=3&refresh=1`);
console.log('total =', rf.json.total, '| server =', JSON.stringify(rf.json.server));

console.log('\n=== 7. 诊断接口 ===');
const d = await get(`/accounts/${acc.id}/diagnose?folder=INBOX`);
const j = d.json;
console.log('STATUS =', j.status?.messages, '| EXISTS =', j.selected?.exists, '| SEARCH ALL =', j.searchAll);
console.log('旧会话视图 =', JSON.stringify(j.pooled), '| stale =', j.stale, '| 已重连 =', j.reconnected);
if (j.sample?.length) console.log('最新一封:', j.sample[0].subject.slice(0, 40), '|', j.sample[0].date.slice(0, 10));
