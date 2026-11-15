const { chromium, devices } = require('playwright-core');
const OUT = process.env.OUT || require('path').join(__dirname, 'out');
const BASE = process.env.BASE || 'http://localhost:8787/';
const results = [];
const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);

(async () => {
  const browser = await chromium.launch();
  for (const scheme of ['dark', 'light']) {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], colorScheme: scheme });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    const wait = ms => page.waitForTimeout(ms);
    const shot = name => page.screenshot({ path: `${OUT}/p-${scheme}-${name}.png` });
    const doneCount = () => page.$eval('.tab[data-id="o5"] .n', e => +e.textContent);
    const closeSheet = () => page.evaluate(() => closeSheet());

    await page.goto(BASE);
    await page.waitForSelector('.row');
    await shot('list');
    if (scheme === 'dark') {
      check('first row emphasized', await page.$eval('#list .row', r => r.classList.contains('first') && getComputedStyle(r.querySelector('.rtt')).fontWeight === '600'));
      check('body preview shown instead of marker', await page.$$eval('.row .rb', r => r.some(x => x.textContent === 'детали')));
      check('header has no glyph icons, 3 svg buttons', await page.$$eval('.title-row .icon-btn', bs => bs.length === 3 && bs.every(b => b.querySelector('svg'))));
      check('group header has epic swatch', !!(await page.$('.group-head .swatch')));
      const targets = await page.$$eval('.gh-more, .icon-btn', es => es.map(e => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); }));
      check('header and ⋯ targets ≥ 44px', targets.every(x => x >= 44), targets.join(','));
    }

    await page.tap('.row:has-text("Собрать отчёт")');
    await wait(400);
    await shot('task');
    check(`${scheme}: task sheet has Закрыть, no Готово`, !!(await page.$('#sheet .link-btn:text-is("Закрыть")')) && !(await page.$('#sheet button:text-is("Готово")')));
    const qa = await page.$$eval('#sheet .qa', b => b.map(x => x.textContent));
    check(`${scheme}: quick actions Выполнено / Pause / Backlog`, qa.join('|') === 'Выполнено|Pause|Backlog', qa.join('|'));
    const lines = await page.$$eval('#sheet .chip-line .chips', cs => cs.map(c => ({ wrap: getComputedStyle(c).flexWrap, h: c.getBoundingClientRect().height })));
    check(`${scheme}: task sheet status and epic chips each on one scrollable line`, lines.length === 2 && lines.every(l => l.wrap === 'nowrap' && l.h <= 44), JSON.stringify(lines));
    check(`${scheme}: sheet is a labelled dialog`, await page.$eval('#sheet', s => s.getAttribute('role') === 'dialog' && s.getAttribute('aria-modal') === 'true'));
    const before = await doneCount();
    await page.tap('#sheet .qa.primary');
    await wait(500);
    check(`${scheme}: Выполнено closes sheet and moves to Done`, !(await page.$('#sheetWrap.open')) && (await doneCount()) === before + 1);
    const toast = await page.evaluate(() => { const t = document.getElementById('toast'); const r = t.getBoundingClientRect(); const b = t.querySelector('button').getBoundingClientRect(); return { top: r.top, h: innerHeight, btn: b.height, live: t.getAttribute('aria-live'), text: t.textContent }; });
    check(`${scheme}: undo toast at bottom with 44px action`, toast.top > toast.h / 2 && toast.btn >= 44 && toast.live === 'polite', JSON.stringify(toast));
    await shot('toast');
    await page.tap('#toast button');
    await wait(400);
    check(`${scheme}: undo from toast restores`, (await doneCount()) === before);

    await page.tap('.row:has-text("Помыть окна")');
    await wait(400);
    await page.tap('#sheet .qa:has-text("Pause")');
    await wait(500);
    check(`${scheme}: quick Pause moves task`, (await page.$eval('.tab[data-id="o3"] .n', e => +e.textContent)) === 1);

    await page.tap('#fab');
    await wait(400);
    await shot('new');
    check(`${scheme}: active chip uses accessible fill`, await page.$eval('#sheet .chip.active', c => { const bg = getComputedStyle(c).backgroundColor; return bg === 'rgb(31, 111, 235)' || bg === 'rgb(9, 105, 218)'; }));
    check(`${scheme}: chips expose aria-pressed`, await page.$$eval('#sheet .chip', cs => cs.every(c => c.hasAttribute('aria-pressed'))));
    await closeSheet();
    await wait(300);

    await page.tap('#settingsBtn');
    await wait(400);
    await shot('settings');
    await closeSheet();
    await wait(300);
    await page.tap('#searchBtn');
    await wait(300);
    await page.keyboard.type('купить');
    await wait(300);
    await shot('search');
    await closeSheet();
    await wait(300);
    await page.tap('.tab[data-id="o4"]');
    await wait(300);
    await shot('empty');
    check(`${scheme}: empty state names the tab`, /В «In progress» пусто/.test(await page.textContent('.empty')));

    check(`${scheme}: no page errors`, errors.length === 0, errors.join('; '));
    await ctx.close();
  }

  const ctx = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await ctx.newPage();
  await page.goto(BASE + '?coach');
  await page.waitForSelector('.row');
  await page.waitForTimeout(1000);
  const peek = await page.$eval('#list .row', r => r.style.transform);
  check('first-run coach slides first row', /translateX\(-96px\)/.test(peek), peek);
  await page.waitForTimeout(2600);
  check('coach shows gesture hint', /Свайп влево/.test(await page.textContent('#toast')));
  check('coach shown once', await page.evaluate(() => localStorage.getItem('pb.coachSeen') === 'true'));

  console.log(results.join('\n'));
  await browser.close();
  process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
})().catch(e => { console.log(results.join('\n')); console.error(e); process.exit(1); });
