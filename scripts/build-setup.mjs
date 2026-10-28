/**
 * 打包安装程序：
 *   1. 把桌面端发成自包含单文件 ikuyoMail.exe
 *   2. 收拢运行时（node.exe + 生产依赖 + 前后端代码）成 payload 目录
 *   3. 压成 installer/payload.zip，作为安装程序的嵌入资源
 *   4. 发安装程序，产物是根目录的 ikuyoMail-Setup-<版本>.exe
 *
 * 用法：node scripts/build-setup.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = path.join(ROOT, 'build');
const APP_OUT = path.join(BUILD, 'app');
const PAYLOAD = path.join(BUILD, 'payload');
const SETUP_OUT = path.join(BUILD, 'setup');
const ZIP = path.join(ROOT, 'installer', 'payload.zip');
const VERSION = '1.0.0';

const log = (...a) => console.log('•', ...a);
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts });

function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function copy(src, dest) {
  fs.cpSync(src, dest, { recursive: true, dereference: true });
}

function sizeOf(dir) {
  let total = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else total += fs.statSync(p).size;
    }
  };
  walk(dir);
  return total;
}

const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';

// 只调界面时加 SKIP_PAYLOAD=1，省掉重新发程序 + 压包的几分钟
const skipPayload = process.env.SKIP_PAYLOAD === '1';

// ---------------------------------------------------------------- 1. 桌面端
if (skipPayload)
{
  log('SKIP_PAYLOAD=1：沿用已有的 payload.zip');
}
else
{
log('发布 ikuyoMail.exe（自包含单文件）…');
rm(APP_OUT);
fs.mkdirSync(APP_OUT, { recursive: true });
sh('dotnet', [
  'publish',
  'desktop/ikuyoMail.csproj',
  '-c', 'Release',
  '-r', 'win-x64',
  '--self-contained', 'true',
  '-p:PublishSingleFile=true',
  '-p:EnableCompressionInSingleFile=true',
  '-p:DebugType=none',
  '-o', APP_OUT,
  '-v', 'q',
  '--nologo',
]);

// ---------------------------------------------------------------- 2. payload
log('整理运行时目录…');
rm(PAYLOAD);
fs.mkdirSync(path.join(PAYLOAD, 'runtime'), { recursive: true });

for (const name of ['ikuyoMail.exe', 'WebView2Loader.dll']) {
  const src = path.join(APP_OUT, name);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(PAYLOAD, name));
}
for (const name of ['src', 'public', 'assets', 'package.json']) {
  copy(path.join(ROOT, name), path.join(PAYLOAD, name));
}
// 安装版不需要放进托盘脚本之外的东西，data 目录留给用户
const dropInPayload = ['assets/shell.ps1'];
for (const rel of dropInPayload) {
  fs.rmSync(path.join(PAYLOAD, rel), { force: true });
}

// 内置 node 运行时（当前进程用的就是它，保证版本一致）
const nodeExe = process.env.NODE_EXE || process.execPath;
fs.copyFileSync(nodeExe, path.join(PAYLOAD, 'runtime', 'node.exe'));
log(`内置 node：${nodeExe}（${mb(fs.statSync(nodeExe).size)}）`);

// ---------------------------------------------------------------- 3. 生产依赖
log('收集生产依赖…');
let listed = '';
try {
  listed = execFileSync('npm', ['ls', '--omit=dev', '--parseable', '--all'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
  });
} catch (err) {
  listed = String(err.stdout || '');
}
const seen = new Set();
let copied = 0;
for (const raw of listed.split(/\r?\n/)) {
  if (!raw.trim()) continue;
  const norm = raw.trim().replace(/\\/g, '/');
  const at = norm.toLowerCase().indexOf('/node_modules/');
  if (at < 0) continue;
  const rel = norm.slice(at + 1);
  if (seen.has(rel)) continue;
  seen.add(rel);
  const from = path.join(ROOT, rel);
  const to = path.join(PAYLOAD, rel);
  if (!fs.existsSync(from)) continue;
  fs.mkdirSync(path.dirname(to), { recursive: true });
  copy(from, to);
  copied++;
}
log(`依赖包 ${copied} 个`);

// 保险：直接依赖一个都不能少
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
for (const dep of Object.keys(pkg.dependencies || {})) {
  const p = path.join(PAYLOAD, 'node_modules', dep);
  if (!fs.existsSync(p)) throw new Error(`生产依赖缺失：${dep}`);
}

// ---------------------------------------------------------------- 4. 压缩
log('压缩 payload.zip…');
fs.rmSync(ZIP, { force: true });
const ps = [
  'Add-Type -AssemblyName System.IO.Compression.FileSystem',
  `[System.IO.Compression.ZipFile]::CreateFromDirectory('${PAYLOAD.replace(/'/g, "''")}',` +
    ` '${ZIP.replace(/'/g, "''")}', [System.IO.Compression.CompressionLevel]::Optimal, $false)`,
].join('; ');
execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'inherit' });
log(`payload.zip：${mb(fs.statSync(ZIP).size)}（解开 ${mb(sizeOf(PAYLOAD))}）`);
}

// ---------------------------------------------------------------- 5. 安装程序
log('发布安装程序…');
rm(SETUP_OUT);
fs.mkdirSync(SETUP_OUT, { recursive: true });
sh('dotnet', ['publish', 'installer/ikuyoMailSetup.csproj', '-c', 'Release', '-o', SETUP_OUT, '-v', 'q', '--nologo']);

const built = path.join(SETUP_OUT, 'ikuyoMail-Setup.exe');
if (!fs.existsSync(built)) throw new Error('没找到 ikuyoMail-Setup.exe');
const final = path.join(ROOT, `ikuyoMail-Setup-${VERSION}.exe`);
fs.copyFileSync(built, final);
log(`完成：${path.basename(final)}（${mb(fs.statSync(final).size)}）`);
