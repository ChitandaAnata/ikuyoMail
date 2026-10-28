// 设置面板左下角版本号自测（仅开发用）
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.URL || 'http://127.0.0.1:7318';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: 'networkidle2' });
await page.waitForSelector('#settingsBtn');
await page.click('#settingsBtn');
await wait(900);

const info = await page.evaluate(() => {
  const el = document.getElementById('appVer');
  if (!el) return null;
  const foot = el.closest('.modal-foot');
  const btn = foot?.querySelector('.primary-btn');
  return {
    text: el.textContent.trim(),
    font: getComputedStyle(el).fontSize,
    color: getComputedStyle(el).color,
    sameRow: foot ? Math.abs(el.getBoundingClientRect().top - btn.getBoundingClientRect().top) < 40 : false,
    box: el.getBoundingClientRect().toJSON(),
  };
});
console.log('版本号：', JSON.stringify(info, null, 2));

const box = await page.evaluate(() => {
  const r = document.getElementById('settingsModal').querySelector('.modal').getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
});
await page.screenshot({ path: 'shots/settings-version.png', clip: { x: box.x, y: box.y + box.height - 120, width: box.width, height: 120 } });
console.log(errors.length ? '报错：' + errors.join(' / ') : '无报错');
await browser.close();
