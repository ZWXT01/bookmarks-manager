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
    if (!queue.length) {
      active = false;
      return;
    }

    active = true;
    const { message, opts, isConfirm, resolve } = queue.shift();
    const o = opts || {};
    const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const overlay = document.createElement('div');
    overlay.className = 'app-dialog-overlay';
    overlay.dataset.testid = 'app-dialog';

    const panel = document.createElement('div');
    panel.className = 'app-dialog-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');

    if (o.title) {
      const headingId = `app-dialog-title-${Date.now()}`;
      panel.setAttribute('aria-labelledby', headingId);
      const h = document.createElement('div');
      h.className = 'app-dialog-title';
      h.id = headingId;
      h.textContent = o.title;
      panel.appendChild(h);
    }

    const msg = document.createElement('div');
    msg.className = 'app-dialog-message';
    msg.textContent = message;
    panel.appendChild(msg);

    const btns = document.createElement('div');
    btns.className = 'flex justify-end gap-2 mt-4';

    function finish(val) {
      overlay.classList.remove('is-open');
      panel.classList.remove('is-open');
      setTimeout(() => {
        overlay.remove();
        if (previousActive && typeof previousActive.focus === 'function') previousActive.focus();
        resolve(val);
        next();
      }, 180);
    }

    if (isConfirm) {
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn-secondary btn-sm';
      cancel.textContent = o.cancelText || '取消';
      cancel.dataset.testid = 'app-dialog-cancel';
      cancel.onclick = () => finish(false);
      btns.appendChild(cancel);
    }

    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'btn-primary btn-sm';
    ok.textContent = isConfirm ? (o.confirmText || '确定') : (o.buttonText || '确定');
    ok.dataset.testid = isConfirm ? 'app-dialog-confirm' : 'app-dialog-ok';
    ok.onclick = () => finish(isConfirm ? true : undefined);
    btns.appendChild(ok);

    panel.appendChild(btns);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    overlay.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(isConfirm ? true : undefined);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(isConfirm ? false : undefined);
      }
    });

    requestAnimationFrame(() => {
      overlay.classList.add('is-open');
      panel.classList.add('is-open');
      ok.focus();
    });
  }

  return {
    confirm: (message, opts) => show(message, opts, true),
    alert: (message, opts) => show(message, opts, false),
  };
})();
