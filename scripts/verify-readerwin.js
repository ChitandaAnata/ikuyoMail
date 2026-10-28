import puppeteer from 'puppeteer-core';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  defaultViewport: { width: 1440, height: 900 },
});
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://127.0.0.1:7317', { waitUntil: 'domcontentloaded' });
await p.evaluate(() => localStorage.setItem('ikuyoMail.layout', JSON.stringify({ sb: 264, list: 384, readerOpen: true })));
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForSelector('.msg-item', { timeout: 90000 });
await p.click('.msg-item');
await wait(2200);

// 阅读区打开时把窗口整体缩窄
for (const w of [1200, 1000, 900]) {
  await p.setViewport({ width: w, height: 880 });
  await wait(350);
  const r = await p.evaluate(() => {
    const g = (s) => Math.round(document.querySelector(s).getBoundingClientRect().width);
    return { sb: g('.sidebar'), list: g('#listPane'), reader: g('#reader'), app: g('.app'), sw: document.documentElement.scrollWidth };
  });
  console.log(`[三栏 ${w}px] 侧栏=${r.sb} 列表=${r.list} 阅读区=${r.reader} app=${r.app} 滚动宽=${r.sw}`);
}
await p.screenshot({ path: 'shots/86-narrow-3col.png' });

// 独立阅读窗口
await p.setViewport({ width: 1440, height: 900 });
await wait(300);
const before = b.targets().length;
await p.click('#popoutBtn');
await wait(2000);
const targets = b.targets().filter((t) => t.url().includes('pane=reader'));
console.log('[独立窗口] 新窗口数量=', targets.length, targets.length ? '✅' : '❌');
if (targets.length) {
  const rp = await targets[0].page();
  await rp.bringToFront();
  await wait(1200);
  const info = await rp.evaluate(() => {
    const r = document.querySelector('#reader').getBoundingClientRect();
    return {
      appW: Math.round(document.querySelector('.app').getBoundingClientRect().width),
      readerW: Math.round(r.width),
      readerOnly: document.querySelector('.app').classList.contains('reader-only'),
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    };
  });
  console.log('[独立窗口]', info, info.readerW > 400 && info.scrollW <= info.clientW + 1 ? '✅ 满宽无滚动' : '❌');
  await rp.screenshot({ path: 'shots/87-reader-window.png' });
  await rp.close();
}
await wait(1500);
const back = await p.evaluate(() => ({
  noReader: document.querySelector('.app').classList.contains('no-reader'),
  readerW: Math.round(document.querySelector('#reader').getBoundingClientRect().width),
  popoutBar: document.querySelector('#popoutBar').hidden,
}));
console.log('[关窗后]', back, !back.noReader && back.readerW > 300 ? '✅ 回到三栏' : '❌');
console.log(errs.length ? '❌ JS 错误: ' + errs[0] : '✅ 无 JS 错误');
await b.close();
