/* Small shared helpers. Everything hangs off window.U. */
(function () {
  const U = (window.U = {});

  U.esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // href for an entry link, or '' — same rule as the server: http(s), mailto, or scheme-less (opened as https://)
  U.safeUrl = s => {
    const t = String(s ?? '').replace(/[\t\n\r]/g, '').replace(/^[\x00-\x20]+/, ''), m = /^([a-zA-Z][a-zA-Z0-9+.-]*):(?!\d)/.exec(t);   // "x:8080" is host:port
    if (!t) return '';
    return !m ? 'https://' + t.replace(/^\/+/, '') : /^(https?|mailto)$/i.test(m[1]) ? t : '';
  };
  U.$ = (sel, root = document) => root.querySelector(sel);
  U.$$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  U.el = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

  // ── Server calls. A failed call throws an Error carrying the server's message. ──
  U.WRITE = { 'X-Clockin': '1' };   // the server refuses writes without it (CSRF guard); send it on every fetch that changes data
  U.api = async (method, url, body) => {
    let r;
    try {
      r = await fetch(url, { method, headers: body === undefined ? U.WRITE : { ...U.WRITE, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) { throw new Error("Can't reach the server."); }
    let data = null;
    const text = await r.text();
    try { data = text ? JSON.parse(text) : null; } catch (e) { /* not json */ }
    if (!r.ok) throw new Error((data && data.error) || `Request failed (${r.status})`);
    return data;
  };

  // ── Dates. Entries use local "YYYY-MM-DD HH:MM". ──
  const pad = n => String(n).padStart(2, '0');
  U.pad = pad;
  U.ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  U.fmtDT = d => `${U.ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  U.parseDT = s => { const m = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)/.exec(s || ''); return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : null; };
  U.parseD = s => { const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(s || ''); return m ? new Date(+m[1], m[2] - 1, +m[3]) : null; };
  U.addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  U.today = () => U.ymd(new Date());
  U.weekStart = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };   // Monday
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  U.MON = MON; U.DAY = DAY;
  U.dayLabel = d => `${DAY[d.getDay()]} ${d.getDate()}`;
  U.niceDT = s => { const d = U.parseDT(s); return d ? `${MON[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}` : (s || ''); };
  U.niceD = s => { const d = U.parseD(s); return d ? `${MON[d.getMonth()]} ${d.getDate()}` : (s || ''); };
  U.fmtClock = sec => { sec = Math.max(0, Math.floor(sec)); return `${Math.floor(sec / 3600)}:${pad(Math.floor(sec % 3600 / 60))}:${pad(sec % 60)}`; };
  U.fmtH = h => (Math.round((h || 0) * 100) / 100).toFixed(2);
  U.fmtH1 = h => (Math.round((h || 0) * 10) / 10).toFixed(1);
  U.money = (n, cur) => `${cur || '$'}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // ── Toasts, with optional Undo ──
  U.toast = (msg, opts = {}) => {
    const t = U.el(`<div class="toast ${opts.error ? 'err' : ''}" role="status"><span>${U.esc(msg)}</span></div>`);
    if (opts.undo) {
      const b = U.el('<button type="button">Undo</button>');
      b.onclick = async () => { t.remove(); try { await opts.undo(); } catch (e) { U.toast(e.message, { error: true }); } };
      t.appendChild(b);
    }
    U.$('#toasts').appendChild(t);
    setTimeout(() => t.remove(), opts.ms || (opts.undo ? 7000 : opts.error ? 6000 : 3000));
  };
  U.fail = e => U.toast(e.message || String(e), { error: true });

  // ── Context menus. items: {label, onClick, danger, checked, disabled} | {sep:true} | {header:'…'} ──
  let closeMenu = null;
  U.menu = (x, y, items) => {
    U.closeMenu();
    const m = U.el('<div class="menu" role="menu"></div>');
    items.forEach(it => {
      if (it.sep) return m.appendChild(U.el('<div class="sep"></div>'));
      if (it.header) return m.appendChild(U.el(`<div class="hd">${U.esc(it.header)}</div>`));
      const b = U.el(`<button type="button" class="mi ${it.danger ? 'danger' : ''} ${it.checked === true ? 'check' : it.checked === false ? 'nocheck' : ''}" role="menuitem" ${it.disabled ? 'disabled' : ''}>${it.swatch ? `<i class="sw" style="background:${U.esc(it.swatch)}"></i>` : ''}${U.esc(it.label)}</button>`);
      b.onclick = e => { e.stopPropagation(); if (!it.keepOpen) U.closeMenu(); if (it.onClick) it.onClick(e); };
      m.appendChild(b);
    });
    U.$('#menuLayer').appendChild(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
    m.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
    const btns = U.$$('.mi:not([disabled])', m); let i = -1;
    const key = e => {
      if (e.key === 'Escape') U.closeMenu();
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); i = (i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length; btns.forEach(b => b.classList.remove('focus')); btns[i].classList.add('focus'); btns[i].focus(); }
    };
    const away = e => { if (!m.contains(e.target)) U.closeMenu(); };
    setTimeout(() => { document.addEventListener('mousedown', away, true); document.addEventListener('keydown', key, true); addEventListener('blur', U.closeMenu); }, 0);
    closeMenu = () => { m.remove(); document.removeEventListener('mousedown', away, true); document.removeEventListener('keydown', key, true); removeEventListener('blur', U.closeMenu); closeMenu = null; };
    return m;
  };
  U.closeMenu = () => closeMenu && closeMenu();
  U.menuAt = (el, items) => { const r = el.getBoundingClientRect(); return U.menu(r.left, r.bottom + 2, items); };
  // Right-click anywhere inside `root` on an element matching `sel` → items(el, event) (native menu stays on inputs/links).
  U.onContext = (root, sel, items) => root.addEventListener('contextmenu', e => {
    if (e.target.closest('input, textarea, select, a')) return;
    const t = e.target.closest(sel); if (!t || !root.contains(t)) return;
    const list = items(t, e); if (!list || !list.length) return;
    e.preventDefault(); U.menu(e.clientX, e.clientY, list);
  });

  // ── Dialogs (promise based; Esc cancels, Enter confirms, focus is trapped in the scrim) ──
  U.dialog = ({ title, body = '', actions, wide }) => new Promise(resolve => {
    const scrim = U.el(`<div class="scrim"><div class="dialog" role="dialog" aria-modal="true" ${wide ? 'style="width:min(640px,100%)"' : ''}><h3>${U.esc(title)}</h3><div class="body"></div><div class="actions"></div></div></div>`);
    const box = U.$('.dialog', scrim), bodyEl = U.$('.body', scrim);
    if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
    const done = v => { scrim.remove(); document.removeEventListener('keydown', key, true); resolve(v); };
    (actions || [{ label: 'OK', primary: true, value: true }]).forEach(a => {
      const b = U.el(`<button type="button" class="btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}">${U.esc(a.label)}</button>`);
      b.onclick = () => done(typeof a.value === 'function' ? a.value(bodyEl) : a.value);
      if (a.primary) b.dataset.primary = '1';
      U.$('.actions', scrim).appendChild(b);
    });
    const key = e => {
      if (e.key === 'Escape') { e.stopPropagation(); done(null); }
      else if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') { e.preventDefault(); const p = U.$('[data-primary]', scrim); if (p) p.click(); }
      else if (e.key === 'Tab') { const f = U.$$('input,select,textarea,button', box).filter(x => !x.disabled); if (!f.length) return; const first = f[0], last = f[f.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
    };
    document.addEventListener('keydown', key, true);
    scrim.addEventListener('mousedown', e => { if (e.target === scrim) done(null); });
    U.$('#dialogLayer').appendChild(scrim);
    const first = U.$('input:not([type=hidden]),select,textarea', bodyEl) || U.$('[data-primary]', scrim);
    if (first) { first.focus(); if (first.select && first.tagName === 'INPUT') first.select(); }
  });
  U.confirm = (title, message, { ok = 'OK', danger = false } = {}) =>
    U.dialog({ title, body: `<p>${U.esc(message)}</p>`, actions: [{ label: 'Cancel', value: false }, { label: ok, primary: true, danger, value: true }] }).then(v => v === true);
  U.prompt = (title, label, value = '') =>
    U.dialog({ title, body: `<div class="form"><label>${U.esc(label)}</label><input type="text" value="${U.esc(value)}"></div>`,
      actions: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, value: b => U.$('input', b).value.trim() }] });

  // Build a <select>/<input> field list. fields: [{key,label,type,options,full}]; returns the form element.
  U.form = (fields, values = {}) => {
    const f = U.el('<div class="form"></div>');
    fields.forEach(x => {
      const v = values[x.key] ?? '';
      let input;
      if (x.type === 'select') input = `<select name="${x.key}">${x.options.map(o => { const val = typeof o === 'object' ? o.value : o, lab = typeof o === 'object' ? o.label : o; return `<option value="${U.esc(val)}" ${val === v ? 'selected' : ''}>${U.esc(lab)}</option>`; }).join('')}</select>`;
      else if (x.type === 'textarea') input = `<textarea name="${x.key}" rows="3">${U.esc(v)}</textarea>`;
      else input = `<input name="${x.key}" type="${x.type || 'text'}" value="${U.esc(v)}" ${x.list ? `list="${x.list}"` : ''} ${x.placeholder ? `placeholder="${U.esc(x.placeholder)}"` : ''} ${x.step ? `step="${x.step}"` : ''}>`;
      f.insertAdjacentHTML('beforeend', `<label>${U.esc(x.label)}</label><div class="${x.full ? 'full' : ''}">${input}</div>`);
    });
    return f;
  };
  U.formValues = root => Object.fromEntries(U.$$('[name]', root).map(i => [i.name, i.value]));

  // ── Panels: a registry of {title, render(el), events}. Panels re-render on store events, but never
  //    while you're typing in one of their inputs (that would eat your text); they catch up on blur. ──
  window.Panels = {};
  U.definePanel = (id, { title, events = ['data', 'scope'], render, setup, flush }) => {
    window.Panels[id] = {
      title,
      create() {
        const element = document.createElement('div');
        element.className = 'panel-host'; element.style.cssText = 'height:100%;min-width:0';
        const off = []; let dirty = false;
        const typing = () => { const a = document.activeElement; return a && element.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.dataset.keep !== 'no'; };
        const draw = () => { if (typing()) { dirty = true; return; } dirty = false; render(element); };
        return {
          element,
          init() {
            events.forEach(ev => off.push(S.on(ev, draw)));
            element.addEventListener('focusout', () => setTimeout(() => { if (dirty && !typing()) draw(); }, 0));
            if (setup) setup(element, draw, fn => off.push(fn));
            render(element);
          },
          dispose() { off.forEach(f => f()); },
        };
      },
    };
  };

  // ── Persisted per-browser prefs (never required: private windows can throw) ──
  U.pref = (key, fallback) => { try { const v = localStorage.getItem('clockin.' + key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } };
  U.setPref = (key, val) => { try { localStorage.setItem('clockin.' + key, JSON.stringify(val)); } catch (e) { /* ignore */ } };
})();
