const API = 'https://api.github.com/graphql';
const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo,project&description=Board%20PWA';
const LS = { token: 'pb.token', project: 'pb.project', cache: 'pb.cache', tab: 'pb.tab', collapsed: 'pb.collapsed', lastEpic: 'pb.lastEpic', grouped: 'pb.grouped', closeAfterAdd: 'pb.closeAfterAdd' };
const OPTION_COLORS = { GRAY: '#8b949e', BLUE: '#2f81f7', GREEN: '#2ea043', YELLOW: '#d29922', ORANGE: '#db6d28', RED: '#f85149', PINK: '#db61a2', PURPLE: '#a371f7' };
const NO_EPIC = 'none';
const NO_STATUS = '__none';
const COLOR_ORDER = Object.keys(OPTION_COLORS);
const SWIPE_TRIGGER = 88;
const PULL_TRIGGER = 70;
const LONG_PRESS_MS = 380;

const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

let token = store.get(LS.token);
let project = store.get(LS.project);
let data = store.get(LS.cache);
let tab = store.get(LS.tab);
let collapsed = new Set(store.get(LS.collapsed, []));
let grouped = store.get(LS.grouped, true);
let drag = null;
const pendingCreates = new Set();
let loading = false;
let lastLoad = 0;
let renderedTab = null;
let sheetOnClose = null;

const $ = (s, r = document) => r.querySelector(s);
const root = document.documentElement;

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}

async function gql(query, variables = {}) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (r.status === 401) throw new Error('GitHub не принял токен (401)');
  if (!r.ok) throw new Error(`GitHub ответил ${r.status}`);
  const j = await r.json();
  if (j.errors?.length) throw new Error(j.errors.map(e => e.message).join('; '));
  return j.data;
}

const ITEMS_Q = `query($id:ID!,$after:String){node(id:$id){... on ProjectV2{title
  field(name:"Status"){... on ProjectV2SingleSelectField{id options{id name color description}}}
  repositories(first:1){nodes{id}}
  items(first:100,after:$after){pageInfo{hasNextPage endCursor}
    nodes{id isArchived
      fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{optionId}}
      content{__typename ... on Issue{id number title body state url parent{id number title}}}}}}}}`;

const EPICS_Q = `query($id:ID!){node(id:$id){... on Repository{label(name:"epic"){id}
  issues(first:100,labels:["epic"],states:[OPEN],orderBy:{field:CREATED_AT,direction:ASC}){nodes{id number title url}}}}}`;

const M = {
  status: `mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){clientMutationId}}`,
  close: `mutation($i:ID!,$r:IssueClosedStateReason){closeIssue(input:{issueId:$i,stateReason:$r}){clientMutationId}}`,
  reopen: `mutation($i:ID!){reopenIssue(input:{issueId:$i}){clientMutationId}}`,
  text: `mutation($i:ID!,$t:String!,$b:String!){updateIssue(input:{id:$i,title:$t,body:$b}){clientMutationId}}`,
  setParent: `mutation($p:ID!,$s:ID!){addSubIssue(input:{issueId:$p,subIssueId:$s,replaceParent:true}){clientMutationId}}`,
  unsetParent: `mutation($p:ID!,$s:ID!){removeSubIssue(input:{issueId:$p,subIssueId:$s}){clientMutationId}}`,
  position: `mutation($p:ID!,$i:ID!,$a:ID){updateProjectV2ItemPosition(input:{projectId:$p,itemId:$i,afterId:$a}){clientMutationId}}`,
  create: `mutation($r:ID!,$t:String!,$b:String,$par:ID,$p:ID!){createIssue(input:{repositoryId:$r,title:$t,body:$b,parentIssueId:$par,projectV2Ids:[$p]}){issue{id number url projectItems(first:10){nodes{id project{id}}}}}}`,
  createEpic: `mutation($r:ID!,$t:String!,$l:[ID!]){createIssue(input:{repositoryId:$r,title:$t,labelIds:$l}){issue{id number title url}}}`,
  createLabel: `mutation($r:ID!){createLabel(input:{repositoryId:$r,name:"epic",color:"8250df",description:"Эпик / проект"}){label{id}}}`,
  rename: `mutation($i:ID!,$t:String!){updateIssue(input:{id:$i,title:$t}){clientMutationId}}`,
  statuses: `mutation($f:ID!,$o:[ProjectV2SingleSelectFieldOptionInput!]){updateProjectV2Field(input:{fieldId:$f,singleSelectOptions:$o}){projectV2Field{... on ProjectV2SingleSelectField{options{id name color description}}}}}`,
  addItem: `mutation($p:ID!,$c:ID!){addProjectV2ItemById(input:{projectId:$p,contentId:$c}){item{id}}}`,
  placeNew: `mutation($p:ID!,$i:ID!,$f:ID!,$o:String!,$top:Boolean!){
    s:updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){clientMutationId}
    t:updateProjectV2ItemPosition(input:{projectId:$p,itemId:$i}) @include(if:$top){clientMutationId}}`,
  remove: `mutation($p:ID!,$i:ID!,$c:ID!){deleteProjectV2Item(input:{projectId:$p,itemId:$i}){deletedItemId}
    closeIssue(input:{issueId:$c,stateReason:NOT_PLANNED}){clientMutationId}}`,
};

