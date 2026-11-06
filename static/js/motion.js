/* Motion: when the layout changes, panels glide to their new places instead of jumping; while you drag a
   panel, its future neighbours make room; and the panel you drop lands with an anime-style hit
   (squash, flash, burst, shake). Collapse, workspaces and opening/closing panels move the same way.
   Everything is off when the system asks for reduced motion. */
(function () {
  const reduce = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const EASE = 'cubic-bezier(.2,.9,.1,1)', DUR = 260;
  let api = null, muted = 0, pending = null, landed = null, squeezed = [], sqKey = '', flyTimer = 0;
  const dock = () => document.getElementById('dock');
  const layer = () => document.getElementById('fxLayer') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'fxLayer' }));
  const gone = (el, ms) => setTimeout(() => el.remove(), ms + 40);   // effects always clean up, even in a background tab
  const visible = g => g.element.isConnected && g.element.getBoundingClientRect().width > 0;

  // Panels can travel outside their old cell for a moment: let them, then clip again.
  function flying(ms) {
    dock().classList.add('fx-flying'); clearTimeout(flyTimer);
    flyTimer = setTimeout(() => dock().classList.remove('fx-flying'), ms + 60);
  }
  function lift(el, ms) {
    const host = el.parentElement; if (!host) return;
    host.style.zIndex = 4; setTimeout(() => { host.style.zIndex = ''; }, ms + 30);
  }

  // ── before / after ──
  function capture(clone) {
    if (!api || reduce()) return null;
    return api.groups.filter(visible).map(g => {
      const r = g.element.getBoundingClientRect();
      return { ids: g.panels.map(p => p.id), active: g.activePanel && g.activePanel.id, r, clone: clone ? g.element.cloneNode(true) : null };
    });
  }
  function play(before, opts = {}) {
    if (!before || reduce()) { unsqueeze(true); return; }
    unsqueeze(true);                                         // the captured boxes already include any squeeze, so no jump
    requestAnimationFrame(() => {
      if (!api) return;
      const after = api.groups.filter(visible), present = new Set(after.flatMap(g => g.panels.map(p => p.id)));
      flying(DUR + 120);
      after.forEach(g => {
        const ids = g.panels.map(p => p.id), act = g.activePanel && g.activePanel.id;
        const b = before.find(x => act && x.ids.includes(act)) || before.find(x => x.ids.some(id => ids.includes(id)));
        if (b) flip(g.element, b.r); else popIn(g.element);
      });
      before.filter(b => b.clone && !b.ids.some(id => present.has(id))).forEach(exit);
      const land = opts.landed && api.getPanel(opts.landed);
      if (land && land.group) setTimeout(() => hit(land.group.element, land.id), DUR * 0.75);
    });
  }
  function flip(el, from) {
    const to = el.getBoundingClientRect(); if (!to.width || !to.height) return;
    const dx = from.left - to.left, dy = from.top - to.top, sx = from.width / to.width, sy = from.height / to.height;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return;
    const skew = Math.abs(dx) > 20 ? (dx > 0 ? -4 : 4) : 0;   // a slight smear on big sideways moves
    lift(el, DUR);
    el.animate([
      { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
      { transformOrigin: '0 0', transform: `translate(${dx * 0.12}px, ${dy * 0.12}px) scale(${1 + (sx - 1) * 0.12}, ${1 + (sy - 1) * 0.12}) skewX(${skew}deg)`, offset: 0.55 },
      { transformOrigin: '0 0', transform: 'none' },
    ], { duration: DUR, easing: EASE });
  }
  function popIn(el) {
    el.animate([
      { transformOrigin: '50% 50%', transform: 'scale(.85)', opacity: 0 },
      { transformOrigin: '50% 50%', transform: 'scale(1.04)', opacity: 1, offset: 0.7 },
      { transformOrigin: '50% 50%', transform: 'none', opacity: 1 },
    ], { duration: 320, easing: EASE });
  }
  function exit(b) {
    const c = b.clone; c.classList.add('fx-ghost');
    Object.assign(c.style, { left: b.r.left + 'px', top: b.r.top + 'px', width: b.r.width + 'px', height: b.r.height + 'px' });
    layer().appendChild(c);
    c.animate([{ transform: 'none', opacity: 1 }, { transform: 'scale(.8)', opacity: 0 }], { duration: 220, easing: 'ease-in' }); gone(c, 220);
  }

  // ── the landing hit ──
  function hit(el, panelId) {
    if (!el.isConnected) return;
    const r = el.getBoundingClientRect();
    const tab = el.querySelector(`.dv-tab[data-tab-panel-id="${panelId}"]`);
    const color = (tab && getComputedStyle(tab).backgroundColor) || getComputedStyle(document.documentElement).getPropertyValue('--accent');
    lift(el, 320);
    el.animate([
      { transformOrigin: '50% 50%', transform: 'scale(1.12, .82)' },
      { transformOrigin: '50% 50%', transform: 'scale(.96, 1.05)', offset: 0.45 },
      { transformOrigin: '50% 50%', transform: 'none' },
    ], { duration: 300, easing: 'ease-out' });
    const flash = Object.assign(document.createElement('div'), { className: 'fx-flash' });
    Object.assign(flash.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    layer().appendChild(flash);
    flash.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: 200, easing: 'ease-out' }); gone(flash, 200);
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = Math.max(r.width, r.height) / 2;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, line = Object.assign(document.createElement('div'), { className: 'fx-line' });
      Object.assign(line.style, { left: cx + 'px', top: cy + 'px', background: color });
      layer().appendChild(line);
      line.animate([
        { transform: `rotate(${a}rad) translateX(${R * 0.45}px) scaleX(.2)`, opacity: 1 },
        { transform: `rotate(${a}rad) translateX(${R * 0.95}px) scaleX(1)`, opacity: 0 },
      ], { duration: 420, easing: 'cubic-bezier(.1,.8,.2,1)' }); gone(line, 420);
    }
    dock().animate([{ transform: 'none' }, { transform: 'translate(-4px, 2px)' }, { transform: 'translate(3px, -2px)' }, { transform: 'translate(-2px, 1px)' }, { transform: 'none' }], { duration: 240 });
  }

  // ── making room while you drag ──
  function squeeze(e) {
    if (reduce() || !api) return;
    if (e.defaultPrevented) return unsqueeze(false);             // a drop the zones don't allow: nothing makes room
    const pos = e.position, g = e.group, edge = e.kind === 'edge';
    const key = `${e.kind}:${g ? g.id : ''}:${pos}`; if (key === sqKey) return;
    unsqueeze(false); sqKey = key;
    const to = (el, transform, origin) => {
      const a = el.animate([{ transformOrigin: origin, transform: 'none' }, { transformOrigin: origin, transform }], { duration: 180, easing: EASE, fill: 'forwards' });
      squeezed.push(a);
    };
    if (edge && pos && pos !== 'center') {                   // docking at the window edge: everyone shifts away from it
      const f = 0.28, horiz = pos === 'left' || pos === 'right';
      const d = dock().getBoundingClientRect();
      api.groups.filter(visible).forEach(x => {
        const r = x.element.getBoundingClientRect();
        // map the group into the part of the dock that's left once the new panel takes its share
        const k = 1 - f, nx = pos === 'left' ? d.left + d.width * f + (r.left - d.left) * k : d.left + (r.left - d.left) * k;
        const ny = pos === 'top' ? d.top + d.height * f + (r.top - d.top) * k : d.top + (r.top - d.top) * k;
        to(x.element, horiz ? `translateX(${nx - r.left}px) scaleX(${k})` : `translateY(${ny - r.top}px) scaleY(${k})`, horiz ? '0 50%' : '50% 0');
      });
      return;
    }
    if (!g || e.kind === 'tab') return;                      // reordering tabs: dockview slides them itself
    if (pos === 'center' || e.kind === 'header_space') {     // joining as a tab: a quick inhale
      squeezed.push(g.element.animate([{ transform: 'none' }, { transform: 'scale(.97)' }, { transform: 'none' }], { duration: 260, easing: 'ease-out' }));
      return;
    }
    const origin = { left: '100% 50%', right: '0 50%', top: '50% 100%', bottom: '50% 0' }[pos];
    to(g.element, pos === 'left' || pos === 'right' ? 'scaleX(.5)' : 'scaleY(.5)', origin);   // the target gives up the half the panel will take
  }
  function unsqueeze(instant) {
    sqKey = '';
    const list = squeezed; squeezed = [];
    list.forEach(a => {
      const held = a.effect && a.effect.getTiming().fill === 'forwards';
      if (instant || !held) return held ? a.cancel() : undefined;     // quick pulses finish on their own
      try { a.reverse(); a.onfinish = () => a.cancel(); } catch (x) { a.cancel(); }   // drag cancelled: ease back
    });
  }

  // ── public ──
  function attach(dockApi) {
    api = dockApi;
    api.onWillMutateLayout(e => { if (!muted) pending = capture(e.kind !== 'add'); });
    api.onDidMutateLayout(() => {
      if (muted || !pending) return;
      const b = pending, l = landed; pending = null; landed = null;
      play(b, { landed: l });
    });
    if (api.onDidMovePanel) api.onDidMovePanel(e => { landed = e.panel && e.panel.id; });
    if (api.onWillShowOverlay) api.onWillShowOverlay(squeeze);
    const done = () => setTimeout(() => unsqueeze(false), 0);
    document.addEventListener('dragend', done, true); document.addEventListener('drop', done, true); document.addEventListener('pointerup', done, true);
  }
  // Run a compound change (a workspace switch, a collapse) as one animation.
  function around(fn, opts = {}) {
    if (!api || reduce()) return fn();
    const before = capture(opts.clone !== false);
    muted++;
    let out;
    try { out = fn(); } finally { muted--; }
    play(before, opts);
    return out;
  }
  // Run a change with no motion of its own (another animation is already covering it).
  function quiet(fn) { muted++; try { return fn(); } finally { muted--; } }
  function dockOut(cb) {
    if (reduce()) return cb();
    let once = false; const go = () => { if (!once) { once = true; cb(); } };
    dock().animate([{ transform: 'none', opacity: 1 }, { transform: 'scale(.96)', opacity: 0 }], { duration: 160, easing: 'ease-in' }).onfinish = go;
    setTimeout(go, 200);                                                    // even if the tab is in the background
  }
  function dockIn() {
    if (reduce()) return;
    dock().animate([{ transform: 'scale(.97)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: EASE });
  }
  window.Motion = { attach, around, quiet, dockOut, dockIn, capture, play, _squeeze: squeeze, _unsqueeze: unsqueeze };
})();
