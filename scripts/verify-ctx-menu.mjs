// 邮件列表右键菜单自测：置顶 / 待办 / 备注 / 另存为 PDF 的界面表现（仅开发用）
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.URL || 'http://127.0.0.1:7318';
const OUT = process.env.OUT || 'shots';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
  protocolTimeout: 20000,
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle2' });
await page.waitForSelector('.msg-item');
await wait(600);

const log = (...a) => console.log(...a);

/** 按主题定位那一封再右键（置顶会让位置变化，不能用固定坐标） */
async function rightClickBySubject(subject) {
  const box = await page.evaluate((s) => {
    const el = [...document.querySelectorAll('.msg-item')].find(
      (n) => n.querySelector('.m-subject').textContent === s
    );
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + 60, y: r.y + r.height / 2 };
  }, subject);
  if (!box) throw new Error('找不到这封邮件：' + subject);
  await page.mouse.click(box.x, box.y, { button: 'right' });
  await wait(280);
  return box;
}

async function act(subject, actName) {
  await rightClickBySubject(subject);
  await page.click(`#ctxMenu [data-act="${actName}"]`);
  await wait(700);
}

const rowInfo = (subject) =>
  page.evaluate((s) => {
    const el = [...document.querySelectorAll('.msg-item')].find(
      (n) => n.querySelector('.m-subject').textContent === s
    );
    const items = [...document.querySelectorAll('.msg-item')];
    return {
      index: items.indexOf(el),
      pinned: el.classList.contains('pinned'),
      pinIcon: !!el.querySelector('.m-pin'),
      todo: el.querySelector('.m-tag.todo')?.textContent.trim() || null,
      note: el.querySelector('.m-note')?.textContent.trim() || null,
      firstSubject: items[0].querySelector('.m-subject').textContent,
    };
  }, subject);

const subject = await page.evaluate(() => {
  const items = [...document.querySelectorAll('.msg-item')];
  return items[3].querySelector('.m-subject').textContent;
});
log('目标邮件：', subject);

/* 1) 菜单 */
await rightClickBySubject(subject);
const menu = await page.evaluate(() => {
  const m = document.getElementById('ctxMenu');
  const r = m.getBoundingClientRect();
  return {
    hidden: m.hidden,
    items: [...m.querySelectorAll('.ctx-item')].map((b) => b.textContent.trim()),
    insideViewport: r.right <= innerWidth && r.bottom <= innerHeight && r.left >= 0 && r.top >= 0,
  };
});
log('菜单：', JSON.stringify(menu));
await page.screenshot({ path: `${OUT}/ctx-menu.png` });

/* 2) 置顶 */
await act(subject, 'pin');
log('置顶后：', JSON.stringify(await rowInfo(subject)));

/* 3) 待办 */
await act(subject, 'todo');
log('待办后：', JSON.stringify(await rowInfo(subject)));

/* 4) 备注 */
await rightClickBySubject(subject);
await page.click('#ctxMenu [data-act="note"]');
await wait(350);
const noteOpen = await page.evaluate(() => !document.getElementById('noteModal').hidden);
await page.type('#noteInput', '等对方回报价再处理');
await page.click('#noteSaveBtn');
await wait(700);
const afterNote = await rowInfo(subject);
log('备注弹窗打开：', noteOpen, '保存后：', JSON.stringify(afterNote));

/* 5) 阅读区也要看到备注 */
await page.evaluate((s) => {
  const el = [...document.querySelectorAll('.msg-item')].find(
    (n) => n.querySelector('.m-subject').textContent === s
  );
  el.click();
}, subject);
await page.waitForSelector('.reader-subject');
await wait(900);
const readerNote = await page.evaluate(() => {
  const box = document.getElementById('readerNote');
  return { hidden: box.hidden, text: box.textContent.trim() };
});
log('阅读区备注：', JSON.stringify(readerNote));
await page.screenshot({ path: `${OUT}/ctx-after.png` });

/* 6) 另存为 PDF（浏览器环境：打开打印页）
   注意：打印页在 auto=1 时会调 window.print()，headless 下会挂住整个浏览器（连主页的 CDP 一起），
   所以这一段用 SKIP_PDF=1 可以跳过；跑完后浏览器会失去响应，清理步骤也一并跳过。 */
if (!process.env.SKIP_PDF) {
  const popup = new Promise((resolve) => browser.once('targetcreated', resolve));
  await rightClickBySubject(subject);
  await page.click('#ctxMenu [data-act="pdf"]');
  const targetHandle = await popup;
  const printPage = await targetHandle.page();
  await printPage.evaluateOnNewDocument(() => {
    window.print = () => {};
  });
  await printPage.reload({ waitUntil: 'networkidle2' });
  await wait(1200);
  log('PDF 打开的页面：', printPage.url());
  const info = await printPage.evaluate(() => ({
    subject: document.getElementById('pSubject').textContent,
    from: document.getElementById('pFrom').textContent,
    date: document.getElementById('pDate').textContent,
    bodyLen: document.getElementById('pBody').shadowRoot?.textContent.trim().length || 0,
    note: document.getElementById('pNote').hidden ? null : document.getElementById('pNote').textContent.trim(),
    docHeight: document.getElementById('doc').scrollHeight,
  }));
  log('打印页：', JSON.stringify(info));
  log(errors.length ? '控制台报错：\n' + errors.join('\n') : '无控制台报错');
  log('（演示数据在内存里，重启演示服务即恢复，这里不再清理）');
  await browser.close().catch(() => {});
  process.exit(0);
}

/* 7) 恢复演示数据的初始状态 */
await act(subject, 'pin');
await act(subject, 'todo');
await rightClickBySubject(subject);
await page.click('#ctxMenu [data-act="note"]');
await wait(300);
await page.click('#noteClearBtn');
await wait(600);
log('清理后：', JSON.stringify(await rowInfo(subject)));

log(errors.length ? '控制台报错：\n' + errors.join('\n') : '无控制台报错');
await browser.close();
