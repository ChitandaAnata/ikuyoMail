import puppeteer from 'puppeteer-core';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  defaultViewport: { width: 1440, height: 900 },
});
const p = await b.newPage();
await p.goto('http://127.0.0.1:7317', { waitUntil: 'domcontentloaded' });
await p.evaluate(() => localStorage.removeItem('ikuyoMail.layout'));
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForSelector('.msg-item', { timeout: 90000 });
await p.click('.msg-item');
await wait(2400);
await p.screenshot({ path: 'shots/88-reader-1440.png' });
await p.click('#readerCollapseBtn');
await wait(500);
await p.screenshot({ path: 'shots/89-collapsed-1440.png' });
await b.close();
