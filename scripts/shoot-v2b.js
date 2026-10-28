/** 补充验收：品牌尺寸 + 「已发送」冷索引下的检索进度条 */
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
await page.waitForSelector('.msg-item', { timeout: 60000 });
await wait(700);
await page.screenshot({ path: 'shots/44-brand-big.png', clip: { x: 0, y: 0, width: 264, height: 160 } });

/* 切到「已发送」——这个文件夹的索引是冷的，能看到检索进度 */
const clicked = await page.evaluate(() => {
  const item = [...document.querySelectorAll('.folder')].find((n) => n.innerText.includes('已发送'));
  if (!item) return false;
  item.click();
  return true;
});
console.log('切到已发送:', clicked);
await wait(2500);
await page.click('#searchInput');
await page.type('#searchInput', 'a', { delay: 30 });
await wait(1500);
console.log(
  '检索中:',
  await page.evaluate(() => ({
    pill: document.querySelector('#listCount').innerText,
    progress: document.querySelector('#listProgress').hidden ? null : document.querySelector('#listProgressText').innerText,
    items: document.querySelectorAll('.msg-item').length,
  }))
);
await page.screenshot({ path: 'shots/45-searching.png' });
await wait(4000);
console.log(
  '稍后:',
  await page.evaluate(() => ({
    pill: document.querySelector('#listCount').innerText,
    progress: document.querySelector('#listProgress').hidden ? null : document.querySelector('#listProgressText').innerText,
  }))
);
console.log(errors.length ? '❌ ' + errors.slice(0, 2).join(' ; ') : '✅ 无 JS 错误');
await browser.close();