async function load() {
  if (loading || !token || !project) return;
  loading = true;
  $('#refreshBtn').classList.add('busy');
  try {
    let after = null, meta = null;
    const items = [];
    do {
      const p = (await gql(ITEMS_Q, { id: project.id, after })).node;
      meta ||= p;
      for (const n of p.items.nodes) {
        const c = n.content;
        if (n.isArchived || c?.__typename !== 'Issue') continue;
        items.push({
          itemId: n.id, id: c.id, number: c.number, title: c.title, body: c.body || '', state: c.state, url: c.url,
          status: n.fieldValueByName?.optionId ?? null,
          parent: c.parent ? { id: c.parent.id, number: c.parent.number, title: c.parent.title } : null,
        });
      }
      after = p.items.pageInfo.hasNextPage ? p.items.pageInfo.endCursor : null;
    } while (after);
    const repoId = meta.repositories.nodes[0]?.id ?? null;
    const repo = repoId ? (await gql(EPICS_Q, { id: repoId })).node : null;
    const epics = repo ? repo.issues.nodes : [];
    const epicIds = new Set(epics.map(e => e.id));
    for (const it of items) if (it.parent && !epicIds.has(it.parent.id)) { epics.push(it.parent); epicIds.add(it.parent.id); }
    const loaded = items.filter(i => !epicIds.has(i.id));
    for (const temp of pendingCreates) {
      if (temp.id && loaded.some(x => x.id === temp.id)) continue;
      temp.top ? loaded.unshift(temp) : loaded.push(temp);
    }
    data = { title: meta.title, fieldId: meta.field.id, statuses: meta.field.options, repoId, epicLabelId: repo?.label?.id ?? null, epics, items: loaded };
    lastLoad = Date.now();
    persistRender();
  } catch (e) {
    toast(e.message);
  } finally {
    loading = false;
    $('#refreshBtn').classList.remove('busy');
  }
}

function persist() { if (data) store.set(LS.cache, data); }
function persistRender() { persist(); render(); }
const optionColor = c => OPTION_COLORS[c] || OPTION_COLORS.GRAY;
const doneStatus = () => data.statuses.find(s => /^done$/i.test(s.name)) || data.statuses.at(-1);
const statusName = id => data.statuses.find(s => s.id === id)?.name ?? '';
const statusKey = it => (it.status && data.statuses.some(s => s.id === it.status)) ? it.status : NO_STATUS;
const defaultStatusId = () => (data.statuses.find(s => /^to\s*do$/i.test(s.name)) || data.statuses[0])?.id ?? NO_STATUS;
const epicKey = it => it.parent?.id ?? NO_EPIC;

function syncHeaderHeight() { root.style.setProperty('--hdr', $('#top').offsetHeight + 'px'); }

function render() {
  if (!token || !project) return renderConnect();
  $('#fab').hidden = false;
  if (!data) { $('#tabs').replaceChildren(); $('#list').replaceChildren(h('div', { class: 'empty', text: 'Загрузка…' })); syncHeaderHeight(); return; }
  $('#title').textContent = data.title;
  document.title = data.title;
  const counts = {};
  for (const it of data.items) { const k = statusKey(it); counts[k] = (counts[k] || 0) + 1; }
  const tabList = [...(counts[NO_STATUS] ? [{ id: NO_STATUS, name: 'Без статуса', color: null }] : []), ...data.statuses];
  if (!tabList.some(s => s.id === tab)) tab = defaultStatusId();
  const tabsEl = $('#tabs');
  const scrollLeft = tabsEl.scrollLeft;
  tabsEl.replaceChildren(...tabList.map(s => h('button', {
    class: 'tab' + (s.id === tab ? ' active' : '') + (s.id === NO_STATUS ? ' no-status' : ''), style: `--c:${s.color ? optionColor(s.color) : 'transparent'}`,
    onclick: () => selectTab(s.id),
  }, h('span', { class: 'dot' }), s.name, h('span', { class: 'n', text: counts[s.id] || 0 }))));
  tabsEl.scrollLeft = scrollLeft;
  if (renderedTab !== tab) {
    const active = $('.tab.active');
    if (active) tabsEl.scrollTo({ left: active.offsetLeft - (tabsEl.clientWidth - active.offsetWidth) / 2, behavior: renderedTab ? 'smooth' : 'auto' });
    renderedTab = tab;
  }

  const groupBtn = $('#groupBtn');
  groupBtn.hidden = false;
  groupBtn.textContent = grouped ? '⊞' : '☰';
  groupBtn.classList.toggle('off', !grouped);
  groupBtn.setAttribute('aria-label', grouped ? 'Выключить группировку по эпикам' : 'Включить группировку по эпикам');

  const inTab = data.items.filter(i => statusKey(i) === tab);
  let sections;
  if (grouped) {
    const groups = [...data.epics.map(e => ({ key: e.id, title: e.title })), { key: NO_EPIC, title: 'Без эпика' }];
    sections = groups.map(g => {
      const its = inTab.filter(i => epicKey(i) === g.key);
      if (!its.length) return null;
      const isCollapsed = collapsed.has(g.key);
      const epic = data.epics.find(e => e.id === g.key);
      return h('section', { class: 'group' + (isCollapsed ? ' collapsed' : '') },
        h('div', { class: 'group-head' },
          h('button', { class: 'gh-toggle', onclick: () => toggleGroup(g.key) },
            h('span', { class: 'chev', text: '›' }), h('span', { class: 'gt', text: g.title }), h('span', { class: 'n', text: its.length })),
          epic ? h('button', { class: 'gh-more', 'aria-label': 'Эпик: редактировать', onclick: () => openEpic(epic) }, '⋯') : null),
        isCollapsed ? null : h('div', { class: 'rows' }, its.map(it => rowEl(it, false))));
    }).filter(Boolean);
  } else {
    sections = inTab.length ? [h('section', { class: 'group flat' }, h('div', { class: 'rows' }, inTab.map(it => rowEl(it, true))))] : [];
  }
  $('#list').replaceChildren(...(sections.length ? sections : [h('div', { class: 'empty', text: 'Здесь пусто' })]));
  syncHeaderHeight();
}

function toggleGrouping() {
  grouped = !grouped;
  store.set(LS.grouped, grouped);
  render();
  toast(grouped ? 'Группировка по эпикам включена' : 'Общий список без эпиков');
}

