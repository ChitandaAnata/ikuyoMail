/** 收尾截图：设置面板（启动项）、已发送文件夹的搜索与跳页 */
import puppeteer from 'puppeteer-core';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  defaultViewport: { width: 1400, height: 900 },
});
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://127.0.0.1:7317', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('.msg-item', { timeout: 60000 });
await wait(800);

await p.click('#settingsBtn');
await wait(900);
await p.evaluate(() => {
  const box = document.querySelector('#setAutoStart').closest('.set-group');
  box.scrollIntoView({ block: 'center' });
});
await wait(400);
await p.screenshot({ path: 'shots/final-settings.png' });
await p.click('[data-close="settingsModal"]');
await wait(400);

const ok = await p.evaluate(() => {
  const f = [...document.querySelectorAll('.folder')].find((n) => n.innerText.includes('已发送'));
  if (!f) return false;
  f.click();
  return true;
});
await wait(2500);
await p.click('#searchInput');
await p.type('#searchInput', '163', { delay: 30 });
await p.keyboard.press('Enter');
await wait(2500);
console.log(
  '已发送搜索:',
  await p.evaluate(() => ({
    pill: document.querySelector('#listCount').innerText,
    rows: document.querySelectorAll('.msg-item').length,
    pager: document.querySelector('#pageTotal').innerText,
  }))
);
await p.screenshot({ path: 'shots/final-sent-search.png' });
console.log(ok ? '已切到已发送' : '未找到已发送', errs.length ? '❌ ' + errs[0] : '✅ 无 JS 错误');
await b.close();
