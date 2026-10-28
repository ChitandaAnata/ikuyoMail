/**
 * 开机自启（仅 Windows）。
 *
 * 做法：往「启动」文件夹里放一个几行的 VBScript，登录时由系统执行，
 * 它会用隐藏窗口启动 node src/server.js（不弹黑框），服务起来后照常
 * 拉起托盘图标并开始轮询新邮件。关掉开关就删掉这个文件，
 * 不写注册表、不需要管理员权限，卸载时也不留垃圾。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'src', 'server.js');
const ENTRY_NAME = 'ikuyoMail.vbs';

function startupDir() {
  const appData =
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

export function entryPath() {
  return path.join(startupDir(), ENTRY_NAME);
}

export const isSupported = () => process.platform === 'win32';

export function isEnabled() {
  if (!isSupported()) return false;
  try {
    return fs.existsSync(entryPath());
  } catch {
    return false;
  }
}

/** VBScript 字符串字面量：内部的双引号要写成两个 */
const vbq = (s) => String(s).replace(/"/g, '""');

/**
 * 开机时用哪个 node 起服务：优先系统安装的 node（长期稳定），
 * 没有的话才用当前进程自己（比如便携版运行时）。
 */
function resolveNode() {
  const sys = process.env.ProgramFiles
    ? path.join(process.env.ProgramFiles, 'nodejs', 'node.exe')
    : 'C:\\Program Files\\nodejs\\node.exe';
  try {
    if (fs.existsSync(sys)) return sys;
  } catch {
    /* ignore */
  }
  return process.execPath;
}

function scriptBody() {
  const node = resolveNode();
  return [
    "' ikuyoMail 开机自启（由设置面板生成，关闭开机自启会自动删除本文件）",
    'Set sh = CreateObject("WScript.Shell")',
    `sh.CurrentDirectory = "${vbq(ROOT)}"`,
    // 0 = 隐藏窗口，False = 不等待
    `sh.Run """${vbq(node)}"" ""${vbq(SERVER)}""", 0, False`,
    '',
  ].join('\r\n');
}

/**
 * 打开 / 关闭开机自启。
 * 返回 { ok, enabled, error }，失败时把原因带回去让界面提示。
 */
export function setEnabled(on) {
  if (!isSupported()) {
    return { ok: false, enabled: false, error: '当前系统不支持（仅 Windows 可用）' };
  }
  const file = entryPath();
  try {
    if (on) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      // UTF-16LE + BOM：VBScript 宿主能正确识别中文路径
      const content = '\ufeff' + scriptBody();
      fs.writeFileSync(file, Buffer.from(content, 'utf16le'), { mode: 0o644 });
    } else if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
    return { ok: true, enabled: fs.existsSync(file), error: null };
  } catch (e) {
    return { ok: false, enabled: isEnabled(), error: `写入启动项失败：${e.message}` };
  }
}