function selectTab(id) {
  if (id === tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  tab = id;
  store.set(LS.tab, tab);
  render();
  window.scrollTo({ top: 0 });
}

function rowEl(it, showEpic) {
  const isDone = doneStatus()?.id === it.status;
  const row = h('button', { class: 'row' + (it.pending ? ' pending' : '') },
    h('span', { class: 'rt' }, h('span', { class: 'rtt', text: it.title }), showEpic && it.parent ? h('span', { class: 're', text: it.parent.title }) : null),
    it.body.trim() ? h('span', { class: 'has', text: '≡' }) : null,
    it.pending ? h('span', { class: 'spinner', 'aria-label': 'Сохраняется' }) : h('span', { class: 'rchev', text: '›' }));
  const wrap = h('div', { class: 'swipe' },
    h('div', { class: 'swipe-act left', text: '⇈ Наверх' }),
    h('div', { class: 'swipe-act right', text: isDone ? 'Вернуть ↺' : 'Готово ✓' }),
    row);
  if (!it.pending) bindRowSwipe(wrap, row, it, isDone);
  return wrap;
}

function bindRowSwipe(wrap, row, it, isDone) {
  let x0 = 0, y0 = 0, dx = 0, axis = null, swiped = false, pressTimer = null, dragged = false;
  const cancelPress = () => { clearTimeout(pressTimer); pressTimer = null; };
  const left = wrap.querySelector('.swipe-act.left'), right = wrap.querySelector('.swipe-act.right');
  const setX = x => {
    row.style.transform = x ? `translateX(${x}px)` : '';
    left.style.visibility = x > 0 ? 'visible' : 'hidden';
    right.style.visibility = x < 0 ? 'visible' : 'hidden';
    left.classList.toggle('armed', x > SWIPE_TRIGGER);
    right.classList.toggle('armed', x < -SWIPE_TRIGGER);
  };
  setX(0);
  row.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; axis = null; swiped = false; dragged = false;
    row.classList.remove('snap');
    cancelPress();
    pressTimer = setTimeout(() => { pressTimer = null; if (!axis) { dragged = true; startDrag(wrap, it, y0); } }, LONG_PRESS_MS);
  }, { passive: true });
  row.addEventListener('touchmove', e => {
    const t = e.touches[0];
    if (drag?.wrap === wrap) { e.preventDefault(); drag.lastY = t.clientY; updateDrag(); return; }
    const mx = t.clientX - x0, my = t.clientY - y0;
    if (!axis) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      cancelPress();
      axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
    }
    if (axis !== 'x') return;
    e.preventDefault();
    swiped = true;
    dx = mx > 0 ? Math.min(mx, wrap.clientWidth * 0.7) : Math.max(mx, -wrap.clientWidth * 0.7);
    setX(dx);
  }, { passive: false });
  const finish = () => {
    cancelPress();
    if (drag?.wrap === wrap) { endDrag(); return; }
    if (axis !== 'x') return;
    row.classList.add('snap');
    if (dx < -SWIPE_TRIGGER) {
      setX(-wrap.clientWidth);
      setTimeout(() => isDone ? reopenFromDone(it) : completeWithUndo(it), 180);
    } else if (dx > SWIPE_TRIGGER) {
      setX(0);
      move(it, 'top');
      toast('Поднято наверх');
    } else setX(0);
    axis = null;
  };
  row.addEventListener('touchend', finish);
  row.addEventListener('touchcancel', () => {
    cancelPress();
    if (drag?.wrap === wrap) { endDrag(true); return; }
    row.classList.add('snap'); setX(0); axis = null;
  });
  row.addEventListener('contextmenu', e => e.preventDefault());
  row.addEventListener('click', e => {
    if (swiped || dragged) { e.preventDefault(); swiped = dragged = false; return; }
    openTask(it);
  });
}

function startDrag(wrap, it, y) {
  const container = wrap.parentElement;
  const wraps = [...container.children];
  const from = wraps.indexOf(wrap);
  if (wraps.length < 2) return;
  const rects = wraps.map(w => w.getBoundingClientRect());
  drag = {
    wrap, it, container, wraps, from, to: from, y0: y, lastY: y, scroll0: window.scrollY,
    height: rects[from].height, mids: rects.map(r => r.top + r.height / 2 + window.scrollY),
    minDy: rects[0].top - rects[from].top, maxDy: rects.at(-1).bottom - rects[from].bottom,
  };
  container.classList.add('sorting');
  wrap.classList.add('lifted');
  root.classList.add('sorting');
  autoScroll();
}

function updateDrag() {
  const d = drag;
  if (!d) return;
  const dy = Math.max(d.minDy, Math.min(d.maxDy, d.lastY - d.y0 + window.scrollY - d.scroll0));
  d.wrap.style.transform = `translateY(${dy}px) scale(1.02)`;
  const center = d.mids[d.from] + dy;
  d.to = d.mids.filter((m, i) => i !== d.from && m < center).length;
  d.wraps.forEach((w, i) => {
    if (i === d.from) return;
    const shift = d.from < d.to && i > d.from && i <= d.to ? -d.height : d.from > d.to && i >= d.to && i < d.from ? d.height : 0;
    w.style.transform = shift ? `translateY(${shift}px)` : '';
  });
}

function autoScroll() {
  if (!drag) return;
  const top = $('#top').offsetHeight + 40, bottom = window.innerHeight - 70;
  const step = drag.lastY < top ? -10 : drag.lastY > bottom ? 10 : 0;
  if (step) { window.scrollBy(0, step); updateDrag(); }
  requestAnimationFrame(autoScroll);
}

function endDrag(cancelled = false) {
  const d = drag;
  drag = null;
  if (!d) return;
  d.wraps.forEach(w => { w.style.transform = ''; });
  d.wrap.classList.remove('lifted');
  d.container.classList.remove('sorting');
  root.classList.remove('sorting');
  if (!cancelled && d.to !== d.from) placeAt(d.it, d.to);
}

function completeWithUndo(it) {
  const prev = it.status;
  setStatus(it, doneStatus().id);
  toast('Готово', { action: 'Отменить', onAction: () => setStatus(it, prev) });
}

function reopenFromDone(it) {
  const target = data.statuses.find(s => /^to\s*do$/i.test(s.name)) || data.statuses[0];
  setStatus(it, target.id);
  toast(`Вернул в ${target.name}`, { action: 'Отменить', onAction: () => setStatus(it, doneStatus().id) });
}

