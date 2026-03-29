const AppDialog = (() => {
  let queue = [];
  let active = false;

  function show(message, opts, isConfirm) {
    return new Promise(resolve => {
      queue.push({ message, opts, isConfirm, resolve });
      if (!active) next();
    });
  }

  function next() {
    if (!queue.length) { active = false; return; }
    active = true;
    const { message, opts, isConfirm, resolve } = queue.shift();
    const o = opts || {};

    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-50 flex items-center justify-center';
    overlay.style.cssText = 'background:rgba(0,0,0,.45);opacity:0;transition:opacity .2s';
    overlay.dataset.testid = 'app-dialog';

    const panel = document.createElement('div');
    panel.className = 'rounded-lg shadow-xl w-full max-w-sm mx-4 p-5';
    panel.style.cssText = 'background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border-color);transform:scale(.95);opacity:0;transition:transform .2s,opacity .2s';

    if (o.title) {
      const h = document.createElement('div');
      h.className = 'text-sm font-semibold mb-2';
      h.textContent = o.title;
      panel.appendChild(h);
    }

    const msg = document.createElement('div');
    msg.className = 'text-sm whitespace-pre-wrap';
    msg.style.color = 'var(--text-secondary)';
    msg.textContent = message;
    panel.appendChild(msg);

    const btns = document.createElement('div');
    btns.className = 'flex justify-end gap-2 mt-4';

    function close(val) {
      overlay.style.opacity = '0';
      panel.style.transform = 'scale(.95)';
      panel.style.opacity = '0';
      setTimeout(() => { overlay.remove(); resolve(val); next(); }, 200);
    }

    if (isConfirm) {
      const cancel = document.createElement('button');
      cancel.className = 'btn-secondary btn-sm';
      cancel.textContent = o.cancelText || '取消';
      cancel.dataset.testid = 'app-dialog-cancel';
      cancel.onclick = () => close(false);
      btns.appendChild(cancel);
    }

    const ok = document.createElement('button');
    ok.className = 'btn-primary btn-sm';
    ok.textContent = isConfirm ? (o.confirmText || '确定') : (o.buttonText || '确定');
    ok.dataset.testid = isConfirm ? 'app-dialog-confirm' : 'app-dialog-ok';
    ok.onclick = () => close(isConfirm ? true : undefined);
    btns.appendChild(ok);

    panel.appendChild(btns);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    overlay.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); close(isConfirm ? true : undefined); }
      if (e.key === 'Escape') { e.preventDefault(); close(isConfirm ? false : undefined); }
    });

    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
      panel.style.transform = 'scale(1)';
      panel.style.opacity = '1';
      ok.focus();
    });
  }

  return {
    confirm: (message, opts) => show(message, opts, true),
    alert: (message, opts) => show(message, opts, false),
  };
})();
