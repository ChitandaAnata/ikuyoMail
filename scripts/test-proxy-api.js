/**
 * 通过真实 HTTP API 验证「账号级代理」：
 * 起本地 SOCKS5 代理 → 用代理配置新增账号 → 读取邮件 → 删除账号。
 * 全程统计经过代理的连接数，证明请求确实走代理而不是直连。
 */
import net from 'node:net';
import { getAccountWithSecret, listAccounts } from '../src/store.js';

const BASE = 'http://127.0.0.1:7317/api';
const PROXY_PORT = 11090;
let proxied = 0;

function parseSocksRequest(buf) {
  if (buf.length < 5) return null;
  const atyp = buf[3];
  let off = 4;
  let host;
  if (atyp === 1) {
    if (buf.length < off + 6) return null;
    host = [...buf.subarray(off, off + 4)].join('.');
    off += 4;
  } else if (atyp === 3) {
    const len = buf[off];
    if (buf.length < off + 1 + len + 2) return null;
    host = buf.subarray(off + 1, off + 1 + len).toString();
    off += 1 + len;
  } else return { bad: true };
  return { host, port: buf.readUInt16BE(off), consumed: off + 2 };
}

const proxy = net.createServer((client) => {
  let stage = 'greeting';
  let buf = Buffer.alloc(0);
  const onData = (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (stage === 'greeting') {
      if (buf.length < 2) return;
      const n = buf[1];
      if (buf.length < 2 + n) return;
      const methods = [...buf.subarray(2, 2 + n)];
      if (!methods.includes(0x00)) return client.end(Buffer.from([0x05, 0xff]));
      client.write(Buffer.from([0x05, 0x00]));
      buf = buf.subarray(2 + n);
      stage = 'request';
    }
    if (stage === 'request') {
      const req = parseSocksRequest(buf);
      if (!req) return;
      if (req.bad) return client.destroy();
      const rest = buf.subarray(req.consumed);
      client.pause();
      client.off('data', onData);
      const target = net.connect({ host: req.host, port: req.port }, () => {
        client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
        if (rest.length) target.write(rest);
        client.pipe(target);
        target.pipe(client);
        client.resume();
        proxied += 1;
        console.log(`  [代理] → ${req.host}:${req.port}`);
      });
      target.on('error', () => client.destroy());
      client.on('error', () => target.destroy());
    }
  };
  client.on('data', onData);
  client.on('error', () => {});
});
proxy.listen(PROXY_PORT, '127.0.0.1');
await new Promise((r) => setTimeout(r, 200));
console.log(`本地 SOCKS5 代理已启动 127.0.0.1:${PROXY_PORT}\n`);

const api = async (path, opts = {}) => {
  const res = await fetch(BASE + path, {
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    method: opts.method || 'GET',
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
};

// 复用已保存的 163 账号凭据来建一个「带代理」的新账号
const brief = listAccounts().find((a) => a.email.includes('163.com'));
if (!brief) {
  console.log('没有 163 账号可供测试');
  proxy.close();
  process.exit(1);
}
const src = getAccountWithSecret(brief.id);

console.log('=== 1. 通过代理新建账号 ===');
const created = await api('/accounts', {
  method: 'POST',
  body: {
    email: src.email,
    pass: src.pass,
    provider: '163',
    name: '代理测试',
    proxy: { enabled: true, type: 'socks5', host: '127.0.0.1', port: PROXY_PORT },
  },
});
console.log('HTTP', created.status, '|', created.json.error || '成功');
if (created.json.account) {
  const a = created.json.account;
  console.log('账号回传的代理配置:', JSON.stringify(a.proxy));
  console.log('IMAP:', created.json.test?.imap, '| SMTP:', created.json.test?.smtp);
  console.log('\n=== 1b. 通过代理读取邮件列表 ===');
  const list = await api(`/accounts/${a.id}/messages?folder=INBOX&pageSize=3`);
  console.log('收件箱 total =', list.json.total, '| 代理转发累计:', proxied);
  await api(`/accounts/${a.id}`, { method: 'DELETE' });
  console.log('已删除测试账号');
}

console.log('\n=== 2. 用错误授权码 + 代理（应被拒绝，验证确实在走代理） ===');
const bad = await api('/accounts', {
  method: 'POST',
  body: {
    email: src.email,
    pass: 'definitely-wrong-code',
    provider: '163',
    proxy: { enabled: true, type: 'socks5', host: '127.0.0.1', port: PROXY_PORT },
  },
});
console.log('HTTP', bad.status, '|', String(bad.json.error || '').slice(0, 100));
console.log('代理转发次数:', proxied);

console.log('\n=== 3. 代理不可用时新增（应报代理错误） ===');
const dead = await api('/accounts', {
  method: 'POST',
  body: {
    email: src.email,
    pass: 'x',
    provider: '163',
    proxy: { enabled: true, type: 'socks5', host: '127.0.0.1', port: 19998 },
  },
});
console.log('HTTP', dead.status, '|', String(dead.json.error || '').slice(0, 80));

proxy.close();
console.log('\n完成，代理已关闭');
process.exit(0);
