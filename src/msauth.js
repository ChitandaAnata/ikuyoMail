/**
 * Microsoft 账号登录（OAuth2 + XOAUTH2），用于 Outlook / Hotmail / Live / MSN。
 *
 * 微软自 2024 年 9 月起对个人账户停用基础认证（应用密码也基本失效），
 * 第三方客户端只能用 OAuth2：跳系统浏览器到 Microsoft 登录页，授权后
 * 重定向回 http://localhost:<临时端口>，由本地监听接住并换取令牌。
 *
 * 和 Gmail 的差别：这里用「公共客户端 + PKCE」，不需要 Client Secret，
 * 用户只要在 Azure 应用注册里拿一个 Application (client) ID 就行。
 * 凭据存 data/microsoft-oauth.json，令牌同样加密保存。
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
const CONFIG_FILE = path.join(ROOT, 'data', 'microsoft-oauth.json');

// common = 个人账户 + 组织账户都能用（应用注册时选「任何组织目录中的账户和个人账户」）
const AUTH_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const TOKEN_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
// IMAP / SMTP 收发信的最小权限集
const SCOPE = [
  'offline_access',
  'openid',
  'profile',
  'email',
  'https://outlook.office.com/IMAP.AccessAsUser.All',
  'https://outlook.office.com/SMTP.Send',
].join(' ');

/** 登录会话：id -> { status, email, resolve, timer } */
const logins = new Map();

function readConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return {
      clientId: raw.clientId || '',
      accounts: raw.accounts || {},
    };
  } catch {
    return { clientId: '', accounts: {} };
  }
}

function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(
    CONFIG_FILE,
    JSON.stringify({ clientId: cfg.clientId || '', accounts: cfg.accounts || {} }, null, 2)
  );
}

export function isConfigured() {
  return !!readConfig().clientId;
}

export function setConfig(clientId) {
  const c = readConfig();
  writeConfig({ ...c, clientId: String(clientId || '').trim() });
  return isConfigured();
}