function toggleGroup(key) {
  collapsed.has(key) ? collapsed.delete(key) : collapsed.add(key);
  store.set(LS.collapsed, [...collapsed]);
  render();
}

function renderConnect() {
  $('#title').textContent = 'Board';
  $('#tabs').replaceChildren();
  $('#fab').hidden = true;
  $('#groupBtn').hidden = true;
  const input = h('input', { type: 'password', placeholder: 'ghp_…', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go' });
  const go = h('button', { class: 'btn primary wide' }, 'Подключить');
  const connect = async () => {
    const v = input.value.trim();
    if (!v) return;
    token = v;
    go.disabled = true;
    input.blur();
    try { await pickProject(); } catch (e) { token = null; toast(e.message); go.disabled = false; }
  };
  go.addEventListener('click', connect);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') connect(); });
  $('#list').replaceChildren(h('div', { class: 'setup' },
    h('h2', { text: 'Подключение к GitHub' }),
    h('p', {}, 'Нужен classic-токен со scope ', h('code', { text: 'repo' }), ' и ', h('code', { text: 'project' }), '. Он хранится только на этом устройстве.'),
    h('a', { class: 'btn wide', href: TOKEN_URL, target: '_blank', rel: 'noopener' }, 'Создать токен на GitHub ↗'),
    input, go));
  syncHeaderHeight();
}

async function pickProject() {
  const d = await gql(`{viewer{login projectsV2(first:30,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{id number title closed}}}}`);
  store.set(LS.token, token);
  const projects = d.viewer.projectsV2.nodes.filter(p => !p.closed);
  if (!projects.length) throw new Error('У аккаунта нет открытых проектов');
  if (projects.length === 1) return chooseProject(projects[0]);
  $('#fab').hidden = true;
  $('#tabs').replaceChildren();
  $('#list').replaceChildren(h('div', { class: 'setup' },
    h('h2', { text: 'Выбери доску' }),
    h('p', { text: `Аккаунт ${d.viewer.login}` }),
    projects.map(p => h('button', { class: 'btn wide', onclick: () => chooseProject(p) }, p.title))));
  syncHeaderHeight();
}

function chooseProject(p) {
  if (project?.id !== p.id) { data = null; store.del(LS.cache); tab = null; renderedTab = null; collapsed = new Set(); store.del(LS.collapsed); }
  project = { id: p.id, title: p.title };
  store.set(LS.project, project);
  render();
  load();
}

function openSheet(content, onClose = null) {
  sheetOnClose = onClose;
  const sheet = $('#sheet');
  sheet.style.transform = '';
  sheet.replaceChildren(h('div', { class: 'grab' }), content);
  sheet.scrollTop = 0;
  root.classList.add('locked');
  $('#sheetWrap').classList.add('open');
}

function closeSheet(skipCallback = false) {
  const cb = sheetOnClose;
  sheetOnClose = null;
  const sheet = $('#sheet');
  sheet.classList.remove('dragging');
  sheet.style.transform = '';
  $('#sheetWrap').style.opacity = '';
  $('#sheetWrap').classList.remove('open');
  root.classList.remove('locked');
  document.activeElement?.blur?.();
  if (cb && !skipCallback) cb();
}

function bindSheetDrag() {
  const sheet = $('#sheet'), wrap = $('#sheetWrap');
  let y0 = 0, t0 = 0, dy = 0, active = false, dragging = false;
  sheet.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    const onGrab = !!e.target.closest('.grab');
    const inField = !!e.target.closest('textarea,input,select');
    active = onGrab || (!inField && sheet.scrollTop <= 0);
    dragging = false;
    y0 = e.touches[0].clientY; t0 = Date.now(); dy = 0;
  }, { passive: true });
  sheet.addEventListener('touchmove', e => {
    if (!active) return;
    dy = e.touches[0].clientY - y0;
    if (!dragging) {
      if (dy < 6) { if (dy < -6) active = false; return; }
      if (sheet.scrollTop > 0) { active = false; return; }
      dragging = true;
      sheet.classList.add('dragging');
      document.activeElement?.blur?.();
    }
    e.preventDefault();
    const y = Math.max(0, dy);
    sheet.style.transform = `translateY(${y}px)`;
    wrap.style.opacity = String(Math.max(0.2, 1 - y / (sheet.offsetHeight * 1.2)));
  }, { passive: false });
  const end = () => {
    if (!dragging) { active = false; return; }
    const velocity = dy / Math.max(1, Date.now() - t0);
    sheet.classList.remove('dragging');
    wrap.style.opacity = '';
    if (dy > Math.min(140, sheet.offsetHeight * 0.3) || velocity > 0.6) closeSheet();
    else sheet.style.transform = '';
    active = dragging = false;
  };
  sheet.addEventListener('touchend', end);
  sheet.addEventListener('touchcancel', end);
  wrap.addEventListener('touchmove', e => { if (e.target === wrap) e.preventDefault(); }, { passive: false });
}

function bindPullToRefresh() {
  const ptr = $('#ptr');
  let y0 = 0, dy = 0, pulling = false;
  const show = y => {
    const p = Math.min(1, y / PULL_TRIGGER);
    ptr.style.opacity = String(p);
    ptr.style.transform = `translateY(${Math.min(y, PULL_TRIGGER) * 0.6 - 20}px) rotate(${p * 180}deg)`;
    ptr.classList.toggle('ready', y >= PULL_TRIGGER);
  };
  document.addEventListener('touchstart', e => {
    if (root.classList.contains('locked') || window.scrollY > 0 || !data || e.target.closest('.tabs')) { pulling = false; return; }
    y0 = e.touches[0].clientY; dy = 0; pulling = true;
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!pulling) return;
    if (drag) { pulling = false; show(0); return; }
    dy = e.touches[0].clientY - y0;
    if (dy <= 0 || window.scrollY > 0) { show(0); return; }
    show(dy * 0.55);
  }, { passive: true });
  document.addEventListener('touchend', async () => {
    if (!pulling) return;
    pulling = false;
    if (dy * 0.55 >= PULL_TRIGGER && !loading) {
      ptr.classList.add('spin');
      ptr.style.transform = `translateY(${PULL_TRIGGER * 0.6 - 20}px)`;
      await load();
      ptr.classList.remove('spin');
    }
    ptr.style.transition = 'opacity .2s, transform .2s';
    show(0);
    setTimeout(() => { ptr.style.transition = ''; }, 220);
  });
}

function bindViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    root.style.setProperty('--kb', kb + 'px');
    root.style.setProperty('--vvh', vv.height + 'px');
    root.classList.toggle('kb', kb > 80);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}

function keepFocus(el) {
  el.addEventListener('pointerdown', e => { if (document.activeElement?.matches('textarea,input')) e.preventDefault(); });
  el.addEventListener('mousedown', e => { if (document.activeElement?.matches('textarea,input')) e.preventDefault(); });
  return el;
}

function chipGroup(options, value, onPick, { holdFocus = false } = {}) {
  const wrap = h('div', { class: 'chips' });
  for (const o of options) {
    const b = h('button', { class: 'chip' + (o.id === value ? ' active' : ''), style: o.color ? `--c:${o.color}` : null },
      o.color ? h('span', { class: 'dot' }) : null, o.name);
    b.addEventListener('click', () => {
      wrap.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      b.classList.add('active');
      onPick(o.id);
    });
    if (holdFocus) keepFocus(b);
    wrap.append(b);
  }
  return wrap;
}

const statusOptions = () => data.statuses.map(s => ({ id: s.id, name: s.name, color: optionColor(s.color) }));
const epicOptions = () => [...data.epics.map(e => ({ id: e.id, name: e.title })), { id: NO_EPIC, name: 'Без эпика' }];

function autoGrow(ta) {
  const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };
  ta.addEventListener('input', fit);
  requestAnimationFrame(fit);
  return fit;
}

function openTask(it) {
  const title = h('textarea', { class: 't-title', rows: '1', enterkeyhint: 'done', autocapitalize: 'sentences' });
  title.value = it.title;
  title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
  const body = h('textarea', { rows: '4', placeholder: 'Детали, ссылки, чек-лист…', autocapitalize: 'sentences' });
  body.value = it.body;
  openSheet(h('div', {},
    title,
    h('div', { class: 'field-label', text: 'Статус' }),
    chipGroup(statusOptions(), it.status, id => { if (id !== it.status) { setStatus(it, id); toast(`→ ${statusName(id)}`); } }),
    h('div', { class: 'field-label', text: 'Эпик' }),
    chipGroup(epicOptions(), epicKey(it), id => setEpic(it, id === NO_EPIC ? null : id)),
    h('div', { class: 'field-label', text: 'Заметки' }),
    body,
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => { move(it, 'top'); toast('Поднято наверх'); } }, '⇈ Наверх'),
      h('button', { class: 'btn', 'aria-label': 'Выше', onclick: () => move(it, 'up') }, '↑'),
      h('button', { class: 'btn', 'aria-label': 'Ниже', onclick: () => move(it, 'down') }, '↓'),
      it.url ? h('a', { class: 'btn', href: it.url, target: '_blank', rel: 'noopener' }, `#${it.number} ↗`) : h('span')),
    h('button', { class: 'btn primary wide', onclick: () => closeSheet() }, 'Готово'),
    h('button', { class: 'btn danger wide', onclick: () => removeTask(it) }, 'Удалить задачу')),
    () => {
      const t = title.value.trim();
      if (t && (t !== it.title || body.value !== it.body)) saveText(it, t, body.value);
    });
  autoGrow(title);
  autoGrow(body);
}

function openNew() {
  let epicId = store.get(LS.lastEpic, NO_EPIC);
  if (epicId !== NO_EPIC && !data.epics.some(e => e.id === epicId)) epicId = NO_EPIC;
  let statusId = tab === NO_STATUS ? defaultStatusId() : tab;
  const title = h('textarea', { class: 't-title new-title', rows: '1', placeholder: 'Что нужно сделать?', enterkeyhint: 'next', autocapitalize: 'sentences' });
  const body = h('textarea', { class: 'new-body', rows: '2', placeholder: 'Описание (необязательно)', autocapitalize: 'sentences' });
  const top = keepFocus(h('input', { type: 'checkbox' }));
  const closeAfter = keepFocus(h('input', { type: 'checkbox' }));
  closeAfter.checked = store.get(LS.closeAfterAdd, false);
  closeAfter.addEventListener('change', () => store.set(LS.closeAfterAdd, closeAfter.checked));
  const add = keepFocus(h('button', { class: 'btn primary wide' }, 'Добавить'));
  const fitTitle = autoGrow(title);
  const fitBody = autoGrow(body);
  const submit = () => {
    const t = title.value.trim();
    if (!t) { title.focus(); return; }
    store.set(LS.lastEpic, epicId);
    createTask({ title: t, body: body.value.trim(), epicId: epicId === NO_EPIC ? null : epicId, statusId, top: top.checked });
    toast('Добавлено');
    if (closeAfter.checked) { closeSheet(true); return; }
    title.value = '';
    body.value = '';
    fitTitle();
    fitBody();
    title.focus();
  };
  add.addEventListener('click', submit);
  title.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); body.focus(); } });
  openSheet(h('div', {},
    h('h3', { text: 'Новая задача' }),
    title,
    body,
    h('div', { class: 'field-label', text: 'Эпик' }),
    chipGroup(epicOptions(), epicId, id => { epicId = id; }, { holdFocus: true }),
    h('div', { class: 'field-label', text: 'Статус' }),
    chipGroup(statusOptions(), statusId, id => { statusId = id; }, { holdFocus: true }),
    keepFocus(h('label', { class: 'toggle' }, top, 'В начало списка (важнее остальных)')),
    keepFocus(h('label', { class: 'toggle' }, closeAfter, 'Закрыть после добавления')),
    add));
  title.focus();
}

