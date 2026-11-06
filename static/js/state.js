/* One store for every panel: server data, the current scope, the selection, and the timer actions.
   Panels render from S and re-render on its events: data, scope, select, tick. */
(function () {
  const S = (window.S = {
    d: { projects: [], clients: [], tasks: [], options: {}, presets: [], timer: null, settings: {}, palette: [], statuses: [] },
    entries: [],                      // every entry; panels filter by scope and period
    seeds: { tasks: {}, presets: [] },// server-built timer seeds (last-used labels), from /api/quickstart
    scope: { view: 'now', client: '', project: '' },   // view: now | unfiled | projects | client | project
    sel: null,                        // {type: 'timer'|'entry'|'task'|'project', id}
    _h: {}, _last: '',
  });

  S.on = (ev, fn) => { (S._h[ev] = S._h[ev] || []).push(fn); return () => { S._h[ev] = S._h[ev].filter(f => f !== fn); }; };
  S.emit = (ev, a) => (S._h[ev] || []).slice().forEach(f => { try { f(a); } catch (e) { console.error(ev, e); } });

  // ── Loading ───────────────────────────────────────────────────────────────────
  S.refresh = async () => {
    const st = await U.api('GET', '/api/state');                 // may auto-stop a forgotten timer, so entries come after
    const [ents, qs] = await Promise.all([U.api('GET', '/api/entries'), U.api('GET', '/api/quickstart')]);
    const fingerprint = JSON.stringify([st, ents, qs]);
    const changed = fingerprint !== S._last;
    S._last = fingerprint;
    S.d = st; S.entries = ents; S.seeds = { tasks: Object.fromEntries(qs.tasks.map(t => [t.id, t])), presets: qs.presets };
    if (st.auto_stopped) {
      const e = st.auto_stopped;
      U.toast(`A timer was left running and was stopped at ${U.niceDT(e.end_time)} (“${e.description || 'untitled'}”). Check its end time.`, { ms: 12000 });
    }
    if (changed) S.emit('data');
    return changed;
  };
  S.poll = () => setInterval(() => { if (!document.hidden && !S._busy) S.refresh().catch(() => {}); }, 20000);
  // run an action, then reload from the server so the screen always shows what's really on disk
  S.act = async fn => { S._busy = true; try { const r = await fn(); await S.refresh(); return r; } catch (e) { U.fail(e); throw e; } finally { S._busy = false; } };

  // ── Scope (set by the Navigator, followed by Tasks, Timesheet, Week, Presets) ─────────────
  const parseHash = () => {
    const p = decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/');
    if (p[0] === 'c' && p[1]) return { view: 'client', client: p[1], project: '' };
    if (p[0] === 'p' && p[2]) return { view: 'project', client: p[1], project: p.slice(2).join('/') };
    if (['now', 'unfiled', 'projects'].includes(p[0])) return { view: p[0], client: '', project: '' };
    return null;
  };
  const hashOf = s => ({ now: '#/now', unfiled: '#/unfiled', projects: '#/projects',
    client: '#/c/' + encodeURIComponent(s.client), project: '#/p/' + encodeURIComponent(s.client) + '/' + encodeURIComponent(s.project) }[s.view]);
  S.setScope = (scope, { silent } = {}) => {
    S.scope = { view: scope.view, client: scope.client || '', project: scope.project || '' };
    U.setPref('scope', S.scope);
    if (location.hash !== hashOf(S.scope)) history.replaceState(null, '', hashOf(S.scope));
    if (!silent) S.emit('scope');
  };
  S.initScope = () => {
    S.scope = parseHash() || U.pref('scope', null) || S.scope;
    S.setScope(S.scope, { silent: true });
    addEventListener('hashchange', () => { const s = parseHash(); if (s && hashOf(s) !== hashOf(S.scope)) { S.scope = s; S.emit('scope'); } });
  };
  S.scopeTitle = () => ({ now: 'Now', unfiled: 'Unfiled', projects: 'All projects', client: S.scope.client, project: S.scope.project }[S.scope.view]);
  S.inScope = rec => {                       // entries, tasks and presets all carry client + project
    const { view, client, project } = S.scope, c = rec.client || '', p = rec.project || '';
    if (client && c !== client) return false;
    if (view === 'project' && p !== project) return false;
    if (view === 'unfiled' && p) return false;
    return true;
  };
  S.scopeClients = () => (S.scope.client ? [S.scope.client] : S.d.clients.map(c => c.name));

  // ── Money is optional: only clients with a rate have it ───────────────────────────────
  S.client = name => S.d.clients.find(c => c.name === name);
  S.rateOf = name => { const r = (S.client(name) || {}).rate; return r > 0 ? r : null; };
  S.cur = () => S.d.settings.currency || '$';

  // ── Hours: the one place that sums time, running timer included ───────────────────────
  S.entryHours = e => {
    if (e.end_time) return e.duration_hours || 0;
    const t = S.d.timer;
    if (t && t.entry_id === e.id && t.start_epoch) return Math.max(0, (Date.now() / 1000 - t.start_epoch) / 3600);
    return 0;
  };
  S.sumHours = list => list.reduce((a, e) => a + S.entryHours(e), 0);
  // Total money for these entries, or null unless every client involved has a rate.
  S.sumMoney = list => {
    const byClient = {};
    list.forEach(e => { byClient[e.client || ''] = (byClient[e.client || ''] || 0) + S.entryHours(e); });
    const names = Object.keys(byClient);
    if (!names.length || names.some(n => !S.rateOf(n))) return null;
    return names.reduce((a, n) => a + byClient[n] * S.rateOf(n), 0);
  };

  // ── Colours: one per project, from the server (stable), with a hash fallback ──────────
  const FALLBACK = ['#5B8DEF', '#EC6FA6', '#E5A03C', '#9B7BF0', '#3BBCD6', '#EF6B5A', '#B8A13B', '#C462D8', '#6E86B8', '#B07A55'];
  S.projectColor = (name, client) => {
    if (!name) return '';
    const p = S.d.projects.find(x => x.name === name && (x.client || '') === (client || '')) || S.d.projects.find(x => x.name === name);
    if (p && p.color) return p.color;
    let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return FALLBACK[h % FALLBACK.length];
  };
  S.clientColor = name => (S.client(name) || {}).color || '#667085';

  // ── Selection (the Inspector follows it) ──────────────────────────────────────────────
  S.select = sel => { S.sel = sel; S.emit('select'); };
  // Add a task to whatever the Navigator is showing (a project, or a client), with Undo. Used by the Tasks box and the timer bar.
  S.addTask = async name => {
    name = (name || '').trim(); if (!name) return null;
    const s = S.scope, body = { task: name };
    if (s.view === 'project') { body.project = s.project; body.client = s.client || (S.project(s.project, s.client) || {}).client || ''; }
    if (s.view === 'client' && s.client) body.client = s.client;
    const t = await S.act(() => U.api('POST', '/api/tasks', body));
    const where = body.project || body.client;
    U.toast(`Task added${where ? ' to ' + where : ''}`, t && t.id ? { undo: () => S.act(() => U.api('DELETE', `/api/tasks/${t.id}`)) } : {});
    return t;
  };

  // ── Timer actions ─────────────────────────────────────────────────────────────────────
  S.timer = () => S.d.timer;
  S.elapsed = () => (S.d.timer && S.d.timer.start_epoch ? Date.now() / 1000 - S.d.timer.start_epoch : 0);

  // seed: {client, project, description, area, operation, task_id?, preset_id?}
  S.startTimer = async seed => {
    seed = { ...seed, client: seed.client ?? S.scope.client };
    const cur = S.d.timer;
    if (cur) {
      const ok = await U.confirm('Switch timer?', `“${cur.description || 'Untitled'}” is running. Stop it and start “${seed.description || 'Untitled'}”?`, { ok: 'Stop and start' });
      if (!ok) return false;
    }
    await S.act(async () => { if (cur) await U.api('POST', '/api/timer/stop'); await U.api('POST', '/api/timer/start', seed); });
    return true;
  };
  S.stopTimer = () => S.act(() => U.api('POST', '/api/timer/stop'));
  S.discardTimer = async () => {
    const t = S.d.timer; if (!t) return;
    if (!(await U.confirm('Discard this timer?', `“${t.description || 'Untitled'}” will be deleted, not saved.`, { ok: 'Discard', danger: true }))) return;
    await S.act(() => U.api('DELETE', '/api/timer'));
  };
  // Seed for a task's ▶: the server's (remembers last labels), else built from the task itself.
  S.taskSeed = t => {
    const s = S.seeds.tasks[t.id];
    const base = s ? { client: s.client, project: s.project, description: s.description, area: s.area, operation: s.operation } :
      { client: t.client || '', project: t.project || '', description: t.task, area: t.work_area || '', operation: t.operation || '' };
    return { ...base, task_id: t.id };
  };
  S.runningTaskId = () => { const t = S.d.timer; if (!t) return null; const e = S.entries.find(x => x.id === t.entry_id); return e && e.task_id; };

  // ── Tasks: repeat rules, show-dates, "open" ───────────────────────────────────────────
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
  S.ruleOf = t => {                                   // normalised view of t.recurrence (legacy strings too)
    const r = t.recurrence; if (!r) return null;
    const base = typeof r === 'string' ? { freq: r, weekend: 'keep' } : r;
    const anchor = t.occurrence || t.due, d = anchor ? new Date(anchor + 'T12:00') : null;
    return { freq: base.freq, weekend: base.weekend || 'before', lead_days: base.lead_days ?? 3, unscheduled: !anchor,
      day: base.day || (d ? d.getDate() : 1), weekday: base.weekday ?? (d ? (d.getDay() + 6) % 7 : 0) };
  };
  S.repeatLabel = r => !r ? '' : r.unscheduled ? `${r.freq} · no date set` : r.freq === 'monthly' ? `monthly · ${ordinal(r.day)}`
    : r.freq === 'weekly' ? `weekly · ${WD[r.weekday]}` : r.freq;
  S.showDate = t => {                                 // a repeating copy stays hidden until `lead_days` before its date
    const r = S.ruleOf(t);
    if (t.done || !r || r.unscheduled || !t.due) return null;
    const d = new Date(t.due + 'T12:00'); d.setDate(d.getDate() - r.lead_days);
    return U.ymd(d);
  };
  S.notYet = t => { const sd = S.showDate(t); return !!sd && sd > U.today(); };
  S.isOpen = t => !t.done && !t.someday && !S.notYet(t);
  S.taskInProject = (t, name, client) => t.project === name && (!t.client || (t.client || '') === (client || ''));
  S.isArchived = p => p.status === 'completed' || p.status === 'archived';
  S.project = (name, client) => S.d.projects.find(p => p.name === name && (p.client || '') === (client || ''));
  S.taskInScope = t => {
    const { view, client, project } = S.scope;
    if (view === 'project') return S.taskInProject(t, project, client);
    if (view === 'client') return (t.client || '') === client;
    if (view === 'unfiled') return !t.project;
    return true;
  };

  setInterval(() => S.emit('tick'), 1000);
})();
