// ============================================================================
// ANALYTICS + COOKIE CONSENT - single source of truth
// ============================================================================
// These snippets were previously copy-pasted into four separate page modules,
// which is why the Cookie Policy could claim "we do NOT use analytics cookies"
// while GA4 loaded on that very page.
//
// Analytics now runs behind Google Consent Mode v2. Storage is denied by
// default, so no analytics cookie is written until the visitor accepts. That is
// what PECR requires for non-essential cookies, and it is what the Cookie
// Policy now describes.

// GA4 is loaded directly with gtag.js. Google Tag Manager (GTM-PNKMSPJN) was
// also loaded on every page but nothing in the site needs it: there are no Ads,
// Meta or other tags in the code, and if the container also held a GA4 tag
// every page view was counted twice. The export names keep "GTM" so the 55
// templates that include them did not need to change.
export const GA4_ID = 'G-FJR6WVMLHE';
export const CONSENT_COOKIE = 'shopshot_cookie_consent';

export const GTM_HEAD = `<!-- Analytics: Consent Mode v2, GA4 loaded only after consent -->
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}

  // Deny by default. Nothing is stored until the visitor chooses.
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    functionality_storage: 'granted',
    security_storage: 'granted'
  });

  (function () {
    // Never measure local development or Cloudflare preview deployments.
    var host = location.hostname;
    var measurable = !(host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || /\\.pages\\.dev$/.test(host));

    var state = null; // null until the visitor chooses, then 'granted' or 'denied'
    try {
      var m = document.cookie.match(/(?:^|;\\s*)${CONSENT_COOKIE}=([^;]*)/);
      if (m) state = decodeURIComponent(m[1]) === 'granted' ? 'granted' : 'denied';
    } catch (e) {}

    var loaded = false;
    var pending = []; // events fired before the visitor has chosen

    function load() {
      if (loaded || !measurable) return;
      loaded = true;
      // Analytics only. The Cookie Policy says we use no advertising cookies,
      // so the ad_* signals stay denied even after Accept.
      gtag('consent', 'update', { analytics_storage: 'granted' });
      gtag('js', new Date());
      gtag('config', '${GA4_ID}');
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtag/js?id=${GA4_ID}';
      document.head.appendChild(s);
      for (var i = 0; i < pending.length; i++) gtag('event', pending[i][0], pending[i][1]);
      pending = [];
    }

    // Funnel events. Before a choice they wait in memory; after Accept they are
    // sent; after Reject (or on a non-production host) they are dropped and no
    // Google script is ever loaded, so Reject means no requests to Google.
    window.ssTrack = function (eventName, params) {
      try {
        if (!measurable || state === 'denied') return;
        if (state === 'granted' && loaded) gtag('event', eventName, params || {});
        else if (pending.length < 50) pending.push([eventName, params || {}]);
      } catch (e) {
        // Never let analytics break the app
      }
    };

    // Called by the cookie banner.
    window.ssConsentChanged = function (choice) {
      state = choice === 'granted' ? 'granted' : 'denied';
      if (state === 'granted') load();
      else {
        pending = [];
        // A page that had already loaded gtag.js stops storing from here on;
        // the next page load will not load it at all.
        if (loaded) gtag('consent', 'update', { analytics_storage: 'denied' });
      }
    };

    if (state === 'granted') load();
  })();
</script>`;

// Cookie banner. Every page that includes GTM_BODY gets it without touching
// each template.
export const GTM_BODY = `<div id="ss-cookie-banner" role="dialog" aria-live="polite" aria-label="Cookie choices" style="display:none">
  <div class="ss-cookie-inner">
    <div class="ss-cookie-text">
      <strong>We'd like to use analytics cookies.</strong>
      They help us see which parts of ShopShot people actually use. Nothing is stored until you choose.
      Essential cookies for login and security are always on. <a href="/cookies">Cookie Policy</a>
    </div>
    <div class="ss-cookie-actions">
      <button type="button" class="ss-cookie-btn ss-cookie-reject" onclick="ssCookieChoice('denied')">Reject</button>
      <button type="button" class="ss-cookie-btn ss-cookie-accept" onclick="ssCookieChoice('granted')">Accept</button>
    </div>
  </div>
</div>
<style>
  #ss-cookie-banner {
    position: fixed; left: 16px; right: 16px; bottom: 16px; z-index: 2147483000;
    background: #111827; color: #F9FAFB; border-radius: 14px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.3); padding: 18px 20px;
    font-family: Inter, system-ui, sans-serif;
  }
  .ss-cookie-inner {
    max-width: 1100px; margin: 0 auto; display: flex; gap: 20px;
    align-items: center; justify-content: space-between; flex-wrap: wrap;
  }
  .ss-cookie-text { font-size: 14px; line-height: 1.6; color: #D1D5DB; flex: 1 1 460px; }
  .ss-cookie-text strong { color: #fff; display: block; margin-bottom: 2px; font-size: 15px; }
  .ss-cookie-text a { color: #93C5FD; }
  .ss-cookie-actions { display: flex; gap: 10px; flex: 0 0 auto; }
  .ss-cookie-btn {
    padding: 10px 22px; border-radius: 9px; font-size: 14px; font-weight: 600;
    cursor: pointer; font-family: inherit; border: 1px solid transparent;
  }
  .ss-cookie-reject { background: transparent; color: #E5E7EB; border-color: #4B5563; }
  .ss-cookie-reject:hover { background: #1F2937; }
  .ss-cookie-accept { background: linear-gradient(135deg,#3B82F6,#8B5CF6); color: #fff; }
  @media (max-width: 560px) {
    .ss-cookie-actions { width: 100%; }
    .ss-cookie-btn { flex: 1; }
  }
</style>
<script>
  (function () {
    var NAME = '${CONSENT_COOKIE}';
    function read() {
      var m = document.cookie.match(/(?:^|;\\s*)${CONSENT_COOKIE}=([^;]*)/);
      return m ? decodeURIComponent(m[1]) : null;
    }
    window.ssCookieChoice = function (choice) {
      // 6 months, matching the review cadence for consent under PECR guidance.
      document.cookie = NAME + '=' + choice + ';path=/;max-age=' + (60 * 60 * 24 * 182) + ';SameSite=Lax' + (location.protocol === 'https:' ? ';Secure' : '');
      if (typeof window.ssConsentChanged === 'function') window.ssConsentChanged(choice);
      var el = document.getElementById('ss-cookie-banner');
      if (el) el.style.display = 'none';
    };
    // Let visitors change their mind: anything linking to #cookie-settings reopens it.
    window.ssCookieSettings = function () {
      var el = document.getElementById('ss-cookie-banner');
      if (el) el.style.display = 'block';
    };
    if (!read()) {
      var el = document.getElementById('ss-cookie-banner');
      if (el) el.style.display = 'block';
    }
  })();
</script>`;
