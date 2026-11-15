const API = 'https://api.github.com/graphql';
const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo,project&description=Board%20PWA';
const LS = { token: 'pb.token', project: 'pb.project', cache: 'pb.cache', tab: 'pb.tab', collapsed: 'pb.collapsed', lastAdd: 'pb.lastAdd', coachSeen: 'pb.coachSeen', queue: 'pb.queue', grouped: 'pb.grouped', closeAfterAdd: 'pb.closeAfterAdd', view: 'pb.view', epicTab: 'pb.epicTab', epicViewSeen: 'pb.epicViewSeen' };
const OPTION_COLORS = { GRAY: '#8b949e', BLUE: '#2f81f7', GREEN: '#2ea043', YELLOW: '#d29922', ORANGE: '#db6d28', RED: '#f85149', PINK: '#db61a2', PURPLE: '#a371f7' };
const NO_EPIC = 'none';
const NO_STATUS = '__none';
const COLOR_ORDER = Object.keys(OPTION_COLORS);
const SWIPE_TRIGGER = 88;
const PULL_TRIGGER = 70;
const LONG_PRESS_MS = 380;
const EDGE = 22;
const TAB_SWIPE = 60;
const RETRY_MS = 15000;
const ALLOWED_SCOPES = ['repo', 'project'];

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
let view = store.get(LS.view, 'status');
let epicTab = store.get(LS.epicTab);
let drag = null;
let queue = store.get(LS.queue, []);
let flushing = null;
let doneWhileLoading = [];
let netState = 'ok';
let retryTimer = null;
let tokenScopes = null;
let tabSwipeAt = 0;
let loading = false;
let lastLoad = 0;
let renderedTab = null;
let sheetOnClose = null;

const $ = (s, r = document) => r.querySelector(s);

const ICONS = {
  search: ['<circle cx="11" cy="11" r="7"/>', '<path d="m20 20-3.5-3.5"/>'],
  view: ['<path d="M3 6h18M7 12h10M10 18h4"/>'],
  settings: ['<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>', '<circle cx="12" cy="12" r="3"/>'],
  plus: ['<path d="M12 5v14M5 12h14"/>'],
  chevron: ['<path d="m9 18 6-6-6-6"/>'],
  more: ['<circle cx="5" cy="12" r="1.2"/>', '<circle cx="12" cy="12" r="1.2"/>', '<circle cx="19" cy="12" r="1.2"/>'],
  top: ['<path d="M5 4h14M18 14l-6-6-6 6M12 8v12"/>'],
  up: ['<path d="m5 12 7-7 7 7M12 19V5"/>'],
  down: ['<path d="M12 5v14M19 12l-7 7-7-7"/>'],
  external: ['<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'],
  check: ['<path d="M20 6 9 17l-5-5"/>'],
  undo: ['<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>', '<path d="M3 3v5h5"/>'],
  x: ['<path d="M18 6 6 18M6 6l12 12"/>'],
  pause: ['<path d="M9 5v14M15 5v14"/>'],
  inbox: ['<path d="M22 12h-6l-2 3h-4l-2-3H2"/>', '<path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>'],
  trash: ['<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>'],
};

function icon(name, size = 20) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'ico' })) svg.setAttribute(k, v);
  svg.innerHTML = ICONS[name].join('');
  return svg;
}

const EPIC_COLORS = ['#2f81f7', '#bf3989', '#1a9d8f', '#d4762c', '#8250df', '#7d9a1f', '#cf4040', '#3d8fb5'];
const epicColor = id => {
  const i = data.epics.findIndex(e => e.id === id);
  return i === -1 ? 'var(--muted)' : EPIC_COLORS[i % EPIC_COLORS.length];
};
const swatch = id => h('span', { class: 'swatch', style: `--c:${epicColor(id)}`, 'aria-hidden': 'true' });
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

const fail = (message, kind) => Object.assign(new Error(message), { kind });
const retryable = e => e.kind === 'network' || e.kind === 'transient';

