(() => {
  const DAY = 864e5;
  const ago = d => new Date(Date.now() - d * DAY).toISOString();
  const statuses = ['Notes', 'Backlog', 'ToDo', 'Pause', 'In progress', 'Done'].map((n, i) => ({ id: 'o' + i, name: n, color: ['PURPLE', 'GRAY', 'BLUE', 'ORANGE', 'YELLOW', 'GREEN'][i] }));
  const projects = [{ id: 'E1', name: 'Дом', color: 'BLUE', description: '' }, { id: 'E2', name: 'Проект Альфа', color: 'PINK', description: '' }, { id: 'E3', name: 'Проект Бета', color: 'GREEN', description: '' }];
  const subIssues = { I1: [{ id: 'S1', number: 201, title: 'Подзадача один', url: 'https://github.com/', state: 'CLOSED' }, { id: 'S2', number: 202, title: 'Подзадача два', url: 'https://github.com/', state: 'OPEN' }, { id: 'S3', number: 203, title: 'Подзадача три', url: 'https://github.com/', state: 'OPEN' }] };
  const age = { E1: 30, E2: 1, E3: 0.05 };
  const titles = ['Записаться к стоматологу', 'Оплатить налоги', 'Собрать отчёт', 'Длинное название задачи, которое переносится на несколько строк и проверяет вёрстку', 'Продлить страховку', 'Проверить показания счётчиков', 'Сравнить тарифы интернета', 'Настроить будильник', 'Помыть окна', 'Почистить телефон', 'Починить кран', 'Вести расходы', 'Разобрать почту'];
  const items = titles.map(t => ['o2', 'E1', t])
    .concat([['o2', 'E2', 'Собрать прототип'], ['o1', 'E3', 'Подготовить презентацию'], ['o2', null, 'Задача без проекта'], ['o5', 'E1', 'Сдать анализы'], ['o5', 'E1', 'Купить фильтры на воду'], [null, 'E3', 'Задача из удалённого статуса']])
    .map(([s, e, t], i) => ({ id: 'PVTI' + i, isArchived: false, fieldValueByName: s ? { optionId: s } : null, proj: e ? { optionId: e } : null, content: { __typename: 'Issue', id: 'I' + i, number: 10 + i, title: t, body: i === 1 ? 'детали' : i === 2 ? 'План:\n- Первый пункт\n- Второй пункт\n• Третий пункт' : '', state: s === 'o5' ? 'CLOSED' : 'OPEN', url: 'https://github.com/', createdAt: ago(e ? age[e] : 40), parent: null, subIssuesSummary: subIssues['I' + i] ? { total: subIssues['I' + i].length, completed: subIssues['I' + i].filter(x => x.state === 'CLOSED').length } : { total: 0, completed: 0 } } }));
  let n = 100;
  window.__calls = [];
  window.__scopes = localStorage.getItem('mock.scopes') || 'project, repo';
  const answer = (q, v) => {
    if (q.includes('viewer')) return { viewer: { login: 'tester', projectsV2: { nodes: [{ id: 'P1', number: 2, title: 'Personal Board', closed: false }] } } };
    if (q.includes('items(first:100')) return { node: { title: 'Personal Board', field: { id: 'F', options: statuses }, pf: localStorage.getItem('mock.noProjectField') ? null : { id: 'PF', options: projects }, repositories: { nodes: [{ id: 'R' }] }, items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: items } } };
    if (q.includes('subIssues(first:100)')) return { node: { subIssues: { nodes: subIssues[v.i] || [] } } };
    if (q.includes('createIssue(') && !q.includes('projectV2Ids')) { n++; return { createIssue: { issue: { id: 'S' + n, number: n, title: v.t, url: 'https://github.com/', state: 'OPEN' } } }; }
    if (q.includes('createProjectV2Field')) return { createProjectV2Field: { projectV2Field: { id: 'PF', options: v.o.map((o, i) => ({ id: 'new' + i, ...o })) } } };
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
      const failPlace = +(localStorage.getItem('mock.failPlace') || 0);
      if (failPlace > 0 && query.includes('s:updateProjectV2ItemFieldValue')) {
        localStorage.setItem('mock.failPlace', String(failPlace - 1));
        window.__calls.push({ q: 'FAILED ' + query.replace(/\s+/g, ' '), variables, auth });
        return new Response(JSON.stringify({ errors: [{ type: 'NOT_FOUND', message: 'Could not resolve to ProjectV2Item' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      window.__calls.push({ q: query.replace(/\s+/g, ' '), variables, auth });
      await new Promise(r => setTimeout(r, 250));
      const missingField = localStorage.getItem('mock.noProjectField') && query.includes('pf:field') ? [{ type: 'NOT_FOUND', path: ['node', 'pf'], message: 'Could not resolve to a Unions::ProjectV2FieldConfiguration with the name Проект' }] : null;
      return new Response(JSON.stringify({ data: answer(query, variables), ...(missingField ? { errors: missingField } : {}) }), { status: 200, headers: { 'Content-Type': 'application/json', 'X-OAuth-Scopes': window.__scopes } });
    }
    return realFetch(url, opts);
  };
  if (!location.search.includes('coach') && !localStorage.getItem('pb.coachSeen')) localStorage.setItem('pb.coachSeen', 'true');
  if (!location.search.includes('fresh') && !localStorage.getItem('pb.token')) {
    localStorage.setItem('pb.token', JSON.stringify('mock-token'));
    localStorage.setItem('pb.project', JSON.stringify({ id: 'P1', title: 'Personal Board' }));
  }
})();
