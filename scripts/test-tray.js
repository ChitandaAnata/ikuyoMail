/** 托盘脚本单独测试：启动 → 收命令 → 退出（scripts/test-tray.js） */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = process.cwd();
const CMD = path.join(ROOT, 'data', '_tray-test-cmd.txt');
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
if (fs.existsSync(CMD)) fs.unlinkSync(CMD);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const ps = spawn(
  'powershell.exe',
  [
    '-NoLogo',
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(ROOT, 'assets', 'tray.ps1'),
    '-IconPath',
    path.join(ROOT, 'assets', 'ikuyoMail.ico'),
    '-CmdFile',
    CMD,
    '-BaseUrl',
    'http://127.0.0.1:7317',
    '-AppUrl',
    'http://127.0.0.1:7317/',
    '-TipTitle',
    '信箱',
  ],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
);

let out = '';
let err = '';
ps.stdout.on('data', (d) => (out += d));
ps.stderr.on('data', (d) => (err += d));
ps.on('exit', (code) => console.log('进程退出，退出码:', code));

await wait(2600);
console.log('2.6 秒后仍在运行:', ps.exitCode === null);

fs.writeFileSync(CMD, ['notify', '测试标题', '测试正文：确认命令能到达托盘脚本', '1'].join('\t'), 'utf8');
await wait(900);
console.log('notify 命令已被消费:', !fs.existsSync(CMD));

fs.writeFileSync(CMD, ['title', '信箱 · 3 封未读'].join('\t'), 'utf8');
await wait(700);
console.log('title 命令已被消费:', !fs.existsSync(CMD));

fs.writeFileSync(CMD, 'quit', 'utf8');
await wait(2200);
console.log('quit 后进程结束:', ps.exitCode !== null, '| 退出码:', ps.exitCode);

if (err.trim()) console.log('stderr:\n' + err.trim().slice(0, 1500));
if (out.trim()) console.log('stdout:\n' + out.trim().slice(0, 600));
if (ps.exitCode === null) ps.kill();
