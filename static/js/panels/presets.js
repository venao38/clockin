/* Presets: one-click timers for the work you repeat. Each remembers the labels you used last time. */
(function () {
  const esc = U.esc;
  const shown = () => S.seeds.presets.filter(p => !S.scope.client || p.client === S.scope.client);
  const startOf = p => S.startTimer({ client: p.client, project: p.project, description: p.description, area: p.area, operation: p.operation, preset_id: p.id }).catch(() => {});

  function render(el) {
    const list = shown();
    el.innerHTML = `<div class="panel"><div class="view-head"><div class="grow"><div class="view-title" style="font-size:14px">Presets</div>
      <div class="view-sub">${S.scope.client ? esc(S.scope.client) : 'All clients'}</div></div><button class="btn sm" data-act="edit" title="Edit presets">✎ Edit</button></div>
      ${list.length ? list.map(p => `<div class="row" data-id="${esc(p.id)}" tabindex="0"><button class="play" data-act="start" title="Start">▶</button><span class="ell grow">${esc(p.label)}</span>
        <span class="muted ell" style="max-width:40%">${esc(p.project || '')}</span></div>`).join('')
        : '<div class="empty">No presets here yet.<br>Add one for work you do again and again.</div>'}</div>`;
  }

  async function manage() {
    const clients = S.d.clients.map(c => c.name);
    const wrap = U.el('<div></div>');
    const rowHtml = p => `<div class="form" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--border)" data-pid="${esc(p.id)}">
      <input name="label" value="${esc(p.label || '')}" placeholder="Label"><input name="description" value="${esc(p.description || '')}" placeholder="Description"><input name="project" value="${esc(p.project || '')}" placeholder="Project">
      <input name="area" value="${esc(p.area || '')}" placeholder="Area"><input name="operation" value="${esc(p.operation || '')}" placeholder="Operation">
      <div style="display:flex;gap:6px"><select name="client">${['', ...clients].map(c => `<option value="${esc(c)}" ${c === (p.client || '') ? 'selected' : ''}>${esc(c || '(no client)')}</option>`).join('')}</select><button class="btn sm danger" data-del title="Delete">✕</button></div></div>`;
    let next = Math.max(0, ...S.d.presets.map(p => p.id).filter(Number.isInteger)) + 1;
    S.d.presets.forEach(p => wrap.insertAdjacentHTML('beforeend', rowHtml(p)));
    const add = U.el('<button class="btn sm" type="button">+ Add preset</button>');
    add.onclick = () => { wrap.insertAdjacentHTML('beforeend', rowHtml({ id: next++, client: S.scope.client })); wrap.lastElementChild.querySelector('input').focus(); };
    wrap.addEventListener('click', e => { if (e.target.closest('[data-del]')) e.target.closest('[data-pid]').remove(); });
    const box = U.el('<div style="max-height:60vh;overflow:auto"></div>'); box.appendChild(wrap); box.appendChild(add);
    const res = await U.dialog({ title: 'Presets', body: box, wide: true, actions: [{ label: 'Cancel', value: null }, { label: 'Save', primary: true, value: () => [...wrap.querySelectorAll('[data-pid]')].map(r => ({ id: +r.dataset.pid, ...Object.fromEntries([...r.querySelectorAll('[name]')].map(i => [i.name, i.value.trim()])) })).filter(p => p.label) }] });
    if (!res) return;
    try { await S.act(() => U.api('PUT', '/api/presets', res)); U.toast('Presets saved'); } catch (e) { /* shown */ }
  }

  async function startOnProject(p) {
    const projects = S.d.projects.filter(x => (x.client || '') === (p.client || '') && !S.isArchived(x));
    U.menu(innerWidth / 2 - 90, innerHeight / 3, [{ header: `${p.label} on…` }, ...projects.map(x => ({ label: x.name, onClick: async () => {
      let mem = {}; try { mem = await U.api('GET', `/api/preset-memory?preset_id=${p.id}&project=${encodeURIComponent(x.name)}&client=${encodeURIComponent(p.client || '')}`); } catch (e) { /* none */ }
      S.startTimer({ client: p.client, project: x.name, description: mem.description || p.description, area: mem.area || p.area, operation: mem.operation || p.operation, preset_id: p.id }).catch(() => {});
    } }))]);
  }

  function setup(el) {
    el.addEventListener('click', e => {
      const a = e.target.closest('[data-act]'), row = e.target.closest('[data-id]');
      if (a && a.dataset.act === 'edit') return manage();
      if (row) { const p = S.seeds.presets.find(x => x.id === +row.dataset.id); if (p) startOf(p); }
    });
    el.addEventListener('keydown', e => { const r = e.target.closest && e.target.closest('[data-id]'); if (r && e.target === r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); r.click(); } });
    U.onContext(el, '[data-id]', row => {
      const p = S.seeds.presets.find(x => x.id === +row.dataset.id); if (!p) return [];
      return [{ label: '▶ Start', onClick: () => startOf(p) }, { label: 'Start on project…', onClick: () => startOnProject(p) }, { label: 'Edit presets…', onClick: manage }, { sep: true },
        { label: 'Delete preset…', danger: true, onClick: async () => {
          if (!(await U.confirm('Delete this preset?', `“${p.label}” will be removed. You can undo right after.`, { ok: 'Delete', danger: true }))) return;
          const before = S.d.presets, after = before.filter(x => x.id !== p.id);
          try { await S.act(() => U.api('PUT', '/api/presets', after)); U.toast(`Deleted: ${p.label}`, { undo: () => S.act(() => U.api('PUT', '/api/presets', before)) }); } catch (e) { /* shown */ }
        } }];
    });
  }
  U.definePanel('presets', { title: 'Presets', events: ['data', 'scope'], render, setup });
})();
