const { chromium, devices } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8787/';
const FLAG = path.join(__dirname, 'out', 'sw-version.txt');
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

(async () => {
  fs.mkdirSync(path.dirname(FLAG), { recursive: true });
  fs.writeFileSync(FLAG, '100');
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const wait = ms => page.waitForTimeout(ms);
    const triggerCheck = () => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.goto(BASE);
    await page.waitForSelector('.row');
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
    check('service worker controls the app', true);
    await page.evaluate(() => { window.__marker = 1; });
    fs.writeFileSync(FLAG, '101');
    await triggerCheck();
    await page.waitForFunction(() => !window.__marker && document.querySelector('.row'), null, { timeout: 15000 }).catch(() => {});
    check('new release reloads the app by itself', await page.evaluate(() => !window.__marker));
    await page.waitForFunction(() => /обновлено/.test(document.getElementById('toast').textContent), null, { timeout: 5000 }).catch(() => {});
    const t = await page.textContent('#toast');
    check('toast says app was updated to new version', /обновлено до версии 101/.test(t), t);
    await page.tap('#settingsBtn');
    await wait(300);
    check('settings show current version', (await page.textContent('#sheet .app-version')) === 'Версия 101');
    await page.evaluate(() => closeSheet());
    await wait(800);

    await page.evaluate(() => { window.__marker = 2; });
    await page.tap('#fab');
    await wait(300);
    await page.keyboard.type('Недописанная задача');
    fs.writeFileSync(FLAG, '102');
    await triggerCheck();
    await wait(3000);
    check('update waits while typing in an open sheet', await page.evaluate(() => window.__marker === 2 && document.querySelector('.new-title').value === 'Недописанная задача'));
    await page.evaluate(() => closeSheet());
    await page.waitForFunction(() => !window.__marker, null, { timeout: 15000 }).catch(() => {});
    check('update applies right after the sheet closes', await page.evaluate(() => !window.__marker));
    await page.waitForSelector('.row');
    await page.evaluate(() => {
      window.__marker = 3;
      const realFetch = window.fetch;
      window.fetch = async (url, opts) => { if (String(url).includes('graphql') && opts.body.includes('createIssue')) await new Promise(r => setTimeout(r, 4000)); return realFetch(url, opts); };
    });
    await page.tap('#fab');
    await wait(300);
    await page.keyboard.type('Задача в полёте');
    await page.tap('#sheet label.toggle:has-text("Закрыть после")');
    await page.tap('#sheet .add-btn');
    await wait(200);
    fs.writeFileSync(FLAG, '103');
    await triggerCheck();
    await wait(2000);
    check('update waits while a change is being sent to GitHub', await page.evaluate(() => window.__marker === 3));
    await page.waitForFunction(() => !window.__marker, null, { timeout: 20000 }).catch(() => {});
    check('update applies after the change is saved', await page.evaluate(() => !window.__marker && JSON.parse(localStorage.getItem('pb.queue') || '[]').length === 0));
    check('no page errors', errors.length === 0, errors.join('; '));
  } finally {
    fs.rmSync(FLAG, { force: true });
    console.log(results.join('\n'));
    await browser.close();
  }
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { fs.rmSync(FLAG, { force: true }); console.log(results.join('\n')); console.error(e); process.exit(1); });
