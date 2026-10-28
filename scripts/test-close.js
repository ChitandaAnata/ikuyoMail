/**
 * 关闭行为测试：closeAction=quit 时，页面断开后服务应自行退出。
 * 结束后把设置恢复成 tray，并重启提示。
 */
import puppeteer from 'puppeteer-core';

const BASE = 'http://127.0.0.1:7317';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const patch = (body) =>
  fetch(BASE + '/api/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

const alive = async () => {
  try {
    const r = await fetch(BASE + '/api/settings', { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
};

const before = await patch({ closeAction: 'quit' });
console.log('已设为退出模式:', before.settings.closeAction);

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  defaultViewport: { width: 1280, height: 860 },
});
const page = await browser.newPage();
await page.goto(BASE, { waitUntil: 'networkidle2' });
await wait(1500);
console.log('已连接，页面在运行');
await page.screenshot({ path: 'shots/35-quit-mode.png' });

await browser.close();
console.log('窗口已关闭，等待 17 秒观察服务是否退出…');
await wait(17000);
const still = await alive();
console.log(still ? '❌ 服务仍在运行（应退出）' : '✅ 服务已自动退出');

if (still) {
  const back = await patch({ closeAction: 'tray' });
  console.log('已恢复为 tray:', back.settings.closeAction);
}
