/* Workspaces and zones.
   The screen has four fixed zones: the left sidebar, the main area, the right sidebar and the bottom drawer.
   Each zone is one stack of tabs. A sidebar can run full height (a column) or sit above the drawer; the
   drawer spans whatever isn't a column. Tabs move between zones by dragging; zones never split.
   Our zone model is the source of truth, saved per workspace; dockview only draws it. */
(function () {
  const DV = window['dockview-core'];
  const SIDES = ['left', 'right'], ZONES = ['left', 'main', 'right', 'bottom'];
  const HOME = { navigator: 'left', tasks: 'main', projects: 'main', timesheet: 'bottom', week: 'bottom', inspector: 'right', presets: 'right' };
  const SLIM = 34, MIN = { left: 150, right: 200, bottom: 110 };
  const BUILT_IN = {
    plan:   { label: 'Plan',   column: { left: true },
              zones: { left: { panels: ['navigator'], size: 230 }, main: { panels: ['tasks', 'projects'] }, right: { panels: ['inspector', 'presets'], size: 320, folded: true }, bottom: { panels: ['timesheet', 'week'], size: 300 } } },
    track:  { label: 'Track',  column: {},
              zones: { left: { panels: [], size: 230 }, main: { panels: ['tasks', 'presets'] }, right: { panels: ['inspector'], size: 320, folded: true }, bottom: { panels: ['week'], size: 220 } } },
    review: { label: 'Review', column: {},
              zones: { left: { panels: ['navigator'], size: 230, folded: true }, main: { panels: ['timesheet'] }, right: { panels: ['inspector', 'presets', 'projects'], size: 320, folded: true }, bottom: { panels: ['week'], size: 230 } } },
  };

  let api = null, current = 'plan', lastFull = 'plan', model = null, building = 0, saveTimer = null;
  let narrow = false, pendingZone = null, warned = false, settleUntil = 0;
  const settling = () => { settleUntil = performance.now() + 600; };   // sizes settle after a redraw or fold; only your own resizing is saved
  const zoneOf = new Map(), btns = new Map(), narrowOpen = new Set();

  const clone = o => JSON.parse(JSON.stringify(o));
  const customs = () => Object.fromEntries(Object.entries(U.pref('wsCustom', {})).filter(([, v]) => v && v.zones));
  const names = () => ({ ...Object.fromEntries(Object.entries(BUILT_IN).map(([k, v]) => [k, v.label])), timer: 'Timer', ...Object.fromEntries(Object.keys(customs()).map(k => [k, k])) });
  const anim = (fn, opts) => (window.Motion && api && api.groups.length ? Motion.around(fn, opts) : fn());   // one smooth move
  const quiet = fn => (window.Motion && Motion.quiet ? Motion.quiet(fn) : fn());                                // no motion of its own
  const groupOfZone = z => api && api.groups.find(g => zoneOf.get(g.id) === z);
  const zoneOfPanel = id => model && ZONES.find(z => model.zones[z].panels.includes(id));
  const folded = z => !!model && z !== 'main' && (model.zones[z].folded || (narrow && SIDES.includes(z) && !narrowOpen.has(z)));
  const zoneName = z => ({ left: 'left sidebar', right: 'right sidebar', bottom: 'drawer', main: 'main area' }[z]);

  // A clean model: every panel at most once, main never empty, sizes sane.
  function normalize(src) {
    const m = clone(src || BUILT_IN.plan), seen = new Set();
    m.column = { left: !!(m.column && m.column.left), right: !!(m.column && m.column.right) };
    m.zones = m.zones || {};
    ZONES.forEach(z => {
      const v = m.zones[z] = Object.assign({ panels: [], size: z === 'bottom' ? 260 : 280, folded: false }, m.zones[z]);
      v.panels = (v.panels || []).filter(id => Panels[id] && !seen.has(id) && seen.add(id));
      v.folded = z !== 'main' && !!v.folded;
      v.size = Math.max(MIN[z] || 0, Math.round(+v.size || 260));
      if (!v.panels.includes(v.active)) v.active = v.panels[0] || null;
    });
    if (!m.zones.main.panels.length) {                        // the main area always holds something
      const from = ZONES.find(z => z !== 'main' && m.zones[z].panels.includes('tasks')) || ZONES.find(z => m.zones[z].panels.length);
      const id = from ? (m.zones[from].panels.includes('tasks') ? 'tasks' : m.zones[from].panels[0]) : 'tasks';
      if (from) { m.zones[from].panels = m.zones[from].panels.filter(x => x !== id); if (m.zones[from].active === id) m.zones[from].active = m.zones[from].panels[0] || null; }
      m.zones.main.panels = [id]; m.zones.main.active = id;
    }
    delete m.label;
    return m;
  }

  // ── drawing the model ── The build order decides who spans what: sidebars that sit above the drawer come
  // before it, so the drawer runs under them; full-height columns come after, so they wrap the drawer too.
  function render(m) {
    building++;
    try {
      api.clear(); zoneOf.clear();
      const place = (zone, position) => {
        const v = m.zones[zone]; if (!v.panels.length) return;
        v.panels.forEach((id, i) => api.addPanel({ id, component: id, title: Panels[id].title, position: i ? { referencePanel: v.panels[0], direction: 'within' } : position }));
        zoneOf.set(api.getPanel(v.panels[0]).group.id, zone);
      };
      place('main');
      SIDES.forEach(s => { if (!m.column[s]) place(s, { direction: s }); });
      place('bottom', { direction: 'below' });
      SIDES.forEach(s => { if (m.column[s]) place(s, { direction: s }); });
      ZONES.forEach(z => { const g = groupOfZone(z); if (g && folded(z)) setFold(g, z, true); });   // folds first: their fixed size must not spill into the others
      for (let pass = 0; pass < 2; pass++) ['left', 'right', 'bottom'].forEach(z => {        // twice: each resize nudges its neighbours
        const g = groupOfZone(z); if (g && !folded(z)) try { g.api.setSize(z === 'bottom' ? { height: m.zones[z].size } : { width: m.zones[z].size }); } catch (e) { /* default */ }
      });
      ZONES.forEach(z => { const p = m.zones[z].active && api.getPanel(m.zones[z].active); if (p) p.api.setActive(); });
      const mp = api.getPanel(m.zones.main.active); if (mp) mp.api.setActive();
      paintAll();
    } finally { building--; settling(); }
  }

  // ── folding ── Sidebars fold into a slim strip, the drawer into a bar. The main area never folds.
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
    const g = groupOfZone(zone); if (!g) return;
    if (narrow && SIDES.includes(zone)) {                      // a narrow window folds sidebars for now only; your saved layout stays
      if (on) narrowOpen.delete(zone); else { narrowOpen.add(zone); model.zones[zone].folded = false; }
    } else model.zones[zone].folded = on;
    building++; try { anim(() => setFold(g, zone, folded(zone)), { clone: false }); } finally { building--; }
    save();
  }
  const toggleGroup = g => { const z = g && zoneOf.get(g.id); if (z) foldZone(z, !g.element.classList.contains('ck-collapsed')); };
  function toggleColumn(zone) {
    if (!model || !SIDES.includes(zone)) return;
    model.column[zone] = !model.column[zone];
    anim(() => render(model)); save();
  }

  // ── the buttons in each zone's tab bar: run full height (sidebars), and fold ──
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
    const z = zoneOf.get(g.id), f = g.element.classList.contains('ck-collapsed');
    b.fold.hidden = !z || z === 'main';
    b.col.hidden = !SIDES.includes(z) || f;
    if (!z || z === 'main') return;
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
    const found = { left: [], main: [], right: [], bottom: [] }, act = {};
    let created = false;
    api.groups.forEach(g => {
      let z = zoneOf.get(g.id);
      if (!z) { z = pendingZone || guessZone(g); zoneOf.set(g.id, z); created = true; }
      g.panels.forEach(p => found[z].push(p.id));
      if (g.activePanel) act[z] = g.activePanel.id;
    });
    pendingZone = null;
    const gained = ZONES.filter(z => found[z].some(id => !model.zones[z].panels.includes(id)));
    ZONES.forEach(z => { const v = model.zones[z]; v.panels = found[z]; v.active = found[z].includes(act[z]) ? act[z] : found[z][0] || null; });
    gained.forEach(z => {                                       // a zone that just received a panel opens, so you see where it went
      if (!folded(z)) return;
      model.zones[z].folded = false; if (narrow) narrowOpen.add(z);
      const g = groupOfZone(z); if (g) { building++; try { setFold(g, z, false); } finally { building--; } }
    });
    const mainEmpty = !model.zones.main.panels.length;
    if (mainEmpty) { model = normalize(model); U.toast('The main area keeps at least one panel'); }
    const last = U.pref('lastZone', {}); ZONES.forEach(z => model.zones[z].panels.forEach(id => { last[id] = z; })); U.setPref('lastZone', last);
    if (created || mainEmpty) quiet(() => render(model));      // a new zone opened: redraw it in its proper place
    else paintAll();
    save();
  }
  function trackSizes() {
    if (building || !model || current === 'timer' || performance.now() < settleUntil) return;
    let changed = false;
    ['left', 'right', 'bottom'].forEach(z => {
      const g = groupOfZone(z); if (!g || g.element.classList.contains('ck-collapsed')) return;
      const s = Math.round(z === 'bottom' ? g.height : g.width);
      if (s >= (MIN[z] || 0) && Math.abs(s - model.zones[z].size) > 2) { model.zones[z].size = s; changed = true; }
    });
    if (changed) save();
  }
  // Where a dragged tab may go: onto a zone's tab bar or into its middle (to stack), or into an empty zone's edge.
  function guard(e) {
    if (!model) return;
    const data = e.getData && e.getData(), pid = data && data.panelId;
    const refuse = msg => { e.preventDefault(); if (msg && !warned) { warned = true; U.toast(msg); } };
    if (!pid) return refuse();                                  // a whole zone can't be dragged
    const from = zoneOfPanel(pid), leavingMain = from === 'main' && model.zones.main.panels.length === 1;
    if (e.kind === 'edge') {
      const z = { left: 'left', right: 'right', bottom: 'bottom' }[e.position];
      if (!z || model.zones[z].panels.length) return refuse();
      if (leavingMain) return refuse('The main area keeps at least one panel');
      pendingZone = z; return;
    }
    const tz = e.group && zoneOf.get(e.group.id);
    if (!tz) return refuse();
    if (e.kind === 'content' && e.position !== 'center') return refuse();
    if (tz !== from && leavingMain) return refuse('The main area keeps at least one panel');
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
      model.zones[z].panels.push(id); model.zones[z].active = id; model.zones[z].folded = false;
      anim(() => render(model)); save();
    }
  }
  function closePanel(id) {
    const z = zoneOfPanel(id);
    if (z === 'main' && model.zones.main.panels.length === 1) return U.toast('The main area keeps at least one panel');
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
    api.onDidMutateLayout(sync);
    if (api.onDidActivePanelChange) api.onDidActivePanelChange(() => { if (!building) sync(); });
    api.onDidLayoutChange(trackSizes);
    const reset = () => setTimeout(() => { warned = false; pendingZone = null; }, 0);
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
      building++; try { anim(() => SIDES.forEach(z => { const g = groupOfZone(z); if (g) setFold(g, z, folded(z)); }), { clone: false }); } finally { building--; }
    });
    lastFull = U.pref('wsLast', 'plan'); if (!BUILT_IN[lastFull] && !customs()[lastFull]) lastFull = 'plan';
    const saved = U.pref('wsCurrent', 'plan');
    load(names()[saved] ? saved : 'plan');
  }

  window.Workspaces = {
    init, reveal, load, resetCurrent, toggleGroup, foldZone, toggleColumn,
    get current() { return current; }, get lastFull() { return lastFull; }, get api() { return api; },
    get model() { return model && clone(model); },
  };
})();
