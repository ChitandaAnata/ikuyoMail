/** 三栏布局 / 收起阅读区 / 独立窗口 的自动化验收 */
import puppeteer from 'puppeteer-core';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  args: ['--disable-popup-blocking'],
  defaultViewport: { width: 1440, height: 900 },
});
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => m.type() === 'error' && errs.push('console: ' + m.text()));

const widths = () =>
  p.evaluate(() => {
    const w = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().width);
    return {
      sb: w('.sidebar'),
      list: w('.list-pane'),
      reader: Math.round(document.querySelector('.reader').getBoundingClientRect().width),
      noReader: document.querySelector('.app').classList.contains('no-reader'),
      total: document.querySelector('.app').clientWidth,
    };
  });

await p.goto('http://127.0.0.1:7317', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.msg-item', { timeout: 90000 });
await wait(600);
console.log('初始:', await widths());

// 1) 拖动侧栏分隔条 +48px
const sbBox = await p.evaluate(() => {
  const r = document.querySelector('#splitSide').getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await p.mouse.move(sbBox.x, sbBox.y);
await p.mouse.down();
await p.mouse.move(sbBox.x + 24, sbBox.y, { steps: 4 });
await p.mouse.move(sbBox.x + 48, sbBox.y, { steps: 4 });
await p.mouse.up();
await wait(300);
const afterDrag = await widths();
console.log('拖动侧栏 +48:', afterDrag);

// 2) 拖动列表分隔条 -60px
const listBox = await p.evaluate(() => {
  const r = document.querySelector('#splitList').getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await p.mouse.move(listBox.x, listBox.y);
await p.mouse.down();
await p.mouse.move(listBox.x - 30, listBox.y, { steps: 4 });
await p.mouse.move(listBox.x - 60, listBox.y, { steps: 4 });
await p.mouse.up();
await wait(300);
console.log('拖动列表 -60:', await widths());

// 3) 双击恢复默认
await p.mouse.click(sbBox.x + 48, sbBox.y, { clickCount: 2 });
await wait(350);
await p.mouse.click(listBox.x - 60, listBox.y, { clickCount: 2 });
await wait(350);
console.log('双击复位:', await widths());

// 4) 收起 / 展开阅读区
await p.click('#readerToggleBtn');
await wait(450);
console.log('收起阅读区:', await widths());
await p.screenshot({ path: 'shots/60-reader-collapsed.png' });
await p.click('#readerToggleBtn');
await wait(450);
console.log('展开阅读区:', await widths());

// 5) F9 快捷键
await p.keyboard.press('F9');
await wait(400);
const f9 = await p.evaluate(() => document.querySelector('.app').classList.contains('no-reader'));
await p.keyboard.press('F9');
await wait(400);
console.log('F9 收起=', f9);

// 6) 打开一封邮件再弹出独立窗口
await p.click('.msg-item');
await p.waitForFunction(() => !!document.querySelector('.reader-subject'), { timeout: 30000 });
await wait(600);
console.log('popout 按钮:', await p.evaluate(() => !!document.querySelector('#popoutBtn')));

b.on('targetcreated', (t) => console.log('  [target]', t.type(), t.url().slice(0, 80)));
const newTarget = b.waitForTarget((t) => t.url().includes('pane=reader'), { timeout: 20000 });
await p.click('#popoutBtn');
const target = await newTarget;
const pop = await target.page();
await pop.waitForSelector('.reader-subject', { timeout: 30000 });
await wait(500);
console.log('弹窗主体:', await pop.evaluate(() => ({
  subject: document.querySelector('.reader-subject')?.innerText.slice(0, 30),
  sidebar: getComputedStyle(document.querySelector('.sidebar')).display,
  list: getComputedStyle(document.querySelector('.list-pane')).display,
  width: document.querySelector('.reader').getBoundingClientRect().width,
  back: document.querySelector('#backBtn')?.textContent,
  title: document.title,
})));
await pop.screenshot({ path: 'shots/61-popout.png' });
console.log('主窗口在弹窗后:', await widths());

// 6b) 弹窗开着时，主窗口点另一封，弹窗要跟着换
await p.evaluate(() => document.querySelectorAll('.msg-item')[1].click());
await wait(2600);
console.log('弹窗跟随:', await pop.evaluate(() => document.querySelector('.reader-subject')?.innerText.slice(0, 24)));
console.log('提示条:', await p.evaluate(() => ({ hidden: document.querySelector('#popoutBar').hidden, text: document.querySelector('#popoutBar').innerText.replace(/\s+/g, ' ') })));
await p.screenshot({ path: 'shots/63-popout-bar.png' });

// 7) 关掉弹窗 → 主界面恢复三栏
await pop.close();
await wait(1600);
console.log('弹窗关闭后:', await widths());
await p.screenshot({ path: 'shots/62-after-popout.png' });

console.log(errs.length ? '❌ ' + errs.slice(0, 2).join(' | ') : '✅ 无 JS 错误');
await b.close();
