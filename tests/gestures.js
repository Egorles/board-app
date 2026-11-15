const { chromium, devices } = require('playwright-core');
const OUT = process.env.OUT || require('path').join(__dirname, 'out');
const BASE = process.env.BASE || BASE;
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 13'], colorScheme: 'dark' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  const cdp = await ctx.newCDPSession(page);
  const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const drag = async (x1, y1, x2, y2, steps = 12, ms = 16) => {
    await touch('touchStart', x1, y1);
    for (let i = 1; i <= steps; i++) { await touch('touchMove', x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps); await page.waitForTimeout(ms); }
    await touch('touchEnd');
  };
  const box = async sel => (await page.locator(sel).first().boundingBox());
  const rowTitles = () => page.$$eval('.group', gs => gs.map(g => [g.querySelector('.gt').textContent, [...g.querySelectorAll('.rtt')].map(r => r.textContent)]));
  const tabCount = name => page.$eval(`.tab:has-text("${name}") .n`, e => +e.textContent).catch(() => page.evaluate(n => +[...document.querySelectorAll('.tab')].find(t => t.textContent.startsWith(n)).querySelector('.n').textContent, name));

  await page.goto(BASE);
  await page.waitForSelector('.row');
  await page.screenshot({ path: `${OUT}/g0-list.png` });

  const doneBefore = await tabCount('Done');
  let b = await box('.row:has-text("Записаться к стоматологу")');
  await drag(b.x + b.width - 30, b.y + b.height / 2, b.x + 40, b.y + b.height / 2);
  await page.waitForTimeout(500);
  const doneAfter = await tabCount('Done');
  check('swipe left → Done', doneAfter === doneBefore + 1, `${doneBefore}→${doneAfter}`);
  const toastText = await page.textContent('#toast');
  check('undo toast shown', /Отменить/.test(toastText), toastText);
  await page.screenshot({ path: `${OUT}/g1-swipe-done.png` });
  await page.click('#toast button');
  await page.waitForTimeout(400);
  check('undo restores', (await tabCount('Done')) === doneBefore);

  await page.locator('.row:has-text("Почистить телефон")').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  b = await box('.row:has-text("Почистить телефон")');
  await drag(b.x + 30, b.y + b.height / 2, b.x + b.width - 40, b.y + b.height / 2);
  await page.waitForTimeout(400);
  const first = (await rowTitles())[0][1][0];
  check('swipe right → top', first === 'Почистить телефон', first);

  b = await box('.row:has-text("Собрать отчёт")');
  await drag(b.x + 100, b.y + b.height / 2, b.x + 104, b.y + b.height / 2 - 200, 10);
  await page.waitForTimeout(300);
  check('vertical drag on row does not open sheet', !(await page.$('#sheetWrap.open')));

  await page.tap('.row:has-text("Собрать отчёт")');
  await page.waitForTimeout(400);
  check('tap opens sheet', !!(await page.$('#sheetWrap.open')));
  check('page scroll locked', await page.evaluate(() => document.documentElement.classList.contains('locked')));
  await page.screenshot({ path: `${OUT}/g2-sheet.png` });
  b = await box('#sheet .grab');
  await drag(b.x + b.width / 2, b.y + 10, b.x + b.width / 2, b.y + 360, 12, 20);
  await page.waitForTimeout(450);
  check('drag down closes sheet', !(await page.$('#sheetWrap.open')));

  await page.tap('.row:has-text("Собрать отчёт")');
  await page.waitForTimeout(400);
  b = await box('#sheet .grab');
  await drag(b.x + b.width / 2, b.y + 10, b.x + b.width / 2, b.y + 60, 6, 20);
  await page.waitForTimeout(450);
  check('small drag keeps sheet open', !!(await page.$('#sheetWrap.open')));
  await page.tap('#sheet button:has-text("Закрыть")');
  await page.waitForTimeout(400);

  await page.evaluate(() => window.scrollTo(0, 0));
  const callsBefore = await page.evaluate(() => window.__calls.length);
  await drag(195, 300, 195, 520, 14, 20);
  await page.waitForTimeout(1500);
  const callsAfter = await page.evaluate(() => window.__calls.length);
  check('pull to refresh reloads', callsAfter > callsBefore, `${callsBefore}→${callsAfter}`);

  await page.tap('#fab');
  await page.waitForTimeout(400);
  check('new sheet focuses title', await page.evaluate(() => document.activeElement?.classList.contains('new-title')));
  await page.keyboard.type('Тестовая задача');
  await page.tap('#sheet .chip:has-text("Проект Бета")');
  check('chip tap keeps focus', await page.evaluate(() => document.activeElement?.classList.contains('new-title')));
  await page.tap('#sheet button:has-text("Добавить")');
  await page.waitForTimeout(900);
  check('add keeps focus for next', await page.evaluate(() => document.activeElement?.classList.contains('new-title')));
  await page.screenshot({ path: `${OUT}/g3-new.png` });
  await page.tap('#sheetWrap', { position: { x: 30, y: 30 } });
  await page.waitForTimeout(400);
  const groups = await rowTitles();
  check('new task in Проект Бета group', groups.some(([g, r]) => g === 'Проект Бета' && r.includes('Тестовая задача')), JSON.stringify(groups.map(g => g[0])));

  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(200);
  const sticky = await page.evaluate(() => { const hd = document.querySelector('.group-head'); const top = document.getElementById('top').getBoundingClientRect().bottom; return Math.abs(hd.getBoundingClientRect().top - top) < 2 || hd.getBoundingClientRect().top > top; });
  check('group header sticky below top bar', sticky);
  await page.screenshot({ path: `${OUT}/g4-scrolled.png` });

  await page.tap('.tab:has-text("Done")');
  await page.waitForTimeout(300);
  b = await box('.row');
  const doneN = await tabCount('Done');
  await drag(b.x + b.width - 30, b.y + b.height / 2, b.x + 40, b.y + b.height / 2);
  await page.waitForTimeout(500);
  check('swipe left in Done → back to ToDo', (await tabCount('Done')) === doneN - 1);


  await page.tap('.tab:has-text("ToDo")');
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, 0));
  const longDrag = async (fromSel, dyRows) => {
    await page.locator(fromSel).scrollIntoViewIfNeeded();
    const bb = await box(fromSel);
    const x = bb.x + bb.width / 2, y = bb.y + bb.height / 2;
    await touch('touchStart', x, y);
    await page.waitForTimeout(480);
    const lifted = await page.evaluate(() => !!document.querySelector('.swipe.lifted'));
    const steps = 14;
    for (let i = 1; i <= steps; i++) { await touch('touchMove', x, y + dyRows * bb.height * i / steps); await page.waitForTimeout(20); }
    await page.waitForTimeout(150);
    await touch('touchEnd');
    await page.waitForTimeout(500);
    return lifted;
  };
  let before = (await rowTitles())[0][1];
  const callsN = await page.evaluate(() => window.__calls.length);
  const lifted = await longDrag('.row:has-text("Записаться к стоматологу")', 3.2);
  let afterOrder = (await rowTitles())[0][1];
  check('long press lifts row', lifted);
  const iFrom = before.indexOf('Записаться к стоматологу'), iTo = afterOrder.indexOf('Записаться к стоматологу');
  check('drag down 2 rows reorders', iTo === iFrom + 2, `${iFrom}→${iTo}: ${afterOrder.slice(0, 5).join(' | ')}`);
  const posCall = await page.evaluate(n => window.__calls.slice(n).find(c => c.q.includes('updateProjectV2ItemPosition')), callsN);
  check('drag sends position mutation', !!posCall, JSON.stringify(posCall?.variables));
  check('drag does not open sheet', !(await page.$('#sheetWrap.open')));

  await page.tap('#groupBtn');
  await page.waitForTimeout(300);
  await page.tap('#sheet .list-row:has-text("общим списком")');
  await page.waitForTimeout(300);
  const flat = await page.evaluate(() => ({ groups: document.querySelectorAll('.group-head').length, labels: [...document.querySelectorAll('.re')].map(e => e.textContent), rows: [...document.querySelectorAll('.rtt')].map(e => e.textContent) }));
  check('grouping off: no group headers', flat.groups === 0);
  check('grouping off: epic labels on rows', flat.labels.includes('Проект Альфа'));
  check('grouping persisted', await page.evaluate(() => localStorage.getItem('pb.grouped') === 'false'));
  const protoIdx = flat.rows.indexOf('Собрать прототип');
  await longDrag('.row:has-text("Собрать прототип")', -(protoIdx + 0.6));
  const flatAfter = await page.$$eval('.rtt', r => r.map(x => x.textContent));
  check('flat drag to very top (cross-epic priority)', flatAfter[0] === 'Собрать прототип', flatAfter.slice(0, 3).join(' | '));
  const posCall2 = await page.evaluate(() => window.__calls.filter(c => c.q.includes('updateProjectV2ItemPosition')).at(-1));
  check('top position uses no afterId', posCall2 && posCall2.variables.a === null, JSON.stringify(posCall2?.variables));
  await page.screenshot({ path: `${OUT}/g5-flat.png` });
  await page.tap('#groupBtn');
  await page.waitForTimeout(300);
  await page.tap('#sheet .list-row:has-text("с эпиками")');
  await page.waitForTimeout(300);
  check('grouping back on', (await page.$$('.group-head')).length > 0);

  check('no page errors', errors.length === 0, errors.join('; '));
  console.log(results.join('\n'));
  await browser.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.error(results.join('\n')); console.error(e); process.exit(1); });
