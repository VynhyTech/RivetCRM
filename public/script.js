const menuToggle = document.querySelector('.menu-toggle');
const siteNav = document.querySelector('.site-nav');
const messageLauncher = document.querySelector('.message-us');
const messageDialog = document.querySelector('#message-dialog');
const messageForm = document.querySelector('#message-form');

messageLauncher?.addEventListener('click', () => messageDialog?.showModal());
messageDialog?.querySelector('.message-close')?.addEventListener('click', () => messageDialog.close());
messageDialog?.addEventListener('click', (event) => {
  if (event.target === messageDialog) messageDialog.close();
});

function ensureFormExtras(form) {
  let status = form.querySelector('#message-status');
  if (!status) {
    status = document.createElement('p');
    status.id = 'message-status';
    status.className = 'message-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    form.querySelector('.message-submit')?.before(status);
  }
  if (!form.querySelector('input[name="hp_check"]')) {
    const trap = document.createElement('input');
    trap.name = 'hp_check'; // deliberately not "website"/"url", which browsers autofill
    trap.tabIndex = -1;
    trap.autocomplete = 'off';
    trap.setAttribute('aria-hidden', 'true');
    // Set through the CSSOM so it needs no CSS rule and stays valid under style-src 'self'.
    Object.assign(trap.style, { position: 'absolute', left: '-9999px', width: '1px', height: '1px', opacity: '0' });
    form.append(trap);
  }
  return status;
}

messageForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = ensureFormExtras(messageForm);
  const submit = messageForm.querySelector('.message-submit');
  const data = Object.fromEntries(new FormData(messageForm));

  if (!data.name?.trim() || !(data.phone?.trim() || data.email?.trim())) {
    status.textContent = 'Please add your name and a phone number or email.';
    return;
  }
  if (!messageForm.reportValidity()) return;

  if (submit) submit.disabled = true;
  status.textContent = 'Sending…';
  try {
    const response = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || 'Something went wrong.');
    status.textContent = 'Thanks! We will get back to you shortly.';
    messageForm.reset();
    setTimeout(() => { messageDialog?.close(); status.textContent = ''; }, 2500);
  } catch (error) {
    status.textContent = error.message || 'Could not send. Please email contact@rivet-crm.com.';
  } finally {
    if (submit) submit.disabled = false;
  }
});

menuToggle?.addEventListener('click', () => {
  const isOpen = siteNav.classList.toggle('open');
  menuToggle.setAttribute('aria-expanded', String(isOpen));
});

siteNav?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    siteNav.classList.remove('open');
    menuToggle?.setAttribute('aria-expanded', 'false');
  });
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && siteNav?.classList.contains('open')) {
    siteNav.classList.remove('open');
    menuToggle?.setAttribute('aria-expanded', 'false');
    menuToggle?.focus();
  }
});
