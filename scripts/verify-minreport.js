import puppeteer from 'puppeteer-core';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1400, height: 860 } });
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://127.0.0.1:7317', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.msg-item', { timeout: 90000 });
await wait(1200);

const read = async () => (await (await fetch('http://127.0.0.1:7317/api/ui/min-width')).json()).width;

// 三栏
await p.evaluate(() => localStorage.setItem('ikuyoMail.layout', JSON.stringify({ sb: 264, list: 384, readerOpen: true })));
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForSelector('.msg-item', { timeout: 90000 });
await wait(1200);
console.log('[三栏] 上报最小宽度 =', await read(), '（应为 902 + 边框）');

// 收起阅读区
await p.evaluate(() => localStorage.setItem('ikuyoMail.layout', JSON.stringify({ sb: 264, list: 384, readerOpen: false })));
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForSelector('.msg-item', { timeout: 90000 });
await wait(1200);
console.log('[两栏] 上报最小宽度 =', await read(), '（应为 536 + 边框）');

console.log(errs.length ? `❌ JS 错误: ${errs[0]}` : '✅ 无 JS 错误');
await b.close();