function openSettings() {
  openSheet(h('div', {},
    h('h3', { text: 'Настройки' }),
    h('p', { class: 'muted', text: project ? `Доска: ${project.title}` : 'Доска не выбрана' }),
    h('p', { class: 'muted', text: 'Свайп задачи влево — готово, вправо — наверх. Удержи задачу и тащи, чтобы поменять приоритет. Потяни список вниз, чтобы обновить.' }),
    data ? h('button', { class: 'btn wide', onclick: openEpics }, 'Эпики…') : null,
    data ? h('button', { class: 'btn wide', onclick: openStatuses }, 'Статусы…') : null,
    data ? h('button', { class: 'btn wide', onclick: () => { closeSheet(); toggleGrouping(); } }, grouped ? 'Выключить группировку по эпикам' : 'Включить группировку по эпикам') : null,
    token ? h('button', { class: 'btn wide', onclick: async () => { closeSheet(); try { await pickProject(); } catch (e) { toast(e.message); } } }, 'Сменить доску') : null,
    token ? h('button', { class: 'btn danger wide', onclick: disconnect }, 'Отключить GitHub на этом устройстве') : null));
}

const childrenOf = epicId => data.items.filter(it => epicKey(it) === epicId);

function openEpics() {
  const input = h('input', { type: 'text', placeholder: 'Название нового эпика', enterkeyhint: 'done', autocapitalize: 'sentences' });
  const create = async () => {
    const t = input.value.trim();
    if (!t) { input.focus(); return; }
    input.value = '';
    input.blur();
    await createEpic(t);
    openEpics();
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); create(); } });
  openSheet(h('div', {},
    h('h3', { text: 'Эпики' }),
    h('div', { class: 'list' }, [...data.epics, { id: NO_EPIC, title: 'Без эпика', virtual: true }].map(e => {
      const n = childrenOf(e.id).length;
      return h('button', { class: 'list-row', onclick: () => openEpic(e) },
        h('span', { class: 'lr-title' + (e.virtual ? ' muted' : ''), text: e.title }),
        h('span', { class: 'n', text: n }),
        h('span', { class: 'rchev', text: '›' }));
    })),
    h('div', { class: 'field-label', text: 'Новый эпик' }),
    h('div', { class: 'inline-add' }, input, h('button', { class: 'btn primary', onclick: create }, 'Создать'))));
}

function openEpic(epic) {
  const isVirtual = epic.id === NO_EPIC;
  const kids = childrenOf(epic.id);
  const selected = new Set(kids.filter(k => !k.pending).map(k => k.id));
  let target = null;
  const title = h('textarea', { class: 't-title', rows: '1', enterkeyhint: 'done', autocapitalize: 'sentences' });
  title.value = epic.title;
  title.readOnly = isVirtual;
  title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
  const moveBtn = h('button', { class: 'btn primary wide' });
  const updateMoveBtn = () => {
    moveBtn.textContent = selected.size ? `Перенести ${selected.size} ${plural(selected.size, ['задачу', 'задачи', 'задач'])}` : 'Выбери задачи';
    moveBtn.disabled = !selected.size || target === null;
  };
  const targets = [...data.epics.filter(e => e.id !== epic.id).map(e => ({ id: e.id, name: e.title })), ...(isVirtual ? [] : [{ id: NO_EPIC, name: 'Без эпика' }])];
  const allBox = h('input', { type: 'checkbox' });
  allBox.checked = selected.size === kids.length && kids.length > 0;
  const boxes = [];
  const rows = kids.map(k => {
    const cb = h('input', { type: 'checkbox', disabled: k.pending ? true : null });
    cb.checked = selected.has(k.id);
    cb.addEventListener('change', () => {
      cb.checked ? selected.add(k.id) : selected.delete(k.id);
      allBox.checked = selected.size === kids.length;
      updateMoveBtn();
    });
    boxes.push([cb, k]);
    return h('label', { class: 'pick-row' }, cb, h('span', { class: 'lr-title', text: k.title }), h('span', { class: 'n', text: statusName(k.status) || '—' }));
  });
  allBox.addEventListener('change', () => {
    for (const [cb, k] of boxes) { if (k.pending) continue; cb.checked = allBox.checked; allBox.checked ? selected.add(k.id) : selected.delete(k.id); }
    updateMoveBtn();
  });
  moveBtn.addEventListener('click', async () => {
    const chosen = kids.filter(k => selected.has(k.id));
    const dest = target === NO_EPIC ? null : data.epics.find(e => e.id === target);
    closeSheet(true);
    await bulkMove(chosen, dest);
  });
  updateMoveBtn();
  openSheet(h('div', {},
    title,
    isVirtual ? null : h('p', { class: 'muted small', text: `#${epic.number} · ${kids.length} ${plural(kids.length, ['задача', 'задачи', 'задач'])} на доске` }),
    kids.length ? h('div', {},
      h('div', { class: 'field-label', text: 'Задачи' }),
      h('label', { class: 'pick-row all' }, allBox, h('span', { class: 'lr-title', text: 'Выбрать все' })),
      h('div', { class: 'list' }, rows),
      h('div', { class: 'field-label', text: 'Перенести выбранные в' }),
      targets.length ? chipGroup(targets, null, id => { target = id; updateMoveBtn(); }) : h('p', { class: 'muted', text: 'Нет других эпиков' }),
      moveBtn) : h('p', { class: 'muted', text: 'Задач в этом эпике нет' }),
    isVirtual ? null : h('div', { class: 'actions two' },
      epic.url ? h('a', { class: 'btn', href: epic.url, target: '_blank', rel: 'noopener' }, `#${epic.number} ↗`) : h('span'),
      h('button', { class: 'btn danger', onclick: () => closeEpic(epic) }, 'Закрыть эпик'))),
    () => {
      const t = title.value.trim();
      if (!isVirtual && t && t !== epic.title) renameEpic(epic, t);
    });
  autoGrow(title);
}

const plural = (n, [one, few, many]) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many; };

async function ensureEpicLabel() {
  if (data.epicLabelId) return data.epicLabelId;
  data.epicLabelId = (await gql(M.createLabel, { r: data.repoId })).createLabel.label.id;
  persist();
  return data.epicLabelId;
}

