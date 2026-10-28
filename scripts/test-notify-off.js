/** 「提醒已关闭时，测试提醒仍应显示」的验证 */
import puppeteer from 'puppeteer-core';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:7318';

const patch = (body) =>
  fetch(BASE + '/api/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

await patch({ notifyEnabled: false });
console.log('已关闭提醒开关');

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  defaultViewport: { width: 1360, height: 880 },
});
const page = await browser.newPage();
await page.goto(BASE, { waitUntil: 'networkidle2' });
await page.waitForSelector('.msg-item');
await wait(600);
await page.click('#settingsBtn');
await wait(500);
const subOff = await page.evaluate(() => document.querySelector('#notifySub').classList.contains('off'));
await page.click('#testNotifyBtn');
await wait(1200);
const card = await page.evaluate(() => document.querySelector('.notify-card')?.innerText.replace(/\n/g, ' | ') || null);
console.log('子项是否置灰:', subOff, '| 测试卡片:', card);
await page.screenshot({ path: 'shots/39-notify-off.png' });

await patch({ notifyEnabled: true });
console.log('已恢复提醒开关');
await browser.close();
