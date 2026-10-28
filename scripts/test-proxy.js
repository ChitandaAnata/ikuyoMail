/**
 * 代理链路真实验证。
 * 本地起 SOCKS5（带/不带认证）与 HTTP CONNECT 代理，让 imapflow / nodemailer
 * 通过它们连真实的 imap.163.com 与 smtp.163.com，并统计经过代理的连接数。
 *
 * 用法：node scripts/test-proxy.js
 */
import net from 'node:net';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import socksPkg from 'socks';
import { getAccountWithSecret, listAccounts } from '../src/store.js';

const stats = { socks5: 0, socks5auth: 0, http: 0 };

/* ---------------- 最小 SOCKS5 服务端 ---------------- */

function parseSocksRequest(buf) {
  if (buf.length < 5) return null;
  const atyp = buf[3];
  let offset = 4;
  let host;
  if (atyp === 1) {
    if (buf.length < offset + 4 + 2) return null;
    host = [...buf.subarray(offset, offset + 4)].join('.');
    offset += 4;
  } else if (atyp === 3) {
    const len = buf[offset];
    if (buf.length < offset + 1 + len + 2) return null;
    host = buf.subarray(offset + 1, offset + 1 + len).toString();
    offset += 1 + len;
  } else if (atyp === 4) {
    if (buf.length < offset + 16 + 2) return null;
    const parts = [];
    for (let i = 0; i < 8; i++) parts.push(buf.readUInt16BE(offset + i * 2).toString(16));
    host = parts.join(':');
    offset += 16;
  } else {
    return { bad: true };
  }
  const port = buf.readUInt16BE(offset);
  return { host, port, consumed: offset + 2 };
}

function startSocks5({ port, username, password, tag }) {
  const server = net.createServer((client) => {
    let stage = 'greeting';
    let buf = Buffer.alloc(0);
    let authed = !username;

    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);

      if (stage === 'greeting') {
        if (buf.length < 2) return;
        if (buf[0] !== 0x05) return client.destroy();
        const n = buf[1];
        if (buf.length < 2 + n) return;
        const methods = [...buf.subarray(2, 2 + n)];
        const want = username ? 0x02 : 0x00;
        if (!methods.includes(want)) {
          client.end(Buffer.from([0x05, 0xff]));
          return;
        }
        client.write(Buffer.from([0x05, want]));
        buf = buf.subarray(2 + n);
        stage = username ? 'auth' : 'request';
      }

      if (stage === 'auth') {
        if (buf.length < 2) return;
        if (buf[0] !== 0x01) return client.destroy();
        const ulen = buf[1];
        if (buf.length < 3 + ulen) return;
        const un = buf.subarray(2, 2 + ulen).toString();
        const plen = buf[2 + ulen];
        if (buf.length < 3 + ulen + plen) return;
        const pw = buf.subarray(3 + ulen, 3 + ulen + plen).toString();
        if (un !== username || pw !== password) {
          client.end(Buffer.from([0x01, 0x01]));
          return;
        }
        client.write(Buffer.from([0x01, 0x00]));
        buf = buf.subarray(3 + ulen + plen);
        authed = true;
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
          stats[tag] += 1;
          console.log(`    [${tag}] 代理转发 → ${req.host}:${req.port}（认证:${authed ? '是' : '否'}）`);
        });
        target.on('error', () => client.destroy());
        client.on('error', () => target.destroy());
      }
    };
    client.on('data', onData);
    client.on('error', () => {});
  });
  server.listen(port, '127.0.0.1');
  return server;
}

/* ---------------- 最小 HTTP CONNECT 代理 ---------------- */

function startHttpProxy({ port }) {
  const server = net.createServer((client) => {
    let buf = Buffer.alloc(0);
    let done = false;
    const onData = (chunk) => {
      if (done) return;
      buf = Buffer.concat([buf, chunk]);
      const idx = buf.indexOf('\r\n\r\n');
      if (idx < 0) return;
      const head = buf.subarray(0, idx).toString();
      const rest = buf.subarray(idx + 4);
      const line = head.split('\r\n')[0] || '';
      const m = line.match(/^CONNECT\s+([^\s:]+):(\d+)/i);
      if (!m) {
        client.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        return;
      }
      done = true;
      client.pause();
      client.off('data', onData);

      const target = net.connect({ host: m[1], port: Number(m[2]) }, () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (rest.length) target.write(rest);
        client.pipe(target);
        target.pipe(client);
        client.resume();
        stats.http += 1;
        console.log(`    [http] 代理转发 → ${m[1]}:${m[2]}`);
      });
      target.on('error', () => client.destroy());
      client.on('error', () => target.destroy());
    };
    client.on('data', onData);
    client.on('error', () => {});
  });
  server.listen(port, '127.0.0.1');
  return server;
}

