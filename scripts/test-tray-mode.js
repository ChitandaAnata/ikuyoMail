/** 托盘模式：关掉窗口后服务应当继续运行，托盘图标仍在 */
import puppeteer from 'puppeteer-core';

const BASE = 'http://127.0.0.1:7317';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const status = () =>
  fetch(BASE + '/api/settings', { signal: AbortSignal.timeout(3000) })
    .then((r) => r.json())
    .catch(() => null);

const s0 = await status();
console.log('关闭行为:', s0.settings.closeAction, '| 托盘:', s0.status.tray);

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  defaultViewport: { width: 1280, height: 860 },
});
const page = await browser.newPage();
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.msg-item', { timeout: 45000 });
await wait(1200);
await browser.close();
console.log('窗口已关闭，等待 18 秒…');
await wait(18000);

const s1 = await status();
if (!s1) {
  console.log('❌ 服务已退出（托盘模式下不应该）');
} else {
  console.log('✅ 服务仍在运行 | 托盘:', s1.status.tray, '| 前台客户端:', s1.status.visibleClients);
}
