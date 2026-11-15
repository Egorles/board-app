(() => {
  const DAY = 864e5;
  const ago = d => new Date(Date.now() - d * DAY).toISOString();
  const statuses = ['Notes', 'Backlog', 'ToDo', 'Pause', 'In progress', 'Done'].map((n, i) => ({ id: 'o' + i, name: n, color: ['PURPLE', 'GRAY', 'BLUE', 'ORANGE', 'YELLOW', 'GREEN'][i] }));
  const epics = [{ id: 'E1', number: 1, title: 'Дом' }, { id: 'E2', number: 7, title: 'Проект Альфа' }, { id: 'E3', number: 9, title: 'Проект Бета' }];
  const age = { E1: 30, E2: 1, E3: 0.05 };
  const titles = ['Записаться к стоматологу', 'Оплатить налоги', 'Собрать отчёт', 'Длинное название задачи, которое переносится на несколько строк и проверяет вёрстку', 'Продлить страховку', 'Проверить показания счётчиков', 'Сравнить тарифы интернета', 'Настроить будильник', 'Помыть окна', 'Почистить телефон', 'Починить кран', 'Вести расходы', 'Разобрать почту'];
  const items = titles.map(t => ['o2', 'E1', t])
    .concat([['o2', 'E2', 'Собрать прототип'], ['o1', 'E3', 'Подготовить презентацию'], ['o2', null, 'Задача без эпика'], ['o5', 'E1', 'Сдать анализы'], ['o5', 'E1', 'Купить фильтры на воду'], [null, 'E3', 'Задача из удалённого статуса']])
    .map(([s, e, t], i) => ({ id: 'PVTI' + i, isArchived: false, fieldValueByName: s ? { optionId: s } : null, content: { __typename: 'Issue', id: 'I' + i, number: 10 + i, title: t, body: i === 1 ? 'детали' : '', state: s === 'o5' ? 'CLOSED' : 'OPEN', url: 'https://github.com/', createdAt: ago(e ? age[e] : 40), parent: e ? epics.find(x => x.id === e) : null } }));
  let n = 100;
  window.__calls = [];
  window.__scopes = localStorage.getItem('mock.scopes') || 'project, repo';
  const answer = (q, v) => {
    if (q.includes('viewer')) return { viewer: { login: 'tester', projectsV2: { nodes: [{ id: 'P1', number: 2, title: 'Personal Board', closed: false }] } } };
    if (q.includes('items(first:100')) return { node: { title: 'Personal Board', field: { id: 'F', options: statuses }, repositories: { nodes: [{ id: 'R' }] }, items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: items } } };
    if (q.includes('labels:["epic"]')) return { node: { label: { id: 'L1' }, issues: { nodes: epics } } };
    if (q.includes('labelIds')) { n++; return { createIssue: { issue: { id: 'E' + n, number: n, title: v.t, url: 'https://github.com/' } } }; }
    if (q.includes('createIssue(')) { n++; return { createIssue: { issue: { id: 'I' + n, number: n, url: 'https://github.com/', projectItems: { nodes: [{ id: 'PVTI' + n, project: { id: 'P1' } }] } } } }; }
    if (q.includes('updateProjectV2Field(')) return { updateProjectV2Field: { projectV2Field: { options: v.o.map((o, i) => ({ id: o.id || 'new' + i, name: o.name, color: o.color, description: o.description })) } } };
    if (q.includes('addProjectV2ItemById')) return { addProjectV2ItemById: { item: { id: 'PVTI' + n } } };
    return {};
  };
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.github.com/graphql')) {
      if (localStorage.getItem('mock.offline') === '1') throw new TypeError('Failed to fetch');
      const auth = opts.headers.Authorization;
      if (localStorage.getItem('mock.badToken') === auth) return new Response('{}', { status: 401 });
      const { query, variables } = JSON.parse(opts.body);
      window.__calls.push({ q: query.replace(/\s+/g, ' '), variables, auth });
      await new Promise(r => setTimeout(r, 250));
      return new Response(JSON.stringify({ data: answer(query, variables) }), { status: 200, headers: { 'Content-Type': 'application/json', 'X-OAuth-Scopes': window.__scopes } });
    }
    return realFetch(url, opts);
  };
  if (!location.search.includes('coach') && !localStorage.getItem('pb.coachSeen')) localStorage.setItem('pb.coachSeen', 'true');
  if (!location.search.includes('fresh') && !localStorage.getItem('pb.token')) {
    localStorage.setItem('pb.token', JSON.stringify('mock-token'));
    localStorage.setItem('pb.project', JSON.stringify({ id: 'P1', title: 'Personal Board' }));
  }
})();
