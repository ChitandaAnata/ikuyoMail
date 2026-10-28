/**
 * 托盘图标 + Windows 系统通知。
 *
 * 做法：起一个常驻的 PowerShell 进程（assets/tray.ps1）托管 NotifyIcon，
 * Node 通过「写命令文件」给它下指令，避免依赖原生模块编译。
 * 通知用气泡提示（ShowBalloonTip），位置就是 Windows 的右下角。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'assets', 'tray.ps1');
const ICON = path.join(ROOT, 'assets', 'ikuyoMail.ico');
const CMD_FILE = path.join(DATA_DIR, 'tray-cmd.txt');

let child = null;
let pending = [];
let flushTimer = null;
let startedAt = 0;

export const isSupported = () => process.platform === 'win32' && fs.existsSync(SCRIPT);

export function isTrayRunning() {
  return !!child && child.exitCode === null && !child.killed;
}

/** 把一行命令排队，稍后一次性写入命令文件（避免高频写盘互相覆盖） */
function enqueue(line) {
  if (!isTrayRunning()) return false;
  pending.push(line);
  if (flushTimer) return true;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const lines = pending;
    pending = [];
    if (!lines.length) return;
    try {
      const tmp = `${CMD_FILE}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, lines.join('\n'), 'utf8');
      fs.renameSync(tmp, CMD_FILE);
    } catch {
      /* 托盘没起来或文件被占用，丢了就丢了，不影响主流程 */
    }
  }, 120);
  if (flushTimer.unref) flushTimer.unref();
  return true;
}

/** 制表符和换行是命令分隔符，正文里必须清掉 */
const clean = (s = '') => String(s).replace(/[\t\r\n]+/g, ' ').trim();

export function notifyDesktop({ title = '新邮件', body = '', sound = true } = {}) {
  return enqueue(['notify', clean(title), clean(body), sound ? '1' : '0'].join('\t'));
}

export function setTip(text) {
  return enqueue(['title', clean(text)].join('\t'));
}

export function startTray({ baseUrl = 'http://127.0.0.1:7317', appUrl = '', tip = 'ikuyoMail' } = {}) {
  if (!isSupported() || isTrayRunning()) return isTrayRunning();
  try {
    if (fs.existsSync(CMD_FILE)) fs.unlinkSync(CMD_FILE);
  } catch {
    /* ignore */
  }
  const args = [
    '-NoLogo',
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-WindowStyle',
    'Hidden',
    '-File',
    SCRIPT,
    '-IconPath',
    ICON,
    '-CmdFile',
    CMD_FILE,
    '-BaseUrl',
    baseUrl,
    '-AppUrl',
    appUrl || baseUrl + '/',
    '-TipTitle',
    tip,
  ];
  child = spawn('powershell.exe', args, { windowsHide: true, stdio: 'ignore' });
  startedAt = Date.now();
  child.on('exit', () => {
    child = null;
  });
  child.on('error', () => {
    child = null;
  });
  return isTrayRunning();
}

export function stopTray({ hard = false } = {}) {
  if (!child) return;
  const c = child;
  if (hard) {
    try {
      c.kill();
    } catch {
      /* ignore */
    }
    child = null;
    return;
  }
  enqueue('quit');
  // 给脚本一点时间自己收拾，超过就直接杀
  const t = setTimeout(() => {
    try {
      if (c.exitCode === null) c.kill();
    } catch {
      /* ignore */
    }
  }, 1800);
  if (t.unref) t.unref();
}

export function trayUptime() {
  return isTrayRunning() ? Date.now() - startedAt : 0;
}
