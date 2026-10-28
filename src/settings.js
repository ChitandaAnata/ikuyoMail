/**
 * 全局设置：存在 data/settings.json，明文（不含任何凭据）。
 * 读不到或字段非法时一律回落到默认值，避免手改坏文件导致程序起不来。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './store.js';

const FILE = path.join(DATA_DIR, 'settings.json');

export const DEFAULT_SETTINGS = {
  /** 邮件正文里的外部图片：block = 默认拦截（防追踪像素），allow = 默认显示 */
  imagePolicy: 'block',
  /** 关掉窗口时：tray = 留在托盘继续收信，quit = 直接退出程序 */
  closeAction: 'tray',
  /** 是否常驻托盘图标（trayEnabled=false 时不启动托盘，closeAction 按 quit 处理） */
  trayEnabled: true,
  /** 收到新邮件是否提醒 */
  notifyEnabled: true,
  /** 提醒时是否播放提示音 */
  notifySound: true,
  /** 窗口不在前台时是否额外弹 Windows 系统通知 */
  notifyDesktop: true,
  /** 新邮件检查间隔（秒） */
  pollInterval: 120,
  /** 开机自启（Windows 启动文件夹里的一个 vbs，真正状态以文件是否存在为准） */
  autoStart: false,
};

const BOOLS = ['trayEnabled', 'notifyEnabled', 'notifySound', 'notifyDesktop', 'autoStart'];
const ENUMS = {
  imagePolicy: ['block', 'allow'],
  closeAction: ['tray', 'quit'],
};

/** 把任意输入洗成合法设置，非法字段直接丢弃 */
export function normalizeSettings(input, base = DEFAULT_SETTINGS) {
  const out = { ...base };
  if (!input || typeof input !== 'object') return out;

  for (const [key, allowed] of Object.entries(ENUMS)) {
    if (input[key] !== undefined && allowed.includes(input[key])) out[key] = input[key];
  }
  for (const key of BOOLS) {
    if (input[key] !== undefined) out[key] = !!input[key];
  }
  if (input.pollInterval !== undefined) {
    const n = Number(input.pollInterval);
    // 再短就是给服务商添堵了，最长 30 分钟
    if (Number.isFinite(n)) out.pollInterval = Math.min(Math.max(Math.round(n), 30), 1800);
  }
  // 托盘关掉时，「最小化到状态栏」没有落脚点，按退出处理
  if (!out.trayEnabled) out.closeAction = 'quit';
  return out;
}

export function getSettings() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(patch) {
  const next = normalizeSettings(patch, getSettings());
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
  return next;
}
