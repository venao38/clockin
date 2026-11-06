/* Inspector: edits whatever is selected — the running timer, a task, or a project. One editor instead of three. */
(function () {
  const esc = U.esc;
  const field = (label, html) => `<label class="field"><span>${label}</span>${html}</label>`;
  const opt = (v, cur, label) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label ?? v)}</option>`;
  const dl = (id, arr) => `<datalist id="${id}">${arr.map(x => `<option value="${esc(x)}">`).join('')}</datalist>`;
  const projectsOf = client => S.d.projects.filter(p => (p.client || '') === (client || '') && !S.isArchived(p)).map(p => p.name);
  const optionsFor = client => S.d.options[client] || S.d.options[''] || { areas: [], operations: [] };

  // what is selected, as a record (or null if it's gone)
  function current() {
    const s = S.sel; if (!s) return null;
    if (s.type === 'timer') { const t = S.timer(); return t ? { kind: 'timer', rec: t, entry: S.entries.find(e => e.id === t.entry_id) || {} } : null; }
    if (s.type === 'task') { const t = S.d.tasks.find(x => x.id === s.id); return t ? { kind: 'task', rec: t } : null; }
    if (s.type === 'project') { const p = S.project(s.name, s.client); return p ? { kind: 'project', rec: p } : null; }
    return null;
  }

  // ── forms ──────────────────────────────────────────────────────────────────────
  function timerForm({ rec, entry }) {
    const o = optionsFor(rec.client), projects = [...new Set([rec.project, ...projectsOf(rec.client)].filter(Boolean))];
    return `<h2>Running timer</h2><div class="sub">${esc(rec.client || 'No client')}</div>
      ${field('Description', `<input type="text" name="description" value="${esc(rec.description)}">`)}
      ${field('Started', `<input type="datetime-local" name="start_time" value="${esc((rec.start_time || '').replace(' ', 'T'))}">`)}
      ${field('Project', `<select name="project"><option value="">(none)</option>${projects.map(p => opt(p, rec.project)).join('')}</select>`)}
      ${field('Area', `<input type="text" name="area" list="iArea" value="${esc(rec.area)}">`)}
      ${field('Operation', `<input type="text" name="operation" list="iOp" value="${esc(rec.operation)}">`)}
      ${field('Notes', `<textarea name="observations" rows="3">${esc(entry.observations || '')}</textarea>`)}
      ${field('Link', `<input type="text" name="link" value="${esc(entry.link || '')}" placeholder="https://…">`)}
      ${dl('iArea', o.areas)}${dl('iOp', o.operations)}
      <div class="btns"><button class="btn primary" data-act="save">Save</button><button class="btn" data-act="stop">Stop timer</button><button class="btn danger" data-act="discard">Discard</button></div>`;
  }

  function taskForm({ rec: t }) {
    const o = optionsFor(t.client), r = S.ruleOf(t) || {}, projects = [...new Set([t.project, ...projectsOf(t.client)].filter(Boolean))];
    const CTX = ['anywhere', 'computer', 'phone', 'errands', 'home'], TOD = ['anytime', 'morning', 'afternoon', 'evening'];
    const subs = (t.subtasks || []).map(s => subRow(s)).join('');
    return `<h2>Task</h2><div class="sub">${t.done ? 'Done' : 'Open'}${t.missed ? ` · ${t.missed}× missed` : ''}</div>
      ${field('Name', `<input type="text" name="task" value="${esc(t.task)}">`)}
      ${field('Client', `<select name="client"><option value="">(none)</option>${S.d.clients.map(c => opt(c.name, t.client || '')).join('')}</select>`)}
      ${field('Project', `<select name="project"><option value="">(none)</option>${projects.map(p => opt(p, t.project || '')).join('')}</select>`)}
      ${field('Area', `<input type="text" name="work_area" list="iArea" value="${esc(t.work_area || '')}">`)}
      ${field('Operation', `<input type="text" name="operation" list="iOp" value="${esc(t.operation || '')}">`)}
      ${field('Due', `<input type="date" name="due" value="${esc(t.due || '')}">`)}
      <div class="field"><span>Repeat</span>
        <select name="freq">${[['', 'Never'], ['daily', 'Every day'], ['weekdays', 'Weekdays'], ['weekly', 'Every week'], ['monthly', 'Every month'], ['yearly', 'Every year']].map(([v, l]) => opt(v, r.freq || '', l)).join('')}</select>
        <div data-rep style="display:${r.freq ? 'grid' : 'none'};gap:6px;margin-top:6px">
          <div data-wk style="display:${r.freq === 'weekly' ? 'block' : 'none'}"><select name="weekday">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => `<option value="${i}" ${r.weekday === i ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
          <div data-day style="display:${r.freq === 'monthly' ? 'block' : 'none'}"><span class="muted">Day of month </span><input type="number" min="1" max="31" name="day" value="${r.day || ''}" style="width:70px"></div>
          <div data-wend style="display:${['weekly', 'monthly', 'yearly'].includes(r.freq) ? 'block' : 'none'}"><span class="muted">If it lands on a weekend: </span><select name="weekend">${[['before', 'workday before'], ['after', 'Monday after'], ['keep', 'keep the date']].map(([v, l]) => opt(v, r.weekend || 'before', l)).join('')}</select></div>
          <div><span class="muted">Show it </span><input type="number" min="0" max="60" name="lead_days" value="${r.lead_days ?? 3}" style="width:60px"><span class="muted"> days before</span>
            ${[3, 7, 12].map(n => `<button type="button" class="pill" data-lead="${n}">${n}</button>`).join(' ')}</div></div></div>
      ${field('Context', `<select name="trigger">${CTX.map(c => opt(c, t.trigger || 'anywhere')).join('')}</select>`)}
      ${field('Time of day', `<select name="time_of_day">${TOD.map(c => opt(c, t.time_of_day || 'anytime')).join('')}</select>`)}
      ${field('Notes', `<textarea name="notes" rows="3">${esc(t.notes || '')}</textarea>`)}
      <div class="field"><span>Subtasks</span><div id="subs">${subs}</div><button type="button" class="btn sm" data-act="addsub">+ Add subtask</button></div>
      ${dl('iArea', o.areas)}${dl('iOp', o.operations)}
      <div class="btns"><button class="btn primary" data-act="save">Save</button>${t.done ? '' : '<button class="btn" data-act="start">▶ Start timer</button>'}
        <button class="btn" data-act="${t.done ? 'undone' : 'done'}">${t.done ? 'Mark not done' : 'Mark done'}</button><button class="btn" data-act="dup">Duplicate</button><button class="btn danger" data-act="del">Delete</button></div>`;
  }
  const subRow = s => `<div class="row" data-sub="${esc(s.id || '')}"><input type="checkbox" ${s.done ? 'checked' : ''}><input type="text" class="grow" value="${esc(s.text || '')}"><button type="button" class="btn ghost sm" data-act="rmsub" title="Remove">✕</button></div>`;

  function projectForm({ rec: p }) {
    return `<h2>Project</h2><div class="sub">${p.total_hours || 0} h total · ${p.month_hours || 0} h this month</div>
      ${field('Name', `<input type="text" name="name" value="${esc(p.name)}">`)}
      ${field('Client', `<select name="client"><option value="">(none)</option>${S.d.clients.map(c => opt(c.name, p.client || '')).join('')}</select>`)}
      ${field('Status', `<select name="status">${S.d.statuses.map(s => opt(s, p.status, s.replace('_', ' '))).join('')}</select>`)}
      ${field('Deadline', `<input type="date" name="deadline" value="${esc(p.deadline || '')}">`)}
      <div class="field"><span>Colour</span><div style="display:flex;gap:6px;flex-wrap:wrap">${S.d.palette.map(c => `<button type="button" data-color="${c}" aria-label="${c}" style="width:22px;height:22px;border-radius:50%;border:2px solid ${c === p.color ? 'var(--text)' : 'transparent'};background:${c};cursor:pointer"></button>`).join('')}</div><input type="hidden" name="color" value="${esc(p.color || '')}"></div>
      ${field('Description', `<textarea name="description" rows="2">${esc(p.description || '')}</textarea>`)}
      ${field('Notes', `<textarea name="notes" rows="3">${esc(p.notes || '')}</textarea>`)}
      <div class="btns"><button class="btn primary" data-act="save">Save</button><button class="btn" data-act="archive">${S.isArchived(p) ? 'Reactivate' : 'Archive'}</button></div>`;
  }

  // ── render (skips redraws that would throw away what you're typing) ───────────────────────────
  function render(el) {
    const cur = current(), key = JSON.stringify([S.sel, cur && cur.rec, cur && cur.entry && cur.entry.id]);
    if (el._key === key) return;
    const selKey = JSON.stringify(S.sel);
    if (el._edited && el._selKey === selKey && cur) return;       // unsaved edits stay put through background refreshes
    if (el._edited && el._for && el._inflight !== el._rev) send(collect(el, el._for, true));   // switching away: save what was typed first, never lose it
    clearTimeout(el._timer);
    el._key = key; el._selKey = selKey; el._edited = false; el._for = idOf(cur);
    if (!cur) { el.innerHTML = `<div class="panel"><div class="empty">${S.sel && S.sel.type === 'timer' ? 'No timer is running.' : 'Select a task, project or the running timer<br>to edit it here.'}</div></div>`; return; }
    el.innerHTML = `<div class="panel insp">${{ timer: timerForm, task: taskForm, project: projectForm }[cur.kind](cur)}</div>`;
    el.dataset.kind = cur.kind;
    const btns = el.querySelector('.btns'); if (btns) btns.insertAdjacentHTML('beforeend', '<span class="insp-note muted" aria-live="polite"></span>');
  }
  const note = (el, text) => { const n = el.querySelector('.insp-note'); if (n) n.textContent = text; };

  // ── autosave ── The form remembers which record it belongs to, so a save always lands there,
  // even after you've selected something else. Renaming or moving a project still waits for Save.
  const idOf = cur => !cur ? null : cur.kind === 'task' ? { kind: 'task', id: cur.rec.id }
    : cur.kind === 'project' ? { kind: 'project', name: cur.rec.name, client: cur.rec.client || '' } : { kind: 'timer', entry: cur.rec.entry_id };
  function resolve(f) {
    if (!f) return null;
    if (f.kind === 'task') { const t = S.d.tasks.find(x => x.id === f.id); return t ? { kind: 'task', rec: t } : null; }
    if (f.kind === 'project') { const p = S.project(f.name, f.client); return p ? { kind: 'project', rec: p } : null; }
    const t = S.timer(); return t && t.entry_id === f.entry ? { kind: 'timer', rec: t } : { kind: 'entry', id: f.entry };
  }
  // Read the form into a request right now (works even while the form is being replaced).
  function collect(el, f, quiet) {
    const cur = resolve(f); if (!cur) return null;
    if (cur.kind === 'timer' || cur.kind === 'entry') {
      const body = { description: val(el, 'description'), project: val(el, 'project'), area: val(el, 'area'), operation: val(el, 'operation'), observations: val(el, 'observations'), link: val(el, 'link') };
      const st = val(el, 'start_time'); if (st && cur.kind === 'timer') body.start_time = st.replace('T', ' ');
      return cur.kind === 'timer' ? { method: 'PATCH', url: '/api/timer', body } : { method: 'PUT', url: `/api/entries/${cur.id}`, body };   // stopped meanwhile: save onto its entry
    }
    if (cur.kind === 'task') {
      const t = cur.rec, body = { task: val(el, 'task'), client: val(el, 'client') || null, project: val(el, 'project') || null, work_area: val(el, 'work_area'), operation: val(el, 'operation'),
        due: val(el, 'due') || null, trigger: val(el, 'trigger'), time_of_day: val(el, 'time_of_day'), notes: val(el, 'notes') || null,
        subtasks: [...el.querySelectorAll('[data-sub]')].map(r => ({ id: r.dataset.sub || undefined, text: r.querySelector('input[type=text]').value, done: r.querySelector('input[type=checkbox]').checked })) };
      if (!body.task || !body.task.trim()) delete body.task;                   // never save an empty name
      const rec = recurrenceFrom(el, t); if (rec !== undefined) body.recurrence = rec;
      return { method: 'PATCH', url: `/api/tasks/${t.id}`, body };
    }
    const p = cur.rec, body = {}; ['name', 'client', 'status', 'deadline', 'color', 'description', 'notes'].forEach(k => { const v = val(el, k); if (v !== undefined && v !== (p[k] || '')) body[k] = v; });
    let held = false;
    if (quiet) ['name', 'client'].forEach(k => { if (k in body) { delete body[k]; held = true; } });
    return { method: 'PUT', url: `/api/projects/${encodeURIComponent(p.name)}?client=${encodeURIComponent(p.client || '')}`, body, project: p, held, empty: !Object.keys(body).length };
  }
  function send(job, keepalive) {
    if (!job || job.empty) return Promise.resolve(null);
    if (keepalive) return fetch(job.url, { method: job.method, headers: { ...U.WRITE, 'Content-Type': 'application/json' }, body: JSON.stringify(job.body), keepalive: true }).catch(() => null);
    return S.act(() => U.api(job.method, job.url, job.body)).catch(() => null);
  }
  async function autosave(el) {
    clearTimeout(el._timer);
    if (!el._edited || !el._for) return;
    const job = collect(el, el._for, true), rev = el._rev;
    if (!job) { el._edited = false; return; }
    if (job.empty) { note(el, job.held ? 'Save to rename or move' : ''); if (!job.held) el._edited = false; return; }
    note(el, 'Saving…'); el._inflight = rev;
    const r = await send(job);
    if (r === null) return note(el, 'Couldn’t save. Try Save.');
    if (el._rev === rev && !job.held) el._edited = false;
    note(el, job.held ? 'Saved. Save to rename or move' : 'Saved');
  }

  const val = (el, n) => { const x = el.querySelector(`[name="${n}"]`); return x ? x.value : undefined; };
  function recurrenceFrom(el, t) {
    const freq = val(el, 'freq'); if (!freq) return t.recurrence ? null : undefined;
    const rule = { freq, weekend: val(el, 'weekend') || 'before', lead_days: +val(el, 'lead_days') };
    if (freq === 'monthly') rule.day = +val(el, 'day') || undefined;
    if (freq === 'weekly') rule.weekday = +val(el, 'weekday');
    const old = S.ruleOf(t);
    const same = old && old.freq === rule.freq && old.weekend === rule.weekend && old.lead_days === rule.lead_days && (freq !== 'monthly' || old.day === rule.day) && (freq !== 'weekly' || old.weekday === rule.weekday);
    return same ? undefined : rule;
  }

  // The Save button and ⌘↩: everything, including a project's new name or client (which asks first).
  async function save(el) {
    clearTimeout(el._timer);
    const job = collect(el, el._for || idOf(current()), false); if (!job) return;
    try {
      if (job.project) {
        const p = job.project, body = job.body;
        if ('client' in body) {
          const mine = S.entries.filter(e => e.project === p.name && (e.client || '') === (p.client || ''));
          if (!(await U.confirm(`Move “${p.name}” to ${body.client || 'no client'}?`, `${mine.length} time entries (${U.fmtH1(S.sumHours(mine))} h) and its tasks move too. This changes who the hours are invoiced to.`, { ok: 'Move project' }))) return;
        }
        if (job.empty) { el._edited = false; return note(el, 'Saved'); }
        const r = await S.act(() => U.api(job.method, job.url, body));
        const next = { type: 'project', name: r.name, client: r.client || '' }; S.sel = next;
        if (S.scope.view === 'project' && S.scope.project === p.name) S.setScope({ view: 'project', client: next.client, project: next.name });
      } else await S.act(() => U.api(job.method, job.url, job.body));
      el._key = null; el._edited = false; S.emit('select'); U.toast('Saved');
    } catch (e) { /* shown */ }
  }

  function setup(el, redraw, track) {
    el._rev = 0;
    const mark = () => el.dispatchEvent(new Event('input'));
    const touched = () => { el._edited = true; el._rev++; note(el, ''); clearTimeout(el._timer); el._timer = setTimeout(() => autosave(el), 800); };
    el.addEventListener('input', touched);
    el.addEventListener('change', e => { if (e.target.matches('select, input[type=checkbox], input[type=date], input[type=datetime-local], input[type=number]')) touched(); });
    el.addEventListener('focusout', e => { if (!el.contains(e.relatedTarget)) autosave(el); });            // clicked somewhere else
    const away = () => { if (el._edited) { clearTimeout(el._timer); send(collect(el, el._for, true), true); } };     // tab hidden or page closing
    const vis = () => { if (document.visibilityState === 'hidden') away(); };
    document.addEventListener('visibilitychange', vis); addEventListener('pagehide', away);
    if (track) track(() => { document.removeEventListener('visibilitychange', vis); removeEventListener('pagehide', away); });
    el.addEventListener('change', async e => {
      const n = e.target.name;
      if (n === 'freq') { const v = e.target.value, w = s => el.querySelector(s); w('[data-rep]').style.display = v ? 'grid' : 'none'; w('[data-wk]').style.display = v === 'weekly' ? 'block' : 'none'; w('[data-day]').style.display = v === 'monthly' ? 'block' : 'none'; w('[data-wend]').style.display = ['weekly', 'monthly', 'yearly'].includes(v) ? 'block' : 'none'; }
      if (n === 'client' && el.dataset.kind === 'task') {          // project list follows the client
        const sel = el.querySelector('[name=project]'); sel.innerHTML = '<option value="">(none)</option>' + projectsOf(e.target.value).map(p => opt(p, '')).join('');
      }
      if (n === 'project' && el.dataset.kind === 'timer') {        // a preset's remembered labels follow the project
        const t = S.timer(), entry = t && S.entries.find(x => x.id === t.entry_id);
        if (entry && entry.preset_id) { try { const m = await U.api('GET', `/api/preset-memory?preset_id=${entry.preset_id}&project=${encodeURIComponent(e.target.value)}&client=${encodeURIComponent(t.client || '')}`);
          if (m.source !== 'none') { ['description', 'area', 'operation'].forEach(k => { if (m[k]) el.querySelector(`[name=${k}]`).value = m[k]; }); } } catch (x) { /* ignore */ } }
      }
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(el); } });
    el.addEventListener('click', async e => {
      const lead = e.target.closest('[data-lead]'), color = e.target.closest('[data-color]'), a = e.target.closest('[data-act]');
      if (lead) { el.querySelector('[name=lead_days]').value = lead.dataset.lead; mark(); return; }
      if (color) { el.querySelector('[name=color]').value = color.dataset.color; el.querySelectorAll('[data-color]').forEach(b => b.style.borderColor = b === color ? 'var(--text)' : 'transparent'); mark(); return; }
      if (!a) return;
      const act = a.dataset.act, cur = current();
      if (act === 'save') return save(el);
      if (act === 'addsub') { el.querySelector('#subs').insertAdjacentHTML('beforeend', subRow({ id: '' })); el.querySelector('#subs').lastElementChild.querySelector('input[type=text]').focus(); mark(); return; }
      if (act === 'rmsub') { a.closest('[data-sub]').remove(); mark(); return; }
      if (!cur) return;
      if (act === 'stop') return S.stopTimer().catch(() => {});
      if (act === 'discard') return S.discardTimer().catch(() => {});
      if (cur.kind === 'task') {
        const t = cur.rec;
        if (act === 'start') return S.startTimer(S.taskSeed(t)).catch(() => {});
        try {
          if (act === 'done') { await S.act(() => U.api('POST', `/api/tasks/${t.id}/done`)); U.toast(`Done: ${t.task}`, { undo: () => S.act(() => U.api('POST', `/api/tasks/${t.id}/undone`)) }); }
          if (act === 'undone') { await S.act(() => U.api('POST', `/api/tasks/${t.id}/undone`)); U.toast('Moved back to open'); }
          if (act === 'dup') { const d = await S.act(() => U.api('POST', `/api/tasks/${t.id}/duplicate`)); S.select({ type: 'task', id: d.id }); U.toast('Duplicated'); }
          if (act === 'del') {
            if (!(await U.confirm('Delete this task?', `“${t.task}” will be removed. You can undo right after.`, { ok: 'Delete', danger: true }))) return;
            const removed = await S.act(() => U.api('DELETE', `/api/tasks/${t.id}`)); S.select(null);
            U.toast(`Deleted: ${t.task}`, { undo: () => S.restoreTask(removed) });
          }
        } catch (x) { /* shown */ }
      }
      if (cur.kind === 'project' && act === 'archive') {
        const p = cur.rec, status = S.isArchived(p) ? 'active' : 'archived';
        try { await S.act(() => U.api('PUT', `/api/projects/${encodeURIComponent(p.name)}?client=${encodeURIComponent(p.client || '')}`, { status })); U.toast(`${p.name}: ${status}`); } catch (x) { /* shown */ }
      }
    });
  }

  U.definePanel('inspector', { title: 'Inspector', events: ['data', 'select'], render, setup });
})();
