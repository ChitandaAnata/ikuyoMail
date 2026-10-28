/** 设置面板 + 图片策略 + 新邮件卡片 的界面自测 */
import puppeteer from 'puppeteer-core';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: 'new',
  defaultViewport: { width: 1440, height: 920 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});

await page.goto('http://127.0.0.1:7318', { waitUntil: 'networkidle2' });
await page.waitForSelector('.msg-item');
await wait(500);

/* ---- 1. 设置面板 ---- */
await page.click('#settingsBtn');
await wait(600);
const setState = await page.evaluate(() => ({
  visible: !document.querySelector('#settingsModal').hidden,
  imageSeg: [...document.querySelectorAll('#setImagePolicy button')].map((b) => b.dataset.val + (b.classList.contains('active') ? '*' : '')),
  closeSeg: [...document.querySelectorAll('#setCloseAction button')].map((b) => b.dataset.val + (b.classList.contains('active') ? '*' : '')),
  status: document.querySelector('#setStatus').innerText.replace(/\n/g, ' | '),
  closeTip: document.querySelector('#closeTip').innerText,
}));
console.log('设置面板可见:', setState.visible);
console.log('图片策略选项:', setState.imageSeg.join(' '), '| 关闭行为:', setState.closeSeg.join(' '));
console.log('状态行:', setState.status);
console.log('关闭提示:', setState.closeTip);
await page.screenshot({ path: 'shots/31-settings.png' });

/* ---- 2. 切成「默认显示」 ---- */
await page.click('#setImagePolicy button[data-val="allow"]');
await wait(500);
const afterAllow = await page.evaluate(() => ({
  seg: [...document.querySelectorAll('#setImagePolicy button')].find((b) => b.classList.contains('active'))?.dataset.val,
  tip: document.querySelector('#imagePolicyTip').innerText,
}));
const savedPolicy = await page.evaluate(() => fetch('/api/settings').then((r) => r.json()).then((d) => d.settings.imagePolicy));
console.log('切换后: 界面=', afterAllow.seg, '| 服务端=', savedPolicy, '| 提示=', afterAllow.tip);

/* ---- 3. 关掉设置，打开带远程图片的邮件 ---- */
await page.click('#settingsModal .primary-btn');
await wait(300);
await page.evaluate(() => {
  [...document.querySelectorAll('.msg-item')].find((n) => n.innerText.includes('设计稿'))?.click();
});
await wait(1400);
const allowedBar = await page.evaluate(() => {
  const bar = document.querySelector('#imgBar');
  return bar ? { text: bar.innerText.replace(/\n/g, ' '), allowed: bar.classList.contains('allowed') } : null;
});
console.log('放行时的提示条:', JSON.stringify(allowedBar));
await page.screenshot({ path: 'shots/32-img-allowed.png' });

/* ---- 4. 点「隐藏图片」 ---- */
await page.click('#showImgs');
await wait(900);
const blockedBar = await page.evaluate(() => {
  const bar = document.querySelector('#imgBar');
  return bar ? { text: bar.innerText.replace(/\n/g, ' '), allowed: bar.classList.contains('allowed') } : null;
});
console.log('拦截时的提示条:', JSON.stringify(blockedBar));
await page.screenshot({ path: 'shots/33-img-blocked.png' });

/* ---- 5. 恢复默认拦截，并做一次测试提醒 ---- */
await page.evaluate(() => fetch('/api/settings', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ imagePolicy: 'block' }),
}));
await page.click('#settingsBtn');
await wait(400);
await page.click('#testNotifyBtn');
await wait(1200);
const notify = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.notify-card')];
  const first = cards[0];
  const box = first?.getBoundingClientRect();
  return {
    count: cards.length,
    text: first ? first.innerText.replace(/\n/g, ' | ') : null,
    right: box ? Math.round(window.innerWidth - box.right) : null,
    bottom: box ? Math.round(window.innerHeight - box.bottom) : null,
  };
});
console.log('提醒卡片:', JSON.stringify(notify));
await page.screenshot({ path: 'shots/34-notify.png' });

console.log(errors.length ? '❌ JS 错误: ' + errors.slice(0, 3).join(' ; ') : '✅ 无 JS 错误');
await browser.close();
