const menuToggle = document.querySelector('.menu-toggle');
const siteNav = document.querySelector('.site-nav');
const billingToggle = document.querySelector('#billing-toggle');

document.querySelectorAll('body *').forEach((element) => {
  if (element.children.length > 0) return;
  element.textContent = element.textContent
    .replace(/\u00e2\u2020\u2014|\u00e2\u2020\u2012|\u00e2\u2020\u2019/g, '->')
    .replace(/\u00e2\u2020\u201c/g, 'v')
    .replace(/\u00c2\u00b7/g, ' / ')
    .replace(/\u00c2\u00a9/g, '(c)');
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

billingToggle?.addEventListener('click', () => {
  const isAnnual = billingToggle.getAttribute('aria-pressed') !== 'true';
  billingToggle.setAttribute('aria-pressed', String(isAnnual));
  billingToggle.setAttribute('aria-label', isAnnual ? 'Switch to monthly billing' : 'Switch to annual billing');
  document.querySelectorAll('[data-monthly][data-annual]').forEach((price) => {
    price.textContent = isAnnual ? price.dataset.annual : price.dataset.monthly;
  });
});

if (billingToggle) {
  billingToggle.setAttribute('aria-pressed', 'false');
  billingToggle.setAttribute('aria-label', 'Switch to annual billing');
}
