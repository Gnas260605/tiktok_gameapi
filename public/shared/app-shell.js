// TikUser LIVE — shared shell: product navigation + icon helper.
// Load with <script src="/shared/app-shell.js" defer></script>.
// Any <nav data-ui-products data-current="studio|leochua|tutien|tutien-admin"> is filled in.
(function () {
  const ICONS = '/shared/icons.svg';

  const PRODUCTS = [
    { id: 'studio', href: '/', label: 'Studio', icon: 'chart' },
    { id: 'leochua', href: '/game', label: 'Leo Chùa', icon: 'pagoda' },
    { id: 'tutien', href: '/tutien', label: 'Tu Tiên', icon: 'swords' },
    { id: 'tutien-admin', href: '/tutien/admin', label: 'Quản trị Tu Tiên', icon: 'shield-admin' },
    { id: 'docs', href: '/docs', label: 'API', icon: 'book', external: true },
  ];

  /** SVG markup for an icon in /shared/icons.svg (decorative by default). */
  function uiIcon(name, extraClass) {
    const cls = extraClass ? `ui-icon ${extraClass}` : 'ui-icon';
    return `<svg class="${cls}" aria-hidden="true" focusable="false"><use href="${ICONS}#i-${name}"></use></svg>`;
  }

  function renderProducts(nav) {
    const current = nav.dataset.current;
    if (!nav.hasAttribute('aria-label')) nav.setAttribute('aria-label', 'Chuyển trang');
    nav.innerHTML = PRODUCTS.map((p) => {
      const isCurrent = p.id === current;
      const attrs = [
        `href="${p.href}"`,
        isCurrent ? 'aria-current="page"' : '',
        p.external ? 'target="_blank" rel="noopener"' : '',
      ].filter(Boolean).join(' ');
      const ext = p.external ? uiIcon('external', 'ui-icon--ext') : '';
      return `<a ${attrs}>${uiIcon(p.icon)}<span>${p.label}</span>${ext}</a>`;
    }).join('');
  }

  function init() {
    document.querySelectorAll('[data-ui-products]').forEach(renderProducts);
  }

  window.uiIcon = uiIcon;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
