/**
 * Google 账号登录（OAuth2 + XOAUTH2）。
 *
 * 2025 年起 Gmail 不再接受「账号 + 密码 / 应用专用密码」的 IMAP/SMTP 登录，
 * 第三方客户端必须走 OAuth：跳系统浏览器到 Google 授权页，用户点允许后
 * Google 把浏览器重定向回 http://127.0.0.1:<临时端口>，由本地监听接住，
 * 换取 access_token（1 小时）和 refresh_token（长期）。
 *
 * 凭据（clientId / clientSecret）由用户在 Google Cloud Console 创建后
 * 填进设置里，存 data/google-oauth.json，密文用 store.js 的 encrypt。
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Agent, ProxyAgent, fetch as undiciFetch } from 'undici';
import { encrypt, decrypt } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONFIG_FILE = path.join(ROOT, 'data', 'google-oauth.json');

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://mail.google.com/';

/** 登录会话：id -> { status, email, resolve, timer } */
const logins = new Map();

function readConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return {
      clientId: raw.clientId || '',
      clientSecret: raw.clientSecretEnc ? decrypt(raw.clientSecretEnc) : '',
      accounts: raw.accounts || {},
    };
  } catch {
    return { clientId: '', clientSecret: '', accounts: {} };
  }
}

function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  const out = {
    clientId: cfg.clientId || '',
    clientSecretEnc: cfg.clientSecret ? encrypt(cfg.clientSecret) : null,
    accounts: cfg.accounts || {},
  };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(out, null, 2));
}

export function isConfigured() {
  const c = readConfig();
  return !!(c.clientId && c.clientSecret);
}

export function setConfig(clientId, clientSecret) {
  const c = readConfig();
  writeConfig({
    ...c,
    clientId: String(clientId || '').trim(),
    clientSecret: String(clientSecret || '').trim(),
  });
  return isConfigured();
}

function saveAccountTokens(email, { refresh_token, access_token, expires_in }) {
  const c = readConfig();
  c.accounts = c.accounts || {};
  const prev = c.accounts[email] || {};
  c.accounts[email] = {
    refreshEnc: encrypt(refresh_token || prev.refresh_token_plain || ''),
    accessEnc: encrypt(access_token || ''),
    expiry: Date.now() + (Number(expires_in) || 3600) * 1000,
    updatedAt: new Date().toISOString(),
  };
  // refresh_token Google 可能不重复下发，留一份明文结构外的冗余没意义，直接覆盖
  writeConfig(c);
}

function storedTokens(email) {
  const c = readConfig();
  const a = (c.accounts || {})[email];
  if (!a) return null;
  return {
    refreshToken: a.refreshEnc ? decrypt(a.refreshEnc) : '',
    accessToken: a.accessEnc ? decrypt(a.accessEnc) : '',
    expiry: a.expiry || 0,
  };
}

export function hasAccount(email) {
  return !!storedTokens(String(email || '').toLowerCase().trim());
}

export function forget(email) {
  const c = readConfig();
  if (c.accounts) {
    delete c.accounts[String(email || '').toLowerCase().trim()];
    writeConfig(c);
  }
}

/**
 * 出网策略：Google 的接口在国内通常直连不通，浏览器走系统代理没问题，
 * 但 Node 里的 fetch 不会自动跟。所以顺序是——
 *   1) 直接连（有 TUN/全局代理或能直连的用户，一次就成了）；
 *   2) 失败则找环境变量 HTTPS_PROXY / HTTP_PROXY；
 *   3) 再失败读 Windows 注册表里的系统代理（Clash / v2rayN 装好后都会写）。
 * 成功用哪条路会被记住，之后的请求不再浪费时间重试直连。
 */
let egress = { mode: 'auto' }; // auto | direct | proxy:{url}
let systemProxyCache = { url: null, at: 0 };

async function readSystemProxy() {
  if (Date.now() - systemProxyCache.at < 5 * 60_000) return systemProxyCache.url;
  const url = await new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    execFile('reg', ['query', key, '/v', 'ProxyEnable'], (e, out) => {
      if (e || !/0x1\b/.test(String(out))) return resolve(null);
      execFile('reg', ['query', key, '/v', 'ProxyServer'], (e2, out2) => {
        if (e2) return resolve(null);
        const m = String(out2).match(/ProxyServer\s+REG_SZ\s+(\S+)/i);
        if (!m) return resolve(null);
        let s = m[1];
        if (s.includes('=')) {
          // "http=...;https=...;ftp=..." 形式，优先取 https 条目
          const part = s
            .split(';')
            .map((x) => x.trim())
            .find((x) => x.startsWith('https=') || x.startsWith('socks='));
          s = part ? part.split('=')[1] : '';
        }
        resolve(s ? `http://${s}` : null);
      });
    });
  });
  systemProxyCache = { url, at: Date.now() };
  return url;
}

async function envOrSystemProxy() {
  const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (envProxy) return envProxy;
  return readSystemProxy();
}

async function candidateDispatchers() {
  const direct = new Agent({ connectTimeout: 12_000 });
  if (egress.mode === 'direct') return [direct];
  if (egress.mode === 'proxy') {
    const url = await envOrSystemProxy();
    if (url) return [new ProxyAgent(url), direct];
  }
  const list = [direct];
  const url = await envOrSystemProxy();
  if (url) list.push(new ProxyAgent(url));
  return list;
}

