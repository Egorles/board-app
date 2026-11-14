const API = 'https://api.github.com/graphql';
const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo,project&description=Board%20PWA';
const LS = { token: 'pb.token', project: 'pb.project', cache: 'pb.cache', tab: 'pb.tab', collapsed: 'pb.collapsed', lastEpic: 'pb.lastEpic' };
const OPTION_COLORS = { GRAY: '#8b949e', BLUE: '#2f81f7', GREEN: '#2ea043', YELLOW: '#d29922', ORANGE: '#db6d28', RED: '#f85149', PINK: '#db61a2', PURPLE: '#a371f7' };
const NO_EPIC = 'none';

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
let loading = false;
let lastLoad = 0;
let sheetOnClose = null;

const $ = (s, r = document) => r.querySelector(s);

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
  field(name:"Status"){... on ProjectV2SingleSelectField{id options{id name color}}}
  repositories(first:1){nodes{id}}
  items(first:100,after:$after){pageInfo{hasNextPage endCursor}
    nodes{id isArchived
      fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{optionId}}
      content{__typename ... on Issue{id number title body state url parent{id number title}}}}}}}}`;

const EPICS_Q = `query($id:ID!){node(id:$id){... on Repository{
  issues(first:100,labels:["epic"],states:[OPEN],orderBy:{field:CREATED_AT,direction:ASC}){nodes{id number title}}}}}`;

const M = {
  status: `mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){clientMutationId}}`,
  close: `mutation($i:ID!,$r:IssueClosedStateReason){closeIssue(input:{issueId:$i,stateReason:$r}){clientMutationId}}`,
  reopen: `mutation($i:ID!){reopenIssue(input:{issueId:$i}){clientMutationId}}`,
  text: `mutation($i:ID!,$t:String!,$b:String!){updateIssue(input:{id:$i,title:$t,body:$b}){clientMutationId}}`,
  setParent: `mutation($p:ID!,$s:ID!){addSubIssue(input:{issueId:$p,subIssueId:$s,replaceParent:true}){clientMutationId}}`,
  unsetParent: `mutation($p:ID!,$s:ID!){removeSubIssue(input:{issueId:$p,subIssueId:$s}){clientMutationId}}`,
  position: `mutation($p:ID!,$i:ID!,$a:ID){updateProjectV2ItemPosition(input:{projectId:$p,itemId:$i,afterId:$a}){clientMutationId}}`,
  create: `mutation($r:ID!,$t:String!,$b:String,$par:ID){createIssue(input:{repositoryId:$r,title:$t,body:$b,parentIssueId:$par}){issue{id number url}}}`,
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
    const epics = repoId ? (await gql(EPICS_Q, { id: repoId })).node.issues.nodes : [];
    const epicIds = new Set(epics.map(e => e.id));
    for (const it of items) if (it.parent && !epicIds.has(it.parent.id)) { epics.push(it.parent); epicIds.add(it.parent.id); }
    data = { title: meta.title, fieldId: meta.field.id, statuses: meta.field.options, repoId, epics, items: items.filter(i => !epicIds.has(i.id)) };
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
const epicKey = it => it.parent?.id ?? NO_EPIC;

function render() {
  if (!token || !project) return renderConnect();
  $('#fab').hidden = false;
  if (!data) { $('#tabs').replaceChildren(); $('#list').replaceChildren(h('div', { class: 'empty', text: 'Загрузка…' })); return; }
  $('#title').textContent = data.title;
  document.title = data.title;
  if (!data.statuses.some(s => s.id === tab)) tab = (data.statuses.find(s => /^to\s*do$/i.test(s.name)) || data.statuses[0])?.id;

  const counts = {};
  for (const it of data.items) counts[it.status] = (counts[it.status] || 0) + 1;
  $('#tabs').replaceChildren(...data.statuses.map(s => h('button', {
    class: 'tab' + (s.id === tab ? ' active' : ''), style: `--c:${optionColor(s.color)}`,
    onclick: () => { tab = s.id; store.set(LS.tab, tab); render(); window.scrollTo({ top: 0 }); },
  }, h('span', { class: 'dot' }), s.name, h('span', { class: 'n', text: counts[s.id] || 0 }))));
  $('.tab.active')?.scrollIntoView({ inline: 'center', block: 'nearest' });

  const inTab = data.items.filter(i => i.status === tab);
  const groups = [...data.epics.map(e => ({ key: e.id, title: e.title })), { key: NO_EPIC, title: 'Без эпика' }];
  const sections = groups.map(g => {
    const its = inTab.filter(i => epicKey(i) === g.key);
    if (!its.length) return null;
    const isCollapsed = collapsed.has(g.key);
    return h('section', { class: 'group' + (isCollapsed ? ' collapsed' : '') },
      h('button', { class: 'group-head', onclick: () => toggleGroup(g.key) },
        h('span', { class: 'chev', text: '›' }), h('span', { class: 'gt', text: g.title }), h('span', { class: 'n', text: its.length })),
      isCollapsed ? null : h('div', { class: 'rows' }, its.map(rowEl)));
  }).filter(Boolean);
  $('#list').replaceChildren(...(sections.length ? sections : [h('div', { class: 'empty', text: 'Здесь пусто' })]));
}

function rowEl(it) {
  return h('button', { class: 'row' + (it.pending ? ' pending' : ''), onclick: () => !it.pending && openTask(it) },
    h('span', { class: 'rt', text: it.title }),
    it.body.trim() ? h('span', { class: 'has', text: '≡' }) : null);
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
  const input = h('input', { type: 'password', placeholder: 'ghp_…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const go = h('button', { class: 'btn primary wide' }, 'Подключить');
  go.addEventListener('click', async () => {
    const v = input.value.trim();
    if (!v) return;
    token = v;
    go.disabled = true;
    try { await pickProject(); } catch (e) { token = null; toast(e.message); go.disabled = false; }
  });
  $('#list').replaceChildren(h('div', { class: 'setup' },
    h('h2', { text: 'Подключение к GitHub' }),
    h('p', {}, 'Нужен classic-токен со scope ', h('code', { text: 'repo' }), ' и ', h('code', { text: 'project' }), '. Он хранится только на этом устройстве.'),
    h('a', { class: 'btn wide', href: TOKEN_URL, target: '_blank', rel: 'noopener' }, 'Создать токен на GitHub ↗'),
    input, go));
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
}

function chooseProject(p) {
  if (project?.id !== p.id) { data = null; store.del(LS.cache); tab = null; collapsed = new Set(); store.del(LS.collapsed); }
  project = { id: p.id, title: p.title };
  store.set(LS.project, project);
  render();
  load();
}

function openSheet(content, onClose = null) {
  sheetOnClose = onClose;
  $('#sheet').replaceChildren(h('div', { class: 'grab' }), content);
  $('#sheet').scrollTop = 0;
  $('#sheetWrap').classList.add('open');
}

function closeSheet(skipCallback = false) {
  const cb = sheetOnClose;
  sheetOnClose = null;
  $('#sheetWrap').classList.remove('open');
  document.activeElement?.blur?.();
  if (cb && !skipCallback) cb();
}

function chipGroup(options, value, onPick) {
  const wrap = h('div', { class: 'chips' });
  for (const o of options) {
    const b = h('button', { class: 'chip' + (o.id === value ? ' active' : ''), style: o.color ? `--c:${o.color}` : null },
      o.color ? h('span', { class: 'dot' }) : null, o.name);
    b.addEventListener('click', () => {
      wrap.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      b.classList.add('active');
      onPick(o.id);
    });
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
}

function openTask(it) {
  const title = h('textarea', { class: 't-title', rows: '1', enterkeyhint: 'done' });
  title.value = it.title;
  title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
  const body = h('textarea', { rows: '5', placeholder: 'Детали, ссылки, чек-лист…' });
  body.value = it.body;
  openSheet(h('div', {},
    title,
    h('div', { class: 'field-label', text: 'Статус' }),
    chipGroup(statusOptions(), it.status, id => setStatus(it, id)),
    h('div', { class: 'field-label', text: 'Эпик' }),
    chipGroup(epicOptions(), epicKey(it), id => setEpic(it, id === NO_EPIC ? null : id)),
    h('div', { class: 'field-label', text: 'Заметки' }),
    body,
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => move(it, 'top') }, '⇈ Наверх'),
      h('button', { class: 'btn', onclick: () => move(it, 'up') }, '↑'),
      h('button', { class: 'btn', onclick: () => move(it, 'down') }, '↓'),
      it.url ? h('a', { class: 'btn', href: it.url, target: '_blank', rel: 'noopener' }, `#${it.number} ↗`) : null),
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
  let statusId = tab;
  const title = h('textarea', { class: 't-title', rows: '1', placeholder: 'Что нужно сделать?', enterkeyhint: 'send' });
  const top = h('input', { type: 'checkbox' });
  const submit = () => {
    const t = title.value.trim();
    if (!t) return;
    store.set(LS.lastEpic, epicId);
    createTask({ title: t, epicId: epicId === NO_EPIC ? null : epicId, statusId, top: top.checked });
    title.value = '';
    title.style.height = 'auto';
    title.focus();
    toast('Добавлено');
  };
  title.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
  openSheet(h('div', {},
    h('h3', { text: 'Новая задача' }),
    title,
    h('div', { class: 'field-label', text: 'Эпик' }),
    chipGroup(epicOptions(), epicId, id => { epicId = id; }),
    h('div', { class: 'field-label', text: 'Статус' }),
    chipGroup(statusOptions(), statusId, id => { statusId = id; }),
    h('label', { class: 'toggle' }, top, 'В начало списка (важнее остальных)'),
    h('button', { class: 'btn primary wide', onclick: submit }, 'Добавить')));
  title.focus();
  autoGrow(title);
}

