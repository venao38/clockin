/* Clients: name, colour, and an optional billing profile. Leave "Rate" empty and the client is never priced:
   no $ totals, no Invoice button. */
(function () {
  const esc = U.esc;

  function formFor(c) {
    const f = U.el(`<div class="form" data-form>
      <label>Name</label><div><input type="text" value="${esc(c.name)}" disabled></div>
      <label>Short</label><div><input name="short" type="text" value="${esc(c.short || '')}" maxlength="6"></div>
      <label>Colour</label><div><input name="color" type="color" value="${esc(c.color || '#5e5ce6')}" style="padding:0;height:28px;width:60px"></div>
      <label>Notes</label><div><textarea name="notes" rows="2">${esc(c.notes || '')}</textarea></div>
      <div class="full sec" style="margin-top:6px">Billing (optional)</div>
      <label>Rate per hour</label><div><input name="rate" type="number" min="0" step="0.01" value="${c.rate ?? ''}" placeholder="No pricing"></div>
      <div class="full muted" style="font-size:12px;margin-top:-4px">Leave empty to track hours only. With a rate you get money totals and invoices for this client.</div>
      <div data-bill style="display:contents">
        <label>Bill to</label><div><input name="bill_to_name" type="text" value="${esc(c.bill_to_name || '')}"></div>
        <label>Address lines</label><div><textarea name="bill_to_lines" rows="3" placeholder="One per line">${esc((c.bill_to_lines || []).join('\n'))}</textarea></div>
        <label>Email text</label><div><textarea name="email_template" rows="4" placeholder="Uses the default from settings if empty">${esc(c.email_template || '')}</textarea></div>
      </div></div>`);
    const toggle = () => { f.querySelector('[data-bill]').style.display = f.querySelector('[name=rate]').value ? 'contents' : 'none'; };
    f.querySelector('[name=rate]').oninput = toggle; toggle();
    return f;
  }

  async function open() {
    let idx = Math.max(0, S.d.clients.findIndex(c => c.name === S.scope.client));
    const box = U.el('<div style="min-height:260px"></div>');
    const draw = () => {
      box.innerHTML = '';
      if (!S.d.clients.length) { box.innerHTML = '<p>No clients yet. Clients are optional: use them to group projects and to bill by the hour.</p>'; return; }
      const sel = U.el(`<select style="width:100%;margin-bottom:10px">${S.d.clients.map((c, i) => `<option value="${i}" ${i === idx ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`);
      sel.onchange = () => { idx = +sel.value; draw(); };
      box.append(sel, formFor(S.d.clients[idx]));
    };
    draw();
    const doSave = async () => {
      const c = S.d.clients[idx]; if (!c) return true;
      const v = U.formValues(box.querySelector('[data-form]'));
      const body = { short: v.short, color: v.color, notes: v.notes, rate: v.rate === '' ? null : v.rate, bill_to_name: v.bill_to_name,
        bill_to_lines: v.bill_to_lines.split('\n').map(x => x.trim()).filter(Boolean), email_template: v.email_template };
      try { await S.act(() => U.api('PUT', `/api/clients/${encodeURIComponent(c.name)}`, body)); return true; } catch (e) { return false; }
    };
    for (;;) {
      const r = await U.dialog({ title: 'Clients', body: box, wide: true, actions: [{ label: 'Close', value: 'close' }, { label: 'Delete', danger: true, value: 'delete' }, { label: 'Your invoice details…', value: 'sender' }, { label: 'Add client…', value: 'add' }, { label: 'Save', primary: true, value: 'save' }] });
      if (r === 'save') { if (await doSave()) { U.toast('Client saved'); return; } }
      else if (r === 'sender') { await senderOpen(); }
      else if (r === 'add') {
        const name = await U.prompt('New client', 'Name'); if (!name) continue;
        try { await S.act(() => U.api('POST', '/api/clients', { name })); idx = S.d.clients.findIndex(c => c.name === name); draw(); } catch (e) { /* shown */ }
      } else if (r === 'delete') {
        const c = S.d.clients[idx]; if (!c) continue;
        const n = S.entries.filter(e => e.client === c.name).length;
        if (await U.confirm(`Delete ${c.name}?`, `Its ${n} time entr${n === 1 ? 'y' : 'ies'} and projects stay, but will no longer belong to a client.`, { ok: 'Delete client', danger: true })) {
          try { await S.act(() => U.api('DELETE', `/api/clients/${encodeURIComponent(c.name)}`)); idx = 0; U.toast(`Deleted ${c.name}`); } catch (e) { /* shown */ }
        }
        draw();
      } else return;
    }
  }

  // ── Your invoice details: who invoices are from. Saved to settings.json on the server. ──
  async function senderOpen({ reason } = {}) {
    let cur;
    try { cur = await U.api('GET', '/api/settings/invoice'); } catch (e) { U.fail(e); return false; }
    const s = cur.sender || {};
    const box = U.el(`<div>${reason ? `<p class="sender-reason">${esc(reason)}</p>` : ''}
      <div class="form" data-form>
        <label>Picture</label><div class="sender-av"><img data-av alt="Your picture"><span class="muted" data-avnone>No picture</span>
          <button type="button" class="btn sm" data-up>Upload…</button><button type="button" class="btn sm ghost" data-avdel>Remove</button>
          <input type="file" accept="image/png,image/jpeg" data-file hidden></div>
        <label>Your name</label><div><input name="name" type="text" placeholder="As it should appear on invoices"></div>
        <label>Address</label><div><textarea name="address_lines" rows="2" placeholder="One line per row"></textarea></div>
        <label>Email</label><div><input name="email" type="email"></div>
        <div class="full sec">How to pay you</div>
        <label>Heading</label><div><input name="payment_title" type="text" placeholder="Payment details"></div>
        <label>Details</label><div><textarea name="payment_lines" rows="3" placeholder="Bank, account number, IBAN… one per row"></textarea></div>
        <label>Currency</label><div><input name="currency" type="text" maxlength="4" style="width:80px"></div>
        <div class="full sec">On the invoice and in the email</div>
        <label>Notes</label><div><textarea name="notes" rows="2" placeholder="Printed at the bottom of every invoice"></textarea></div>
        <label>Sign emails as</label><div><input name="signature" type="text"></div>
        <label>Email text</label><div><textarea name="email_template" rows="6"></textarea>
          <div class="muted" style="font-size:11.5px;margin-top:3px">Placeholders: {invoice_num} {month} {year} {total_hours} {rate} {total_amount} {currency} {payment} {signature}. A client’s own email text wins over this one.</div></div>
      </div></div>`);
    const f = U.$('[data-form]', box), set = (n, v) => { f.querySelector(`[name=${n}]`).value = v ?? ''; };
    ['name', 'email', 'payment_title', 'notes', 'signature'].forEach(k => set(k, s[k]));
    set('address_lines', (s.address_lines || []).join('\n')); set('payment_lines', (s.payment_lines || []).join('\n'));
    set('currency', cur.currency); set('email_template', cur.email_template);
    const img = U.$('[data-av]', box), none = U.$('[data-avnone]', box), del = U.$('[data-avdel]', box), file = U.$('[data-file]', box);
    const paintAv = has => { img.hidden = !has; none.hidden = has; del.hidden = !has; if (has) img.src = '/api/settings/avatar?t=' + Date.now(); };
    paintAv(!!s.avatar);
    U.$('[data-up]', box).onclick = () => file.click();
    file.onchange = async () => {
      const fd = new FormData(); fd.append('file', file.files[0]);
      try {
        const r = await fetch('/api/settings/avatar', { method: 'POST', headers: U.WRITE, body: fd }), d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Upload failed');
        paintAv(true);
      } catch (e) { U.fail(e); }
      file.value = '';
    };
    del.onclick = async () => { try { await U.api('PUT', '/api/settings/invoice', { sender: { avatar: null } }); paintAv(false); } catch (e) { U.fail(e); } };
    for (;;) {
      const r = await U.dialog({ title: 'Your invoice details', body: box, wide: true, actions: [{ label: 'Cancel', value: null }, { label: 'Save', primary: true, value: 'save' }] });
      if (r !== 'save') return false;
      const v = U.formValues(f), lines = t => t.split('\n').map(x => x.trim()).filter(Boolean);
      const body = { sender: { name: v.name, email: v.email, payment_title: v.payment_title, notes: v.notes, signature: v.signature,
        address_lines: lines(v.address_lines), payment_lines: lines(v.payment_lines) }, currency: v.currency, email_template: v.email_template.trim() === (cur.default_email_template || '').trim() ? '' : v.email_template };   // unchanged default: keep following it
      try { await S.act(() => U.api('PUT', '/api/settings/invoice', body)); U.toast('Invoice details saved'); return true; } catch (e) { /* shown; keep the form open */ }
    }
  }
  window.SenderDialog = { open: senderOpen };
  window.ClientsDialog = { open };
})();