async function tokenRequest(params) {
  const body = new URLSearchParams(params).toString();
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  };
  let lastErr = null;
  for (const dispatcher of await candidateDispatchers()) {
    try {
      const res = await undiciFetch(TOKEN_ENDPOINT, { ...init, dispatcher });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Google 明确拒绝了（如 invalid_client），换网络通道也没用，直接抛
        throw new Error(data.error_description || data.error || `Google 返回 ${res.status}`);
      }
      egress = dispatcher instanceof ProxyAgent ? { mode: 'proxy' } : { mode: 'direct' };
      return data;
    } catch (e) {
      // Google 的业务错误原样抛出，不重试
      if (/Google 返回|invalid_client|invalid_grant|error_description/i.test(e.message) && !/fetch failed/i.test(e.message)) {
        throw e;
      }
      lastErr = e;
    }
  }
  throw new Error('连不上 Google（直连和系统代理都试过了）：' + (lastErr?.cause?.message || lastErr?.message));
}

/**
 * 发起一次登录：起本地监听，返回授权链接。
 * 用户在系统浏览器里点「允许」后 Google 会带 code 回来。
 */
export function startLogin(email) {
  const cfg = readConfig();
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new Error('还没有配置 Google 客户端凭据');
  }
  const key = String(email || '').toLowerCase().trim();
  const loginId = crypto.randomUUID();
  const state = crypto.randomBytes(12).toString('hex');

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const session = logins.get(loginId);
      if (!session) {
        res.writeHead(410, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<meta charset="utf-8">这个授权会话已经失效了，请回到 ikuyoMail 重新发起。');
        return;
      }

      if (url.searchParams.get('state') !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<meta charset="utf-8">state 校验失败，请回到 ikuyoMail 重新发起。');
        return;
      }

      const err = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const finish = (body) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<meta charset="utf-8"><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
            '<div style="text-align:center"><h2>' +
            body.title +
            '</h2><p style="color:#666">' +
            body.text +
            '</p></div></body>'
        );
      };

      if (err) {
        session.status = 'error';
        session.error = err === 'access_denied' ? '你在 Google 页面点了拒绝' : 'Google 返回错误：' + err;
        finish({ ok: false, title: '没有完成授权', text: '可以关掉这个页面，回 ikuyoMail 重试。' });
        clearTimeout(session.timer);
        server.close();
        return;
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<meta charset="utf-8">缺少授权码，请回到 ikuyoMail 重试。');
        return;
      }

      // 浏览器带回了 code，换 token
      tokenRequest({
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: session.redirectUri,
        grant_type: 'authorization_code',
      })
        .then((tok) => {
          if (tok.refresh_token) {
            saveAccountTokens(key, tok);
            session.status = 'done';
            session.tokens = tok;
            finish({ ok: true, title: '授权成功', text: '可以关掉这个页面，回到 ikuyoMail。' });
          } else {
            // 没拿到 refresh_token：让用户重来一次（prompt=consent 理论上必给）
            session.status = 'error';
            session.error = 'Google 没有下发长期授权，请重试一次登录';
            finish({ ok: false, title: '授权不完整', text: '回到 ikuyoMail 重新点一次登录按钮。' });
          }
          clearTimeout(session.timer);
          server.close();
        })
        .catch((e) => {
          session.status = 'error';
          session.error = '换取令牌失败：' + e.message;
          finish({ ok: false, title: '换取令牌失败', text: e.message });
          clearTimeout(session.timer);
          server.close();
        });
    });

    server.on('error', (e) => {
      logins.delete(loginId);
      reject(new Error('本地监听启动失败：' + e.message));
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const redirectUri = `http://127.0.0.1:${port}`;
      const authUrl =
        AUTH_ENDPOINT +
        '?' +
        new URLSearchParams({
          client_id: cfg.clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: SCOPE,
          access_type: 'offline',
          prompt: 'consent',
          state,
          login_hint: key,
        }).toString();

      const session = {
        status: 'pending',
        email: key,
        redirectUri,
        state,
        server,
        timer: setTimeout(() => {
          if (logins.get(loginId)?.status === 'pending') {
            logins.get(loginId).status = 'error';
            logins.get(loginId).error = '授权超时（5 分钟没等到 Google 回调）';
          }
          try { server.close(); } catch { /* ignore */ }
        }, 5 * 60 * 1000),
      };
      logins.set(loginId, session);
      resolve({ loginId, authUrl });
    });
  });
}

export function pollLogin(loginId) {
  const s = logins.get(loginId);
  if (!s) return { status: 'gone' };
  const out = { status: s.status, email: s.email };
  if (s.status === 'error') {
    out.error = s.error;
    logins.delete(loginId);
  } else if (s.status === 'done') {
    logins.delete(loginId);
  }
  return out;
}

/** 取一个可用的 access_token：快过期就用 refresh_token 换新的 */
export async function getAccessToken(email) {
  const key = String(email || '').toLowerCase().trim();
  const cfg = readConfig();
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new Error('还没有配置 Google 客户端凭据');
  }
  const t = storedTokens(key);
  if (!t || !t.refreshToken) {
    throw new Error('这个 Gmail 还没有完成 Google 授权，请重新登录');
  }
  if (t.accessToken && t.expiry - 120_000 > Date.now()) {
    return t.accessToken;
  }
  const tok = await tokenRequest({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: t.refreshToken,
    grant_type: 'refresh_token',
  });
  saveAccountTokens(key, { ...tok, refresh_token: t.refreshToken });
  return tok.access_token;
}
