// 界面自测截图脚本（仅开发用）
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
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle2' });
await page.waitForSelector('.msg-item');
await wait(500);
await page.screenshot({ path: `${OUT}/01-list.png` });

/* 阅读 */
await page.click('.msg-item');
await page.waitForSelector('.reader-subject');
await wait(800);
await page.screenshot({ path: `${OUT}/02-reader.png` });

/* 写邮件：富文本 */
await page.click('#composeBtn');
await wait(300);
await page.type('#composeTo', 'zhou');
await page.waitForSelector('.addr-item', { timeout: 5000 });
await wait(300);
await page.screenshot({ path: `${OUT}/03-contacts.png` });
const suggestions = await page.$$eval('.addr-item .ad', (n) => n.map((x) => x.textContent));
await page.click('.addr-item');

await page.click('#composeSubject');
await page.type('#composeSubject', '关于 Q4 路线图的几点补充');
await page.click('#composeEditor');
await page.type('#composeEditor', '周砚你好，');
await page.click('[data-cmd="bold"]');
await page.type('#composeEditor', '第二段加粗说明');
await page.click('[data-cmd="bold"]');
await page.type('#composeEditor', '，其余正常。');
await page.click('[data-cmd="insertUnorderedList"]');
await page.type('#composeEditor', '要点一');
await page.keyboard.press('Enter');
await page.type('#composeEditor', '要点二');
await wait(300);
await page.screenshot({ path: `${OUT}/04-compose.png` });
const editorHtml = await page.$eval('#composeEditor', (e) => e.innerHTML);
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

/* 回复：引用块 */
await page.click('#replyBtn');
await wait(400);
const replyHtml = await page.$eval('#composeEditor', (e) => e.innerHTML);
await page.screenshot({ path: `${OUT}/05-reply.png` });
await page.keyboard.press('Escape');

/* 账号编辑 + 诊断 */
await page.hover('.account-item');
await wait(200);
await page.click('[data-edit]');
await wait(400);
await page.screenshot({ path: `${OUT}/06-account-edit.png` });
await page.click('#diagBtn');
await wait(900);
const diagText = await page.$eval('#diagOut', (n) => n.textContent);
await page.screenshot({ path: `${OUT}/07-diagnose.png` });
await page.keyboard.press('Escape');

/* 窄屏 */
await page.setViewport({ width: 900, height: 820 });
await wait(400);
await page.screenshot({ path: `${OUT}/08-narrow.png` });

console.log(errors.length ? 'JS 错误:\n' + errors.join('\n') : '✅ 页面无 JS 报错');
console.log('联系人候选:', suggestions.join(' | '));
console.log('编辑器 HTML:', editorHtml.replace(/\n/g, '').slice(0, 260));
console.log('回复引用:', replyHtml.replace(/\n/g, '').slice(0, 200));
console.log('诊断输出:\n' + diagText);
await browser.close();
