// Outlook（Microsoft OAuth）界面自测（仅开发用）：demo 服务 + 添加账号弹窗
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 7422;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

const opened = await page.evaluate(() => {
  const btn = document.querySelector('#addAccountBtn') || document.querySelector('[data-open="accountModal"]');
  if (btn) { btn.click(); return 'btn'; }
  return null;
});
if (!opened) {
  await page.evaluate(() => window.openAccountModal && window.openAccountModal('create'));
}
await wait(600);

// 切到 Outlook
await page.evaluate(() => {
  const sel = document.querySelector('#accProvider');
  const opt = [...sel.options].find((o) => /outlook/i.test(o.textContent));
  sel.value = opt.value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
});
await wait(500);

const info = await page.evaluate(() => ({
  msBlockHidden: document.getElementById('msBlock')?.hidden,
  googleBlockHidden: document.getElementById('googleBlock')?.hidden,
  passFieldHidden: document.getElementById('passField')?.hidden,
  loginBtnText: document.getElementById('msLoginBtn')?.textContent,
  configOpen: document.getElementById('msConfigDetails')?.open,
  tutorialSteps: document.querySelectorAll('#msBlock .google-help ol li').length,
  tutorialHasAzure: /应用注册/.test(document.getElementById('msBlock')?.textContent || ''),
  imapHost: document.getElementById('imapHost')?.value,
  smtpHost: document.getElementById('smtpHost')?.value,
}));

await page.evaluate(() => {
  const cfg = document.getElementById('msConfigDetails');
  if (cfg) cfg.open = true;
  const help = document.querySelector('#msBlock .google-help');
  if (help) help.open = true;
});
await wait(300);
await page.screenshot({ path: 'shots/outlook-modal.png', fullPage: false });
await page.evaluate(() => {
  const help = document.querySelector('#msBlock .google-help');
  if (help) help.scrollIntoView({ block: 'start' });
});
await wait(300);
await page.screenshot({ path: 'shots/outlook-help.png', fullPage: false });

// 切回 163 看区块是否消失
await page.evaluate(() => {
  const sel = document.querySelector('#accProvider');
  const opt = [...sel.options].find((o) => /163/.test(o.textContent));
  sel.value = opt.value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
});
await wait(400);
const after = await page.evaluate(() => ({
  msBlockHidden: document.getElementById('msBlock')?.hidden,
  passFieldHidden: document.getElementById('passField')?.hidden,
  imapHost: document.getElementById('imapHost')?.value,
}));

console.log('Outlook 选中:', JSON.stringify(info, null, 1));
console.log('切回 163:', JSON.stringify(after));
console.log('页面 JS 错误:', errors.length ? errors.join(' | ') : '无');

await browser.close();
demo.kill();
const ok =
  info.msBlockHidden === false &&
  info.googleBlockHidden === true &&
  info.passFieldHidden === true &&
  info.tutorialSteps >= 8 &&
  info.tutorialHasAzure === true &&
  info.imapHost === 'outlook.office365.com' &&
  after.msBlockHidden === true &&
  after.passFieldHidden === false &&
  errors.length === 0;
console.log(ok ? '✅ 全部通过' : '❌ 有断言失败');
process.exit(ok ? 0 : 1);
