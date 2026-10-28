import puppeteer from 'puppeteer-core';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1400, height: 860 } });
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://127.0.0.1:7317', { waitUntil: 'domcontentloaded' });

const probe = () => p.evaluate(() => {
  const g = (s) => document.querySelector(s)?.getBoundingClientRect();
  return {
    sb: Math.round(g('.sidebar').width),
    list: Math.round(g('#listPane').width),
    reader: Math.round(g('#reader').width),
    cw: document.documentElement.clientWidth,
    sw: document.documentElement.scrollWidth,
    cls: document.querySelector('.app').className,
  };
});

for (const open of [false, true]) {
  await p.evaluate((o) => localStorage.setItem('ikuyoMail.layout', JSON.stringify({ sb: 264, list: 384, readerOpen: o })), open);
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForSelector('.msg-item', { timeout: 90000 });
  await wait(500);
  console.log(`\n=== ${open ? '三栏' : '两栏'}（账号栏 264、列表 384）===`);
  const widths = open ? [1400, 1100, 1000, 950, 920, 902, 880, 850] : [1400, 900, 700, 640, 600, 560, 536, 500];
  let prev = null;
  for (const w of widths) {
    await p.setViewport({ width: w, height: 800 });
    await wait(280);
    const r = await probe();
    const sum = r.sb + r.list + r.reader + (open ? 12 : 6);
    const trend = prev ? `Δ账号 ${r.sb - prev.sb} Δ列表 ${r.list - prev.list} Δ阅读 ${r.reader - prev.reader}` : '';
    console.log(`视口 ${String(w).padStart(4)} | 账号 ${String(r.sb).padStart(3)} 列表 ${String(r.list).padStart(3)} ${open ? `阅读 ${String(r.reader).padStart(3)}` : ''} | 合计 ${sum} 视口 ${r.cw} | ${r.sw > r.cw + 1 ? '横滚 ' + (r.sw - r.cw) : '无滚动'} | ${trend}`);
    prev = r;
  }
}
console.log(errs.length ? `❌ JS 错误: ${errs[0]}` : '✅ 无 JS 错误');
await b.close();
