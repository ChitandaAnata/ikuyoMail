/** 最终截图 + 布局记忆验证 */
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
await wait(700);
await p.screenshot({ path: 'shots/70-main.png' });

// 拖动侧栏到 300，刷新后应该还在
const box = await p.evaluate(() => {
  const r = document.querySelector('#splitSide').getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + 400 };
});
await p.mouse.move(box.x, box.y);
await p.mouse.down();
await p.mouse.move(box.x + 36, box.y, { steps: 6 });
await p.mouse.up();
await wait(300);
const w1 = await p.evaluate(() => Math.round(document.querySelector('.sidebar').getBoundingClientRect().width));
await p.reload({ waitUntil: 'domcontentloaded' });
await p.waitForSelector('.msg-item', { timeout: 90000 });
await wait(500);
const w2 = await p.evaluate(() => Math.round(document.querySelector('.sidebar').getBoundingClientRect().width));
console.log('拖动后宽度', w1, '刷新后', w2, w1 === w2 ? '✅ 记住了' : '❌ 没记住');

// 双击复位
const box2 = await p.evaluate(() => {
  const r = document.querySelector('#splitSide').getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + 400 };
});
await p.mouse.click(box2.x, box2.y, { clickCount: 2 });
await wait(400);
console.log('双击后', await p.evaluate(() => Math.round(document.querySelector('.sidebar').getBoundingClientRect().width)));

// 收起的截图（放在打开邮件之后）
await p.click('.msg-item');
await wait(2500);
await p.keyboard.press('F9');
await wait(500);
await p.screenshot({ path: 'shots/71-collapsed.png' });
await p.keyboard.press('F9');
await wait(400);
await p.screenshot({ path: 'shots/72-reader.png' });
console.log(errs.length ? '❌ ' + errs[0] : '✅ 无 JS 错误');
await b.close();
