/**
 * 主流邮箱服务商预设
 * - imap/smtp 为主机与端口配置
 * - authType: 'password' = 直接密码 | 'authcode' = 需要客户端授权码/应用专用密码
 * - help: 登录表单里展示的取码指引
 */
export const PROVIDERS = {
  qq: {
    id: 'qq',
    name: 'QQ 邮箱',
    domain: 'qq.com',
    imap: { host: 'imap.qq.com', port: 993, secure: true },
    smtp: { host: 'smtp.qq.com', port: 465, secure: true },
    authType: 'authcode',
    hint: 'QQ 邮箱不支持账号密码直登，需要「授权码」。',
    help:
      '打开 QQ 邮箱网页版 → 设置 → 账号 → 开启 IMAP/SMTP 服务 → 按提示发送短信，即可获得 16 位授权码。密码处填授权码，不是 QQ 密码。',
  },
  'qq-exmail': {
    id: 'qq-exmail',
    name: '腾讯企业邮',
    domain: 'exmail.qq.com',
    imap: { host: 'imap.exmail.qq.com', port: 993, secure: true },
    smtp: { host: 'smtp.exmail.qq.com', port: 465, secure: true },
    authType: 'authcode',
    hint: '企业邮需要在「微信绑定 / 客户端专用密码」里生成密码。',
    help: '腾讯企业邮管理后台 → 设置 → 客户端专用密码 → 新建，用生成的密码登录。',
  },
  '163': {
    id: '163',
    name: '网易 163 邮箱',
    domain: '163.com',
    imap: { host: 'imap.163.com', port: 993, secure: true },
    smtp: { host: 'smtp.163.com', port: 465, secure: true },
    authType: 'authcode',
    hint: '网易邮箱需要使用「客户端授权密码」。',
    help:
      '登录 163 邮箱网页版 → 设置 → POP3/SMTP/IMAP → 开启 IMAP/SMTP → 设置客户端授权密码。密码处填授权码。',
  },
  '126': {
    id: '126',
    name: '网易 126 邮箱',
    domain: '126.com',
    imap: { host: 'imap.126.com', port: 993, secure: true },
    smtp: { host: 'smtp.126.com', port: 465, secure: true },
    authType: 'authcode',
    hint: '网易邮箱需要使用「客户端授权密码」。',
    help: '登录 126 邮箱网页版 → 设置 → POP3/SMTP/IMAP → 开启 IMAP/SMTP → 设置客户端授权密码。',
  },
  yeah: {
    id: 'yeah',
    name: '网易 yeah.net',
    domain: 'yeah.net',
    imap: { host: 'imap.yeah.net', port: 993, secure: true },
    smtp: { host: 'smtp.yeah.net', port: 465, secure: true },
    authType: 'authcode',
    hint: '网易邮箱需要使用「客户端授权密码」。',
    help: '登录 yeah.net 网页版 → 设置 → POP3/SMTP/IMAP → 开启 IMAP/SMTP → 设置客户端授权密码。',
  },
  gmail: {
    id: 'gmail',
    name: 'Gmail',
    domain: 'gmail.com',
    imap: { host: 'imap.gmail.com', port: 993, secure: true },
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
    authType: 'authcode',
    hint: 'Gmail 需要两步验证后生成的「应用专用密码」。',
    help:
      'Google 账号 → 安全性 → 开启两步验证 → 应用专用密码 → 生成一个（选「邮件 / Windows 计算机」）。密码处填这 16 位密码。需能直连 Google（网络通畅）。',
  },
  outlook: {
    id: 'outlook',
    name: 'Outlook / Hotmail',
    domain: 'outlook.com',
    imap: { host: 'outlook.office365.com', port: 993, secure: true },
    smtp: { host: 'smtp-mail.outlook.com', port: 587, secure: false },
    authType: 'authcode',
    hint: '微软已逐步停用基础认证，建议使用应用密码；若失败请改用 OAuth 或改用其他邮箱测试。',
    help:
      '账号 → 安全 → 高级安全选项 → 开启双重验证 → 创建「应用密码」。IMAP 主机 outlook.office365.com:993，SMTP smtp-mail.outlook.com:587（STARTTLS）。注意：微软对个人账户的基础认证（含应用密码）限制较多，若被拒属服务商策略。',
  },
  icloud: {
    id: 'icloud',
    name: 'iCloud 邮箱',
    domain: 'icloud.com',
    imap: { host: 'imap.mail.me.com', port: 993, secure: true },
    smtp: { host: 'smtp.mail.me.com', port: 587, secure: false },
    authType: 'authcode',
    hint: 'iCloud 需要 Apple ID 的「App 专用密码」。',
    help: 'appleid.apple.com → 登录与安全 → App 专用密码 → 生成。用户名填 iCloud 邮箱全称。',
  },
  yahoo: {
    id: 'yahoo',
    name: 'Yahoo 邮箱',
    domain: 'yahoo.com',
    imap: { host: 'imap.mail.yahoo.com', port: 993, secure: true },
    smtp: { host: 'smtp.mail.yahoo.com', port: 465, secure: true },
    authType: 'authcode',
    hint: 'Yahoo 需要「应用密码」。',
    help: 'Yahoo 账号安全设置 → 生成应用密码，用它登录。',
  },
  sina: {
    id: 'sina',
    name: '新浪邮箱',
    domain: 'sina.com',
    imap: { host: 'imap.sina.com', port: 993, secure: true },
    smtp: { host: 'smtp.sina.com', port: 465, secure: true },
    authType: 'authcode',
    hint: '新浪邮箱需要在设置中开启 IMAP/SMTP 服务。',
    help: '登录新浪邮箱网页版 → 设置 → 客户端pop/imap/smtp → 开启服务。',
  },
  aliyun: {
    id: 'aliyun',
    name: '阿里云邮箱',
    domain: 'aliyun.com',
    imap: { host: 'imap.aliyun.com', port: 993, secure: true },
    smtp: { host: 'smtp.aliyun.com', port: 465, secure: true },
    authType: 'password',
    hint: '使用邮箱登录密码。',
    help: '阿里云个人邮箱可直接用登录密码；如开启安全锁需使用客户端专用密码。',
  },
  custom: {
    id: 'custom',
    name: '自定义 / 其他',
    domain: '',
    imap: { host: '', port: 993, secure: true },
    smtp: { host: '', port: 465, secure: true },
    authType: 'password',
    hint: '手动填写服务商提供的 IMAP / SMTP 地址。',
    help: '常见端口：IMAP 993(SSL) / 143(STARTTLS)；SMTP 465(SSL) / 587(STARTTLS)。',
  },
};

