// Keep draft data in this page only; never persist private profile fields.
export const unsavedProfileScript = String.raw`(()=>{
  const form = document.querySelector('#profile-form');
  if (!form) return;
  const snapshot = () => JSON.stringify([...new FormData(form)]);
  const original = snapshot();
  let submitting = false;
  addEventListener('beforeunload', event => {
    if (submitting || snapshot() === original) return;
    event.preventDefault();
    event.returnValue = '';
  });
  form.addEventListener('submit', () => { submitting = true; });
  addEventListener('pageshow', () => { submitting = false; });
})();`;

export const uploadFeedbackScript = String.raw`(()=>{
  const form = document.querySelector('[data-takeout-form]');
  if (!form) return;
  const input = form.querySelector('input[type=file]');
  const button = form.querySelector('button[type=submit]');
  const status = form.querySelector('[role=status]');
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
  form.addEventListener('submit', event => {
    if (submitting) { event.preventDefault(); return; }
    if (!validate()) { event.preventDefault(); input.reportValidity(); return; }
    submitting = true;
    form.setAttribute('aria-busy', 'true');
    button.disabled = true;
    button.textContent = form.dataset.uploading;
    status.textContent = form.dataset.wait;
  });
  addEventListener('pageshow', () => {
    submitting = false;
    form.removeAttribute('aria-busy');
    button.disabled = false;
    button.textContent = label;
    validate();
  });
})();`;
