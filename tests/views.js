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
  const wait = ms => page.waitForTimeout(ms);
  await page.goto(BASE);
  await page.waitForSelector('.row');

  await page.tap('#fab');
  await wait(400);
  const box = await page.evaluate(() => {
    const s = document.querySelector('#sheet');
    const lines = [...s.querySelectorAll('.chip-line .chips')].map(c => ({ wrap: getComputedStyle(c).flexWrap, overflow: c.scrollWidth > c.clientWidth, h: c.getBoundingClientRect().height }));
    return { h: s.getBoundingClientRect().height, lines, add: !!s.querySelector('.new-head .add-btn') };
  });
  check('new task sheet compact (<= 360px)', box.h <= 360, `h=${Math.round(box.h)}`);
  check('chip lines single row, horizontally scrollable', box.lines.length === 2 && box.lines.every(l => l.wrap === 'nowrap' && l.h <= 44) && box.lines[0].overflow, JSON.stringify(box.lines));
  check('add button in header', box.add);
  await page.screenshot({ path: `${OUT}/c1-new.png` });
  await page.$eval('#sheet .chip-line .chips', c => { c.scrollLeft = 400; });
  await page.tap('#sheet .chip-line .chip:has-text("Альфа")');
  await page.keyboard.type('Компактная задача');
  await page.tap('#sheet .add-btn');
  await wait(1000);
  const placed = (await page.evaluate(() => window.__calls)).find(c => c.q.includes('j:updateProjectV2ItemFieldValue') && c.variables.setProj);
  check('create from compact sheet sets chosen project', placed && placed.variables.po === 'E2' && placed.variables.pf === 'PF', JSON.stringify(placed?.variables));
  await page.tap('#sheetWrap', { position: { x: 30, y: 30 } });
  await wait(300);

  await page.tap('#groupBtn');
  await wait(300);
  await page.screenshot({ path: `${OUT}/c2-view.png` });
  await page.tap('#sheet .list-row:has-text("Вкладки — проекты")');
  await wait(300);
  const tabs = await page.$$eval('.tab', ts => ts.map(t => t.textContent));
  check('epic view: tabs are epics', tabs.some(t => t.startsWith('Дом')) && tabs.some(t => t.startsWith('Без проекта')), tabs.join(' | '));
  await page.tap('.tab:has-text("Дом")');
  await wait(300);
  const sec = await page.$$eval('.group', gs => gs.map(g => [g.querySelector('.gt').textContent, g.classList.contains('collapsed'), g.querySelectorAll('.rtt').length]));
  check('epic view: sections by status, Done collapsed', sec.some(([n, c, k]) => n === 'ToDo' && !c && k === 13) && sec.some(([n, c]) => n === 'Done' && c), JSON.stringify(sec));
  check('epic bar counts', (await page.textContent('.epic-bar')).includes('13 открыто · 2 готово'), await page.textContent('.epic-bar'));
  await page.screenshot({ path: `${OUT}/c3-epicview.png` });
  await page.tap('.group:has(.gt:text-is("Done")) .gh-toggle');
  await wait(200);
  check('expand Done shows done tasks', (await page.$$eval('.rtt', r => r.map(x => x.textContent))).includes('Купить фильтры на воду'));

  await page.tap('#fab');
  await wait(300);
  check('new task in epic view defaults to current epic', (await page.textContent('#sheet .chip-line:first-child .chip.active').catch(() => null)) === 'Дом' || (await page.$eval('#sheet .chip-line .chip.active', c => c.textContent)) === 'Дом');
  await page.tap('#sheetWrap', { position: { x: 30, y: 30 } });
  await wait(300);

  await page.tap('.tab:has-text("Альфа")');
  await wait(300);
  check('switch epic tab', (await page.$$eval('.rtt', r => r.map(x => x.textContent))).includes('Собрать прототип'));
  check('view persisted', await page.evaluate(() => localStorage.getItem('pb.view') === '"epic"'));

  await page.tap('#groupBtn'); await wait(300);
  await page.tap('#sheet .list-row:has-text("с проектами")'); await wait(300);
  await page.tap('.tab:has-text("ToDo")'); await wait(300);
  await page.tap('.group:has(.gt:text-is("Проект Альфа")) .gh-more'); await wait(300);
  await page.tap('#sheet button:has-text("Показать все задачи списком")'); await wait(300);
  const t2 = await page.$eval('.tab.active', t => t.textContent);
  check('epic sheet → "show all as list" opens epic view on that epic', t2.startsWith("Проект Альфа"), t2);

  check('no page errors', errors.length === 0, errors.join('; '));
  console.log(results.join('\n'));
  await browser.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.log(results.join('\n')); console.error(e); process.exit(1); });
