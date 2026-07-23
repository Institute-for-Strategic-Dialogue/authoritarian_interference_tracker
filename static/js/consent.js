(function () {
  var GA_ID = 'G-VNQ6ZEYEEQ';
  var STORAGE_KEY = 'ait_analytics_consent';

  function loadAnalytics() {
    if (window.__aitGtagLoaded) return;
    window.__aitGtagLoaded = true;

    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID);

    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
  }

  function removeBanner() {
    var el = document.getElementById('consent-banner');
    if (el) el.parentNode.removeChild(el);
  }

  function setChoice(choice) {
    try { localStorage.setItem(STORAGE_KEY, choice); } catch (e) { /* private mode */ }
    removeBanner();
    if (choice === 'accepted') loadAnalytics();
  }

  function showBanner() {
    if (document.getElementById('consent-banner')) return;

    var wrap = document.createElement('div');
    wrap.id = 'consent-banner';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-label', 'Cookie consent');
    wrap.setAttribute('aria-live', 'polite');

    var inner = document.createElement('div');
    inner.className = 'consent-inner';

    var msg = document.createElement('p');
    msg.className = 'consent-msg';
    msg.innerHTML =
      '<strong>Cookies.</strong> We would like to use Google Analytics to count ' +
      'aggregate visits to the AIT. Analytics cookies are set only if you accept. ' +
      '<a href="/privacy#analytics">More detail</a>.';

    var actions = document.createElement('div');
    actions.className = 'consent-actions';

    var decline = document.createElement('button');
    decline.type = 'button';
    decline.className = 'consent-btn consent-btn--decline';
    decline.textContent = 'Decline';
    decline.addEventListener('click', function () { setChoice('declined'); });

    var accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'consent-btn consent-btn--accept';
    accept.textContent = 'Accept';
    accept.addEventListener('click', function () { setChoice('accepted'); });

    actions.appendChild(decline);
    actions.appendChild(accept);
    inner.appendChild(msg);
    inner.appendChild(actions);
    wrap.appendChild(inner);
    document.body.appendChild(wrap);
  }

  window.aitResetConsent = function () {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    window.__aitGtagLoaded = false;
    showBanner();
  };

  var stored = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch (e) { /* private mode */ }

  if (stored === 'accepted') {
    loadAnalytics();
  } else if (stored !== 'declined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showBanner);
    } else {
      showBanner();
    }
  }
})();
