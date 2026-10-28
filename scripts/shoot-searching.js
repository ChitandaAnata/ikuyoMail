/** 冷索引下截一张「正在检索更早的邮件」的图 */
import puppeteer from 'puppeteer-core';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  defaultViewport: { width: 1400, height: 900 },
});
const p = await b.newPage();
await p.goto('http://127.0.0.1:7317', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.msg-item', { timeout: 60000 });
await p.click('#searchInput');
await p.type('#searchInput', '网易', { delay: 20 });
await p.keyboard.press('Enter');
await wait(2500);
console.log(
  await p.evaluate(() => ({
    pill: document.querySelector('#listCount').innerText,
    progress: document.querySelector('#listProgress').hidden ? null : document.querySelector('#listProgressText').innerText,
    rows: document.querySelectorAll('.msg-item').length,
  }))
);
await p.screenshot({ path: 'shots/48-searching.png' });
await b.close();
