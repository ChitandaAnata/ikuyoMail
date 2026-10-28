const BASE = 'http://127.0.0.1:7317';
const j = async (res) => ({ status: res.status, body: await res.json().catch(() => null) });

const { body: accounts } = await j(await fetch(BASE + '/api/accounts'));
const acc = accounts.accounts[0].id;
console.log('account', acc);

const marks0 = await j(await fetch(`${BASE}/api/accounts/${acc}/marks`));
console.log('marks(before)', JSON.stringify(marks0.body));

const p1 = await j(
  await fetch(`${BASE}/api/accounts/${acc}/mark`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder: 'INBOX', uid: 123, pinned: true, note: '  等他回复报价  ', subject: '测试主题' }),
  })
);
console.log('pin+note', JSON.stringify(p1.body));

const p2 = await j(
  await fetch(`${BASE}/api/accounts/${acc}/mark`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder: 'INBOX', uid: 123, todo: true }),
  })
);
console.log('todo', JSON.stringify(p2.body));

const marks1 = await j(await fetch(`${BASE}/api/accounts/${acc}/marks`));
console.log('marks(after)', JSON.stringify(marks1.body));

// 清空 note + 取消置顶/待办 → 记录应被删掉
const p3 = await j(
  await fetch(`${BASE}/api/accounts/${acc}/mark`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder: 'INBOX', uid: 123, pinned: false, todo: false, note: '' }),
  })
);
console.log('clear', JSON.stringify(p3.body));

const marks2 = await j(await fetch(`${BASE}/api/accounts/${acc}/marks`));
console.log('marks(empty)', JSON.stringify(marks2.body));

// 打印页能打开吗
const pr = await fetch(`${BASE}/print.html?acc=${acc}&folder=INBOX&uid=1`);
const html = await pr.text();
console.log('print.html', pr.status, html.includes('pSubject'), html.length);
const pjs = await fetch(`${BASE}/print.js`);
console.log('print.js', pjs.status, (await pjs.text()).length);
