/** 界面验收：新图标/品牌、搜索、页码跳转、开机自启开关 */
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
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});

await page.goto('http://127.0.0.1:7317', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.msg-item', { timeout: 60000 });
await wait(600);

console.log('标题:', await page.title());
const brand = await page.evaluate(() => {
  const img = document.querySelector('.brand-logo');
  const r = img.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), text: document.querySelector('.brand')?.innerText.trim() };
});
console.log('品牌图:', JSON.stringify(brand));
await page.screenshot({ path: 'shots/40-brand.png', clip: { x: 0, y: 0, width: 264, height: 140 } });

/* 搜索：中文发件人名字 */
await page.click('#searchInput');
await page.type('#searchInput', '网易', { delay: 40 });
await wait(3500);
const searched = await page.evaluate(() => ({
  count: document.querySelector('#listCount')?.innerText,
  items: [...document.querySelectorAll('.msg-item .m-from')].slice(0, 3).map((n) => n.innerText),
  total: document.querySelectorAll('.msg-item').length,
}));
console.log('搜索结果:', JSON.stringify(searched));
await page.screenshot({ path: 'shots/41-search.png' });
console.log('进度条:', await page.evaluate(() => ({ hidden: document.querySelector('#listProgress').hidden, text: document.querySelector('#listProgressText').innerText })));

/* 清空搜索，用邮箱地址再搜一次 */
await page.click('#searchInput', { clickCount: 3 });
await page.keyboard.press('Backspace');
await wait(1200);
await page.type('#searchInput', 'service.netease.com', { delay: 25 });
await page.keyboard.press('Enter');
await wait(2500);
console.log('邮箱搜索:', await page.evaluate(() => document.querySelector('#listCount')?.innerText));
await page.screenshot({ path: 'shots/41b-search-mail.png' });

/* 页码跳转 */
await page.click('#searchInput', { clickCount: 3 });
await page.keyboard.press('Backspace');
await wait(1500);
const before = await page.evaluate(() => document.querySelector('#pageInput').value);
await page.click('#pageInput', { clickCount: 3 });
await page.type('#pageInput', '7');
await page.keyboard.press('Enter');
await wait(2000);
const after = await page.evaluate(() => ({
  page: document.querySelector('#pageInput').value,
  total: document.querySelector('#pageTotal').innerText,
  firstUid: document.querySelector('.msg-item')?.dataset.uid,
  count: document.querySelector('#listCount')?.innerText,
}));
console.log('跳页:', before, '→', JSON.stringify(after));
await page.screenshot({ path: 'shots/42-page-jump.png' });

/* 越界页码应当被夹住并提示 */
await page.click('#pageInput', { clickCount: 3 });
await page.type('#pageInput', '999');
await page.keyboard.press('Enter');
await wait(600);
console.log('越界后页码:', await page.evaluate(() => document.querySelector('#pageInput').value));

/* 设置面板 */
await page.click('#settingsBtn');
await wait(900);
const settings = await page.evaluate(() => ({
  autoChecked: document.querySelector('#setAutoStart').checked,
  autoDisabled: document.querySelector('#setAutoStart').disabled,
  tip: document.querySelector('#autoStartTip').innerText,
}));
console.log('设置:', JSON.stringify(settings));
await page.screenshot({ path: 'shots/43-settings.png' });

console.log(errors.length ? '❌ JS 错误: ' + errors.slice(0, 3).join(' ; ') : '✅ 无 JS 错误');
await browser.close();
