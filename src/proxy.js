/**
 * 每个账号可选的出口代理。
 *
 * imapflow 与 nodemailer 都接受「URL 形式」的代理配置，形如：
 *   socks5://127.0.0.1:1080
 *   socks5://user:pass@127.0.0.1:1080
 *   http://user:pass@127.0.0.1:8080
 * 两者支持的协议一致：socks / socks5 / socks4 / socks4a / http / https。
 *
 * 代理密码和邮箱口令一样属于敏感信息，存储时单独加密（encProxyPass），
 * 对外只暴露 hasPassword 布尔值。
 */

const TYPES = new Set(['socks5', 'socks4', 'socks4a', 'socks', 'http', 'https']);

const DEFAULT_PORTS = {
  socks5: 1080,
  socks: 1080,
  socks4: 1080,
  socks4a: 1080,
  http: 8080,
  https: 8080,
};

export function normalizeProxy(input) {
  if (!input) return null;
  const type = TYPES.has(String(input.type || '').toLowerCase())
    ? String(input.type).toLowerCase()
    : 'socks5';
  const host = String(input.host || '').trim();
  const portNum = Number(input.port);
  const port = Number.isFinite(portNum) && portNum > 0 && portNum < 65536 ? portNum : DEFAULT_PORTS[type];
  const username = String(input.username || '').trim();

  // 没有主机就等于没配置
  if (!host) return null;

  return {
    enabled: input.enabled !== false,
    type,
    host,
    port,
    username,
    password: input.password === undefined ? undefined : String(input.password || ''),
  };
}

/** 对外暴露的代理配置（永远不含密码明文） */
export function publicProxy(proxy) {
  if (!proxy || !proxy.host) return null;
  return {
    enabled: proxy.enabled !== false,
    type: proxy.type || 'socks5',
    host: proxy.host,
    port: proxy.port || DEFAULT_PORTS[proxy.type || 'socks5'],
    username: proxy.username || '',
    hasPassword: !!proxy.passwordEnc,
  };
}

/** 生成库能直接消费的代理 URL；返回 null 表示不走代理 */
export function toProxyUrl(proxy) {
  if (!proxy || proxy.enabled === false || !proxy.host) return null;
  const type = proxy.type || 'socks5';
  const host = proxy.host.includes(':') && !proxy.host.startsWith('[') ? `[${proxy.host}]` : proxy.host;
  const port = proxy.port || DEFAULT_PORTS[type] || 1080;
  const auth = proxy.username
    ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password || '')}@`
    : '';
  return `${type}://${auth}${host}:${port}`;
}

/** 日志/界面里展示用，隐去密码 */
export function describeProxy(proxy) {
  if (!proxy || !proxy.host) return '未使用代理';
  const type = (proxy.type || 'socks5').toUpperCase();
  return `${type} ${proxy.host}:${proxy.port || DEFAULT_PORTS[proxy.type || 'socks5']}`;
}

/** URL 的 userinfo 里可以原样保留、不会被 percent-encode 的字符 */
const URL_USERINFO_SAFE = /^[A-Za-z0-9\-._~!$&'()*+,;=]*$/;

/**
 * SOCKS 代理的已知限制：
 * imapflow 把 URL 里的密码原样交给 socks 库，中间不做 decode。
 * 所以密码里一旦出现 @ : / % 空格 这类必须转义的字符，
 * 代理认证就会拿编码后的串去比对，必然失败。
 * HTTP 代理走的是 Basic 头，那边有正确的解码，不受影响。
 */
export function socksPasswordUnsafe(proxy) {
  if (!proxy || !proxy.host || !proxy.password) return false;
  if (!/^socks/i.test(proxy.type || 'socks5')) return false;
  return !URL_USERINFO_SAFE.test(proxy.password);
}

export const SOCKS_PASSWORD_HINT =
  'SOCKS 代理密码里有 @ : / % 或空格这类字符，部分 IMAP 库无法正确传递，可能认证失败。建议改用 HTTP 代理，或给代理设一个只含字母数字的密码。';
