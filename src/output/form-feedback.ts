// Keep draft data in this page only; never persist private profile fields.
export const unsavedProfileScript = String.raw`(()=>{
  const form = document.querySelector('#profile-form');
  if (!form) return;
  const snapshot = () => JSON.stringify([...new FormData(form)]);
  const original = snapshot();
  let submitting = false;
  const dirty = () => form.dataset.unsaved === 'true' || snapshot() !== original;
  const warn = event => {
    if (submitting || !dirty()) return;
    event.preventDefault();
    event.returnValue = '';
  };
  const refresh = () => {
    if (!submitting && dirty()) addEventListener('beforeunload', warn);
    else removeEventListener('beforeunload', warn);
  };
  // Click also covers adding/removing/reordering rows without text input.
  for (const type of ['input', 'change', 'click']) form.addEventListener(type, refresh);
  form.addEventListener('submit', event => { if (!event.defaultPrevented) { submitting = true; refresh(); } });
  addEventListener('pageshow', () => { submitting = false; refresh(); });
  refresh();
})();`;

// Files over data-direct-max are sent in chunks to an upload session first
// (Cloudflare refuses request bodies over 100 MB), then the form is submitted
// naming that session instead of carrying the file. Without fetch, or for
// smaller files, the form posts the file as before.
export const uploadFeedbackScript = String.raw`(()=>{
  const form = document.querySelector('[data-takeout-form]');
  if (!form) return;
  const input = form.querySelector('input[type=file]');
  const button = form.querySelector('button[type=submit]');
  const session = form.querySelector('input[name=upload]');
  // Keep the live status outside the busy form so progress is announced
  // immediately instead of waiting for aria-busy to be cleared.
  const status = document.getElementById('takeout-status');
  const label = button.textContent;
  const validate = () => {
    const file = input.files?.[0];
    const error = file && !file.name.toLowerCase().endsWith('.zip') ? form.dataset.invalidFile
      : file && file.size > Number(form.dataset.maxBytes) ? form.dataset.tooLarge : '';
    input.setCustomValidity(error);
    status.textContent = error;
    return !error;
  };
  input.addEventListener('change', validate);
  let submitting = false;
  const reset = () => {
    submitting = false;
    form.removeAttribute('aria-busy');
    button.disabled = false;
    button.textContent = label;
    input.disabled = false;
    if (session) session.value = '';
  };
  const failure = async response => {
    try { return (await response.json()).error || form.dataset.uploadFailed; } catch { return form.dataset.uploadFailed; }
  };
  const chunked = async file => {
    const base = form.dataset.chunkStart;
    let id = '';
    try {
      const started = await fetch(base, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ size: file.size, name: file.name }) });
      if (!started.ok) throw new Error(await failure(started));
      const upload = await started.json();
      id = upload.id;
      for (let offset = 0; offset < file.size; offset += upload.chunkBytes) {
        const end = Math.min(file.size, offset + upload.chunkBytes);
        const response = await fetch(base + '/' + encodeURIComponent(id) + '/chunk?offset=' + offset, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/octet-stream' }, body: file.slice(offset, end) });
        if (!response.ok) throw new Error(await failure(response));
        status.textContent = form.dataset.progress.replace('{percent}', String(Math.floor(end / file.size * 100)));
      }
      status.textContent = form.dataset.wait;
      session.value = id;
      // The file was sent already; the form carries only the session.
      input.disabled = true;
      form.submit();
    } catch (error) {
      if (id) fetch(base + '/' + encodeURIComponent(id) + '/cancel', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
      reset();
      status.textContent = error && error.message ? error.message : form.dataset.uploadFailed;
    }
  };
  form.addEventListener('submit', event => {
    if (event.defaultPrevented) return;
    if (submitting) { event.preventDefault(); return; }
    if (!validate()) { event.preventDefault(); input.reportValidity(); return; }
    submitting = true;
    form.setAttribute('aria-busy', 'true');
    button.disabled = true;
    button.textContent = form.dataset.uploading;
    status.textContent = form.dataset.wait;
    const file = input.files?.[0];
    if (file && session && typeof fetch === 'function' && file.size > Number(form.dataset.directMax)) {
      event.preventDefault();
      status.textContent = form.dataset.progress.replace('{percent}', '0');
      chunked(file);
    }
  });
  addEventListener('pageshow', () => {
    reset();
    validate();
  });
})();`;
