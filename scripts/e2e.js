// 端到端校验（使用 Ethereal 临时邮箱，验证完即可删除账号）
import nodemailer from 'nodemailer';

const BASE = 'http://127.0.0.1:7317/api';
const out = [];
const log = (...a) => out.push(a.join(' '));

const json = async (url, opts) => {
  const r = await fetch(BASE + url, {
    headers: opts?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...opts,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${data?.error || ''}`);
  return data;
};

const { user, pass, smtp, imap } = await nodemailer.createTestAccount();
log('测试账号:', user);

// 1. 添加账号（服务端会先验证 IMAP）
const { account, test } = await json('/accounts', {
  method: 'POST',
  body: {
    email: user,
    pass,
    name: '端到端测试',
    provider: 'custom',
    imap: { host: imap.host, port: imap.port, secure: true },
    smtp: { host: smtp.host, port: smtp.port, secure: false },
  },
});
log('1) 添加账号 OK, IMAP:', test.imap, 'SMTP:', test.smtp, '文件夹数:', test.folders);

const id = account.id;

// 2. 文件夹
const { folders } = await json(`/accounts/${id}/folders`);
log('2) 文件夹:', folders.map((f) => `${f.name}${f.selectable ? '' : '(不可选)'}`).join(' | '));

// 3. 发信（中文主题 + 附件）
const subject = '端到端测试 · 中文主题 🎉';
const { savedToSent } = await json(`/accounts/${id}/send`, {
  method: 'POST',
  body: {
    to: user,
    subject,
    text: '这是一封自动化测试邮件。\n第二行。',
    html: '<p>这是一封<b>自动化</b>测试邮件。</p><p>第二行。</p>',
    attachments: [
      { filename: '测试附件.txt', contentType: 'text/plain', content: Buffer.from('hello 附件').toString('base64') },
    ],
  },
});
log('3) 发信 OK, 存入已发送:', savedToSent);

// 等待投递
await new Promise((r) => setTimeout(r, 5000));

// 4. 列表
const list = await json(`/accounts/${id}/messages?folder=INBOX&pageSize=10`);
const first = list.messages[0];
log('4) 收件箱:', list.total, '封；首封主题:', first?.subject, '| 附件标记:', first?.hasAttachments, '| 未读:', first?.unread);

// 5. 详情
const { message } = await json(`/accounts/${id}/message?folder=INBOX&uid=${first.uid}`);
log('5) 详情: 主题正确', message.subject === subject, '| HTML 片段:', JSON.stringify(message.html.slice(0, 46)));
log('   纯文本:', JSON.stringify(message.text.slice(0, 30)), '| 附件:', message.attachments.map((a) => `${a.filename}(${a.size}B)`).join(','));

// 6. 附件下载
const attRes = await fetch(`${BASE}/accounts/${id}/attachment?folder=INBOX&uid=${first.uid}&index=0`);
const attText = await attRes.text();
log('6) 附件下载:', attRes.status, JSON.stringify(attText), '| 头:', attRes.headers.get('content-disposition'));

// 7. 标记已读 + 星标
await json(`/accounts/${id}/flags`, { method: 'POST', body: { folder: 'INBOX', uid: first.uid, seen: true, flagged: true } });
const after = await json(`/accounts/${id}/messages?folder=INBOX&pageSize=10`);
log('7) 标记后:', '未读=', after.messages[0].unread, '星标=', after.messages[0].flagged);

// 8. 搜索
const s1 = await json(`/accounts/${id}/messages?folder=INBOX&q=${encodeURIComponent('端到端')}`);
log('8) 中文搜索命中:', s1.total, '封');
const s2 = await json(`/accounts/${id}/messages?folder=INBOX&q=zzz-not-exist`);
log('   无结果搜索:', s2.total, '封');

// 8.5 联系人补全（列表/发信后应已积累）
const c1 = await json(`/contacts?q=ethereal`);
const c2 = await json('/contacts?q=');
log('8.5) 联系人搜索:', c1.contacts.length, '条 | 最近联系人:', c2.contacts.slice(0, 3).map((c) => c.address).join(', '));

// 8.6 诊断
const diag = await json(`/accounts/${id}/diagnose?folder=INBOX`);
log('8.6) 诊断: STATUS=', diag.status?.messages, 'EXISTS=', diag.selected?.exists, 'SEARCH ALL=', diag.searchAll);

// 8.7 修改账号（改显示名 + 重新验证授权码）
const p1 = await json(`/accounts/${id}`, { method: 'PATCH', body: { name: '改名后的测试账号' } });
log('8.7) 改显示名:', p1.account.name, '| 密码未动');
const p2 = await json(`/accounts/${id}`, { method: 'PATCH', body: { pass } });
log('     改授权码后复验 IMAP:', p2.test?.imap, 'SMTP:', p2.test?.smtp);
let badChange = null;
try {
  await json(`/accounts/${id}`, { method: 'PATCH', body: { pass: 'wrong-password-xyz' } });
} catch (e) {
  badChange = e.message;
}
log('     错误授权码被拒绝:', !!badChange, '|', (badChange || '').slice(0, 40));

// 9. 删除
await json(`/accounts/${id}/message?folder=INBOX&uid=${first.uid}`, { method: 'DELETE' });
const afterDel = await json(`/accounts/${id}/messages?folder=INBOX&pageSize=10`);
log('9) 删除后收件箱:', afterDel.total, '封');

// 10. 清理
await json(`/accounts/${id}`, { method: 'DELETE' });
log('10) 已清理测试账号');

const fs = await import('node:fs');
fs.writeFileSync('scripts/e2e-result.txt', out.join('\n'), 'utf8');
console.log('DONE');
