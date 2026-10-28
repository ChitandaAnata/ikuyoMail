/**
 * 验证：窄列表不遮挡「写邮件」/ 收起阅读区入口 / 窗口缩窄后三栏不塌陷
 * 用法：node scripts/verify-layout2.js
 */
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
await p.evaluate(() => localStorage.removeItem('ikuyoMail.layout'));
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForSelector('.msg-item', { timeout: 90000 });
await wait(600);

const rect = (sel) =>
  p.evaluate((s) => {
    const n = document.querySelector(s);
    if (!n) return null;
    const r = n.getBoundingClientRect();
    const cs = getComputedStyle(n);
    return {
      x: Math.round(r.x),
      right: Math.round(r.right),
      w: Math.round(r.width),
      display: cs.display,
      visible: r.width > 0 && r.height > 0 && cs.display !== 'none',
    };
  }, sel);

/* ---------- 1. 阅读区打开：把列表拖到最窄 ---------- */
const sp = await p.evaluate(() => {
  const r = document.querySelector('#splitList').getBoundingClientRect();
  return { x: r.x + r.width / 2, y: 400 };
});
await p.mouse.move(sp.x, sp.y);
await p.mouse.down();
await p.mouse.move(sp.x - 600, sp.y, { steps: 14 });
await p.mouse.up();
await wait(400);

const list1 = await rect('#listPane');
const compose1 = await rect('#composeBtn');
const search1 = await rect('.search-box');
console.log(`[1] 列表最窄: 列表宽=${list1.w} 搜索框宽=${search1.w} 写邮件右边=${compose1.right} 列表右边=${list1.right}`);
console.log(
  `    写邮件按钮完整可见: ${compose1.visible && compose1.right <= list1.right + 1 && compose1.w > 40 ? '✅' : '❌'}`
);
await p.screenshot({ path: 'shots/80-narrow-list.png' });

/* ---------- 2. 收起入口在阅读区里 ---------- */
await p.click('.msg-item');
await wait(2200);
const collapse = await rect('#readerCollapseBtn');
const toggleBtn = await rect('#readerToggleBtn');
console.log(`[2] 阅读区内的「收起」: ${collapse ? '存在 ✅' : '缺失 ❌'} / 列表上的「阅读区」按钮: ${toggleBtn ? '还在 ❌' : '已移除 ✅'}`);
await p.click('#readerCollapseBtn');
await wait(400);
const reader2 = await rect('#reader');
const list2 = await rect('#listPane');
const toggle2 = await rect('#readerToggleBtn');
const noReader = await p.evaluate(() => document.querySelector('.app').classList.contains('no-reader'));
console.log(
  `    收起后: no-reader=${noReader} 阅读区隐藏=${!reader2.visible ? '✅' : '❌'} 列表宽=${list2.w} 列表上的「阅读区」按钮=${toggle2 ? '还在 ❌' : '已移除 ✅'}`
);
await p.screenshot({ path: 'shots/81-collapsed-list.png' });

/* ---------- 3. 两栏状态下把窗口横向缩窄 ---------- */
for (const w of [1000, 860, 720, 620]) {
  await p.setViewport({ width: w, height: 880 });
  await wait(350);
  const l = await rect('#listPane');
  const r = await rect('#reader');
  const app = await p.evaluate(() => ({
    w: document.querySelector('.app').getBoundingClientRect().width,
    scroll: document.documentElement.scrollWidth,
    noReader: document.querySelector('.app').classList.contains('no-reader'),
  }));
  const ok = l.visible && l.w >= 280 && !r.visible;
  console.log(
    `[3] 窗口 ${w}px: 列表宽=${l.w} 阅读区显示=${r.visible} app宽=${Math.round(app.w)} 文档滚动宽=${app.scroll} -> ${ok ? '✅' : '❌'}`
  );
}
await p.screenshot({ path: 'shots/82-collapsed-narrow.png' });

/* ---------- 4. 展开阅读区，检查最小宽度与按钮换行 ---------- */
await p.setViewport({ width: 900, height: 880 });
await wait(300);
await p.click('.msg-item'); // 列表上的「展开阅读区」按钮已去掉，点邮件即可
await wait(500);
const r4 = await rect('#reader');
const l4 = await rect('#listPane');
const sb4 = await rect('.sidebar');
const acts = await p.evaluate(() => {
  const n = document.querySelector('.reader-actions');
  if (!n) return null;
  const r = n.getBoundingClientRect();
  return { h: Math.round(r.height), scrollW: n.scrollWidth, clientW: n.clientWidth };
});
console.log(`[4] 窗口 900px 展开阅读区: 侧栏=${sb4.w} 列表=${l4.w} 阅读区=${r4.w} ${r4.w >= 355 ? '✅' : '❌'}`);
console.log(`    按钮区高=${acts.h}px 溢出=${acts.scrollW > acts.clientW ? '是 ❌' : '否 ✅'}`);
await p.screenshot({ path: 'shots/83-reader-900.png' });

/* ---------- 5. 窄窗口压缩是临时的，放大后回到用户设置的宽度 ---------- */
await p.evaluate(() => localStorage.removeItem('ikuyoMail.layout'));
await p.setViewport({ width: 1440, height: 900 });
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForSelector('.msg-item', { timeout: 90000 });
await wait(600);
const wide1 = await rect('#listPane');
await p.setViewport({ width: 900, height: 880 });
await wait(400);
const narrow1 = await rect('#listPane');
await p.setViewport({ width: 1440, height: 900 });
await wait(400);
const wide2 = await rect('#listPane');
console.log(
  `[5] 列表宽度 1440=${wide1.w} → 900=${narrow1.w} → 1440=${wide2.w} ${narrow1.w < wide1.w && wide2.w === wide1.w ? '✅ 临时压缩，能恢复' : '❌'}`
);
await p.screenshot({ path: 'shots/84-restored.png' });

console.log(errs.length ? '❌ JS 错误: ' + errs[0] : '✅ 无 JS 错误');
await b.close();
