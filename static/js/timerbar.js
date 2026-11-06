/* The timer bar: always visible, the only place the running timer is shown. */
(function () {
  const bar = () => U.$('#timerbar');
  let built = '';

  const todayHours = () => { const t = U.today(); return S.sumHours(S.entries.filter(e => (e.start_time || '').startsWith(t))); };

  function render() {
    const t = S.timer(), key = t ? `r${t.entry_id}${t.description}${t.project}${t.area}${t.operation}` : 'idle';
    if (key !== built) {                                   // rebuild only when the structure changes; tick just updates numbers
      built = key;
      if (t) {
        bar().className = 'running';
        bar().innerHTML = `<span class="dotr"></span>
          <span class="what ell" title="${U.esc(t.description)}">${U.esc(t.description || 'Untitled')}</span>
          <span class="sub ell">${[t.project, [t.area, t.operation].filter(Boolean).join(' · ')].filter(Boolean).map(U.esc).join(' · ')}</span>
          <span class="clock" id="tbClock">0:00:00</span>
          <span class="today" id="tbToday"></span>
          <button class="tb-btn" id="tbDetails" title="Edit the running timer">Details</button>
          <button class="tb-btn" id="tbSwitch">Switch ▾</button>
          <button class="tb-btn" id="tbDiscard" title="Delete this timer without saving">Discard</button>
          <button class="tb-btn stop" id="tbStop">Stop</button>`;
        U.$('#tbDetails').onclick = () => { S.select({ type: 'timer' }); Workspaces.reveal('inspector'); };
        U.$('#tbSwitch').onclick = e => switchMenu(e.currentTarget);
        U.$('#tbDiscard').onclick = () => S.discardTimer().catch(() => {});
        U.$('#tbStop').onclick = () => S.stopTimer().catch(() => {});
      } else {
        bar().className = 'idle';
        bar().innerHTML = `<label class="tb-field"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            <input id="tbNew" type="text" placeholder="Create a task or start a timer" aria-label="Create a task or start a timer" autocomplete="off"></label>
          <button class="btn primary" id="tbGo" title="Start a timer with this text (Enter). You can also press ▶ on any task or preset.">▶ Start timer</button>
          <button class="btn" id="tbAdd" title="Add this as a task to what you're viewing (Shift+Enter)">+ Add task</button>
          <button class="btn ghost" id="tbSwitch">Presets ▾</button>
          <span class="today" id="tbToday" style="margin-left:auto"></span>`;
        const inp = U.$('#tbNew');
        const go = () => { const v = inp.value.trim(); if (!v) return inp.focus(); inp.value = ''; S.startTimer({ description: v, project: S.scope.view === 'project' ? S.scope.project : '' }).catch(() => {}); };
        const add = async () => { const v = inp.value.trim(); if (!v) return inp.focus(); try { await S.addTask(v); inp.value = ''; } catch (e) { /* shown */ } };
        inp.onkeydown = e => { if (e.key !== 'Enter') return; e.preventDefault(); e.shiftKey ? add() : go(); };
        U.$('#tbGo').onclick = go; U.$('#tbAdd').onclick = add;
        U.$('#tbSwitch').onclick = e => switchMenu(e.currentTarget);
      }
    }
    tick();
  }

  function tick() {
    const clock = U.$('#tbClock'); if (clock) clock.textContent = U.fmtClock(S.elapsed());
    const td = U.$('#tbToday'); if (td) td.textContent = `Today ${U.fmtH1(todayHours())} h`;
  }

  function switchMenu(btn) {
    const items = [{ header: 'Presets' }];
    const pre = S.seeds.presets.filter(p => !S.scope.client || p.client === S.scope.client);
    pre.forEach(p => items.push({ label: '▶ ' + p.label, onClick: () => S.startTimer({ client: p.client, project: p.project, description: p.description, area: p.area, operation: p.operation, preset_id: p.id }) }));
    if (!pre.length) items.push({ label: 'No presets yet', disabled: true });
    const tasks = S.d.tasks.filter(t => !t.done && S.seeds.tasks[t.id] && S.inScope(t)).slice(0, 12);
    if (tasks.length) { items.push({ sep: true }, { header: 'Tasks' }); tasks.forEach(t => items.push({ label: '▶ ' + t.task, onClick: () => S.startTimer(S.taskSeed(t)) })); }
    U.menuAt(btn, items);
  }

  window.TimerBar = { render, tick };
  S.on('data', render);
  S.on('tick', tick);
})();
