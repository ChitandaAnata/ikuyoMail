import puppeteer from 'puppeteer-core';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1400, height: 860 } });
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://127.0.0.1:7317', { waitUntil: 'domcontentloaded' });
await p.evaluate(() => localStorage.setItem('ikuyoMail.layout', JSON.stringify({ sb: 264, list: 384, readerOpen: true })));
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForSelector('.msg-item', { timeout: 90000 });
await p.click('.msg-item');
await wait(1600);

const probe = () => p.evaluate(() => {
  const g = (s) => Math.round(document.querySelector(s)?.getBoundingClientRect().width || 0);
  return {
    sb: g('.sidebar'), list: g('#listPane'), reader: g('#reader'),
    cw: document.documentElement.clientWidth,
    tooNarrow: document.querySelector('.app').classList.contains('too-narrow'),
    hintShown: getComputedStyle(document.querySelector('#narrowHint')).display !== 'none',
  };
});

let ok = true;
for (const w of [1400, 1200, 1100, 1020, 1000, 990, 982, 950, 900, 800, 700, 600]) {
  await p.setViewport({ width: w, height: 860 });
  await wait(260);
  const r = await probe();
  const bad = r.reader < 439;
  if (bad) ok = false;
  console.log(`视口 ${String(w).padStart(4)} | 账号 ${String(r.sb).padStart(3)} 列表 ${String(r.list).padStart(3)} 阅读 ${String(r.reader).padStart(3)} | ${r.tooNarrow ? '触发窄提示' : '正常'} ${bad ? '❌ 阅读区被压窄' : '✅'}`);
}
await p.setViewport({ width: 700, height: 800 });
await wait(400);
await p.screenshot({ path: 'shots/B1-too-narrow.png' });
// 提示条里的「收起阅读区」按钮
await p.evaluate(() => document.querySelector('#narrowCollapse').click());
await wait(400);
const after = await probe();
console.log('[点收起阅读区]', after, after.reader === 0 ? '✅ 已收起' : '❌');
await p.screenshot({ path: 'shots/B2-after-collapse.png' });
console.log(ok ? '✅ 阅读区在任何视口都不小于 440' : '❌ 有视口把阅读区压窄了');
console.log(errs.length ? `❌ JS 错误: ${errs[0]}` : '✅ 无 JS 错误');
await b.close();