function openSettings() {
  openSheet(h('div', {},
    h('h3', { text: 'Настройки' }),
    h('p', { class: 'muted', text: project ? `Доска: ${project.title}` : 'Доска не выбрана' }),
    token ? h('button', { class: 'btn wide', onclick: async () => { closeSheet(); try { await pickProject(); } catch (e) { toast(e.message); } } }, 'Сменить доску') : null,
    token ? h('button', { class: 'btn danger wide', onclick: disconnect }, 'Отключить GitHub на этом устройстве') : null));
}

function disconnect() {
  if (!confirm('Удалить токен и кэш с этого устройства?')) return;
  Object.values(LS).forEach(k => store.del(k));
  token = project = data = tab = null;
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

function move(it, dir) {
  const siblings = data.items.filter(x => x.status === it.status && epicKey(x) === epicKey(it));
  const idx = siblings.indexOf(it);
  const rest = data.items.filter(x => x !== it);
  const before = x => rest[rest.indexOf(x) - 1] ?? null;
  let after;
  if (dir === 'top') { if (idx === 0) return; after = before(siblings[0]); }
  else if (dir === 'up') { if (idx === 0) return; after = before(siblings[idx - 1]); }
  else { if (idx === siblings.length - 1) return; after = siblings[idx + 1]; }
  const prevOrder = data.items;
  return mutate(() => {
    rest.splice(after ? rest.indexOf(after) + 1 : 0, 0, it);
    data.items = rest;
  }, () => { data.items = prevOrder; }, () => gql(M.position, { p: project.id, i: it.itemId, a: after?.itemId ?? null }));
}

async function createTask({ title, epicId, statusId, top }) {
  const epic = epicId ? data.epics.find(e => e.id === epicId) : null;
  const temp = { itemId: 'tmp-' + Date.now() + Math.random(), id: null, number: null, title, body: '', state: 'OPEN', url: null, status: statusId,
    parent: epic ? { id: epic.id, number: epic.number, title: epic.title } : null, pending: true };
  top ? data.items.unshift(temp) : data.items.push(temp);
  render();
  try {
    const issue = (await gql(M.create, { r: data.repoId, t: title, b: null, par: epic?.id ?? null })).createIssue.issue;
    const itemId = (await gql(M.addItem, { p: project.id, c: issue.id })).addProjectV2ItemById.item.id;
    await gql(M.placeNew, { p: project.id, i: itemId, f: data.fieldId, o: statusId, top });
    Object.assign(temp, { itemId, id: issue.id, number: issue.number, url: issue.url, pending: false });
    delete temp.pending;
    persistRender();
  } catch (e) {
    data.items = data.items.filter(x => x !== temp);
    persistRender();
    toast('Не создалось: ' + e.message);
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
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

$('#fab').addEventListener('click', () => data && openNew());
$('#refreshBtn').addEventListener('click', load);
$('#settingsBtn').addEventListener('click', openSettings);
$('#sheetWrap').addEventListener('click', e => { if (e.target.id === 'sheetWrap') closeSheet(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - lastLoad > 30000) load(); });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

render();
load();