function saveAccountTokens(email, { refresh_token, access_token, expires_in }) {
  const c = readConfig();
  c.accounts = c.accounts || {};
  const prev = c.accounts[email] || {};
  const prevRefresh = prev.refreshEnc ? decrypt(prev.refreshEnc) : '';
  c.accounts[email] = {
    refreshEnc: encrypt(refresh_token || prevRefresh),
    accessEnc: encrypt(access_token || ''),
    expiry: Date.now() + (Number(expires_in) || 3600) * 1000,
    updatedAt: new Date().toISOString(),
  };
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

/* ---- 出网策略：与 goauth 同一套（直连 → 环境变量 → Windows 系统代理） ---- */
let egress = { mode: 'auto' }; // auto | direct | proxy
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
  const envProxy =
    process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
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

/** 把 AADSTS 系列错误翻成人话 */
function humanizeMicrosoftError(code, desc) {
  const raw = `${code || ''} ${desc || ''}`;
  if (/AADSTS700016|unauthorized_client/i.test(raw)) {
    return 'Microsoft 说找不到这个应用：Client ID 填错了，或者应用注册没选「个人 Microsoft 账户」。';
  }
  if (/AADSTS50011|redirect_uri/i.test(raw)) {
    return '重定向地址不匹配：请在 Azure 应用的「身份验证」里添加平台「移动和桌面应用程序」，并添加 http://localhost。';
  }
  if (/AADSTS65001|consent/i.test(raw)) {
    return '这个账号还没有同意授权：重新点一次登录，在浏览器里勾选同意。';
  }
  if (/invalid_grant/i.test(raw)) {
    return '授权已失效（可能被撤销或密码变更），请重新登录一次。';
  }
  if (/invalid_client/i.test(raw)) {
    return 'Client ID 无效，请回 Azure 复制「应用程序(客户端) ID」。';
  }
  return desc || code || 'Microsoft 返回了未知错误';
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
    let res;
    try {
      res = await undiciFetch(TOKEN_ENDPOINT, { ...init, dispatcher });
    } catch (e) {
      // 网络层失败，换下一条通道
      lastErr = e;
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // 微软明确拒绝了，换通道也没用
      throw new Error(humanizeMicrosoftError(data.error, data.error_description));
    }
    egress = dispatcher instanceof ProxyAgent ? { mode: 'proxy' } : { mode: 'direct' };
    return data;
  }
  throw new Error('连不上 Microsoft（直连和系统代理都试过了）：' + (lastErr?.cause?.message || lastErr?.message));
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * 发起一次登录：起本地监听，返回授权链接。
 * 注意 redirect_uri 用 localhost（Azure 对 loopback 的规则是「注册 http://localhost
 * 后任意端口都放行」，写 127.0.0.1 反而不匹配）。
 */
export function startLogin(email) {
  const cfg = readConfig();
  if (!cfg.clientId) throw new Error('还没有配置 Microsoft 应用 ID');

  const key = String(email || '').toLowerCase().trim();
  const loginId = crypto.randomUUID();
  const state = crypto.randomBytes(12).toString('hex');
  const codeVerifier = b64url(crypto.randomBytes(32));
  const codeChallenge = b64url(crypto.createHash('sha256').update(codeVerifier).digest());

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
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
      const errDesc = url.searchParams.get('error_description');
      const code = url.searchParams.get('code');
      const finish = (title, text) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<meta charset="utf-8"><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
            '<div style="text-align:center"><h2>' +
            title +
            '</h2><p style="color:#666">' +
            text +
            '</p></div></body>'
        );
      };

      if (err) {
        session.status = 'error';
        session.error =
          err === 'access_denied'
            ? '你在 Microsoft 页面点了拒绝'
            : 'Microsoft 返回错误：' + (errDesc || err);
        finish('没有完成授权', '可以关掉这个页面，回 ikuyoMail 重试。');
        clearTimeout(session.timer);
        server.close();
        return;
      }
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<meta charset="utf-8">缺少授权码，请回到 ikuyoMail 重试。');
        return;
      }

      tokenRequest({
        code,
        client_id: cfg.clientId,
        redirect_uri: session.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
        scope: SCOPE,
      })
        .then((tok) => {
          if (tok.refresh_token) {
            saveAccountTokens(key, tok);
            session.status = 'done';
            session.tokens = tok;
            finish('授权成功', '可以关掉这个页面，回到 ikuyoMail。');
          } else {
            session.status = 'error';
            session.error = 'Microsoft 没有下发长期授权（refresh_token），请重试一次登录';
            finish('授权不完整', '回到 ikuyoMail 重新点一次登录按钮。');
          }
          clearTimeout(session.timer);
          server.close();
        })
        .catch((e) => {
          session.status = 'error';
          session.error = '换取令牌失败：' + e.message;
          finish('换取令牌失败', e.message);
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
      const redirectUri = `http://localhost:${port}`;
      const authUrl =
        AUTH_ENDPOINT +
        '?' +
        new URLSearchParams({
          client_id: cfg.clientId,
          response_type: 'code',
          response_mode: 'query',
          redirect_uri: redirectUri,
          scope: SCOPE,
          state,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          login_hint: key,
          prompt: 'consent',
        }).toString();

      const session = {
        status: 'pending',
        email: key,
        redirectUri,
        state,
        server,
        timer: setTimeout(() => {
          const s = logins.get(loginId);
          if (s?.status === 'pending') {
            s.status = 'error';
            s.error = '授权超时（5 分钟没等到 Microsoft 回调）';
          }
          try {
            server.close();
          } catch {
            /* ignore */
          }
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
  if (!cfg.clientId) throw new Error('还没有配置 Microsoft 应用 ID');
  const t = storedTokens(key);
  if (!t || !t.refreshToken) {
    throw new Error('这个 Outlook 邮箱还没有完成 Microsoft 授权，请重新登录');
  }
  if (t.accessToken && t.expiry - 120_000 > Date.now()) {
    return t.accessToken;
  }
  const tok = await tokenRequest({
    client_id: cfg.clientId,
    refresh_token: t.refreshToken,
    grant_type: 'refresh_token',
    scope: SCOPE,
  });
  saveAccountTokens(key, { ...tok, refresh_token: t.refreshToken });
  return tok.access_token;
}
