import puppeteer from 'puppeteer-core';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1440, height: 900 } });
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://127.0.0.1:7317', { waitUntil: 'domcontentloaded' });
await p.evaluate(() => localStorage.setItem('ikuyoMail.layout', JSON.stringify({ sb: 264, list: 384, readerOpen: true })));
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForSelector('.msg-item', { timeout: 90000 });
await wait(900);

for (const [w, h] of [[1920, 900], [1440, 900], [1440, 620], [1000, 500], [1000, 400], [998, 499]]) {
  await p.setViewport({ width: w, height: h });
  await wait(320);
  const m = await p.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    sh: document.documentElement.scrollHeight,
    cw: document.documentElement.clientWidth,
    ch: document.documentElement.clientHeight,
    appH: Math.round(document.querySelector('.app').getBoundingClientRect().height),
  }));
  const vScroll = m.sh > m.ch + 1;
  const hScroll = m.sw > m.cw + 1;
  console.log(`${w}x${h} | app 高 ${m.appH} | 内容 ${m.sw}x${m.sh} 视口 ${m.cw}x${m.ch} | ${hScroll ? '有横向滚动' : '无横向滚动'} ${vScroll ? '有纵向滚动' : '无纵向滚动'}`);
}
await p.setViewport({ width: 998, height: 499 });
await wait(400);
await p.screenshot({ path: 'shots/D1-min-998x499.png' });
await p.setViewport({ width: 1000, height: 400 });
await wait(400);
await p.screenshot({ path: 'shots/D2-short-1000x400.png' });
console.log(errs.length ? `❌ JS 错误: ${errs[0]}` : '✅ 无 JS 错误');
await b.close();
