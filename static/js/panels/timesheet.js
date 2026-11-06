/* Timesheet: the entries for the current scope and period, with totals. Money appears only when every client in view has a rate. */
(function () {
  const esc = U.esc;
  const COLS = [['client', 'Client', false], ['wk', 'Wk', true], ['description', 'Description', true], ['project', 'Project', true], ['area', 'Area', true],
    ['operation', 'Operation', true], ['start', 'Start', true], ['end', 'End', true], ['dur', 'Duration', true], ['notes', 'Notes', false], ['link', 'Link', false]];
  const period = () => ({ kind: 'week', offset: 0, ...U.pref('tsPeriod', {}) });
  const setPeriod = p => { U.setPref('tsPeriod', p); S.emit('period'); };
  const cols = () => { const saved = U.pref('tsCols', null); return COLS.filter(c => saved ? saved.includes(c[0]) : c[2]).map(c => c[0]); };

  // ── period → {from, to} (inclusive YYYY-MM-DD) and a label ──
  function range(p = period()) {
    const t = new Date();
    if (p.kind === 'all') return { from: '', to: '', label: 'All time' };
    if (p.kind === 'month') {
      const a = new Date(t.getFullYear(), t.getMonth() + p.offset, 1), b = new Date(a.getFullYear(), a.getMonth() + 1, 0);
      return { from: U.ymd(a), to: U.ymd(b), label: `${U.MON[a.getMonth()]} ${a.getFullYear()}` };
    }
    const a = U.addDays(U.weekStart(t), p.offset * 7), b = U.addDays(a, 6);
    return { from: U.ymd(a), to: U.ymd(b), label: `${U.MON[a.getMonth()]} ${a.getDate()} – ${U.MON[b.getMonth()]} ${b.getDate()}` };
  }
  const rows = () => {
    const { from, to } = range();
    return S.entries.filter(e => S.inScope(e) && (!from || (e.start_time || '').slice(0, 10) >= from) && (!to || (e.start_time || '').slice(0, 10) <= to))
      .sort((a, b) => (b.start_time || '').localeCompare(a.start_time || ''));
  };
  const rateClient = () => (S.scope.client && S.rateOf(S.scope.client)) ? S.scope.client : '';
  const ratedClients = () => S.d.clients.filter(c => S.rateOf(c.name)).map(c => c.name);   // the ones you can invoice

  function totals(list) {
    const h = S.sumHours(list), m = S.sumMoney(list);
    return { h, m, text: `${U.fmtH(h)}h${m !== null ? ` · ${U.money(m, S.cur())}` : ''}` };
  }

  function cell(c, e) {
    const run = !e.end_time && S.timer() && S.timer().entry_id === e.id;
    switch (c) {
      case 'client': return `<td>${esc(e.client || '')}</td>`;
      case 'wk': return `<td>${e.week ?? ''}</td>`;
      case 'description': return `<td title="${esc(e.description)}">${e.auto_stopped ? '<span class="flag" title="Auto-stopped: check the end time">⚑</span> ' : ''}${esc(e.description)}</td>`;
      case 'project': return `<td>${esc(e.project || '')}</td>`;
      case 'area': return `<td>${e.area ? `<span class="chip fill">${esc(e.area)}</span>` : ''}</td>`;
      case 'operation': return `<td>${e.operation ? `<span class="chip fill">${esc(e.operation)}</span>` : ''}</td>`;
      case 'start': return `<td class="mono">${esc(U.niceDT(e.start_time))}</td>`;
      case 'end': return run ? '<td class="running-tag">● running</td>' : `<td class="mono">${esc(U.niceDT(e.end_time))}</td>`;
      case 'dur': return `<td class="mono" ${run ? 'data-run' : ''}>${U.fmtH(S.entryHours(e))}h</td>`;
      case 'notes': return `<td title="${esc(e.observations)}">${esc(e.observations || '')}</td>`;
      case 'link': { const u = U.safeUrl(e.link); return `<td>${u ? `<a href="${esc(u)}" target="_blank" rel="noopener">Link ↗</a>` : e.link ? `<span title="${esc(e.link)}">${esc(e.link)}</span>` : '<span class="muted">—</span>'}</td>`; }
    }
  }

  function render(el) {
    const p = period(), r = range(p), list = rows(), shown = cols(), tot = totals(list);
    const pill = (label, on, attrs) => `<button class="pill ${on ? 'on' : ''}" ${attrs}>${label}</button>`;
    const sel = S.sel && S.sel.type === 'entry' ? S.sel.id : null;
    el.innerHTML = `<div class="panel flush">
      <div class="tsbar">
        ${pill('This week', p.kind === 'week' && p.offset === 0, 'data-p="week" data-o="0"')}${pill('Last week', p.kind === 'week' && p.offset === -1, 'data-p="week" data-o="-1"')}
        ${pill('This month', p.kind === 'month' && p.offset === 0, 'data-p="month" data-o="0"')}${pill('Last month', p.kind === 'month' && p.offset === -1, 'data-p="month" data-o="-1"')}${pill('All', p.kind === 'all', 'data-p="all" data-o="0"')}
        ${p.kind !== 'all' ? `<button class="btn ghost sm" data-step="-1" title="Previous">‹</button><span class="muted">${esc(r.label)}</span><button class="btn ghost sm" data-step="1" title="Next">›</button>` : ''}
        <span class="total" id="tsTotal">${tot.text}</span><span class="grow"></span>
        <button class="btn sm" data-act="cols">Columns ▾</button><button class="btn sm" data-act="csv">↓ CSV</button>
        ${rateClient() || ratedClients().length ? '<button class="btn sm" data-act="invoice">↓ Invoice</button>' : ''}
        <button class="btn sm primary" data-act="add">+ Add entry</button></div>
      ${list.length ? `<table class="ts"><thead><tr>${shown.map(c => `<th>${COLS.find(x => x[0] === c)[1]}</th>`).join('')}</tr></thead>
        <tbody>${list.map(e => `<tr data-id="${e.id}" class="${sel === e.id ? 'sel' : ''}" tabindex="0" style="--pc:${esc(S.projectColor(e.project, e.client))}">${shown.map(c => cell(c, e)).join('')}</tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="${shown.length}">SUM <b>${U.fmtH(tot.h)}</b> h${tot.m !== null ? ` · <b>${U.money(tot.m, S.cur())}</b>` : ''}</td></tr></tfoot></table>`
        : `<div class="empty">No time tracked ${p.kind === 'all' ? 'here yet' : 'in this period'}.<br>Start a timer from the bar above, or add an entry.</div>`}</div>`;
  }

  // ── entry dialog (add / edit) ──
  const toLocal = s => (s || '').replace(' ', 'T');
  const fromLocal = s => (s || '').replace('T', ' ');
  // e: an entry to edit; or, with prefill, the values for a new one (from a task, or a spot on the Week timeline)
  async function editEntry(e, { duplicate, prefill } = {}) {
    const isNew = !e || duplicate || prefill, v0 = e || {};
    const clients = S.d.clients.map(c => c.name);
    const def = { client: v0.client ?? (S.scope.client || clients[0] || ''), description: v0.description || '', project: v0.project || (S.scope.view === 'project' ? S.scope.project : ''), area: v0.area || '',
      operation: v0.operation || '', start_time: toLocal(v0.start_time), end_time: toLocal(v0.end_time), observations: v0.observations || '', link: v0.link || '' };
    if (duplicate) { const t = U.today(); def.start_time = `${t}T${(def.start_time || 'T09:00').slice(11)}`; def.end_time = def.end_time ? `${t}T${def.end_time.slice(11)}` : ''; }
    if (isNew && !def.start_time) { const n = new Date(); def.end_time = U.fmtDT(n).replace(' ', 'T'); def.start_time = U.fmtDT(new Date(n - 3600e3)).replace(' ', 'T'); }
    const opts = S.d.options[def.client] || S.d.options[''] || { areas: [], operations: [] };
    const form = U.form([
      { key: 'client', label: 'Client', type: 'select', options: [{ value: '', label: '(no client)' }, ...clients] },
      { key: 'description', label: 'Description' }, { key: 'project', label: 'Project', list: 'dlProjects' },
      { key: 'area', label: 'Area', list: 'dlAreas' }, { key: 'operation', label: 'Operation', list: 'dlOps' },
      { key: 'start_time', label: 'Start', type: 'datetime-local' }, { key: 'end_time', label: 'End', type: 'datetime-local' },
      { key: 'observations', label: 'Notes', type: 'textarea' }, { key: 'link', label: 'Link' }], def);
    const dl = (id, arr) => `<datalist id="${id}">${arr.map(x => `<option value="${esc(x)}">`).join('')}</datalist>`;
    const projs = () => S.d.projects.filter(p => (p.client || '') === form.querySelector('[name=client]').value && !S.isArchived(p)).map(p => p.name);
    form.insertAdjacentHTML('beforeend', dl('dlProjects', projs()) + dl('dlAreas', opts.areas) + dl('dlOps', opts.operations));
    form.querySelector('[name=client]').onchange = () => { form.querySelector('#dlProjects').innerHTML = projs().map(x => `<option value="${esc(x)}">`).join(''); };
    const running = e && !e.end_time && S.timer() && S.timer().entry_id === e.id;
    if (running) form.querySelector('[name=end_time]').disabled = true;
    const actions = [{ label: 'Cancel', value: null }];
    if (e && !isNew) actions.push({ label: 'Delete', danger: true, value: 'delete' });
    actions.push({ label: isNew ? 'Add entry' : 'Save', primary: true, value: b => ({ save: U.formValues(b) }) });
    const res = await U.dialog({ title: isNew ? (duplicate ? 'Duplicate to today' : 'Add entry') : 'Edit entry', body: form, actions, wide: true });
    if (!res) return;
    try {
      if (res === 'delete') {
        if (!(await U.confirm('Delete this entry?', `“${e.description || 'Untitled'}” (${U.fmtH(S.entryHours(e))} h) will be removed.`, { ok: 'Delete', danger: true }))) return;
        const old = { ...e }; delete old.week; delete old.id;
        await S.act(() => U.api('DELETE', `/api/entries/${e.id}`));
        return U.toast('Entry deleted', { undo: () => S.act(() => U.api('POST', '/api/entries', old)) });
      }
      const v = res.save;
      const body = { ...v, start_time: fromLocal(v.start_time), end_time: running ? undefined : fromLocal(v.end_time) };
      if (prefill && v0.task_id) body.task_id = v0.task_id;                  // keeps the entry linked to its task
      if (!body.start_time) return U.toast('Add a start time', { error: true });
      if (!running && body.end_time && body.end_time < body.start_time) return U.toast('The end is before the start', { error: true });
      if (isNew) await S.act(() => U.api('POST', '/api/entries', body)); else await S.act(() => U.api('PUT', `/api/entries/${e.id}`, body));
      U.toast(isNew ? 'Entry added' : 'Saved');
    } catch (err) { /* shown */ }
  }

  async function continueEntry(e) {
    await S.startTimer({ client: e.client, project: e.project, description: e.description, area: e.area, operation: e.operation }).catch(() => {});
  }
  function moveMenu(e) {
    const recent = [...new Set(S.entries.slice().sort((a, b) => (b.start_time || '').localeCompare(a.start_time || '')).filter(x => (x.client || '') === (e.client || '')).map(x => x.project).filter(Boolean))].slice(0, 10);
    return recent.map(name => ({ label: name, checked: e.project === name, onClick: async () => {
      const old = e.project; try { await S.act(() => U.api('PUT', `/api/entries/${e.id}`, { project: name })); U.toast(`Moved to ${name}`, { undo: () => S.act(() => U.api('PUT', `/api/entries/${e.id}`, { project: old })) }); } catch (x) { /* shown */ } } }));
  }
  function menuFor(e) {
    const run = !e.end_time && S.timer() && S.timer().entry_id === e.id;
    const items = [];
    if (run) items.push({ label: 'Stop', onClick: () => S.stopTimer().catch(() => {}) }, { label: 'Edit running timer…', onClick: () => { S.select({ type: 'timer' }); Workspaces.reveal('inspector'); } }, { label: 'Discard…', danger: true, onClick: () => S.discardTimer().catch(() => {}) });
    else items.push({ label: '▶ Continue', onClick: () => continueEntry(e) }, { label: 'Edit…', onClick: () => editEntry(e) }, { label: 'Duplicate to today…', onClick: () => editEntry(e, { duplicate: true }) },
      { sep: true }, { header: 'Move to project' }, ...moveMenu(e), { sep: true },
      { label: 'Copy description', onClick: () => navigator.clipboard && navigator.clipboard.writeText(e.description || '').then(() => U.toast('Copied')) },
      { label: 'Delete…', danger: true, onClick: () => editEntry(e) });
    return items;
  }

  // ── CSV of exactly what's on screen ──
  function csv() {
    const list = rows().slice().reverse(), q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const t = v => q(/^[=+\-@\t\r\n]/.test(v ?? '') ? "'" + v : v);   // text a spreadsheet could run as a formula gets a leading quote
    const head = ['Week', 'Client', 'Description', 'Project', 'Notes', 'Area', 'Operation', 'Start', 'End', 'Hours', 'Link'];
    const body = list.map(e => [q(e.week), ...[e.client, e.description, e.project, e.observations, e.area, e.operation, e.start_time, e.end_time].map(t), q(U.fmtH(S.entryHours(e))), t(e.link)].join(','));
    const blob = new Blob([[head.map(q).join(','), ...body].join('\n')], { type: 'text/csv' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `clockin-${S.scope.client || 'all'}-${range().from || 'all'}.csv`.replace(/\s+/g, '_') });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ── invoice (only offered when the client has a rate) ──
  async function invoice() {
    let client = rateClient();
    if (!client) {                                                          // not inside a billed client: ask which one
      const list = ratedClients(); if (!list.length) return;
      const recent = (S.entries.filter(e => list.includes(e.client) && e.start_time).sort((a, b) => b.start_time.localeCompare(a.start_time))[0] || {}).client || list[0];
      if (list.length === 1) client = list[0];
      else {
        const v = await U.dialog({ title: 'Invoice which client?', body: U.form([{ key: 'client', label: 'Client', type: 'select', options: list }], { client: recent }),
          actions: [{ label: 'Cancel', value: null }, { label: 'Next', primary: true, value: b => U.formValues(b) }] });
        if (!v) return; client = v.client;
      }
    }
    if (S.d.settings.sender_ready === false && window.SenderDialog) {        // a first invoice: say who it's from
      if (!(await SenderDialog.open({ reason: 'Add your details first, so the invoice shows who it’s from and how to pay you.' })) || S.d.settings.sender_ready === false) return;
    }
    const c = S.client(client), months = [...new Set(S.entries.filter(e => e.client === client && e.start_time).map(e => e.start_time.slice(0, 7)))].sort().reverse();
    if (!months.length) return U.toast('No time tracked for this client yet', { error: true });
    const fill = (month, num) => {
      const d = new Date(month + '-01T12:00'), list = S.entries.filter(e => e.client === client && (e.start_time || '').startsWith(month));
      const hours = list.reduce((a, e) => a + (e.duration_hours || 0), 0), pay = (S.d.settings.payment_lines || []).join('\n');
      const tpl = c.email_template || S.d.settings.email_template || '';
      return tpl.replace(/\{invoice_num\}/g, num).replace(/\{month\}/g, d.toLocaleString('en-US', { month: 'long' })).replace(/\{year\}/g, d.getFullYear())
        .replace(/\{total_hours\}/g, U.fmtH(hours)).replace(/\{rate\}/g, c.rate).replace(/\{total_amount\}/g, (hours * c.rate).toFixed(2))
        .replace(/\{currency\}/g, S.cur()).replace(/\{payment\}/g, pay).replace(/\{signature\}/g, S.d.settings.signature || '').replace(/\{wise_handle\}/g, pay);   // legacy alias for {payment}
    };
    const form = U.form([{ key: 'month', label: 'Month', type: 'select', options: months }, { key: 'num', label: 'Invoice #', type: 'number' }, { key: 'msg', label: 'Email text', type: 'textarea' }],
      { month: months[0], num: (c.last_invoice_num || 0) + 1 });
    const upd = () => { const v = U.formValues(form); form.querySelector('[name=msg]').value = fill(v.month, v.num); };
    form.querySelector('[name=month]').onchange = upd; form.querySelector('[name=num]').oninput = upd; form.querySelector('[name=msg]').rows = 8; upd();
    const v = await U.dialog({ title: `Invoice · ${client}`, body: form, wide: true, actions: [{ label: 'Cancel', value: null }, { label: 'Generate ZIP', primary: true, value: b => U.formValues(b) }] });
    if (!v) return;
    try {
      const r = await fetch('/api/invoice', { method: 'POST', headers: { ...U.WRITE, 'Content-Type': 'application/json' }, body: JSON.stringify({ month: v.month, client, invoice_number: v.num, email_message: v.msg }) });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))).error) || 'Invoice failed');
      const blob = await r.blob(), a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `Invoice_${v.num}.zip` });
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); S.refresh();
    } catch (e) { U.fail(e); }
  }

  function setup(el, redraw, track) {
    el.addEventListener('click', e => {
      const p = e.target.closest('[data-p]'), st = e.target.closest('[data-step]'), a = e.target.closest('[data-act]'), tr = e.target.closest('tr[data-id]');
      if (p) return setPeriod({ kind: p.dataset.p, offset: +p.dataset.o });
      if (st) { const cur = period(); return setPeriod({ ...cur, offset: cur.offset + +st.dataset.step }); }
      if (a) {
        if (a.dataset.act === 'add') return editEntry(null);
        if (a.dataset.act === 'csv') return csv();
        if (a.dataset.act === 'invoice') return invoice();
        if (a.dataset.act === 'cols') {
          const on = new Set(cols());
          return U.menuAt(a, [{ header: 'Columns' }, ...COLS.map(c => ({ label: c[1], checked: on.has(c[0]), keepOpen: true, onClick: ev => {
            on.has(c[0]) ? on.delete(c[0]) : on.add(c[0]); ev.currentTarget.classList.toggle('check'); ev.currentTarget.classList.toggle('nocheck');
            U.setPref('tsCols', COLS.map(x => x[0]).filter(k => on.has(k))); redraw(); } }))]);
        }
      }
      if (tr && !e.target.closest('a')) { const en = S.entries.find(x => x.id === +tr.dataset.id); if (en) { S.select({ type: 'entry', id: en.id }); editEntry(en); } }
    });
    el.addEventListener('keydown', e => { const tr = e.target.closest && e.target.closest('tr[data-id]'); if (tr && e.key === 'Enter') tr.click(); });
    U.onContext(el, 'tr[data-id]', tr => { const en = S.entries.find(x => x.id === +tr.dataset.id); return en ? menuFor(en) : []; });
    track(S.on('tick', () => { // keep the running row live without redrawing the table
      const run = el.querySelector('[data-run]'); if (!run) return;
      const en = S.entries.find(x => S.timer() && x.id === S.timer().entry_id); if (en) run.textContent = U.fmtH(S.entryHours(en)) + 'h';
    }));
  }

  window.Timesheet = { range, rows, editEntry, period };
  U.definePanel('timesheet', { title: 'Timesheet', events: ['data', 'scope', 'period', 'select'], render, setup });
})();
