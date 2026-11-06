/* Week: a timeline of the time you tracked, one row per day. Click a block to edit that entry. */
(function () {
  const esc = U.esc;
  const mode = () => U.pref('weekMode', 'week');
  const setMode = m => { U.setPref('weekMode', m); S.emit('weekmode'); };

  function days() {
    const t = new Date(), m = mode();
    if (m === 'day') return [t];
    if (m === '7days') return Array.from({ length: 7 }, (_, i) => U.addDays(t, i - 6));
    const a = U.weekStart(t); return Array.from({ length: 7 }, (_, i) => U.addDays(a, i));
  }
  const mins = d => d.getHours() * 60 + d.getMinutes();

  function render(el) {
    if (el._drawing) { el._dirty = true; return; }               // don't redraw under a block you're drawing
    const ds = days(), keys = ds.map(U.ymd), today = U.today(), run = S.timer(), nowD = new Date();
    const list = S.entries.filter(e => S.inScope(e) && keys.includes((e.start_time || '').slice(0, 10)));
    // hour window: wide enough for everything shown, never narrower than 8 hours
    let lo = 7 * 60, hi = 19 * 60;
    list.forEach(e => {
      const s = U.parseDT(e.start_time), en = e.end_time ? U.parseDT(e.end_time) : nowD;
      if (!s) return; lo = Math.min(lo, mins(s)); if (en && U.ymd(en) === U.ymd(s)) hi = Math.max(hi, mins(en));
    });
    lo = Math.max(0, Math.floor(lo / 60) * 60); hi = Math.min(24 * 60, Math.ceil(hi / 60) * 60); if (hi - lo < 480) hi = Math.min(24 * 60, lo + 480);
    const span = hi - lo, pct = v => ((v - lo) / span) * 100;
    const total = S.sumHours(list), m = mode();
    const label = m === 'day' ? 'Today' : m === '7days' ? 'Last 7 days' : 'This week';
    const range = ds.length > 1 ? ` · ${U.MON[ds[0].getMonth()]} ${ds[0].getDate()} – ${U.MON[ds[6].getMonth()]} ${ds[6].getDate()}` : '';
    const seg = (k, l) => `<button class="pill ${m === k ? 'on' : ''}" data-mode="${k}">${l}</button>`;
    const rows = ds.map((d, i) => {
      const es = list.filter(e => (e.start_time || '').startsWith(keys[i])), h = S.sumHours(es);
      const blocks = es.map(e => {
        const s = U.parseDT(e.start_time); if (!s) return '';
        const isRun = !e.end_time && run && run.entry_id === e.id, en = e.end_time ? U.parseDT(e.end_time) : nowD;
        const a = mins(s), b = Math.max(a + 3, en && U.ymd(en) === U.ymd(s) ? mins(en) : 24 * 60);
        return `<div class="wk-block ${isRun ? 'run' : ''}" data-id="${e.id}" style="left:${pct(a)}%;width:${Math.max(0.5, pct(b) - pct(a))}%;background:${esc(S.projectColor(e.project, e.client))}"
          title="${esc(e.description)} · ${esc(e.project || '')} · ${U.fmtH(S.entryHours(e))}h">${esc(e.description)}</div>`;
      }).join('');
      const nowMark = keys[i] === today && mins(nowD) >= lo && mins(nowD) <= hi ? `<div style="position:absolute;top:-2px;bottom:-2px;left:${pct(mins(nowD))}%;width:2px;background:var(--text)"></div>` : '';
      return `<div class="wk-row ${keys[i] === today ? 'today' : ''} ${m === 'day' ? 'big' : ''}"><span class="d">${U.dayLabel(d)}</span><div class="tr" data-day="${keys[i]}" data-lo="${lo}" data-span="${span}" title="Drag across a day to add an entry (or click for an hour)">${blocks}${nowMark}</div><span class="h">${h ? U.fmtH1(h) + ' h' : ''}</span></div>`;
    }).join('');
    const ticks = []; for (let t = Math.ceil(lo / 60); t * 60 <= hi; t += (span > 600 ? 2 : 1)) ticks.push(`<span style="left:${pct(t * 60)}%">${t}</span>`);
    el.innerHTML = `<div class="panel"><div class="view-head"><div class="grow"><div class="view-title" style="font-size:14px">${label}<span class="muted" style="font-size:12px;font-weight:400">${range}</span></div></div>
      <div style="display:flex;gap:4px;align-items:center"><button class="btn sm" data-act="add" title="Add a time entry without the timer">+ Add entry</button>${seg('day', 'Day')}${seg('7days', '7 days')}${seg('week', 'This week')}<span class="muted mono" style="margin-left:8px">${U.fmtH1(total)} h</span></div></div>
      ${rows}<div class="wk-axis">${ticks.join('')}</div></div>`;
  }

  function setup(el, redraw, track) {
    el.addEventListener('click', e => {
      const md = e.target.closest('[data-mode]'), b = e.target.closest('.wk-block');
      if (md) return setMode(md.dataset.mode);
      if (b) { const en = S.entries.find(x => x.id === +b.dataset.id); if (en) { S.select({ type: 'entry', id: en.id }); Timesheet.editEntry(en); } return; }
      if (e.target.closest('[data-act="add"]')) return Timesheet.editEntry(null);
    });
    let n = 0; track(S.on('tick', () => { if (S.timer() && ++n % 30 === 0) redraw(); }));   // the running block grows

    // Draw an entry like in a calendar: press on an empty spot of a day, drag across the time, let go.
    // It snaps to 15 minutes; a plain click makes a one-hour entry. The block stays while the form is open.
    let draw = null;
    const DAY = 24 * 60, hm = m => `${U.pad(Math.floor(m / 60))}:${U.pad(m % 60)}`;
    const at = (tr, x) => { const r = tr.getBoundingClientRect(), lo = +tr.dataset.lo, span = +tr.dataset.span; return Math.max(0, Math.min(DAY, Math.round((lo + ((x - r.left) / r.width) * span) / 15) * 15)); };
    // The free time around a minute on a day (every entry counts, not only the ones in view; a running timer runs to now).
    // A bounded gap of up to 4 hours is filled exactly; otherwise an hour, cut short before the next entry.
    const GAP_MAX = 240;
    function fit(day, point) {
      const now = new Date(), occ = S.entries.filter(e => (e.start_time || '').startsWith(day)).map(e => {
        const s = U.parseDT(e.start_time), en = e.end_time ? U.parseDT(e.end_time) : now;
        return [mins(s), en && U.ymd(en) === day ? mins(en) : DAY];
      }).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
      const inside = occ.find(([a, b]) => point >= a && point < b); if (inside) point = inside[1];   // on an entry: start right after it
      const before = occ.filter(([, b]) => b <= point), after = occ.filter(([a]) => a >= point);
      const prev = before.length ? Math.max(...before.map(x => x[1])) : null, next = after.length ? Math.min(...after.map(x => x[0])) : null;
      if (prev !== null && next !== null && next - prev >= 15 && next - prev <= GAP_MAX) return { a: prev, b: next, gap: true };
      let a = Math.max(prev ?? 0, Math.round(point / 15) * 15), b = Math.min(a + 60, next ?? DAY - 1);
      if (b - a < 15) { b = Math.min(a + 15, DAY - 1); }
      return { a, b, gap: false };
    }
    const rawAt = (tr, x) => { const r = tr.getBoundingClientRect(); return Math.max(0, Math.min(DAY - 1, +tr.dataset.lo + ((x - r.left) / r.width) * +tr.dataset.span)); };
    const range = d => { let a = Math.min(d.a, d.b), b = Math.max(d.a, d.b); if (!d.moved) b = a + 60; if (b - a < 15) b = a + 15; b = Math.min(b, DAY - 1); a = Math.min(a, b - 15); return [a, b]; };
    const place = d => {
      const [a, b] = range(d), lo = +d.tr.dataset.lo, span = +d.tr.dataset.span;
      Object.assign(d.g.style, { left: ((a - lo) / span) * 100 + '%', width: Math.max(0.5, ((b - a) / span) * 100) + '%' });
      d.g.textContent = `${hm(a)}–${hm(b)}`;
    };
    el.addEventListener('pointerdown', e => {
      const tr = e.target.closest('.tr[data-day]');
      if (!tr || e.button !== 0 || e.target.closest('.wk-block')) return;
      e.preventDefault();
      const g = document.createElement('div'); g.className = 'wk-draft'; tr.appendChild(g);
      draw = { tr, g, a: at(tr, e.clientX), b: 0, x: e.clientX, moved: false, raw: rawAt(tr, e.clientX) }; draw.b = draw.a;
      el._drawing = true; try { tr.setPointerCapture(e.pointerId); } catch (x) { /* fine */ } place(draw);
    });
    el.addEventListener('pointermove', e => {
      if (!draw) return;
      if (!draw.moved && Math.abs(e.clientX - draw.x) < 5) return;
      draw.moved = true; draw.b = at(draw.tr, e.clientX); place(draw);
    });
    const finish = async cancelled => {
      const d = draw; draw = null; if (!d) return;
      try {
        if (!cancelled) {
          if (!d.moved) { const f = fit(d.tr.dataset.day, d.raw); d.a = f.a; d.b = f.b; d.moved = true; }   // a click fits the free time
          const [a, b] = range(d), s = S.scope; place(d);
          await Timesheet.editEntry({ client: s.client || '', project: s.view === 'project' ? s.project : '', start_time: `${d.tr.dataset.day} ${hm(a)}`, end_time: `${d.tr.dataset.day} ${hm(b)}` }, { prefill: true });
        }
      } finally { d.g.remove(); el._drawing = false; if (el._dirty) { el._dirty = false; redraw(); } }
    };
    el.addEventListener('pointerup', () => finish(false));
    el.addEventListener('pointercancel', () => finish(true));

    // Drag a task from the Tasks list onto a day: a one-hour block shows where it lands, then the entry form opens for that task.
    const isTask = e => e.dataTransfer && [...e.dataTransfer.types].includes('application/x-clockin-task');
    let drop = null;
    const clearDrop = () => { if (!drop) return; drop.g.remove(); drop = null; el._drawing = false; if (el._dirty) { el._dirty = false; redraw(); } };
    el.addEventListener('dragover', e => {
      const tr = e.target.closest('.tr[data-day]'); if (!tr || !isTask(e)) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
      if (!drop || drop.tr !== tr) { clearDrop(); const g = document.createElement('div'); g.className = 'wk-draft'; tr.appendChild(g); drop = { tr, g, moved: true }; el._drawing = true; }
      const f = fit(tr.dataset.day, rawAt(tr, e.clientX)); drop.a = f.a; drop.b = f.b; place(drop);
      drop.g.classList.toggle('gap', f.gap); if (f.gap) drop.g.textContent += ' · fills the gap';
      const t = S.dragging && S.d.tasks.find(x => x.id === S.dragging.task); if (t) drop.g.textContent += ' · ' + t.task;
    });
    el.addEventListener('dragleave', e => { if (drop && (!e.relatedTarget || !el.contains(e.relatedTarget))) clearDrop(); });
    el.addEventListener('drop', async e => {
      const tr = e.target.closest('.tr[data-day]'); if (!tr || !isTask(e)) return;
      e.preventDefault();
      const t = S.d.tasks.find(x => x.id === e.dataTransfer.getData('application/x-clockin-task'));
      if (!t || !drop) return clearDrop();
      const [a, b] = range(drop); place(drop);
      try { await Timesheet.editEntry({ ...S.taskSeed(t), start_time: `${tr.dataset.day} ${hm(a)}`, end_time: `${tr.dataset.day} ${hm(b)}` }, { prefill: true }); }
      finally { clearDrop(); }
    });
    const endDrag = () => setTimeout(() => { if (drop && !document.querySelector('#dialogLayer .dialog')) clearDrop(); }, 0);   // dropped somewhere else
    document.addEventListener('dragend', endDrag); track(() => document.removeEventListener('dragend', endDrag));
  }
  U.definePanel('week', { title: 'Week', events: ['data', 'scope', 'weekmode'], render, setup });
})();
