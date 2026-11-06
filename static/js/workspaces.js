/* Workspaces and zones.
   The screen has four fixed zones: the left sidebar, the main area, the right sidebar and the bottom drawer.
   Each zone holds one to three stacks of tabs: one above another in the main area and the sidebars, side by
   side in the drawer. A sidebar can run full height (a column) or sit above the drawer; the drawer spans
   whatever isn't a column. Tabs move between zones and stacks by dragging; nothing else splits.
   Our zone model is the source of truth, saved per workspace; dockview only draws it. */
(function () {
  const DV = window['dockview-core'];
  const SIDES = ['left', 'right'], ZONES = ['left', 'main', 'right', 'bottom'];
  const HOME = { navigator: 'left', tasks: 'main', projects: 'main', timesheet: 'bottom', week: 'bottom', inspector: 'right', presets: 'right' };
  const SLIM = 34, MIN = { left: 150, right: 200, bottom: 110 }, MAX_STACKS = 3;
  const st = (...panels) => ({ panels });
  const BUILT_IN = {
    plan:   { label: 'Plan',   column: { left: true },
              zones: { left: { stacks: [st('navigator')], size: 230 }, main: { stacks: [st('tasks', 'projects')] }, right: { stacks: [st('inspector', 'presets')], size: 320, folded: true }, bottom: { stacks: [st('timesheet', 'week')], size: 300 } } },
    track:  { label: 'Track',  column: {},
              zones: { left: { stacks: [], size: 230 }, main: { stacks: [st('tasks', 'presets')] }, right: { stacks: [st('inspector')], size: 320, folded: true }, bottom: { stacks: [st('week')], size: 220 } } },
    review: { label: 'Review', column: {},
              zones: { left: { stacks: [st('navigator')], size: 230, folded: true }, main: { stacks: [st('timesheet'), st('week')] }, right: { stacks: [st('inspector', 'presets', 'projects')], size: 320, folded: true }, bottom: { stacks: [], size: 230 } } },
  };

  let api = null, current = 'plan', lastFull = 'plan', model = null, building = 0, saveTimer = null;
  let narrow = false, pendingZone = null, pendingKind = null, pendingPanel = null, warned = false, settleUntil = 0, mutating = false;
  const zoneOf = new Map(), btns = new Map(), narrowOpen = new Set();
  const settling = () => { settleUntil = performance.now() + 600; };   // sizes settle after a redraw or fold; only your own resizing is saved

  const clone = o => JSON.parse(JSON.stringify(o));
  const customs = () => Object.fromEntries(Object.entries(U.pref('wsCustom', {})).filter(([, v]) => v && v.zones));
  const names = () => ({ ...Object.fromEntries(Object.entries(BUILT_IN).map(([k, v]) => [k, v.label])), timer: 'Timer', ...Object.fromEntries(Object.keys(customs()).map(k => [k, k])) });
  const anim = (fn, opts) => (window.Motion && api && api.groups.length ? Motion.around(fn, opts) : fn());   // one smooth move
  const quiet = fn => (window.Motion && Motion.quiet ? Motion.quiet(fn) : fn());                                // no motion of its own
  const across = z => z === 'bottom';                                       // the drawer's stacks sit side by side
  const along = (g, z) => { const r = g.element.getBoundingClientRect(); return across(z) ? r.left : r.top; };
  const groupsOfZone = z => (api ? api.groups.filter(g => zoneOf.get(g.id) === z).sort((a, b) => along(a, z) - along(b, z)) : []);
  const groupOfZone = z => groupsOfZone(z)[0];
  const panelsOf = (z, m = model) => m.zones[z].stacks.flatMap(s => s.panels);
  const zoneOfPanel = id => model && ZONES.find(z => panelsOf(z).includes(id));
  const folded = z => !!model && z !== 'main' && (model.zones[z].folded || (narrow && SIDES.includes(z) && !narrowOpen.has(z)));
  const zoneName = z => ({ left: 'left sidebar', right: 'right sidebar', bottom: 'drawer', main: 'main area' }[z]);

  // A clean model: every panel at most once, no empty stacks, main never empty, sizes sane.
  // Older saved layouts (one list of panels per zone) become a single stack.
  function normalize(src) {
    const m = clone(src || BUILT_IN.plan), seen = new Set();
    m.column = { left: !!(m.column && m.column.left), right: !!(m.column && m.column.right) };
    m.zones = m.zones || {};
    ZONES.forEach(z => {
      const v = m.zones[z] = Object.assign({ size: z === 'bottom' ? 260 : 280, folded: false }, m.zones[z]);
      const stacks = v.stacks || (v.panels ? [{ panels: v.panels, active: v.active }] : []);
      v.stacks = stacks.map(s => ({ panels: (s.panels || []).filter(id => Panels[id] && !seen.has(id) && seen.add(id)), active: s.active, size: s.size ? Math.round(+s.size) : null }))
        .filter(s => s.panels.length).slice(0, MAX_STACKS);
      v.stacks.forEach(s => { if (!s.panels.includes(s.active)) s.active = s.panels[0]; });
      delete v.panels; delete v.active;
      v.folded = z !== 'main' && !!v.folded;
      v.size = Math.max(MIN[z] || 0, Math.round(+v.size || 260));
    });
    if (!panelsOf('main', m).length) {                        // the main area always holds something
      const from = ZONES.find(z => z !== 'main' && panelsOf(z, m).includes('tasks')) || ZONES.find(z => panelsOf(z, m).length);
      const id = from ? (panelsOf(from, m).includes('tasks') ? 'tasks' : panelsOf(from, m)[0]) : 'tasks';
      if (from) {
        m.zones[from].stacks.forEach(s => { s.panels = s.panels.filter(x => x !== id); if (s.active === id) s.active = s.panels[0]; });
        m.zones[from].stacks = m.zones[from].stacks.filter(s => s.panels.length);
      }
      m.zones.main.stacks = [{ panels: [id], active: id, size: null }];
    }
    delete m.label;
    return m;
  }

  // ── drawing the model ── The build order decides who spans what: sidebars that sit above the drawer come
  // before it, so the drawer runs under them; full-height columns come after, so they wrap the drawer too.
  // A zone's extra stacks split its first one, below it (or to its right, in the drawer).
  function render(m) {
    building++;
    try {
      api.clear(); zoneOf.clear();
      const place = (zone, position) => {
        let prev = null;
        m.zones[zone].stacks.forEach((s, k) => {
          const pos = k ? { referencePanel: prev, direction: across(zone) ? 'right' : 'below' } : position;
          s.panels.forEach((id, i) => api.addPanel({ id, component: id, title: Panels[id].title, position: i ? { referencePanel: s.panels[0], direction: 'within' } : pos }));
          zoneOf.set(api.getPanel(s.panels[0]).group.id, zone); prev = s.panels[0];
        });
      };
      place('main');
      SIDES.forEach(s => { if (!m.column[s]) place(s, { direction: s }); });
      place('bottom', { direction: 'below' });
      SIDES.forEach(s => { if (m.column[s]) place(s, { direction: s }); });
      ZONES.forEach(z => { if (folded(z)) groupsOfZone(z).forEach(g => setFold(g, z, true)); });   // folds first: their fixed size must not spill into the others
      for (let pass = 0; pass < 2; pass++) ZONES.forEach(z => {                                   // twice: each resize nudges its neighbours
        if (folded(z)) return;
        const gs = groupsOfZone(z), v = m.zones[z];
        if (z !== 'main' && gs[0]) try { gs[0].api.setSize(z === 'bottom' ? { height: v.size } : { width: v.size }); } catch (e) { /* default */ }
        if (gs.length > 1) gs.slice(0, -1).forEach((g, k) => { const s = v.stacks[k] && v.stacks[k].size; if (s) try { g.api.setSize(across(z) ? { width: s } : { height: s }); } catch (e) { /* even */ } });
      });
      ZONES.forEach(z => m.zones[z].stacks.forEach(s => { const p = api.getPanel(s.active); if (p) p.api.setActive(); }));
      const mp = m.zones.main.stacks[0] && api.getPanel(m.zones.main.stacks[0].active); if (mp) mp.api.setActive();
      paintAll();
    } finally { building--; settling(); }
  }

  // ── folding ── Sidebars fold into a slim strip, the drawer into a bar (every stack in it). The main area never folds.
  function setFold(g, zone, on) {
    const h = zone === 'bottom', el = g.element;
    el.classList.toggle('ck-collapsed', on); el.classList.toggle('ck-h', on && h); el.classList.toggle('ck-w', on && !h);
    try {
      if (on) { g.api.setConstraints(h ? { minimumHeight: SLIM, maximumHeight: SLIM } : { minimumWidth: SLIM, maximumWidth: SLIM }); g.api.setSize(h ? { height: SLIM } : { width: SLIM }); }
      else {
        g.api.setConstraints(h ? { minimumHeight: MIN.bottom, maximumHeight: Number.MAX_SAFE_INTEGER } : { minimumWidth: MIN[zone], maximumWidth: Number.MAX_SAFE_INTEGER });
        g.api.setSize(h ? { height: model.zones[zone].size } : { width: model.zones[zone].size });
      }
    } catch (e) { console.warn('fold', e); }
    settling();
    paint(g);
  }
  function foldZone(zone, on) {
    if (!model || !zone || zone === 'main') return;
    const gs = groupsOfZone(zone); if (!gs.length) return;
    if (narrow && SIDES.includes(zone)) {                      // a narrow window folds sidebars for now only; your saved layout stays
      if (on) narrowOpen.delete(zone); else { narrowOpen.add(zone); model.zones[zone].folded = false; }
    } else model.zones[zone].folded = on;
    building++; try { anim(() => gs.forEach(g => setFold(g, zone, folded(zone))), { clone: false }); } finally { building--; }
    paintAll(); save();
  }
  const toggleGroup = g => { const z = g && zoneOf.get(g.id); if (z) foldZone(z, !g.element.classList.contains('ck-collapsed')); };
  function toggleColumn(zone) {
    if (!model || !SIDES.includes(zone)) return;
    model.column[zone] = !model.column[zone];
    anim(() => render(model)); save();
  }

  // ── the buttons in each zone's tab bar (on its first stack only): run full height (sidebars), and fold ──
  const icon = (zone, full) => {
    const x = zone === 'left' ? 2.5 : 9.5;
    return `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="1.5" width="13" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.2"/>`
      + (full ? `<rect x="${x}" y="2.5" width="4" height="11" rx="1" fill="currentColor"/>` : `<rect x="${x}" y="2.5" width="4" height="7" rx="1" fill="currentColor"/><rect x="2.5" y="10.5" width="11" height="3" rx="1" fill="currentColor" opacity=".55"/>`) + '</svg>';
  };
  function headerAction(group) {
    const el = document.createElement('div'); el.className = 'ck-actions';
    const mk = (cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.onclick = e => { e.stopPropagation(); fn(); }; return b; };
    return {
      element: el,
      init() {
        const col = mk('ck-colbtn', () => toggleColumn(zoneOf.get(group.id)));
        const fold = mk('ck-collapse', () => toggleGroup(group));
        el.append(col, fold); btns.set(group.id, { col, fold }); paint(group);
      },
      dispose() { btns.delete(group.id); },
    };
  }
  function paint(g) {
    const b = btns.get(g.id); if (!b) return;
    const z = zoneOf.get(g.id), f = g.element.classList.contains('ck-collapsed'), first = !!z && groupOfZone(z) === g;
    b.fold.hidden = !z || z === 'main' || !first;
    b.col.hidden = !SIDES.includes(z) || f || !first;
    if (!z || z === 'main' || !first) return;
    b.fold.textContent = { left: f ? '›' : '‹', right: f ? '‹' : '›', bottom: f ? '⌃' : '⌄' }[z];
    b.fold.title = b.fold.ariaLabel = (f ? 'Unfold the ' : 'Fold the ') + zoneName(z);
    if (SIDES.includes(z)) {
      const full = !!(model && model.column[z]);
      b.col.innerHTML = icon(z, full); b.col.classList.toggle('on', full);
      b.col.title = b.col.ariaLabel = full ? 'Sit above the drawer' : 'Run full height';
    }
  }
  const paintAll = () => api && api.groups.forEach(paint);

  // ── keeping the model in step with what you do ──
  function guessZone(g) {
    const d = document.getElementById('dock').getBoundingClientRect(), r = g.element.getBoundingClientRect();
    const cx = (r.left + r.width / 2 - d.left) / d.width, cy = (r.top + r.height / 2 - d.top) / d.height;   // judge by the centre
    if (cy > 0.6 && r.width > d.width * 0.45) return 'bottom';
    if (cx < 0.38) return 'left';
    if (cx > 0.62) return 'right';
    return cy > 0.6 ? 'bottom' : 'main';
  }
  function sync() {
    if (building || !model || !api || current === 'timer') return;
    mutating = false;
    let created = false;
    api.groups.forEach(g => { if (!zoneOf.get(g.id)) { zoneOf.set(g.id, pendingZone || guessZone(g)); created = true; } });
    const moved = pendingPanel && pendingZone && api.getPanel(pendingPanel) && api.getPanel(pendingPanel).group;
    if (moved && zoneOf.get(moved.id) !== pendingZone) { zoneOf.set(moved.id, pendingZone); created = true; }   // a zone's only stack moved whole
    const kind = pendingKind;
    if (created) { pendingZone = null; pendingKind = null; pendingPanel = null; }   // keep a drag's target until its stack lands
    const hadZones = ZONES.filter(z => model.zones[z].stacks.length).join();
    const before = Object.fromEntries(ZONES.map(z => [z, panelsOf(z)]));
    ZONES.forEach(z => {
      const old = model.zones[z].stacks;
      model.zones[z].stacks = groupsOfZone(z).map((g, k) => {
        const panels = g.panels.map(p => p.id);
        return { panels, active: g.activePanel && panels.includes(g.activePanel.id) ? g.activePanel.id : panels[0], size: old[k] ? old[k].size : null };
      }).filter(s => s.panels.length);
    });
    ZONES.filter(z => panelsOf(z).some(id => !before[z].includes(id))).forEach(z => {   // a zone that just received a panel opens, so you see where it went
      if (!folded(z)) return;
      model.zones[z].folded = false; if (narrow) narrowOpen.add(z);
      building++; try { groupsOfZone(z).forEach(g => setFold(g, z, false)); } finally { building--; }
    });
    const mainEmpty = !panelsOf('main').length;
    if (mainEmpty) { model = normalize(model); U.toast('The main area keeps at least one panel'); }
    const reshaped = hadZones !== ZONES.filter(z => model.zones[z].stacks.length).join();   // a zone emptied or opened
    const last = U.pref('lastZone', {}); ZONES.forEach(z => panelsOf(z).forEach(id => { last[id] = z; })); U.setPref('lastZone', last);
    const newZone = created && kind !== 'split';                // a new stack inside a zone is already in place
    if (newZone || mainEmpty || reshaped) quiet(() => render(model));   // zones changed: redraw them in their places, at your sizes
    else paintAll();
    save();
  }
  function trackSizes() {
    if (building || mutating || !model || current === 'timer' || performance.now() < settleUntil) return;
    let changed = false;
    const keep = (o, k, s, min) => { if (s >= min && Math.abs(s - (o[k] || 0)) > 2) { o[k] = s; changed = true; } };
    ZONES.forEach(z => {
      const gs = groupsOfZone(z); if (!gs.length || folded(z)) return;
      if (z !== 'main') keep(model.zones[z], 'size', Math.round(z === 'bottom' ? gs[0].height : gs[0].width), MIN[z]);
      if (gs.length > 1) gs.forEach((g, k) => { const s = model.zones[z].stacks[k]; if (s) keep(s, 'size', Math.round(across(z) ? g.width : g.height), 60); });
    });
    if (changed) save();
  }
  // Where a dragged tab may go: onto a stack's tab bar or into its middle (to join it), onto a stack's top or bottom
  // edge (the left or right edge in the drawer) to start a new stack in that zone, or into an empty zone's window edge.
  function guard(e) {
    if (!model) return;
    const data = e.getData && e.getData(), pid = data && data.panelId;
    const refuse = msg => { e.preventDefault(); if (msg && !warned) { warned = true; U.toast(msg); } };
    if (!pid) return refuse();                                  // a whole stack can't be dragged
    const from = zoneOfPanel(pid), leavingMain = from === 'main' && panelsOf('main').length === 1;
    if (e.kind === 'edge') {
      const z = { left: 'left', right: 'right', bottom: 'bottom' }[e.position];
      if (!z || model.zones[z].stacks.length) return refuse();
      if (leavingMain) return refuse('The main area keeps at least one panel');
      pendingZone = z; pendingKind = 'edge'; pendingPanel = pid; return;
    }
    const tz = e.group && zoneOf.get(e.group.id);
    if (!tz) return refuse();
    if (tz !== from && leavingMain) return refuse('The main area keeps at least one panel');
    if (e.kind !== 'content' || e.position === 'center') return;             // joining a stack
    const ends = across(tz) ? ['left', 'right'] : ['top', 'bottom'];
    if (!ends.includes(e.position) || folded(tz)) return refuse();
    const alone = e.group.panels.length === 1 && e.group.panels[0].id === pid;   // splitting a stack off itself changes nothing
    if (alone) return refuse();
    if (model.zones[tz].stacks.length >= MAX_STACKS && from !== tz) return refuse('A zone holds up to three stacks');
    if (model.zones[tz].stacks.length >= MAX_STACKS && from === tz && model.zones[tz].stacks.find(s => s.panels.includes(pid)).panels.length > 1) return refuse('A zone holds up to three stacks');
    pendingZone = tz; pendingKind = 'split'; pendingPanel = pid;
  }

  // ── saving ──
  function save() {
    if (!model || current === 'timer') return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      U.setPref('zones.' + current, model);
      const c = U.pref('wsCustom', {}); if (c[current]) { c[current] = clone(model); U.setPref('wsCustom', c); }
    }, 300);
  }

  // ── workspaces ──
  function load(name) {
    const fromTimer = document.body.classList.contains('ws-timer');
    if (!names()[name]) name = 'plan';
    current = name; U.setPref('wsCurrent', name);
    document.getElementById('wsName').textContent = names()[name];
    if (name === 'timer') {                                     // the light workspace: just the timer bar
      const hide = () => { if (current === 'timer') document.body.classList.add('ws-timer'); };
      if (window.Motion && !fromTimer) Motion.dockOut(hide); else hide();
      S.emit('data'); return;
    }
    document.body.classList.remove('ws-timer');
    lastFull = name; U.setPref('wsLast', name);
    narrowOpen.clear();
    model = normalize(U.pref('zones.' + name, null) || customs()[name] || BUILT_IN[name]);
    if (fromTimer || !api.groups.length) { quiet(() => render(model)); if (fromTimer && window.Motion) Motion.dockIn(); }
    else anim(() => render(model));
    S.emit('data');
  }
  function resetCurrent() {
    if (current === 'timer') return;
    try { localStorage.removeItem('clockin.zones.' + current); } catch (e) { /* ok */ }
    model = normalize(customs()[current] || BUILT_IN[current]); narrowOpen.clear();
    anim(() => render(model)); save(); U.toast('Layout reset');
  }
  async function saveAs() {
    if (current === 'timer') return U.toast('Switch to a layout first, then save it', { error: true });
    const name = await U.prompt('Save workspace', 'Name'); if (!name) return;
    if (BUILT_IN[name.toLowerCase()] || name.toLowerCase() === 'timer') return U.toast('That name is taken by a built-in workspace', { error: true });
    const c = U.pref('wsCustom', {}); c[name] = clone(model); U.setPref('wsCustom', c);
    current = name; U.setPref('wsCurrent', name); U.setPref('zones.' + name, model);
    document.getElementById('wsName').textContent = name; U.toast(`Saved workspace “${name}”`);
  }
  function deleteCustom(name) {
    const c = U.pref('wsCustom', {}); delete c[name]; U.setPref('wsCustom', c);
    try { localStorage.removeItem('clockin.zones.' + name); } catch (e) { /* ok */ }
    if (current === name) load('plan');
  }

  // ── panels ──
  function openPanel(id) {
    if (!Panels[id] || api.getPanel(id)) return;
    const z = U.pref('lastZone', {})[id] || HOME[id] || 'right', g = groupOfZone(z);
    if (g) {
      anim(() => api.addPanel({ id, component: id, title: Panels[id].title, position: { referenceGroup: g.id } }));
      if (folded(z)) foldZone(z, false);
    } else {
      model.zones[z].stacks = [{ panels: [id], active: id, size: null }]; model.zones[z].folded = false;
      anim(() => render(model)); save();
    }
  }
  function closePanel(id) {
    const z = zoneOfPanel(id);
    if (z === 'main' && panelsOf('main').length === 1) return U.toast('The main area keeps at least one panel');
    const p = api.getPanel(id); if (p) anim(() => p.api.close());
  }
  function reveal(id) {
    if (current === 'timer') load(lastFull);
    if (!api.getPanel(id)) openPanel(id);
    const p = api.getPanel(id); if (!p) return;
    const z = zoneOfPanel(id); if (z && folded(z)) foldZone(z, false);
    try { p.api.setActive(); } catch (e) { /* ok */ }
  }
  const togglePanel = id => (api.getPanel(id) ? closePanel(id) : reveal(id));

  // ── menus ──
  function wsMenu(btn) {
    const all = names(), custom = customs();
    U.menuAt(btn, [{ header: 'Workspace' }, ...Object.entries(all).map(([k, l]) => ({ label: l, checked: k === current, onClick: () => load(k) })), { sep: true },
      { label: 'Save layout as…', onClick: saveAs }, { label: 'Reset this workspace', onClick: resetCurrent, disabled: current === 'timer' },
      ...Object.keys(custom).map(k => ({ label: `Delete “${k}”`, danger: true, onClick: () => deleteCustom(k) }))]);
  }
  function winMenu(btn) {
    U.menuAt(btn, [{ header: 'Panels' }, ...Object.keys(Panels).map(id => {
      const open = !!(api && api.getPanel(id)), z = open ? zoneOfPanel(id) : (U.pref('lastZone', {})[id] || HOME[id]);
      return { label: `${Panels[id].title} · ${zoneName(z)}`, checked: open, onClick: () => togglePanel(id) };
    })]);
  }

  function init() {
    api = DV.createDockview(document.getElementById('dock'), {
      theme: { name: 'clockin', className: 'dockview-theme-clockin', gap: 6, tabAnimation: 'smooth',
               dndTabIndicator: 'line', dndOverlayMounting: 'absolute', dndOverlayBorder: '2px dashed var(--accent)' },
      dndEdges: { size: { value: 28, type: 'pixels' }, activationSize: { value: 36, type: 'pixels' } },   // empty zones open at the window's edge
      disableFloatingGroups: true,
      createComponent: ({ name }) => Panels[name].create(),
      createRightHeaderActionComponent: headerAction,
    });
    window.Dock = api;
    api.onWillShowOverlay(guard);                                // before Motion, so refused drops never squeeze anything
    if (api.onWillDragGroup) api.onWillDragGroup(e => { try { e.nativeEvent.preventDefault(); } catch (x) { /* ok */ } });
    if (window.Motion) Motion.attach(api);
    api.onWillMutateLayout(() => { if (!building) mutating = true; });   // sizes jump mid-move: don't save them
    api.onDidMutateLayout(sync);
    if (api.onDidActivePanelChange) api.onDidActivePanelChange(() => { if (!building) sync(); });
    api.onDidLayoutChange(trackSizes);
    const reset = () => setTimeout(() => { warned = false; pendingZone = null; pendingKind = null; pendingPanel = null; }, 0);
    document.addEventListener('dragend', reset, true); document.addEventListener('pointerup', reset, true);

    // Click the tab that's showing to fold its zone; click a folded zone's tab to unfold it.
    // Whether it was showing is read on pointer-down, before dockview switches tabs; drags and the × don't count.
    const dockEl = document.getElementById('dock'); let press = null;
    dockEl.addEventListener('pointerdown', e => {
      const t = e.target.closest('.dv-tab');
      press = t && e.button === 0 && !e.target.closest('.dv-default-tab-action') ? { t, x: e.clientX, y: e.clientY, was: t.classList.contains('dv-active-tab') } : null;
    }, true);
    dockEl.addEventListener('click', e => {
      const t = e.target.closest('.dv-tab'), p = press; press = null;
      if (!t || !p || p.t !== t || e.target.closest('.dv-default-tab-action') || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 4) return;
      const g = api.groups.find(x => x.element === t.closest('.dv-groupview')), z = g && zoneOf.get(g.id);
      if (!z || z === 'main') return;
      if (g.element.classList.contains('ck-collapsed')) foldZone(z, false);
      else if (p.was) foldZone(z, true);
    });

    document.getElementById('wsBtn').onclick = e => wsMenu(e.currentTarget);
    document.getElementById('winBtn').onclick = e => winMenu(e.currentTarget);
    // Narrow windows fold the sidebars for now (not saved); widening brings them back.
    narrow = innerWidth < 900;
    addEventListener('resize', () => {
      const n = innerWidth < 900; if (n === narrow) return;
      narrow = n; narrowOpen.clear();
      if (current === 'timer' || !model) return;
      building++; try { anim(() => SIDES.forEach(z => groupsOfZone(z).forEach(g => setFold(g, z, folded(z)))), { clone: false }); } finally { building--; }
      paintAll();
    });
    lastFull = U.pref('wsLast', 'plan'); if (!BUILT_IN[lastFull] && !customs()[lastFull]) lastFull = 'plan';
    const saved = U.pref('wsCurrent', 'plan');
    load(names()[saved] ? saved : 'plan');
  }

  window.Workspaces = {
    init, reveal, load, resetCurrent, toggleGroup, foldZone, toggleColumn,
    get current() { return current; }, get lastFull() { return lastFull; }, get api() { return api; },
    get model() { return model && clone(model); },
    _expect(zone, kind, panel) { pendingZone = zone; pendingKind = kind; pendingPanel = panel || null; },   // tests: what a real drag reports before its drop
  };
})();