/**
 * 添加账号时的服务商下拉选项。
 *
 * 一个服务商可能有多个可用域名（QQ 有 qq.com / foxmail.com，Outlook 有一堆），
 * 这里把它们拆成独立选项 —— 选中哪一项，邮箱地址的 @ 后面就直接锁定成对应域名，
 * 用户只需要输 @ 前面的部分。
 *
 * domain 为空表示「域名由用户自己填」：企业邮和自定义服务商都是这种。
 */
export const PROVIDER_OPTIONS = [
  { key: 'qq', provider: 'qq', label: 'QQ 邮箱', domain: 'qq.com' },
  { key: 'qq-foxmail', provider: 'qq', label: 'QQ 邮箱（Foxmail）', domain: 'foxmail.com' },
  { key: '163', provider: '163', label: '网易 163 邮箱', domain: '163.com' },
  { key: '126', provider: '126', label: '网易 126 邮箱', domain: '126.com' },
  { key: 'yeah', provider: 'yeah', label: '网易 yeah.net', domain: 'yeah.net' },
  { key: 'gmail', provider: 'gmail', label: 'Gmail', domain: 'gmail.com' },
  { key: 'outlook', provider: 'outlook', label: 'Outlook', domain: 'outlook.com' },
  { key: 'hotmail', provider: 'outlook', label: 'Hotmail', domain: 'hotmail.com' },
  { key: 'live', provider: 'outlook', label: 'Live', domain: 'live.com' },
  { key: 'msn', provider: 'outlook', label: 'MSN', domain: 'msn.com' },
  { key: 'icloud', provider: 'icloud', label: 'iCloud', domain: 'icloud.com' },
  { key: 'icloud-me', provider: 'icloud', label: 'iCloud（me.com）', domain: 'me.com' },
  { key: 'icloud-mac', provider: 'icloud', label: 'iCloud（mac.com）', domain: 'mac.com' },
  { key: 'yahoo', provider: 'yahoo', label: 'Yahoo 邮箱', domain: 'yahoo.com' },
  { key: 'sina', provider: 'sina', label: '新浪邮箱', domain: 'sina.com' },
  { key: 'sina-cn', provider: 'sina', label: '新浪邮箱（sina.cn）', domain: 'sina.cn' },
  { key: 'aliyun', provider: 'aliyun', label: '阿里云邮箱', domain: 'aliyun.com' },
  { key: 'qq-exmail', provider: 'qq-exmail', label: '腾讯企业邮（自有域名）', domain: '' },
  { key: 'aliyun-enterprise', provider: 'aliyun', label: '阿里云企业邮（自有域名）', domain: '' },
  { key: 'custom', provider: 'custom', label: '自定义 / 其他', domain: '' },
];

/** 根据域名找下拉里最匹配的一项 */
export function optionForDomain(domain = '') {
  const d = String(domain).toLowerCase();
  if (!d) return null;
  return PROVIDER_OPTIONS.find((o) => o.domain && o.domain === d) || null;
}

/** 根据邮箱地址猜测服务商 */
export function guessProvider(email = '') {
  const domain = String(email).split('@')[1]?.toLowerCase() || '';
  if (!domain) return 'custom';
  const opt = optionForDomain(domain);
  if (opt) return opt.provider;
  if (domain === 'googlemail.com') return 'gmail';
  if (domain.endsWith('outlook.office365.com') || domain.endsWith('onmicrosoft.com')) return 'outlook';
  if (domain === 'yahoo.co.jp') return 'yahoo';
  if (domain.includes('exmail')) return 'qq-exmail';
  return 'custom';
}

export function resolveConfig({ provider = 'custom', email, imap, smtp }) {
  const base = PROVIDERS[provider] || PROVIDERS.custom;
  const cfg = {
    imap: { ...base.imap, ...(imap || {}) },
    smtp: { ...base.smtp, ...(smtp || {}) },
  };
  // 自定义服务商允许只填主机，端口用默认值
  if (!cfg.imap.host) throw new Error('缺少 IMAP 服务器地址');
  if (!cfg.smtp.host) throw new Error('缺少 SMTP 服务器地址');
  return cfg;
}