async function createEpic(title) {
  try {
    const label = await ensureEpicLabel();
    const issue = (await gql(M.createEpic, { r: data.repoId, t: title, l: [label] })).createIssue.issue;
    data.epics.push(issue);
    persistRender();
    toast(`Эпик «${title}» создан`);
  } catch (e) { toast('Не создался: ' + e.message); }
}

function renameEpic(epic, title) {
  const prev = epic.title;
  const sync = t => { epic.title = t; for (const it of data.items) if (it.parent?.id === epic.id) it.parent.title = t; };
  return mutate(() => sync(title), () => sync(prev), () => gql(M.rename, { i: epic.id, t: title }));
}

async function bulkMove(tasks, dest) {
  const moving = tasks.filter(t => !t.pending && (t.parent?.id ?? null) !== (dest?.id ?? null));
  if (!moving.length) return;
  const prev = new Map(moving.map(t => [t, t.parent]));
  const ops = moving.map((t, i) => dest
    ? `m${i}: addSubIssue(input:{issueId:${JSON.stringify(dest.id)},subIssueId:${JSON.stringify(t.id)},replaceParent:true}){clientMutationId}`
    : `m${i}: removeSubIssue(input:{issueId:${JSON.stringify(t.parent.id)},subIssueId:${JSON.stringify(t.id)}}){clientMutationId}`);
  await mutate(
    () => moving.forEach(t => { t.parent = dest ? { id: dest.id, number: dest.number, title: dest.title } : null; }),
    () => moving.forEach(t => { t.parent = prev.get(t); }),
    async () => { for (let i = 0; i < ops.length; i += 20) await gql(`mutation{${ops.slice(i, i + 20).join(' ')}}`); });
  toast(`Перенесено: ${moving.length} → ${dest ? dest.title : 'без эпика'}`);
}

async function closeEpic(epic) {
  const kids = childrenOf(epic.id);
  if (kids.length && !confirm(`В эпике ${kids.length} ${plural(kids.length, ['задача', 'задачи', 'задач'])}. Закрыть эпик? Задачи останутся на доске и переедут в «Без эпика».`)) return;
  if (!kids.length && !confirm(`Закрыть эпик «${epic.title}»?`)) return;
  closeSheet(true);
  const idx = data.epics.indexOf(epic);
  await mutate(
    () => { data.epics.splice(idx, 1); kids.forEach(k => { k.parent = null; }); },
    () => { data.epics.splice(idx, 0, epic); kids.forEach(k => { k.parent = { id: epic.id, number: epic.number, title: epic.title }; }); },
    async () => {
      const ops = kids.map((k, i) => `m${i}: removeSubIssue(input:{issueId:${JSON.stringify(epic.id)},subIssueId:${JSON.stringify(k.id)}}){clientMutationId}`);
      for (let i = 0; i < ops.length; i += 20) await gql(`mutation{${ops.slice(i, i + 20).join(' ')}}`);
      await gql(M.close, { i: epic.id, r: 'COMPLETED' });
    });
  toast(`Эпик «${epic.title}» закрыт`);
}

function openStatuses() {
  const draft = data.statuses.map(s => ({ id: s.id, name: s.name, color: s.color || 'GRAY', description: s.description || '' }));
  const listEl = h('div', { class: 'list' });
  const draw = () => {
    listEl.replaceChildren(...draft.map((s, i) => {
      const name = h('input', { type: 'text', class: 'st-name', autocapitalize: 'sentences', enterkeyhint: 'done' });
      name.value = s.name;
      name.addEventListener('input', () => { s.name = name.value; });
      const count = s.id ? data.items.filter(it => it.status === s.id).length : 0;
      return h('div', { class: 'st-row' },
        h('button', { class: 'st-dot', style: `--c:${optionColor(s.color)}`, 'aria-label': 'Цвет', onclick: () => { s.color = COLOR_ORDER[(COLOR_ORDER.indexOf(s.color) + 1) % COLOR_ORDER.length]; draw(); } }),
        name,
        h('span', { class: 'n', text: count }),
        h('button', { class: 'st-btn', 'aria-label': 'Выше', disabled: i === 0 ? true : null, onclick: () => { [draft[i - 1], draft[i]] = [draft[i], draft[i - 1]]; draw(); } }, '↑'),
        h('button', { class: 'st-btn', 'aria-label': 'Ниже', disabled: i === draft.length - 1 ? true : null, onclick: () => { [draft[i + 1], draft[i]] = [draft[i], draft[i + 1]]; draw(); } }, '↓'),
        h('button', { class: 'st-btn danger', 'aria-label': 'Удалить', onclick: () => {
          if (count && !confirm(`В статусе «${s.name}» ${count} ${plural(count, ['задача', 'задачи', 'задач'])}. После сохранения они попадут во вкладку «Без статуса». Удалить?`)) return;
          draft.splice(i, 1); draw();
        } }, '×'));
    }));
  };
  draw();
  const save = async () => {
    const options = draft.map(s => ({ ...(s.id ? { id: s.id } : {}), name: s.name.trim() || 'Без названия', color: s.color, description: s.description }));
    if (!options.length) { toast('Нужен хотя бы один статус'); return; }
    closeSheet(true);
    try {
      const saved = (await gql(M.statuses, { f: data.fieldId, o: options })).updateProjectV2Field.projectV2Field.options;
      data.statuses = saved;
      persistRender();
      toast('Статусы сохранены');
    } catch (e) { toast('Не сохранилось: ' + e.message); }
  };
  openSheet(h('div', {},
    h('h3', { text: 'Статусы' }),
    h('p', { class: 'muted small', text: 'Тап по кружку меняет цвет. Порядок здесь — порядок вкладок и колонок на доске.' }),
    listEl,
    h('button', { class: 'btn wide', onclick: () => { draft.push({ id: null, name: 'Новый статус', color: 'GRAY', description: '' }); draw(); listEl.lastChild?.querySelector('input')?.select(); } }, '+ Добавить статус'),
    h('button', { class: 'btn primary wide', onclick: save }, 'Сохранить')));
}

