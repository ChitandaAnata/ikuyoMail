import puppeteer from 'puppeteer-core';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1000, height: 800 } });
const p = await b.newPage();
await p.goto('http://127.0.0.1:7317', { waitUntil: 'domcontentloaded' });

async function shot(open, w, name, height = 800) {
  await p.evaluate((o) => localStorage.setItem('ikuyoMail.layout', JSON.stringify({ sb: 264, list: 384, readerOpen: o })), open);
  await p.setViewport({ width: w, height });
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.msg-item', { timeout: 90000 });
  await wait(800);
  await p.screenshot({ path: `shots/${name}.png` });
  const m = await p.evaluate(() => {
    const g = (s) => Math.round(document.querySelector(s)?.getBoundingClientRect().width || 0);
    return { sb: g('.sidebar'), list: g('#listPane'), reader: g('#reader'), cw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth };
  });
  console.log(`${name}: 账号 ${m.sb} 列表 ${m.list} 阅读 ${m.reader} | 视口 ${m.cw} 滚动宽 ${m.sw}`);
}

await shot(false, 700, '97-two-700');
await shot(false, 560, '98-two-560');
await shot(false, 536, '99-two-min');
await shot(true, 1000, 'A0-three-1000');
await shot(true, 918, 'A1-three-min');
await b.close();
