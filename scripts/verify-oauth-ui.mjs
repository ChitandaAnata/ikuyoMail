// Gmail OAuth 界面自测（仅开发用）：demo 服务 + 添加账号弹窗
import puppeteer from 'puppeteer-core';
import { execSync, spawn } from 'node:child_process';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 7421;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 起 demo 服务（demo.js 有 providers 接口，够测弹窗）
const demo = spawn(process.execPath, ['src/demo.js'], {
  env: { ...process.env, DEMO_PORT: String(PORT) },
  stdio: 'ignore',
});
await wait(2500);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}`, { waitUntil: 'networkidle2' });
await page.waitForSelector('#addAccountBtn', { timeout: 10000 }).catch(() => {});

// 打开添加账号弹窗（demo 页面按钮可能叫别的，兜底直接调内部打开逻辑）
const opened = await page.evaluate(() => {
  const btn = document.querySelector('#addAccountBtn') || document.querySelector('[data-open="accountModal"]');
  if (btn) { btn.click(); return 'btn'; }
  return null;
});
if (!opened) {
  await page.evaluate(() => window.openAccountModal && window.openAccountModal('create'));
}
await wait(600);

// 切到 Gmail
await page.evaluate(() => {
  const sel = document.querySelector('#accProvider');
  const opt = [...sel.options].find((o) => /gmail/i.test(o.textContent));
  sel.value = opt.value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
});
await wait(400);

const info = await page.evaluate(() => ({
  googleBlockHidden: document.getElementById('googleBlock')?.hidden,
  passFieldHidden: document.getElementById('passField')?.hidden,
  loginBtnText: document.getElementById('googleLoginBtn')?.textContent,
  hintText: document.getElementById('hintText')?.textContent.slice(0, 40),
  configOpen: document.getElementById('googleConfigDetails')?.open,
}));

// 截图
await page.screenshot({ path: 'shots/oauth-gmail-modal.png' });

// 切回 163 看区块是否消失
await page.evaluate(() => {
  const sel = document.querySelector('#accProvider');
  const opt = [...sel.options].find((o) => /163/.test(o.textContent));
  sel.value = opt.value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
});
await wait(300);
const after = await page.evaluate(() => ({
  googleBlockHidden: document.getElementById('googleBlock')?.hidden,
  passFieldHidden: document.getElementById('passField')?.hidden,
}));

console.log('Gmail 选中:', JSON.stringify(info));
console.log('切回 163:', JSON.stringify(after));
console.log('页面 JS 错误:', errors.length ? errors.join(' | ') : '无');

await browser.close();
demo.kill();
const ok =
  info.googleBlockHidden === false &&
  info.passFieldHidden === true &&
  after.googleBlockHidden === true &&
  after.passFieldHidden === false &&
  errors.length === 0;
console.log(ok ? '✅ 全部通过' : '❌ 有断言失败');
process.exit(ok ? 0 : 1);
