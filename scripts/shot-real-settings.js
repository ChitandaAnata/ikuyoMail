/** 真实账号（7317）下的设置面板截图 */
import puppeteer from 'puppeteer-core';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  defaultViewport: { width: 1400, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:7317', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.msg-item', { timeout: 45000 });
await wait(800);
await page.screenshot({ path: 'shots/36-real-list.png' });

await page.click('#settingsBtn');
await wait(700);
const info = await page.evaluate(() => ({
  status: document.querySelector('#setStatus').innerText.replace(/\n/g, ' | '),
  image: [...document.querySelectorAll('#setImagePolicy button')].find((b) => b.classList.contains('active'))?.dataset.val,
  close: [...document.querySelectorAll('#setCloseAction button')].find((b) => b.classList.contains('active'))?.dataset.val,
}));
console.log('截图为', JSON.stringify(info));
await page.screenshot({ path: 'shots/37-real-settings.png' });

/* 真实账号里试一次测试提醒（此时窗口在前台，应只出应用内卡片） */
await page.click('#testNotifyBtn');
await wait(1200);
const card = await page.evaluate(() => {
  const c = document.querySelector('.notify-card');
  return c ? c.innerText.replace(/\n/g, ' | ') : null;
});
console.log('应用内卡片:', card);
await page.screenshot({ path: 'shots/38-real-notify.png' });

console.log(errors.length ? '❌ JS 错误: ' + errors.slice(0, 2).join(' ; ') : '✅ 无 JS 错误');
await browser.close();