function disconnect() {
  if (!confirm('Удалить токен и кэш с этого устройства?')) return;
  Object.values(LS).forEach(k => store.del(k));
  token = project = data = tab = renderedTab = null;
  collapsed = new Set();
  closeSheet(true);
  render();
}

async function mutate(apply, rollback, run) {
  apply();
  persistRender();
  try { await run(); persist(); }
  catch (e) { rollback(); persistRender(); toast(e.message); }
}

function setStatus(it, optionId) {
  const prev = { status: it.status, state: it.state };
  const done = doneStatus()?.id === optionId;
  return mutate(() => { it.status = optionId; }, () => Object.assign(it, prev), async () => {
    if (!done && it.state === 'CLOSED') { await gql(M.reopen, { i: it.id }); it.state = 'OPEN'; }
    await gql(M.status, { p: project.id, i: it.itemId, f: data.fieldId, o: optionId });
    if (done && it.state === 'OPEN') { await gql(M.close, { i: it.id, r: 'COMPLETED' }); it.state = 'CLOSED'; }
  });
}

function setEpic(it, epicId) {
  const prev = it.parent;
  const epic = epicId ? data.epics.find(e => e.id === epicId) : null;
  if ((prev?.id ?? null) === (epic?.id ?? null)) return;
  return mutate(() => { it.parent = epic ? { id: epic.id, number: epic.number, title: epic.title } : null; }, () => { it.parent = prev; }, async () => {
    if (epic) await gql(M.setParent, { p: epic.id, s: it.id });
    else await gql(M.unsetParent, { p: prev.id, s: it.id });
  });
}

function saveText(it, title, body) {
  const prev = { title: it.title, body: it.body };
  return mutate(() => Object.assign(it, { title, body }), () => Object.assign(it, prev), () => gql(M.text, { i: it.id, t: title, b: body }));
}

const siblingsOf = it => data.items.filter(x => statusKey(x) === statusKey(it) && (!grouped || epicKey(x) === epicKey(it)));

function move(it, dir) {
  const from = siblingsOf(it).indexOf(it);
  return placeAt(it, dir === 'top' ? 0 : dir === 'up' ? from - 1 : from + 1);
}

function placeAt(it, index) {
  const siblings = siblingsOf(it);
  const from = siblings.indexOf(it);
  const others = siblings.filter(x => x !== it);
  if (!others.length || index < 0 || index > others.length || index === from) return;
  const rest = data.items.filter(x => x !== it);
  const after = index === 0 ? rest[rest.indexOf(others[0]) - 1] ?? null : others[index - 1];
  const prevOrder = data.items;
  return mutate(() => {
    rest.splice(after ? rest.indexOf(after) + 1 : 0, 0, it);
    data.items = rest;
  }, () => { data.items = prevOrder; }, () => gql(M.position, { p: project.id, i: it.itemId, a: after?.itemId ?? null }));
}

async function createTask({ title, body, epicId, statusId, top }) {
  const epic = epicId ? data.epics.find(e => e.id === epicId) : null;
  const temp = { itemId: 'tmp-' + Date.now() + Math.random(), id: null, number: null, title, body: body || '', state: 'OPEN', url: null, status: statusId,
    parent: epic ? { id: epic.id, number: epic.number, title: epic.title } : null, pending: true, top };
  pendingCreates.add(temp);
  top ? data.items.unshift(temp) : data.items.push(temp);
  render();
  try {
    const issue = (await gql(M.create, { r: data.repoId, t: title, b: body || null, par: epic?.id ?? null, p: project.id })).createIssue.issue;
    let itemId = issue.projectItems?.nodes.find(n => n.project.id === project.id)?.id;
    if (!itemId) itemId = (await gql(M.addItem, { p: project.id, c: issue.id })).addProjectV2ItemById.item.id;
    if (statusId && statusId !== NO_STATUS) await gql(M.placeNew, { p: project.id, i: itemId, f: data.fieldId, o: statusId, top });
    else if (top) await gql(M.position, { p: project.id, i: itemId, a: null });
    Object.assign(temp, { itemId, id: issue.id, number: issue.number, url: issue.url });
    delete temp.pending;
    delete temp.top;
    const duplicate = data.items.find(x => x !== temp && x.id === issue.id);
    if (duplicate) data.items = data.items.filter(x => x !== temp);
    else if (!data.items.includes(temp)) data.items.push(temp);
    persistRender();
  } catch (e) {
    data.items = data.items.filter(x => x !== temp);
    persistRender();
    toast('Не создалось: ' + e.message);
  } finally {
    pendingCreates.delete(temp);
  }
}

function removeTask(it) {
  if (!confirm(`Удалить «${it.title}»?\nIssue закроется как not planned и уйдёт с доски.`)) return;
  closeSheet(true);
  const idx = data.items.indexOf(it);
  return mutate(() => data.items.splice(idx, 1), () => data.items.splice(idx, 0, it),
    () => gql(M.remove, { p: project.id, i: it.itemId, c: it.id }));
}

let toastTimer;
function toast(msg, { action, onAction } = {}) {
  const t = $('#toast');
  t.replaceChildren(h('span', { text: msg }));
  t.classList.toggle('has-action', !!action);
  if (action) t.append(h('button', { onclick: () => { t.classList.remove('show'); onAction(); } }, action));
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 4500 : 2200);
}

$('#fab').addEventListener('click', () => data && openNew());
$('#refreshBtn').addEventListener('click', load);
$('#groupBtn').addEventListener('click', toggleGrouping);
$('#settingsBtn').addEventListener('click', openSettings);
$('#sheetWrap').addEventListener('click', e => { if (e.target.id === 'sheetWrap') closeSheet(); });
document.addEventListener('touchstart', () => {}, { passive: true });
document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastLoad > 30000) load(); });
window.addEventListener('resize', syncHeaderHeight);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

bindSheetDrag();
bindPullToRefresh();
bindViewport();
render();
load();
