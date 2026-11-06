/* Tasks: the open list for the current scope, with a ▶ on every row that starts a timer. */
(function () {
  const esc = U.esc;
  const CTX = [['computer', 'Computer'], ['phone', 'Phone'], ['errands', 'Errands'], ['home', 'Home'], ['anywhere', 'Anywhere']];
  const TOD = [['morning', 'Morning'], ['afternoon', 'Afternoon'], ['evening', 'Evening']];
  const ui = () => ({ ctx: '', tod: '', sort: 'due', doneOpen: false, upcomingOpen: false, ...U.pref('tasksUI', {}) });
  const setUi = patch => U.setPref('tasksUI', { ...ui(), ...patch });
  const fmtDate = s => { const d = U.parseD(s); return d ? `${U.MON[d.getMonth()]} ${d.getDate()}${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''}` : ''; };

  // tasks for this scope; done / upcoming / open
  function list(kind) {
    const u = ui();
    let l = S.d.tasks.filter(t => S.taskInScope(t) && (kind === 'done' ? t.done : !t.done && (kind === 'upcoming') === S.notYet(t)));
    if (kind !== 'done') {
      if (u.ctx) l = l.filter(t => (t.trigger || 'anywhere') === u.ctx || (t.trigger || 'anywhere') === 'anywhere');
      if (u.tod) l = l.filter(t => (t.time_of_day || 'anytime') === u.tod || (t.time_of_day || 'anytime') === 'anytime');
    }
    if (kind === 'done') return l.sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''));
    const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || (a.created || '').localeCompare(b.created || '');
    if (u.sort === 'manual' && kind === 'open') {
      const has = t => typeof t.order === 'number';
      return l.sort((a, b) => (has(b) - has(a)) || (has(a) ? a.order - b.order : 0) || byDue(a, b));
    }
    return l.sort(byDue);
  }

  function row(t) {
    const chips = [], today = U.today(), run = S.runningTaskId() === t.id;
    if (t.due && !t.done) chips.push(`<span class="chip ${t.due < today ? 'late' : t.due === today ? 'today' : ''}">${esc(fmtDate(t.due))}</span>`);
    if (t.work_area || t.operation) chips.push(`<span class="chip">${esc([t.work_area, t.operation].filter(Boolean).join(' · '))}</span>`);
    if (t.trigger && t.trigger !== 'anywhere') chips.push(`<span class="chip">${esc((CTX.find(c => c[0] === t.trigger) || [])[1] || t.trigger)}</span>`);
    if (t.time_of_day && t.time_of_day !== 'anytime') chips.push(`<span class="chip">${esc(t.time_of_day)}</span>`);
    if (t.subtasks && t.subtasks.length) chips.push(`<span class="chip">${t.subtasks.filter(s => s.done).length}/${t.subtasks.length}</span>`);
    if (t.missed && !t.done) chips.push(`<span class="chip late" title="Older copies of this repeating task are still open">${t.missed}× missed</span>`);
    const rr = S.ruleOf(t);
    if (rr && !t.done) chips.push(`<span class="chip" title="${rr.unscheduled ? 'Set a due date so it can repeat.' : `Repeats ${esc(S.repeatLabel(rr))}; the next copy appears ${rr.lead_days} day(s) before its date.`}">↻ ${esc(S.repeatLabel(rr))}</span>`);
    if (S.notYet(t)) chips.push(`<span class="chip" title="Hidden from your lists until then">shows ${esc(fmtDate(S.showDate(t)))}</span>`);
    if (t.skipped) chips.push('<span class="chip">skipped</span>');
    const showProj = (S.scope.view === 'now' || S.scope.view === 'client' || S.scope.view === 'projects') && t.project;
    if (showProj) chips.push(`<span class="chip fill">${t.client ? `<span class="dot" style="background:${esc(S.clientColor(t.client))};width:6px;height:6px"></span>` : ''}${esc(t.project)}</span>`);
    const sel = S.sel && S.sel.type === 'task' && S.sel.id === t.id;
    return `<div class="task ${t.done ? 'is-done' : ''} ${run ? 'running' : ''} ${sel ? 'sel' : ''}" tabindex="0" draggable="true" data-id="${esc(t.id)}" ${t.project ? `style="--pc:${esc(S.projectColor(t.project, t.client))}"` : ''}>
      ${t.done ? '' : `<button class="play" data-act="play" title="${run ? 'Running' : 'Start a timer on this task'}" ${run ? 'disabled' : ''}>${run ? '●' : '▶'}</button>`}
      <button class="chk" data-act="${t.done ? 'undone' : 'done'}" aria-label="${t.done ? 'Mark not done' : 'Mark done'}">${t.done ? '✓' : ''}</button>
      <span class="t-name">${esc(t.task)}</span><span class="chips">${chips.join('')}</span>
      <button class="more" data-act="menu" aria-label="Task actions" aria-haspopup="menu">···</button></div>`;
  }

  function head() {
    const s = S.scope;
    if (s.view === 'project') {
      const p = S.project(s.project, s.client) || {};
      return `<div class="view-head"><div class="grow"><div class="view-title"><span class="dot" style="background:${esc(S.projectColor(s.project, s.client))};width:10px;height:10px"></span>${esc(s.project)}</div>
        <div class="view-sub">${p.status ? `<span class="chip">${esc(p.status.replace('_', ' '))}</span>` : ''}${s.client ? `<span>${esc(s.client)}</span>` : ''}${p.deadline ? `<span class="chip ${p.deadline < U.today() ? 'late' : ''}">⏱ ${esc(fmtDate(p.deadline))}</span>` : ''}
        <span>${p.month_hours > 0 ? `<b>${p.month_hours}h</b> this month` : 'no time this month'} · ${p.total_hours || 0}h total</span></div></div>
        <button class="btn sm" data-act="pdetails">Project details</button></div>`;
    }
    if (s.view === 'client') {
      const live = S.d.projects.filter(p => (p.client || '') === s.client && !S.isArchived(p)).length;
      return `<div class="view-head"><div class="grow"><div class="view-title">${s.client ? `<span class="dot" style="background:${esc(S.clientColor(s.client))};width:10px;height:10px"></span>` : ''}${esc(s.client || 'No client')}</div>
        <div class="view-sub">Every task for this client · ${live} active project${live === 1 ? '' : 's'}</div></div></div>`;
    }
    return `<div class="view-head"><div class="grow"><div class="view-title">${s.view === 'unfiled' ? 'Unfiled' : 'Now'}</div><div class="view-sub">${s.view === 'unfiled' ? 'Open tasks with no project' : 'Every open task'}</div></div></div>`;
  }

  function render(el) {
    const s = S.scope, u = ui();
    if (s.view === 'projects') { el.innerHTML = `<div class="panel"><div class="empty">Pick a client or project in the Navigator to see its tasks.<br>The <b>Projects</b> panel shows the overview.</div></div>`; return; }
    const openL = list('open'), doneL = list('done'), soon = list('upcoming');
    const where = s.view === 'project' ? s.project : s.view === 'client' ? s.client : '';
    const pill = (attr, v, label, on) => `<button class="pill ${on ? 'on' : ''}" ${attr}="${v}">${label}</button>`;
    el.innerHTML = `<div class="panel roomy">${head()}
      <input class="quickadd" id="qa" autocomplete="off" placeholder="Add a task${where ? ' to ' + esc(where) : ''}… (press Enter)">
      <div class="filters"><span class="lbl">Context</span>${pill('data-ctx', '', 'All', !u.ctx)}${CTX.map(([k, l]) => pill('data-ctx', k, l, u.ctx === k)).join('')}
        <span class="lbl" style="margin-left:10px">Time</span>${pill('data-tod', '', 'All', !u.tod)}${TOD.map(([k, l]) => pill('data-tod', k, l, u.tod === k)).join('')}
        <span class="lbl" style="margin-left:10px">Sort</span>${pill('data-sort', 'due', 'Due date', u.sort !== 'manual')}${pill('data-sort', 'manual', 'Manual', u.sort === 'manual')}</div>
      <div id="openList" class="${u.sort === 'manual' ? 'manual' : ''}">${openL.length ? openL.map(row).join('') : `<div class="empty">${u.ctx || u.tod ? 'Nothing matches these filters.' : 'Nothing open here.'}</div>`}</div>
      ${soon.length ? `<button class="fold" data-act="fold-up">${u.upcomingOpen ? '▾' : '▸'} Upcoming <span class="muted">appear closer to their date</span><span class="n">${soon.length}</span></button>${u.upcomingOpen ? soon.map(row).join('') : ''}` : ''}
      ${doneL.length ? `<button class="fold" data-act="fold-done">${u.doneOpen ? '▾' : '▸'} Done<span class="n">${doneL.length}</span></button>${u.doneOpen ? doneL.slice(0, 50).map(row).join('') : ''}` : ''}</div>`;
  }

  // ── actions ──────────────────────────────────────────────────────────────────
  const byId = id => S.d.tasks.find(t => t.id === id);
  const done = async id => { const t = byId(id); if (!t) return; try { await S.act(() => U.api('POST', `/api/tasks/${id}/done`)); U.toast(`Done: ${t.task}`, { undo: () => S.act(() => U.api('POST', `/api/tasks/${id}/undone`)) }); } catch (e) { /* shown */ } };
  const undone = async id => { try { await S.act(() => U.api('POST', `/api/tasks/${id}/undone`)); U.toast('Moved back to open'); } catch (e) { /* shown */ } };
  const skip = async id => { const t = byId(id); if (!t) return; try { await S.act(() => U.api('POST', `/api/tasks/${id}/done?skip=1`)); U.toast(`Skipped: ${t.task}`, { undo: () => S.act(() => U.api('POST', `/api/tasks/${id}/undone`)) }); } catch (e) { /* shown */ } };
  const del = async id => {
    const t = byId(id); if (!t) return;
    try { const removed = await S.act(() => U.api('DELETE', `/api/tasks/${id}`)); U.toast(`Deleted: ${t.task}`, { undo: () => S.restoreTask(removed) }); } catch (e) { /* shown */ }
  };
  const dup = async id => { try { const d = await S.act(() => U.api('POST', `/api/tasks/${id}/duplicate`)); S.select({ type: 'task', id: d.id }); U.toast('Duplicated'); } catch (e) { /* shown */ } };
  const stopRepeat = async id => { try { await S.act(() => U.api('PATCH', `/api/tasks/${id}`, { recurrence: null })); U.toast('Stopped repeating'); } catch (e) { /* shown */ } };
  const open = id => { S.select({ type: 'task', id }); Workspaces.reveal('inspector'); };

  async function quickAdd(input) {
    if (!input.value.trim()) return;
    input.disabled = true;
    try { await S.addTask(input.value); input.value = ''; } catch (e) { /* shown */ }
    input.disabled = false; input.focus();
  }

  function menuFor(id) {
    const t = byId(id); if (!t) return [];
    const projs = S.d.projects.filter(p => !S.isArchived(p)).slice(0, 14);
    const items = [];
    if (!t.done) items.push({ label: '▶ Start timer', onClick: () => S.startTimer(S.taskSeed(t)) });
    items.push({ label: '+ Create time entry…', onClick: () => Timesheet.editEntry(S.taskSeed(t), { prefill: true }) });   // log time without the timer
    items.push({ label: 'Open details', onClick: () => open(id) }, { label: 'Duplicate', onClick: () => dup(id) }, { sep: true });
    items.push(t.done ? { label: 'Mark not done', onClick: () => undone(id) } : { label: 'Mark done', onClick: () => done(id) });
    if (!t.done && t.series_id) items.push({ label: 'Skip this one', onClick: () => skip(id) });
    if (t.recurrence && !t.done) items.push({ label: 'Stop repeating', onClick: () => stopRepeat(id) });
    items.push({ sep: true }, { header: 'Move to project' }, { label: '(Unfiled)', checked: !t.project, onClick: () => U.moveTask(id, { view: 'unfiled' }) });
    projs.forEach(p => items.push({ label: `${p.name}${p.client ? ' · ' + p.client : ''}`, checked: S.taskInProject(t, p.name, p.client) && !!t.project, onClick: () => U.moveTask(id, { view: 'project', client: p.client || '', project: p.name }) }));
    items.push({ sep: true }, { label: 'Delete…', danger: true, onClick: async () => { if (await U.confirm('Delete this task?', `“${t.task}” will be removed. You can undo right after.`, { ok: 'Delete', danger: true })) del(id); } });
    return items;
  }

  // manual ordering: drop a row before / after another (ported from the Projects app)
  async function reorder(id, targetId, after) {
    const ids = list('open').map(t => t.id).filter(x => x !== id);
    let i = ids.indexOf(targetId); if (i < 0) return;
    if (after) i += 1;
    ids.splice(i, 0, id);
    const ord = x => byId(x).order;
    try {
      await S.act(async () => {
        if (ids.every(x => typeof ord(x) === 'number' || x === id)) {
          const p = ids[i - 1], n = ids[i + 1];
          await U.api('PATCH', `/api/tasks/${id}`, { order: p && n ? (ord(p) + ord(n)) / 2 : p ? ord(p) + 1024 : n ? ord(n) - 1024 : 0 });
        } else {                                         // first manual drag here: number the whole list
          for (const [k, x] of ids.entries()) if (ord(x) !== (k + 1) * 1024) await U.api('PATCH', `/api/tasks/${x}`, { order: (k + 1) * 1024 });
        }
      });
    } catch (e) { /* shown */ }
  }

  function setup(el, redraw) {
    el.addEventListener('click', e => {
      const t = e.target;
      const pill = t.closest('[data-ctx],[data-tod],[data-sort]');
      if (pill) { setUi(pill.hasAttribute('data-ctx') ? { ctx: pill.dataset.ctx } : pill.hasAttribute('data-tod') ? { tod: pill.dataset.tod } : { sort: pill.dataset.sort }); return redraw(); }
      const a = t.closest('[data-act]'), row = t.closest('.task');
      if (a && a.dataset.act === 'fold-done') { setUi({ doneOpen: !ui().doneOpen }); return redraw(); }
      if (a && a.dataset.act === 'fold-up') { setUi({ upcomingOpen: !ui().upcomingOpen }); return redraw(); }
      if (a && a.dataset.act === 'pdetails') { S.select({ type: 'project', name: S.scope.project, client: S.scope.client }); return Workspaces.reveal('inspector'); }
      if (!row) return;
      const id = row.dataset.id, act = a && a.dataset.act;
      if (act === 'play') { const tk = byId(id); return tk && S.startTimer(S.taskSeed(tk)).catch(() => {}); }
      if (act === 'done') return done(id);
      if (act === 'undone') return undone(id);
      if (act === 'menu') { const r = a.getBoundingClientRect(); return U.menu(r.left, r.bottom, menuFor(id)); }
      open(id);
    });
    el.addEventListener('keydown', e => {
      if (e.target.id === 'qa' && e.key === 'Enter') return quickAdd(e.target);
      const row = e.target.closest && e.target.closest('.task');
      if (row && e.target === row && (e.key === 'Enter')) open(row.dataset.id);
      if (row && e.target === row && e.key === ' ') { e.preventDefault(); const t = byId(row.dataset.id); if (t && !t.done) S.startTimer(S.taskSeed(t)).catch(() => {}); }
    });
    U.onContext(el, '.task', row => menuFor(row.dataset.id));
    // drag: to the Navigator (move) or onto another row (manual order)
    let dragId = null;
    el.addEventListener('dragstart', e => { const r = e.target.closest('.task'); if (!r) return; dragId = r.dataset.id; S.dragging = { task: dragId }; e.dataTransfer.setData('application/x-clockin-task', dragId); e.dataTransfer.effectAllowed = 'copyMove'; r.classList.add('dragging'); });   // copy: onto the Week timeline
    el.addEventListener('dragend', () => { dragId = null; S.dragging = null; el.querySelectorAll('.dragging,.drop-before,.drop-after').forEach(x => x.classList.remove('dragging', 'drop-before', 'drop-after')); });
    el.addEventListener('dragover', e => {
      if (!dragId || ui().sort !== 'manual') return;
      const r = e.target.closest('#openList .task'); el.querySelectorAll('.drop-before,.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
      if (!r || r.dataset.id === dragId) return;
      e.preventDefault(); const b = r.getBoundingClientRect(); r.classList.add(e.clientY > b.top + b.height / 2 ? 'drop-after' : 'drop-before');
    });
    el.addEventListener('drop', e => {
      const r = e.target.closest('#openList .task'); if (!dragId || !r || ui().sort !== 'manual' || r.dataset.id === dragId) return;
      e.preventDefault(); const after = r.classList.contains('drop-after'); reorder(dragId, r.dataset.id, after);
    });
  }

  U.definePanel('tasks', { title: 'Tasks', events: ['data', 'scope', 'select'], render, setup });
})();