async function gql(query, variables = {}) {
  let r;
  try {
    r = await fetch(API, {
      method: 'POST',
      headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
  } catch { throw fail('Нет связи с GitHub', 'network'); }
  const scopes = r.headers.get('X-OAuth-Scopes');
  if (scopes != null) tokenScopes = scopes.split(',').map(x => x.trim()).filter(Boolean);
  if (r.status === 401) throw fail('GitHub не принял токен — возможно, он истёк', 'auth');
  if (r.status >= 500 || r.status === 429) throw fail(`GitHub временно недоступен (${r.status})`, 'transient');
  if (!r.ok) throw fail(r.status === 403 ? 'Не хватает прав токена или исчерпан лимит запросов — попробуй позже или замени токен' : `GitHub не принял запрос (код ${r.status}) — попробуй ещё раз`, 'http');
  const j = await r.json();
  if (j.errors?.length) {
    const raw = j.errors.map(e => `${e.type || ''} ${e.message}`).join('; ');
    const text = /NOT_FOUND|Could not resolve/i.test(raw) ? 'Задача не найдена на GitHub — возможно, её удалили. Обнови список'
      : /FORBIDDEN|permission|scope/i.test(raw) ? 'Не хватает прав токена — замени его в настройках'
      : 'GitHub отклонил изменение — обнови список и попробуй снова';
    throw Object.assign(fail(text, 'gql'), { detail: raw });
  }
  return j.data;
}

const extraScopes = () => (tokenScopes || []).filter(x => !ALLOWED_SCOPES.includes(x));

const ITEMS_Q = `query($id:ID!,$after:String){node(id:$id){... on ProjectV2{title
  field(name:"Status"){... on ProjectV2SingleSelectField{id options{id name color description}}}
  repositories(first:1){nodes{id}}
  items(first:100,after:$after){pageInfo{hasNextPage endCursor}
    nodes{id isArchived
      fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{optionId}}
      content{__typename ... on Issue{id number title body state url createdAt parent{id number title}}}}}}}}`;

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
  if (loading || !token || !project || netState === 'auth') return;
  loading = true;
  root.classList.add('loading');
  try {
    if (queue.length) await flush();
    if (queue.length && netState !== 'ok') return;
    doneWhileLoading = [];
    let after = null, meta = null;
    const items = [];
    do {
      const p = (await gql(ITEMS_Q, { id: project.id, after })).node;
      meta ||= p;
      for (const n of p.items.nodes) {
        const c = n.content;
        if (n.isArchived || c?.__typename !== 'Issue') continue;
        items.push({
          itemId: n.id, id: c.id, number: c.number, title: c.title, body: c.body || '', state: c.state, url: c.url, createdAt: c.createdAt,
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
    data = { title: meta.title, fieldId: meta.field.id, statuses: meta.field.options, repoId, epicLabelId: repo?.label?.id ?? null, epics, items: loaded };
    for (const op of [...doneWhileLoading, ...queue]) applyOp(op);
    doneWhileLoading = [];
    lastLoad = Date.now();
    setNet('ok');
    persistRender();
  } catch (e) {
    if (retryable(e)) setNet('offline');
    else if (e.kind === 'auth') setNet('auth');
    else toast(e.message);
  } finally {
    loading = false;
    root.classList.remove('loading');
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
  const byEpic = view === 'epic';
  const tabList = byEpic ? epicTabs() : statusTabs();
  const current = byEpic ? epicTab : tab;
  const tabsEl = $('#tabs');
  const scrollLeft = tabsEl.scrollLeft;
  tabsEl.replaceChildren(...tabList.map(s => h('button', {
    class: 'tab' + (s.id === current ? ' active' : '') + (s.id === NO_STATUS ? ' no-status' : ''), 'data-id': s.id, role: 'tab', 'aria-selected': String(s.id === current), style: `--c:${s.color ? optionColor(s.color) : 'transparent'}`,
    onclick: () => selectTab(s.id),
  }, byEpic ? swatch(s.id) : h('span', { class: 'dot' }), s.name, h('span', { class: 'n', text: s.n }))));
  tabsEl.scrollLeft = scrollLeft;
  const tabMark = view + ':' + current;
  if (renderedTab !== tabMark) {
    const active = $('.tab.active');
    if (active) tabsEl.scrollTo({ left: active.offsetLeft - (tabsEl.clientWidth - active.offsetWidth) / 2, behavior: renderedTab?.startsWith(view) ? 'smooth' : 'auto' });
    renderedTab = tabMark;
  }

  const viewBtn = $('#groupBtn');
  viewBtn.hidden = false;
  $('#searchBtn').hidden = false;
  viewBtn.setAttribute('aria-label', 'Вид списка');

  const sections = byEpic ? epicSections() : statusSections();
  $('#list').replaceChildren(...(sections.length ? sections : [emptyState()]));
  if (!byEpic && tab !== doneStatus()?.id) $('#list .row')?.classList.add('first');
  maybeCoach();
  syncHeaderHeight();
}

function emptyState() {
  const isDone = tab === doneStatus()?.id;
  const name = tab === NO_STATUS ? 'Без статуса' : statusName(tab);
  return h('div', { class: 'empty' },
    h('p', { class: 'empty-title', text: isDone ? 'Выполненных пока нет' : `В «${name}» пусто` }),
    h('p', { class: 'muted', text: isDone ? 'Смахни задачу влево — она окажется здесь.' : 'Нажми «+», чтобы добавить задачу.' }));
}

function statusTabs() {
  const counts = {};
  for (const it of data.items) { const k = statusKey(it); counts[k] = (counts[k] || 0) + 1; }
  const list = [...(counts[NO_STATUS] ? [{ id: NO_STATUS, name: 'Без статуса', color: null }] : []), ...data.statuses];
  if (!list.some(s => s.id === tab)) tab = defaultStatusId();
  return list.map(s => ({ id: s.id, name: s.name, color: s.color, n: counts[s.id] || 0 }));
}

function epicTabs() {
  const list = data.epics.map(e => ({ id: e.id, name: e.title, n: childrenOf(e.id).length }));
  const loose = childrenOf(NO_EPIC).length;
  if (loose) list.push({ id: NO_EPIC, name: 'Без эпика', n: loose });
  if (!list.some(e => e.id === epicTab)) epicTab = (list.find(e => e.n) || list[0])?.id ?? NO_EPIC;
  return list;
}

function groupSection(key, head, its, showEpic, more) {
  const isCollapsed = collapsed.has(key);
  return h('section', { class: 'group' + (isCollapsed ? ' collapsed' : '') },
    h('div', { class: 'group-head' },
      h('button', { class: 'gh-toggle', onclick: () => toggleGroup(key) },
        h('span', { class: 'chev' }, icon('chevron', 16)), ...head, h('span', { class: 'n', text: its.length })),
      more),
    isCollapsed ? null : h('div', { class: 'rows' }, its.map(it => rowEl(it, showEpic))));
}

function statusSections() {
  const inTab = data.items.filter(i => statusKey(i) === tab);
  if (!grouped) return inTab.length ? [h('section', { class: 'group flat' }, h('div', { class: 'rows' }, inTab.map(it => rowEl(it, true))))] : [];
  const groups = [...data.epics.map(e => ({ key: e.id, title: e.title })), { key: NO_EPIC, title: 'Без эпика' }];
  return groups.map(g => {
    const its = inTab.filter(i => epicKey(i) === g.key);
    if (!its.length) return null;
    const epic = data.epics.find(e => e.id === g.key);
    return groupSection(g.key, [swatch(g.key), h('span', { class: 'gt', text: g.title })], its, false,
      epic ? h('button', { class: 'gh-more', 'aria-label': `Эпик «${epic.title}»: редактировать`, onclick: () => openEpic(epic) }, icon('more')) : null);
  }).filter(Boolean);
}

function epicSections() {
  const kids = childrenOf(epicTab);
  const epic = data.epics.find(e => e.id === epicTab) || { id: NO_EPIC, title: 'Без эпика' };
  const open = kids.filter(k => statusKey(k) !== doneStatus()?.id).length;
  const bar = h('div', { class: 'epic-bar' },
    h('span', { class: 'muted', text: kids.length ? `${open} открыто · ${kids.length - open} готово` : 'Задач нет' }),
    h('button', { class: 'gh-more', 'aria-label': 'Эпик: редактировать', onclick: () => openEpic(epic) }, icon('more')));
  const statuses = [...(kids.some(k => statusKey(k) === NO_STATUS) ? [{ id: NO_STATUS, name: 'Без статуса', color: null }] : []), ...data.statuses];
  const sections = statuses.map(s => {
    const its = kids.filter(k => statusKey(k) === s.id);
    if (!its.length) return null;
    return groupSection('st:' + s.id, [h('span', { class: 'dot', style: `--c:${s.color ? optionColor(s.color) : 'var(--muted)'}` }), h('span', { class: 'gt', text: s.name })], its, false, null);
  }).filter(Boolean);
  return [bar, ...sections];
}

function setView(next, epicId) {
  view = next;
  store.set(LS.view, view);
  if (epicId) { epicTab = epicId; store.set(LS.epicTab, epicTab); }
  if (view === 'epic' && !store.get(LS.epicViewSeen)) {
    const done = doneStatus();
    if (done) collapsed.add('st:' + done.id);
    store.set(LS.collapsed, [...collapsed]);
    store.set(LS.epicViewSeen, true);
  }
  render();
  window.scrollTo({ top: 0 });
}

function openView() {
  const opt = (label, hint, active, run) => h('button', { class: 'list-row' + (active ? ' on' : ''), role: 'menuitemradio', 'aria-checked': String(active), onclick: () => { closeSheet(); run(); } },
    h('span', { class: 'lr-title' }, label, h('span', { class: 'lr-hint', text: hint })),
    h('span', { class: 'check' }, active ? icon('check', 18) : null));
  openSheet(h('div', {},
    h('h2', { text: 'Вид' }),
    h('div', { class: 'list', role: 'menu' },
      opt('По статусам, с эпиками', 'Вкладки — статусы, внутри группы по эпикам', view === 'status' && grouped, () => { if (!grouped) toggleGrouping(); setView('status'); }),
      opt('По статусам, общим списком', 'Сквозной приоритет без деления на эпики', view === 'status' && !grouped, () => { if (grouped) toggleGrouping(); setView('status'); }),
      opt('По эпикам', 'Вкладки — эпики, внутри все задачи по статусам', view === 'epic', () => setView('epic')))));
}

function toggleGrouping() {
  grouped = !grouped;
  store.set(LS.grouped, grouped);
  render();
  toast(grouped ? 'Группировка по эпикам включена' : 'Общий список без эпиков');
}

function selectTab(id) {
  if (id === (view === 'epic' ? epicTab : tab)) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (view === 'epic') { epicTab = id; store.set(LS.epicTab, epicTab); } else { tab = id; store.set(LS.tab, tab); }
  render();
  window.scrollTo({ top: 0 });
}

function bodyPreview(body) {
  const line = body.split('\n').map(x => x.replace(/^[-*#>\s\[\]x]+/i, '').trim()).find(Boolean);
  return line || '';
}

function rowEl(it, showEpic) {
  const isDone = doneStatus()?.id === it.status;
  const preview = bodyPreview(it.body);
  const row = h('button', { class: 'row' + (it.pending ? ' pending' : '') },
    h('span', { class: 'rt' },
      h('span', { class: 'rtt', text: it.title }),
      preview ? h('span', { class: 'rb', text: preview }) : null,
      showEpic && it.parent ? h('span', { class: 're' }, swatch(it.parent.id), it.parent.title) : null),
    it.pending ? h('span', { class: 'spinner', role: 'img', 'aria-label': 'Сохраняется' }) : null);
  const wrap = h('div', { class: 'swipe' },
    h('div', { class: 'swipe-act left' }, icon('top', 18), 'Наверх'),
    h('div', { class: 'swipe-act right' }, isDone ? 'Вернуть' : 'Выполнено', icon(isDone ? 'undo' : 'check', 18)),
    row);
  bindRowSwipe(wrap, row, it, isDone);
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
    if (x0 < EDGE || x0 > window.innerWidth - EDGE) { axis = 'edge'; return; }
    pressTimer = setTimeout(() => { pressTimer = null; if (!axis) { dragged = true; startDrag(wrap, it, y0); } }, LONG_PRESS_MS);
  }, { passive: true });
  row.addEventListener('touchmove', e => {
    const t = e.touches[0];
    if (drag?.wrap === wrap) { e.preventDefault(); drag.lastY = t.clientY; updateDrag(); return; }
    if (axis === 'edge') return;
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
  toast('Выполнено', { action: 'Отменить', onAction: () => setStatus(it, prev) });
}

function reopenFromDone(it) {
  const target = data.statuses.find(s => /^to\s*do$/i.test(s.name)) || data.statuses[0];
  setStatus(it, target.id);
  toast(`Возвращено в ${target.name}`, { action: 'Отменить', onAction: () => setStatus(it, doneStatus().id) });
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
  $('#searchBtn').hidden = true;
  const input = h('input', { type: 'password', name: 'token', 'aria-label': 'Токен GitHub', placeholder: 'ghp_…', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go' });
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
    h('a', { class: 'btn wide', href: TOKEN_URL, target: '_blank', rel: 'noopener' }, 'Создать токен на GitHub'),
    input, go));
  syncHeaderHeight();
}

async function pickProject() {
  const d = await gql(`{viewer{login projectsV2(first:30,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{id number title closed}}}}`);
  store.set(LS.token, token);
  netState = 'ok';
  warnScopes();
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
  if (project?.id !== p.id) { data = null; store.del(LS.cache); tab = null; renderedTab = null; collapsed = new Set(); store.del(LS.collapsed); queue = []; store.del(LS.queue); }
  project = { id: p.id, title: p.title };
  store.set(LS.project, project);
  render();
  load();
}

let sheetReturnFocus = null;

function openSheet(content, onClose = null) {
  if (!$('#sheetWrap').classList.contains('open')) sheetReturnFocus = document.activeElement;
  $('#toast').classList.remove('show');
  sheetOnClose = onClose;
  const sheet = $('#sheet');
  const heading = content.querySelector('h2');
  if (heading) { heading.id = 'sheetTitle'; sheet.setAttribute('aria-labelledby', 'sheetTitle'); } else sheet.removeAttribute('aria-labelledby');
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
  if (sheetReturnFocus?.isConnected) sheetReturnFocus.focus({ preventScroll: true });
  sheetReturnFocus = null;
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
    if (drag || $('#list').classList.contains('tab-swiping')) { pulling = false; show(0); return; }
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
  const wrap = h('div', { class: 'chips', role: 'group' });
  for (const o of options) {
    const b = h('button', { class: 'chip' + (o.id === value ? ' active' : ''), style: o.color ? `--c:${o.color}` : null, 'aria-pressed': String(o.id === value) },
      o.color ? h('span', { class: 'dot' }) : o.swatch ? swatch(o.id) : null, o.name);
    b.addEventListener('click', () => {
      wrap.querySelectorAll('.chip').forEach(c => { c.classList.remove('active'); c.setAttribute('aria-pressed', 'false'); });
      b.classList.add('active');
      b.setAttribute('aria-pressed', 'true');
      onPick(o.id);
    });
    if (holdFocus) keepFocus(b);
    wrap.append(b);
  }
  return wrap;
}

const statusOptions = () => data.statuses.map(s => ({ id: s.id, name: s.name, color: optionColor(s.color) }));
const epicOptions = () => [...data.epics.map(e => ({ id: e.id, name: e.title })), { id: NO_EPIC, name: 'Без эпика' }];

const HALF_LIFE_DAYS = 7;
const SESSION_MS = 3 * 3600e3;

function rankedEpicOptions() {
  const now = Date.now();
  const score = new Map();
  for (const it of data.items) {
    const t = Date.parse(it.createdAt || '');
    if (!t) continue;
    const k = epicKey(it);
    score.set(k, (score.get(k) || 0) + Math.pow(0.5, (now - t) / 864e5 / HALF_LIFE_DAYS));
  }
  const last = store.get(LS.lastAdd);
  if (last && now - last.ts < SESSION_MS) score.set(last.epicId, (score.get(last.epicId) || 0) + 1000);
  return epicOptions().map((o, i) => ({ o, i, s: score.get(o.id) || 0 })).sort((a, b) => b.s - a.s || a.i - b.i).map(x => x.o);
}

const chipLine = (label, chips) => h('div', { class: 'chip-line' }, h('span', { class: 'cl-label', text: label }), chips);

function revealActiveChip(chips) {
  const prev = chips.querySelector('.chip.active')?.previousElementSibling;
  chips.scrollLeft = prev ? prev.offsetLeft - chips.offsetLeft : 0;
}

function autoGrow(ta) {
  const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };
  ta.addEventListener('input', fit);
  requestAnimationFrame(fit);
  return fit;
}

const findStatus = re => data.statuses.find(x => re.test(x.name));

function quickMove(it, target, label) {
  const prev = it.status;
  closeSheet();
  setStatus(it, target.id);
  toast(label, { action: 'Отменить', onAction: () => setStatus(it, prev) });
}

function openTask(it) {
  const title = h('textarea', { class: 't-title', rows: '1', enterkeyhint: 'done', autocapitalize: 'sentences', 'aria-label': 'Название задачи' });
  title.value = it.title;
  title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
  const body = h('textarea', { rows: '4', placeholder: 'Детали, ссылки, чек-лист…', autocapitalize: 'sentences', autocomplete: 'off', 'aria-label': 'Заметки' });
  body.value = it.body;
  const done = doneStatus();
  const isDone = done?.id === it.status;
  const quick = [];
  if (isDone) {
    const back = findStatus(/^to\s*do$/i) || data.statuses[0];
    quick.push(h('button', { class: 'qa primary', onclick: () => quickMove(it, back, `Возвращено в ${back.name}`) }, icon('undo'), 'Вернуть в работу'));
  } else if (done) {
    quick.push(h('button', { class: 'qa primary', onclick: () => { closeSheet(); completeWithUndo(it); } }, icon('check'), 'Выполнено'));
  }
  for (const [re, ico] of [[/^pause$/i, 'pause'], [/^backlog$/i, 'inbox']]) {
    const st = findStatus(re);
    if (st && st.id !== it.status && !isDone) quick.push(h('button', { class: 'qa', onclick: () => quickMove(it, st, `Перенесено в ${st.name}`) }, icon(ico), st.name));
  }
  const meta = [it.number ? `#${it.number}` : 'Сохраняется…', it.parent ? it.parent.title : null].filter(Boolean).join(' · ');
  const statusChips = chipGroup(statusOptions(), it.status, id => { if (id !== it.status) { setStatus(it, id); toast(`Перенесено в ${statusName(id)}`); } });
  const epicChips = chipGroup(epicOptions().map(o => ({ ...o, swatch: true })), epicKey(it), id => setEpic(it, id === NO_EPIC ? null : id));
  openSheet(h('div', { class: 'task' },
    h('div', { class: 'sheet-head' },
      h('span', { class: 'sh-meta' }, it.parent ? swatch(it.parent.id) : null, meta),
      h('button', { class: 'link-btn', onclick: () => closeSheet() }, 'Закрыть')),
    title,
    quick.length ? h('div', { class: 'quick' + (quick.length === 1 ? ' one' : '') }, quick) : null,
    chipLine('Статус', statusChips),
    chipLine('Эпик', epicChips),
    h('div', { class: 'field-label', text: 'Заметки' }),
    body,
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => { move(it, 'top'); toast('Поднято наверх'); } }, icon('top', 18), 'Наверх'),
      h('button', { class: 'btn', 'aria-label': 'Выше', onclick: () => move(it, 'up') }, icon('up', 18)),
      h('button', { class: 'btn', 'aria-label': 'Ниже', onclick: () => move(it, 'down') }, icon('down', 18)),
      it.url ? h('a', { class: 'btn', href: it.url, target: '_blank', rel: 'noopener' }, `#${it.number}`, icon('external', 16)) : h('span')),
    h('button', { class: 'btn danger wide delete', onclick: () => removeTask(it) }, icon('trash', 18), 'Удалить задачу')),
    () => {
      const t = title.value.trim();
      if (t && (t !== it.title || body.value !== it.body)) saveText(it, t, body.value);
    });
  autoGrow(title);
  autoGrow(body);
  revealActiveChip(statusChips);
  revealActiveChip(epicChips);
}

function openNew() {
  const ranked = rankedEpicOptions();
  let epicId = view === 'epic' ? epicTab : ranked[0].id;
  const current = ranked.findIndex(o => o.id === epicId);
  if (current > 0) ranked.unshift(...ranked.splice(current, 1));
  let statusId = view === 'epic' || tab === NO_STATUS ? defaultStatusId() : tab;
  const title = h('textarea', { class: 't-title new-title', rows: '1', placeholder: 'Что нужно сделать?', 'aria-label': 'Название задачи', autocomplete: 'off', enterkeyhint: 'next', autocapitalize: 'sentences' });
  const body = h('textarea', { class: 'new-body', rows: '1', placeholder: 'Описание…', 'aria-label': 'Описание', autocomplete: 'off', autocapitalize: 'sentences' });
  const top = keepFocus(h('input', { type: 'checkbox' }));
  const closeAfter = keepFocus(h('input', { type: 'checkbox' }));
  closeAfter.checked = store.get(LS.closeAfterAdd, false);
  closeAfter.addEventListener('change', () => store.set(LS.closeAfterAdd, closeAfter.checked));
  const add = keepFocus(h('button', { class: 'btn primary add-btn' }, icon('plus', 18), 'Добавить'));
  const fitTitle = autoGrow(title);
  const fitBody = autoGrow(body);
  const submit = () => {
    const t = title.value.trim();
    if (!t) { title.focus(); return; }
    store.set(LS.lastAdd, { epicId, ts: Date.now() });
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
  const epicChips = chipGroup(ranked.map(o => ({ ...o, swatch: true })), epicId, id => { epicId = id; }, { holdFocus: true });
  const statusChips = chipGroup(statusOptions(), statusId, id => { statusId = id; }, { holdFocus: true });
  openSheet(h('div', { class: 'new-task' },
    h('div', { class: 'new-head' }, h('h2', { text: 'Новая задача' }), add),
    title,
    body,
    chipLine('Эпик', epicChips),
    chipLine('Статус', statusChips),
    h('div', { class: 'toggles' },
      keepFocus(h('label', { class: 'toggle' }, top, 'В начало')),
      keepFocus(h('label', { class: 'toggle' }, closeAfter, 'Закрыть после')))));
  revealActiveChip(epicChips);
  revealActiveChip(statusChips);
  title.focus();
}

function openSettings() {
  const extra = extraScopes();
  openSheet(h('div', {},
    h('h2', { text: 'Настройки' }),
    data ? h('div', { class: 'list' },
      h('button', { class: 'list-row', onclick: openView }, h('span', { class: 'lr-title', text: 'Вид списка' }), h('span', { class: 'rchev' }, icon('chevron', 18))),
      h('button', { class: 'list-row', onclick: openEpics }, h('span', { class: 'lr-title', text: 'Эпики' }), h('span', { class: 'n', text: data.epics.length }), h('span', { class: 'rchev' }, icon('chevron', 18))),
      h('button', { class: 'list-row', onclick: openStatuses }, h('span', { class: 'lr-title', text: 'Статусы' }), h('span', { class: 'n', text: data.statuses.length }), h('span', { class: 'rchev' }, icon('chevron', 18)))) : null,
    h('div', { class: 'field-label', text: 'Жесты' }),
    h('p', { class: 'muted small', text: 'Свайп задачи влево — выполнено, вправо — наверх. Удержи задачу и тащи, чтобы поменять приоритет. Свайп от края экрана или по заголовкам — соседняя вкладка. Потяни список вниз, чтобы обновить.' }),
    h('div', { class: 'field-label', text: 'GitHub' }),
    h('p', { class: 'muted small', text: project ? `Доска: ${project.title}` : 'Доска не выбрана' }),
    tokenScopes ? h('p', { class: 'small' + (extra.length ? ' warn' : ' muted'), text: extra.length
      ? `Права токена: ${tokenScopes.join(', ')}. Лишние: ${extra.join(', ')} — лучше выпустить новый только с repo и project.`
      : `Права токена: ${tokenScopes.join(', ')} — ничего лишнего.` }) : null,
    token ? h('div', { class: 'list' },
      h('button', { class: 'list-row', onclick: async () => { closeSheet(); try { await pickProject(); } catch (e) { toast(e.message); } } }, h('span', { class: 'lr-title', text: 'Сменить доску' }), h('span', { class: 'rchev' }, icon('chevron', 18))),
      h('button', { class: 'list-row', onclick: openReauth }, h('span', { class: 'lr-title', text: 'Заменить токен' }), h('span', { class: 'rchev' }, icon('chevron', 18)))) : null,
    token ? h('button', { class: 'btn danger wide', onclick: disconnect }, 'Отключить GitHub на этом устройстве') : null));
}

const childrenOf = epicId => data.items.filter(it => epicKey(it) === epicId);

function openEpics() {
  const input = h('input', { type: 'text', name: 'epic', placeholder: 'Название нового эпика…', 'aria-label': 'Название нового эпика', autocomplete: 'off', enterkeyhint: 'done', autocapitalize: 'sentences' });
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
    h('h2', { text: 'Эпики' }),
    h('div', { class: 'list' }, [...data.epics, { id: NO_EPIC, title: 'Без эпика', virtual: true }].map(e => {
      const n = childrenOf(e.id).length;
      return h('button', { class: 'list-row', onclick: () => openEpic(e) },
        swatch(e.id),
        h('span', { class: 'lr-title' + (e.virtual ? ' muted' : ''), text: e.title }),
        h('span', { class: 'n', text: n }),
        h('span', { class: 'rchev' }, icon('chevron', 18)));
    })),
    h('div', { class: 'field-label', text: 'Новый эпик' }),
    h('div', { class: 'inline-add' }, input, h('button', { class: 'btn primary', onclick: create }, 'Создать'))));
}

function openEpic(epic) {
  const isVirtual = epic.id === NO_EPIC;
  const kids = childrenOf(epic.id);
  const selected = new Set();
  let target = null;
  const title = h('textarea', { class: 't-title', rows: '1', enterkeyhint: 'done', autocapitalize: 'sentences', 'aria-label': 'Название эпика' });
  title.value = epic.title;
  title.readOnly = isVirtual;
  title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
  const moveBtn = h('button', { class: 'btn primary wide' });
  const updateMoveBtn = () => {
    moveBtn.textContent = selected.size ? `Перенести ${selected.size} ${plural(selected.size, ['задачу', 'задачи', 'задач'])}` : 'Выбери задачи';
    moveBtn.disabled = !selected.size || target === null;
  };
  const targets = [...data.epics.filter(e => e.id !== epic.id).map(e => ({ id: e.id, name: e.title, swatch: true })), ...(isVirtual ? [] : [{ id: NO_EPIC, name: 'Без эпика', swatch: true }])];
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
    view === 'epic' && epicTab === epic.id ? null : h('button', { class: 'btn wide', onclick: () => { closeSheet(); setView('epic', epic.id); } }, 'Показать все задачи списком'),
    kids.length ? h('div', {},
      h('div', { class: 'field-label', text: 'Задачи' }),
      h('label', { class: 'pick-row all' }, allBox, h('span', { class: 'lr-title', text: 'Выбрать все' })),
      h('div', { class: 'list' }, rows),
      h('div', { class: 'field-label', text: 'Перенести выбранные в' }),
      targets.length ? chipGroup(targets, null, id => { target = id; updateMoveBtn(); }) : h('p', { class: 'muted', text: 'Нет других эпиков' }),
      moveBtn) : h('p', { class: 'muted', text: 'Задач в этом эпике нет' }),
    isVirtual ? null : h('div', { class: 'actions two' },
      epic.url ? h('a', { class: 'btn', href: epic.url, target: '_blank', rel: 'noopener' }, `#${epic.number}`, icon('external', 16)) : h('span'),
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
  return mutateNow(() => sync(title), () => sync(prev), () => gql(M.rename, { i: epic.id, t: title }));
}

async function bulkMove(tasks, dest) {
  const moving = tasks.filter(t => !t.pending && (t.parent?.id ?? null) !== (dest?.id ?? null));
  if (!moving.length) return;
  const prev = new Map(moving.map(t => [t, t.parent]));
  const ops = moving.map((t, i) => dest
    ? `m${i}: addSubIssue(input:{issueId:${JSON.stringify(dest.id)},subIssueId:${JSON.stringify(t.id)},replaceParent:true}){clientMutationId}`
    : `m${i}: removeSubIssue(input:{issueId:${JSON.stringify(t.parent.id)},subIssueId:${JSON.stringify(t.id)}}){clientMutationId}`);
  await mutateNow(
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
  await mutateNow(
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
  const initial = JSON.stringify(draft);
  const listEl = h('div', { class: 'list' });
  const draw = () => {
    listEl.replaceChildren(...draft.map((s, i) => {
      const name = h('input', { type: 'text', class: 'st-name', 'aria-label': 'Название статуса', autocomplete: 'off', autocapitalize: 'sentences', enterkeyhint: 'done' });
      name.value = s.name;
      name.addEventListener('input', () => { s.name = name.value; });
      const count = s.id ? data.items.filter(it => it.status === s.id).length : 0;
      return h('div', { class: 'st-row' },
        h('button', { class: 'st-dot', style: `--c:${optionColor(s.color)}`, 'aria-label': 'Цвет', onclick: () => { s.color = COLOR_ORDER[(COLOR_ORDER.indexOf(s.color) + 1) % COLOR_ORDER.length]; draw(); } }),
        name,
        h('span', { class: 'n', text: count }),
        h('button', { class: 'st-btn', 'aria-label': 'Выше', disabled: i === 0 ? true : null, onclick: () => { [draft[i - 1], draft[i]] = [draft[i], draft[i - 1]]; draw(); } }, icon('up', 18)),
        h('button', { class: 'st-btn', 'aria-label': 'Ниже', disabled: i === draft.length - 1 ? true : null, onclick: () => { [draft[i + 1], draft[i]] = [draft[i], draft[i + 1]]; draw(); } }, icon('down', 18)),
        h('button', { class: 'st-btn danger', 'aria-label': 'Удалить', onclick: () => {
          if (count && !confirm(`В статусе «${s.name}» ${count} ${plural(count, ['задача', 'задачи', 'задач'])}. После сохранения они попадут во вкладку «Без статуса». Удалить?`)) return;
          draft.splice(i, 1); draw();
        } }, icon('x', 20)));
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
    h('h2', { text: 'Статусы' }),
    h('p', { class: 'muted small', text: 'Тап по кружку меняет цвет. Порядок здесь — порядок вкладок и колонок на доске.' }),
    listEl,
    h('button', { class: 'btn wide', onclick: () => { draft.push({ id: null, name: 'Новый статус', color: 'GRAY', description: '' }); draw(); listEl.lastChild?.querySelector('input')?.select(); } }, icon('plus', 18), 'Добавить статус'),
    h('button', { class: 'btn primary wide', onclick: save }, 'Сохранить')),
    () => { if (JSON.stringify(draft) !== initial && confirm('Сохранить изменения статусов?')) save(); });
}

function disconnect() {
  if (!confirm('Удалить токен и кэш с этого устройства?')) return;
  Object.values(LS).forEach(k => store.del(k));
  token = project = data = tab = renderedTab = null;
  collapsed = new Set();
  queue = [];
  netState = 'ok';
  updateNet();
  closeSheet(true);
  render();
}

async function mutateNow(apply, rollback, run) {
  apply();
  persistRender();
  try { await run(); persist(); }
  catch (e) {
    rollback();
    persistRender();
    toast(retryable(e) ? 'Нет связи — это действие нужно повторить онлайн' : e.message);
    if (e.kind === 'auth') setNet('auth');
  }
}

const byItem = id => data.items.find(x => x.itemId === id);
const epicRef = epic => epic ? { id: epic.id, number: epic.number, title: epic.title } : null;

function applyOp(op) {
  if (op.type === 'create') {
    const ref = op.real?.itemId ?? op.tmp;
    if (byItem(ref) || (op.real && data.items.some(x => x.id === op.real.id))) return;
    const it = { itemId: ref, id: op.real?.id ?? null, number: op.real?.number ?? null, title: op.title, body: op.body || '', state: 'OPEN',
      url: op.real?.url ?? null, status: op.statusId, parent: op.epic, createdAt: op.createdAt };
    if (!op.real) it.pending = true;
    op.top ? data.items.unshift(it) : data.items.push(it);
    return;
  }
  const it = byItem(op.item);
  if (!it) return;
  if (op.type === 'status') it.status = op.optionId;
  else if (op.type === 'epic') it.parent = op.epic;
  else if (op.type === 'text') Object.assign(it, { title: op.title, body: op.body });
  else if (op.type === 'remove') data.items = data.items.filter(x => x !== it);
  else if (op.type === 'position') {
    const rest = data.items.filter(x => x !== it);
    const after = op.after ? rest.find(x => x.itemId === op.after) : null;
    if (op.after && !after) return;
    rest.splice(after ? rest.indexOf(after) + 1 : 0, 0, it);
    data.items = rest;
  }
}

function enqueue(op) {
  op.qid = Date.now() + '-' + Math.random().toString(36).slice(2);
  queue.push(op);
  store.set(LS.queue, queue);
  applyOp(op);
  persistRender();
  flush();
}

const isTemp = id => typeof id === 'string' && id.startsWith('tmp-');

async function execOp(op) {
  if (op.type === 'create') {
    const issue = (await gql(M.create, { r: data.repoId, t: op.title, b: op.body || null, par: op.epic?.id ?? null, p: project.id })).createIssue.issue;
    let itemId = issue.projectItems?.nodes.find(n => n.project.id === project.id)?.id;
    if (!itemId) itemId = (await gql(M.addItem, { p: project.id, c: issue.id })).addProjectV2ItemById.item.id;
    if (op.statusId && op.statusId !== NO_STATUS) await gql(M.placeNew, { p: project.id, i: itemId, f: data.fieldId, o: op.statusId, top: !!op.top });
    else if (op.top) await gql(M.position, { p: project.id, i: itemId, a: null });
    op.real = { itemId, id: issue.id, number: issue.number, url: issue.url };
    for (const q of queue) {
      if (q.item === op.tmp) { q.item = itemId; q.issue = issue.id; }
      if (q.after === op.tmp) q.after = itemId;
    }
    const temp = byItem(op.tmp);
    if (data.items.some(x => x !== temp && x.id === issue.id)) data.items = data.items.filter(x => x !== temp);
    else if (temp) { Object.assign(temp, { itemId, id: issue.id, number: issue.number, url: issue.url }); delete temp.pending; }
    return;
  }
  if (isTemp(op.item) || isTemp(op.after)) return;
  const it = byItem(op.item);
  if (op.type === 'status') {
    const state = it?.state ?? 'OPEN';
    if (!op.done && state === 'CLOSED') { await gql(M.reopen, { i: op.issue }); if (it) it.state = 'OPEN'; }
    await gql(M.status, { p: project.id, i: op.item, f: data.fieldId, o: op.optionId });
    if (op.done && state === 'OPEN') { await gql(M.close, { i: op.issue, r: 'COMPLETED' }); if (it) it.state = 'CLOSED'; }
  } else if (op.type === 'epic') {
    if (op.epic) await gql(M.setParent, { p: op.epic.id, s: op.issue });
    else if (op.prev) await gql(M.unsetParent, { p: op.prev, s: op.issue });
  } else if (op.type === 'text') await gql(M.text, { i: op.issue, t: op.title, b: op.body });
  else if (op.type === 'position') await gql(M.position, { p: project.id, i: op.item, a: op.after });
  else if (op.type === 'remove') await gql(M.remove, { p: project.id, i: op.item, c: op.issue });
}

function dropOp(op) {
  if (queue[0] === op) queue.shift();
  else queue = queue.filter(q => q !== op);
  store.set(LS.queue, queue);
}

function flush() {
  if (flushing) return flushing;
  let reload = false;
  flushing = (async () => {
    while (queue.length && token && project && data) {
      const op = queue[0];
      try { await execOp(op); }
      catch (e) {
        if (retryable(e)) { setNet('offline'); scheduleRetry(); return; }
        if (e.kind === 'auth') { setNet('auth'); return; }
        dropOp(op);
        if (op.type === 'create') {
          data.items = data.items.filter(x => x.itemId !== op.tmp);
          queue = queue.filter(q => q.item !== op.tmp && q.after !== op.tmp);
          store.set(LS.queue, queue);
        }
        toast('Не сохранилось: ' + e.message);
        reload = true;
        continue;
      }
      dropOp(op);
      if (loading) doneWhileLoading.push(op);
      setNet('ok');
      persistRender();
    }
  })().finally(() => {
    flushing = null;
    updateNet();
    if (reload) load();
  });
  return flushing;
}

function scheduleRetry() {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { retryTimer = null; flush(); }, RETRY_MS);
}

function setNet(state) {
  if (netState === state) return updateNet();
  netState = state;
  updateNet();
  if (state === 'auth') toast('GitHub не принимает токен — введи новый');
}

function updateNet() {
  const badge = $('#netBadge');
  root.classList.toggle('offline', netState === 'offline');
  if (netState === 'ok' && !queue.length) { badge.hidden = true; return; }
  badge.hidden = false;
  badge.className = 'net-badge ' + netState;
  badge.textContent = netState === 'auth' ? 'Токен ⚠︎' : netState === 'offline' ? `Нет сети${queue.length ? ' · ' + queue.length : ''}` : `Сохраняю · ${queue.length}`;
}

function onBadge() {
  if (netState === 'auth') return openReauth();
  if (netState === 'offline') {
    toast(queue.length ? `Изменений в очереди: ${queue.length}. Отправятся, когда появится связь` : 'Нет связи с GitHub — на экране сохранённая версия');
    flush();
    load();
  }
}

function openReauth() {
  const input = h('input', { type: 'password', name: 'token', 'aria-label': 'Токен GitHub', placeholder: 'ghp_…', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'go' });
  const save = h('button', { class: 'btn primary wide' }, 'Сохранить');
  const go = async () => {
    const v = input.value.trim();
    if (!v) { input.focus(); return; }
    const prev = token;
    token = v;
    save.disabled = true;
    try {
      await gql('{viewer{login}}');
      store.set(LS.token, token);
      netState = 'ok';
      updateNet();
      closeSheet(true);
      warnScopes();
      await flush();
      load();
    } catch (e) {
      token = prev;
      save.disabled = false;
      toast(e.message);
    }
  };
  save.addEventListener('click', go);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  openSheet(h('div', {},
    h('h2', { text: 'Новый токен' }),
    h('p', { class: 'muted', text: queue.length ? `GitHub перестал принимать токен. Несохранённые изменения (${queue.length}) никуда не делись — они отправятся с новым токеном.` : 'GitHub перестал принимать токен — скорее всего, истёк срок. Создай новый с правами repo и project.' }),
    h('a', { class: 'btn wide', href: TOKEN_URL, target: '_blank', rel: 'noopener' }, 'Создать токен на GitHub'),
    input, save));
  input.focus();
}

function warnScopes() {
  const extra = extraScopes();
  if (extra.length) toast(`У токена лишние права: ${extra.join(', ')}. Лучше выпустить новый только с repo и project`);
}

function setStatus(it, optionId) {
  if (it.status === optionId) return;
  enqueue({ type: 'status', item: it.itemId, issue: it.id, optionId, done: doneStatus()?.id === optionId });
}

function setEpic(it, epicId) {
  const epic = epicId ? data.epics.find(e => e.id === epicId) : null;
  if ((it.parent?.id ?? null) === (epic?.id ?? null)) return;
  enqueue({ type: 'epic', item: it.itemId, issue: it.id, epic: epicRef(epic), prev: it.parent?.id ?? null });
}

function saveText(it, title, body) {
  enqueue({ type: 'text', item: it.itemId, issue: it.id, title, body });
}

const siblingsOf = it => data.items.filter(x => statusKey(x) === statusKey(it) && (view === 'epic' || grouped ? epicKey(x) === epicKey(it) : true));

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
  enqueue({ type: 'position', item: it.itemId, after: after?.itemId ?? null });
}

function createTask({ title, body, epicId, statusId, top }) {
  const epic = epicId ? data.epics.find(e => e.id === epicId) : null;
  enqueue({ type: 'create', tmp: 'tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2), title, body: body || '', epic: epicRef(epic), statusId, top: !!top, createdAt: new Date().toISOString() });
}

function removeTask(it) {
  if (!confirm(`Удалить «${it.title}»?\nIssue закроется как not planned и уйдёт с доски.`)) return;
  closeSheet(true);
  enqueue({ type: 'remove', item: it.itemId, issue: it.id });
}

const norm = t => (t || '').toLowerCase().replace(/ё/g, 'е');

function searchItems(q) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const doneId = doneStatus()?.id;
  return data.items
    .map(it => ({ it, title: norm(it.title), all: norm(it.title + ' ' + it.body + ' ' + (it.parent?.title || '')) }))
    .filter(x => words.every(w => x.all.includes(w)))
    .sort((a, b) => (words.every(w => b.title.includes(w)) - words.every(w => a.title.includes(w))) || ((a.it.status === doneId) - (b.it.status === doneId)))
    .map(x => x.it);
}

function highlight(text, q) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  const low = norm(text);
  const marks = new Array(text.length).fill(false);
  for (const w of words) for (let i = low.indexOf(w); i !== -1; i = low.indexOf(w, i + 1)) marks.fill(true, i, i + w.length);
  const out = [];
  let i = 0;
  while (i < text.length) {
    let j = i;
    while (j < text.length && marks[j] === marks[i]) j++;
    out.push(marks[i] ? h('mark', { text: text.slice(i, j) }) : text.slice(i, j));
    i = j;
  }
  return out;
}

function openSearch() {
  const input = h('input', { type: 'search', name: 'q', class: 'search-input', 'aria-label': 'Поиск задач', autocomplete: 'off', placeholder: 'Название, описание, эпик…', enterkeyhint: 'search', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
  const results = h('div', { class: 'search-results' });
  const doneId = doneStatus()?.id;
  const draw = () => {
    const q = input.value.trim();
    if (!q) { results.replaceChildren(h('p', { class: 'muted small', text: `Поиск по всем ${data.items.length} задачам, включая Done` })); return; }
    const found = searchItems(q);
    results.replaceChildren(
      h('p', { class: 'muted small', text: found.length ? `Найдено: ${found.length}` : 'Ничего не нашлось' }),
      found.length ? h('div', { class: 'list' }, found.slice(0, 60).map(it => {
        const st = data.statuses.find(x => x.id === it.status);
        return h('button', { class: 'list-row search-row' + (it.status === doneId ? ' done' : ''), onclick: () => { closeSheet(true); openTask(it); } },
          h('span', { class: 'lr-title' },
            h('span', { class: 'sr-title' }, highlight(it.title, q)),
            h('span', { class: 'lr-hint' },
              h('span', { class: 'dot', style: `--c:${st ? optionColor(st.color) : 'transparent'}` }), st?.name ?? 'Без статуса',
              it.parent ? [h('span', { class: 'sep', text: '·' }), swatch(it.parent.id), it.parent.title] : null)),
          h('span', { class: 'rchev' }, icon('chevron', 18)));
      })) : null);
  };
  input.addEventListener('input', draw);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
  openSheet(h('div', { class: 'search' }, input, results));
  draw();
  input.focus();
}

function adjacentTab(dir) {
  const ids = [...document.querySelectorAll('#tabs .tab')].map(b => b.dataset.id);
  const i = ids.indexOf(view === 'epic' ? epicTab : tab);
  return i === -1 ? null : ids[i + dir] ?? null;
}

function bindTabSwipe() {
  const list = $('#list');
  let x0 = 0, y0 = 0, dx = 0, axis = null, active = false;
  const startsOnRow = e => !!e.target.closest('.swipe');
  document.addEventListener('touchstart', e => {
    active = false;
    if (e.touches.length !== 1 || !data || !token || root.classList.contains('locked') || drag) return;
    if (e.target.closest('.tabs,.top,.fab,.toast')) return;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    const atEdge = x0 < EDGE || x0 > window.innerWidth - EDGE;
    if (!atEdge && startsOnRow(e)) return;
    active = true; axis = null; dx = 0;
  }, { passive: true, capture: true });
  document.addEventListener('touchmove', e => {
    if (!active || drag) return;
    const t = e.touches[0];
    const mx = t.clientX - x0, my = t.clientY - y0;
    if (!axis) {
      if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
      axis = Math.abs(mx) > Math.abs(my) * 1.3 ? 'x' : 'y';
      if (axis === 'y') { active = false; return; }
      list.classList.add('tab-swiping');
    }
    e.preventDefault();
    dx = mx;
    const blocked = !adjacentTab(dx < 0 ? 1 : -1);
    list.style.transform = `translateX(${dx * (blocked ? 0.15 : 0.45)}px)`;
  }, { passive: false, capture: true });
  const end = () => {
    if (!active) return;
    active = false;
    if (axis !== 'x') return;
    tabSwipeAt = Date.now();
    list.classList.remove('tab-swiping');
    const next = Math.abs(dx) > TAB_SWIPE ? adjacentTab(dx < 0 ? 1 : -1) : null;
    if (!next) { list.style.transform = ''; return; }
    list.style.transition = 'none';
    list.style.transform = `translateX(${dx < 0 ? 40 : -40}px)`;
    list.style.opacity = '0.4';
    selectTab(next);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      list.style.transition = '';
      list.style.transform = '';
      list.style.opacity = '';
    }));
  };
  document.addEventListener('touchend', end, { capture: true });
  document.addEventListener('touchcancel', () => { active = false; list.classList.remove('tab-swiping'); list.style.transform = ''; }, { capture: true });
  document.addEventListener('click', e => { if (Date.now() - tabSwipeAt < 400) { e.stopPropagation(); e.preventDefault(); } }, { capture: true });
}

let toastTimer;
let toastMs = 0;
function hideToastLater() {
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('show'), toastMs);
}

function toast(msg, { action, onAction } = {}) {
  const t = $('#toast');
  t.replaceChildren(h('span', { text: msg }));
  t.classList.toggle('has-action', !!action);
  if (action) t.append(h('button', { onclick: () => { t.classList.remove('show'); onAction(); } }, action));
  t.classList.add('show');
  toastMs = action ? 6000 : 2400;
  hideToastLater();
}

function maybeCoach() {
  if (store.get(LS.coachSeen) || !data || root.classList.contains('locked')) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { store.set(LS.coachSeen, true); return; }
  const wrap = $('#list .swipe');
  if (!wrap) return;
  store.set(LS.coachSeen, true);
  const row = wrap.querySelector('.row');
  const right = wrap.querySelector('.swipe-act.right'), left = wrap.querySelector('.swipe-act.left');
  const step = (x, vis, delay) => setTimeout(() => {
    row.classList.add('snap');
    row.style.transform = x ? `translateX(${x}px)` : '';
    right.style.visibility = vis === 'right' ? 'visible' : 'hidden';
    left.style.visibility = vis === 'left' ? 'visible' : 'hidden';
  }, delay);
  step(-96, 'right', 700);
  step(0, null, 1500);
  step(96, 'left', 1900);
  step(0, null, 2700);
  setTimeout(() => toast('Свайп влево — выполнено, вправо — наверх'), 2900);
}

$('#fab').addEventListener('click', () => data && openNew());
$('#groupBtn').addEventListener('click', () => data && openView());
$('#settingsBtn').addEventListener('click', openSettings);
$('#searchBtn').addEventListener('click', () => data && openSearch());
$('#netBadge').addEventListener('click', onBadge);
window.addEventListener('online', () => { flush(); load(); });
$('#sheetWrap').addEventListener('click', e => { if (e.target.id === 'sheetWrap') closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#sheetWrap').classList.contains('open')) closeSheet(); });
$('#toast').addEventListener('touchstart', () => clearTimeout(toastTimer), { passive: true });
$('#toast').addEventListener('touchend', hideToastLater);
document.addEventListener('touchstart', () => {}, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (queue.length) flush();
  if (Date.now() - lastLoad > 30000) load();
});
window.addEventListener('resize', syncHeaderHeight);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

bindSheetDrag();
bindPullToRefresh();
bindTabSwipe();
bindViewport();
render();
updateNet();
load();