/* ---------------- 测试主体 ---------------- */

const P_SOCKS = 11080;
const P_SOCKS_AUTH = 11081;
const P_HTTP = 18080;

const s1 = startSocks5({ port: P_SOCKS, tag: 'socks5' });
const s2 = startSocks5({ port: P_SOCKS_AUTH, username: 'tester', password: 'proxysecret123', tag: 'socks5auth' });
const s3 = startHttpProxy({ port: P_HTTP });
await new Promise((r) => setTimeout(r, 300));
console.log('本地代理已启动：socks5 11080 / socks5+auth 11081 / http 18080\n');

const brief = listAccounts().find((a) => a.email.includes('163.com'));
if (!brief) {
  console.log('没有可用的 163 账号，无法做真实链路测试');
  process.exit(1);
}
const acc = getAccountWithSecret(brief.id);

async function tryImap(proxyUrl, label) {
  const client = new ImapFlow({
    host: acc.imap.host,
    port: acc.imap.port,
    secure: true,
    auth: { user: acc.username || acc.email, pass: acc.pass },
    proxy: proxyUrl,
    logger: false,
    connectionTimeout: 20000,
    greetingTimeout: 15000,
  });
  client.on('error', () => {});
  const t0 = Date.now();
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    const exists = client.mailbox.exists;
    lock.release();
    await client.logout();
    console.log(`✅ ${label}：IMAP 登录成功，收件箱 ${exists} 封（${Date.now() - t0}ms）`);
    return true;
  } catch (e) {
    console.log(`❌ ${label}：${e.message}`);
    try {
      client.close();
    } catch {}
    return false;
  }
}

async function trySmtp(proxyUrl, label) {
  const transport = nodemailer.createTransport({
    host: acc.smtp.host,
    port: acc.smtp.port,
    secure: acc.smtp.secure !== false,
    auth: { user: acc.username || acc.email, pass: acc.pass },
    proxy: proxyUrl,
    tls: { rejectUnauthorized: true },
    connectionTimeout: 20000,
    greetingTimeout: 15000,
  });
  // 与 src/imap.js 的处理保持一致
  if (/^socks/i.test(proxyUrl)) transport.meta.set('proxy_socks_module', socksPkg);
  try {
    await transport.verify();
    transport.close();
    console.log(`✅ ${label}：SMTP 认证通过`);
    return true;
  } catch (e) {
    console.log(`❌ ${label}：${e.message}`);
    try {
      transport.close();
    } catch {}
    return false;
  }
}

console.log('=== 1. SOCKS5（无认证） ===');
await tryImap(`socks5://127.0.0.1:${P_SOCKS}`, 'IMAP');
await trySmtp(`socks5://127.0.0.1:${P_SOCKS}`, 'SMTP');

console.log('\n=== 2. SOCKS5（用户名密码认证） ===');
await tryImap(
  `socks5://tester:${encodeURIComponent('proxysecret123')}@127.0.0.1:${P_SOCKS_AUTH}`,
  'IMAP'
);

console.log('\n=== 3. HTTP CONNECT ===');
await tryImap(`http://127.0.0.1:${P_HTTP}`, 'IMAP');

console.log('\n=== 4. 代理不可用（端口没开） ===');
const before = Date.now();
const badClient = new ImapFlow({
  host: acc.imap.host,
  port: acc.imap.port,
  secure: true,
  auth: { user: acc.username, pass: acc.pass },
  proxy: 'socks5://127.0.0.1:19999',
  logger: false,
  connectionTimeout: 8000,
});
badClient.on('error', () => {});
try {
  await badClient.connect();
  console.log('❌ 应该失败却连上了');
} catch (e) {
  console.log(`✅ 正确失败（${Date.now() - before}ms）：${e.message}`);
}

console.log('\n=== 5. 认证错误的代理 ===');
const badAuth = new ImapFlow({
  host: acc.imap.host,
  port: acc.imap.port,
  secure: true,
  auth: { user: acc.username, pass: acc.pass },
  proxy: `socks5://tester:wrongpass@127.0.0.1:${P_SOCKS_AUTH}`,
  logger: false,
  connectionTimeout: 10000,
});
badAuth.on('error', () => {});
try {
  await badAuth.connect();
  console.log('❌ 认证错误却连上了');
} catch (e) {
  console.log(`✅ 正确失败：${e.message}`);
}

console.log('\n=== 经过代理的连接统计 ===');
console.log(JSON.stringify(stats));

s1.close();
s2.close();
s3.close();
process.exit(0);
