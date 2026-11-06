/* The first-run tour. A spotlight glides between parts of the app while a card explains each one.
   Runs once per browser (pref "tourDone"); replay it from the ? menu. Never creates data by itself. */
(function () {
  const reduce = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const dock = () => window.Dock;
  const panel = id => (dock() ? dock().getPanel(id) : null);
  const groupEl = id => { const p = panel(id); return p && p.group ? p.group.element : null; };
  // Bring a panel into view if this layout has it (and unfold it if it was collapsed). Never adds panels to your layout.
  const show = id => () => { if (panel(id)) try { Workspaces.reveal(id); } catch (e) { /* fine */ } };

  const STEPS = [
    { hero: 'clock', place: 'center', title: 'Welcome to Clock-in’',
      body: 'Your time and your tasks, in one window. Here’s a one-minute look around.' },
    { target: () => document.getElementById('timerbar'), place: 'bottom', tryTimer: true, title: 'This is your timer',
      body: 'Type what you’re working on and press Enter, or press ▶ next to any task or preset. While it runs, the bar turns green and shows a big clock.' },
    { panel: 'navigator', place: 'right', title: 'Pick where you are',
      body: 'Now, a client or a single project. Tasks, Timesheet, Week and Presets all follow what you pick here.' },
    { panel: 'tasks', title: 'Your tasks',
      body: 'Add one in the box at the top. Press ▶ on a row to time it, and tick the circle when it’s done. The pills filter by context and time of day.' },
    { panel: 'timesheet', title: 'Every minute, on the record',
      body: 'Switch periods, add an entry by hand or export a CSV. Give a client an hourly rate and you also get $ totals and an Invoice button. Pricing is optional.',
      extra: { label: 'Your invoice details…', run: () => window.SenderDialog && SenderDialog.open() } },
    { panel: 'week', title: 'Your week at a glance',
      body: 'Each block is a stretch of tracked time, coloured by project. Switch between today, the last 7 days and this week.' },
    { demo: 'dock', target: () => { const g = groupEl('tasks') || document.querySelector('#dock .dv-groupview'); return g && g.querySelector('.dv-tabs-and-actions-container'); },
      title: 'Arrange it your way',
      body: 'Four zones: two sidebars, the main area and the drawer. Drag a tab onto another zone to stack it there. Click the tab that’s showing, or its arrow, to fold a sidebar or the drawer.' },
    { target: () => document.getElementById('wsBtn'), place: 'bottom', title: 'Workspaces',
      body: 'Plan, Track and Review are ready-made layouts. Timer is just the clock, for a small window. You can save your own arrangement too.' },
    { target: () => document.getElementById('themeBtn'), place: 'bottom', title: 'Make it yours',
      body: 'Five colour themes, light or dark. Pick one that makes you want to press Start.' },
    { hero: 'check', place: 'center', finish: true, title: 'You’re all set',
      body: 'Start a timer and get going. You can replay this tour anytime from the ? button.' },
  ];
  STEPS.forEach(s => { if (s.panel) { s.before = show(s.panel); s.target = () => groupEl(s.panel); } });

  let ui = null, i = 0, typing = null, extras = [], lastFocus = null, raf = 0;

  // ── building blocks ──
  function build() {
    const root = U.el(`<div class="tour" role="dialog" aria-label="Tour of Clock-in’">
      <div class="tour-wall"></div><div class="tour-wall"></div><div class="tour-wall"></div><div class="tour-wall"></div>
      <div class="tour-hole none"></div>
      <div class="tour-card" aria-live="polite"></div></div>`);
    document.body.appendChild(root);
    ui = { root, hole: U.$('.tour-hole', root), card: U.$('.tour-card', root), walls: U.$$('.tour-wall', root), offs: [] };
    const relayout = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(layout); };
    addEventListener('resize', relayout); ui.offs.push(() => removeEventListener('resize', relayout));
    if (dock() && dock().onDidLayoutChange) { const d = dock().onDidLayoutChange(relayout); ui.offs.push(() => d.dispose()); }
    document.addEventListener('keydown', key, true); ui.offs.push(() => document.removeEventListener('keydown', key, true));
    ui.card.addEventListener('click', e => {
      const b = e.target.closest('[data-tour]'); if (!b) return;
      const a = b.dataset.tour;
      if (a === 'next') go(i + 1); else if (a === 'back') go(i - 1); else if (a === 'skip') close();
      else if (a === 'finish') { close(); const inp = U.$('#timerbar input'); if (inp) inp.focus(); }
      else if (a === 'try') { const inp = U.$('#timerbar input'); if (inp) { inp.focus(); inp.placeholder = 'e.g. Reading the docs — then press Enter'; } }
      else if (a === 'extra' && STEPS[i].extra) STEPS[i].extra.run();
    });
  }

  function key(e) {
    if (!ui || document.querySelector('#dialogLayer .scrim')) return;           // a dialog opened from the tour owns the keys
    const t = e.target, typingElsewhere = !ui.card.contains(t) && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '');
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (typingElsewhere) return;
    else if (e.key === 'ArrowRight') { e.preventDefault(); if (i < STEPS.length - 1) go(i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); if (i > 0) go(i - 1); }
  }

  function card(st) {
    const n = STEPS.length, first = i === 0, last = i === n - 1;
    const missing = st.panel && !panel(st.panel) ? ' It isn’t in this layout: open it from Panels ▾.' : '';
    const running = st.tryTimer && S.d && S.d.timer;
    const body = running ? 'Your timer is already running. Stop, Switch and Discard live right here, next to the big clock.' : st.body + missing;
    const hero = st.hero === 'clock' ? '<div class="tour-clock" aria-hidden="true"><i class="h"></i><i class="m"></i></div>'
      : st.hero === 'check' ? '<div class="tour-check" aria-hidden="true">✓</div>' : '';
    const btns = first ? `<button type="button" class="btn ghost" data-tour="skip">Skip tour</button><button type="button" class="btn primary" data-tour="next">Show me around →</button>`
      : last ? `<button type="button" class="btn ghost" data-tour="back">Back</button><button type="button" class="btn primary" data-tour="finish">Start tracking</button>`
      : `<button type="button" class="btn ghost" data-tour="skip">Skip</button><button type="button" class="btn" data-tour="back">Back</button>`
        + (st.tryTimer && !running ? '<button type="button" class="btn" data-tour="try">Try it</button>' : '')
        + '<button type="button" class="btn primary" data-tour="next">Next →</button>';
    ui.card.className = 'tour-card' + (st.hero ? ' hero' : '');
    ui.card.innerHTML = `${hero}${first || last ? '' : `<div class="tour-kicker">${i} of ${n - 2}</div>`}
      <h3 class="tour-title" aria-label="${U.esc(st.title)}"><span class="tt-full" aria-hidden="true">${U.esc(st.title)}</span><span class="tt" aria-hidden="true"></span></h3>
      <p class="tour-body">${U.esc(body)}</p>
      ${st.extra ? `<button type="button" class="tour-link" data-tour="extra">${U.esc(st.extra.label)}</button>` : ''}
      <div class="tour-foot"><div class="tour-dots" aria-hidden="true">${STEPS.map((_, k) => `<i class="${k === i ? 'on' : k < i ? 'done' : ''}"></i>`).join('')}</div>
      <div class="tour-btns">${btns}</div></div>`;
    typeTitle(st.title);
  }

  function typeTitle(text) {
    clearInterval(typing);
    const tt = U.$('.tt', ui.card), full = U.$('.tt-full', ui.card);
    if (reduce()) { tt.textContent = text; return; }
    full.classList.add('typing');
    let k = 0;
    typing = setInterval(() => {
      if (!ui) return clearInterval(typing);
      tt.textContent = text.slice(0, ++k);
      if (k >= text.length) { clearInterval(typing); full.classList.remove('typing'); }
    }, 18);
  }

  // ── geometry: spotlight, the four click-walls around it, and the card beside it ──
  function layout() {
    if (!ui) return;
    const st = STEPS[i], vw = innerWidth, vh = innerHeight;
    const el = st.place === 'center' ? null : (st.target && st.target());
    let r = el && el.getBoundingClientRect();
    if (r && (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > vh)) r = null;
    const pad = 6;
    const H = r ? { x: Math.max(4, r.left - pad), y: Math.max(4, r.top - pad) } : { x: vw / 2, y: vh / 2, w: 0, h: 0 };
    if (r) { H.w = Math.min(vw - 4, r.right + pad) - H.x; H.h = Math.min(vh - 4, r.bottom + pad) - H.y; }
    Object.assign(ui.hole.style, { left: H.x + 'px', top: H.y + 'px', width: H.w + 'px', height: H.h + 'px' });
    ui.hole.classList.toggle('none', !r);
    const [wt, wb, wl, wr] = ui.walls;
    Object.assign(wt.style, { left: 0, top: 0, width: vw + 'px', height: H.y + 'px' });
    Object.assign(wb.style, { left: 0, top: H.y + H.h + 'px', width: vw + 'px', height: Math.max(0, vh - H.y - H.h) + 'px' });
    Object.assign(wl.style, { left: 0, top: H.y + 'px', width: H.x + 'px', height: H.h + 'px' });
    Object.assign(wr.style, { left: H.x + H.w + 'px', top: H.y + 'px', width: Math.max(0, vw - H.x - H.w) + 'px', height: H.h + 'px' });

    const c = ui.card, cw = c.offsetWidth, ch = c.offsetHeight, gap = 16, m = 12;
    let x, y;
    if (!r) { x = (vw - cw) / 2; y = (vh - ch) / 2; }
    else {
      const room = { right: vw - H.x - H.w, left: H.x, bottom: vh - H.y - H.h, top: H.y };
      const fits = s => (s === 'right' || s === 'left' ? room[s] >= cw + gap + m : room[s] >= ch + gap + m);
      const side = [st.place, 'right', 'left', 'bottom', 'top'].filter(Boolean).find(s => room[s] !== undefined && fits(s));
      if (side === 'right') { x = H.x + H.w + gap; y = H.y + H.h / 2 - ch / 2; }
      else if (side === 'left') { x = H.x - gap - cw; y = H.y + H.h / 2 - ch / 2; }
      else if (side === 'bottom') { x = H.x + H.w / 2 - cw / 2; y = H.y + H.h + gap; }
      else if (side === 'top') { x = H.x + H.w / 2 - cw / 2; y = H.y - gap - ch; }
      else { x = H.x + H.w - cw - 18; y = H.y + H.h - ch - 18; }   // a big target: sit inside its corner
    }
    c.style.left = clamp(x, m, vw - cw - m) + 'px';
    c.style.top = clamp(y, m, vh - ch - m) + 'px';
  }

  // ── step flow ──
  async function go(n) {
    if (!ui) return;
    stopExtras();
    i = clamp(n, 0, STEPS.length - 1);
    const st = STEPS[i], me = i;
    if (st.before) { st.before(); await wait(90); if (!ui || i !== me) return; }
    card(st);
    layout();
    setTimeout(() => { if (ui && i === me) layout(); }, 380);           // a panel that was just unfolded settles a beat later
    const nextBtn = U.$('[data-tour="next"], [data-tour="finish"]', ui.card); if (nextBtn) nextBtn.focus({ preventScroll: true });
    if (st.demo === 'dock') setTimeout(() => ui && i === me && dockDemo(), reduce() ? 0 : 550);
    if (st.tryTimer) armTimer(me);
    if (st.finish) setTimeout(() => { if (ui && i === me) { const b = ui.card.getBoundingClientRect(); confetti(b.left + b.width / 2, b.top + 40, 46); } }, reduce() ? 0 : 250);
  }

  function armTimer(me) {
    if (S.d && S.d.timer) return;
    const off = S.on('data', () => {
      if (!ui || i !== me || !(S.d && S.d.timer)) return;
      off();
      const r = document.getElementById('timerbar').getBoundingClientRect();
      confetti(r.right - 140, r.top + r.height / 2, 18);
      const b = U.$('.tour-body', ui.card); if (b) b.textContent = 'There it goes. That’s all it takes.';
      const t = U.$('[data-tour="try"]', ui.card); if (t) t.remove();
      setTimeout(() => { if (ui && i === me) go(me + 1); }, 1300);
    });
    extras.push({ remove: off });
  }

  function dockDemo() {
    const g = groupEl('tasks') || document.querySelector('#dock .dv-groupview');
    const tab = g && (g.querySelector('.dv-tab.dv-active-tab') || g.querySelector('.dv-tab'));
    const d = document.getElementById('dock').getBoundingClientRect();
    if (!tab || !d.width) return;
    const r = tab.getBoundingClientRect(), cs = getComputedStyle(tab);
    const ghost = U.el(`<div class="tour-ghost">${U.esc(tab.textContent.trim())}</div>`);
    Object.assign(ghost.style, { left: r.left + 'px', top: r.top + 'px', height: r.height + 'px', background: cs.backgroundColor, color: cs.color });
    const drawer = groupEl('timesheet') || groupEl('week'), dr = drawer && drawer !== g ? drawer.getBoundingClientRect() : null;   // fly the tab into the drawer zone
    const zb = dr || { left: d.left + 8, width: d.width - 16, top: d.bottom - Math.max(70, d.height * 0.28) - 8, height: Math.max(70, d.height * 0.28) };
    const zone = U.el('<div class="tour-drop"><span>Drop on a zone: it stacks there</span></div>');
    Object.assign(zone.style, { left: zb.left + 'px', width: zb.width + 'px', top: zb.top + 'px', height: zb.height + 'px' });
    document.body.append(zone, ghost);
    extras.push(zone, ghost);
    const dx = zb.left + zb.width / 2 - (r.left + r.width / 2), dy = zb.top + zb.height / 2 - (r.top + r.height / 2);
    if (reduce()) { ghost.style.transform = `translate(${dx}px, ${dy}px)`; zone.style.opacity = 1; return; }
    const T = 2800, opt = { duration: T, iterations: 2, easing: 'ease-in-out' };
    ghost.animate([
      { transform: 'translate(0,0) scale(1) rotate(0deg)', offset: 0 },
      { transform: 'translate(0,-12px) scale(1.08) rotate(-3deg)', offset: 0.12 },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.3 - 30}px) scale(1.08) rotate(2deg)`, offset: 0.34 },
      { transform: `translate(${dx}px, ${dy}px) scale(1.08) rotate(0deg)`, offset: 0.56 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.94)`, offset: 0.68 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.94)`, offset: 0.78 },
      { transform: 'translate(0,0) scale(1) rotate(0deg)', offset: 1 },
    ], opt);
    zone.animate([{ opacity: 0, offset: 0 }, { opacity: 0, offset: 0.38 }, { opacity: 1, offset: 0.52 }, { opacity: 1, offset: 0.76 }, { opacity: 0, offset: 0.9 }, { opacity: 0, offset: 1 }], opt);
    setTimeout(() => { ghost.remove(); zone.remove(); }, T * 2 + 50);
  }

  function confetti(x, y, n) {
    if (reduce()) return;
    const spectrum = document.documentElement.getAttribute('data-palette') === 'spectrum';
    const colors = spectrum ? ['#7B2A6F', '#0B5CA8', '#1F8A4C', '#FDB927', '#E8541F', '#DC2323'] : ['var(--accent)', 'var(--mint)', '#FDB927', '#FF7A8A', '#7DB8F5'];
    for (let k = 0; k < n; k++) {
      const p = document.createElement('i');
      p.className = 'tour-confetti';
      Object.assign(p.style, { left: x + 'px', top: y + 'px', background: colors[k % colors.length], width: 5 + Math.random() * 5 + 'px', height: 8 + Math.random() * 7 + 'px' });
      document.body.appendChild(p);
      const a = -Math.PI * (0.1 + Math.random() * 0.8), sp = 140 + Math.random() * 240, rot = (Math.random() - 0.5) * 720;
      const dx = Math.cos(a) * sp, dy = Math.sin(a) * sp;
      p.animate([
        { transform: 'translate(-50%,-50%) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${dx * 1.25}px, ${dy + 280}px) rotate(${rot * 2}deg)`, opacity: 0 },
      ], { duration: 1200 + Math.random() * 600, easing: 'cubic-bezier(.2,.7,.4,1)' }).onfinish = () => p.remove();
    }
  }

  function stopExtras() { extras.forEach(x => (x.remove ? x.remove() : null)); extras = []; }

  function close() {
    if (!ui) return;
    clearInterval(typing); stopExtras();
    ui.offs.forEach(f => f());
    ui.root.remove(); ui = null;
    U.setPref('tourDone', true);
    if (lastFocus && document.contains(lastFocus)) try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ok */ }
  }

  function start() {
    if (ui) return;
    try { if (U.closeMenu) U.closeMenu(); } catch (e) { /* none open */ }
    lastFocus = document.activeElement;
    if (window.Workspaces && Workspaces.current === 'timer') Workspaces.load(Workspaces.lastFull || 'plan');
    build();
    go(0);
  }

  window.Tour = { start, close, isOpen: () => !!ui };
})();
