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

export const GTM_ID = 'GTM-PNKMSPJN';
export const GA4_ID = 'G-FJR6WVMLHE';
export const CONSENT_COOKIE = 'shopshot_cookie_consent';

export const GTM_HEAD = `<!-- Consent Mode v2 - must run before any Google tag -->
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
    security_storage: 'granted',
    wait_for_update: 500
  });

  // Re-apply a previous choice on subsequent page loads.
  (function () {
    try {
      var m = document.cookie.match(/(?:^|;\\s*)${CONSENT_COOKIE}=([^;]*)/);
      if (m && decodeURIComponent(m[1]) === 'granted') {
        gtag('consent', 'update', {
          ad_storage: 'granted',
          ad_user_data: 'granted',
          ad_personalization: 'granted',
          analytics_storage: 'granted'
        });
      }
    } catch (e) {}
  })();
</script>
<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${GTM_ID}');</script>
<!-- End Google Tag Manager -->
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA4_ID}"></script>
<script>
  gtag('js', new Date());
  gtag('config', '${GA4_ID}');

  // Funnel tracking. Previously only 'purchase' reached GA4, which meant every
  // stage before payment was invisible and drop-off could not be diagnosed.
  // Safe to call before gtag.js finishes loading - dataLayer queues the hit.
  window.ssTrack = function (eventName, params) {
    try {
      window.dataLayer = window.dataLayer || [];
      if (typeof gtag === 'function') gtag('event', eventName, params || {});
      window.dataLayer.push(Object.assign({ event: eventName }, params || {}));
    } catch (e) {
      // Never let analytics break the app
    }
  };
</script>`;

// Cookie banner. Rendered with the GTM noscript so every page that already
// includes GTM_BODY gets it without touching each template.
export const GTM_BODY = `<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${GTM_ID}"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->
<div id="ss-cookie-banner" role="dialog" aria-live="polite" aria-label="Cookie choices" style="display:none">
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
      document.cookie = NAME + '=' + choice + ';path=/;max-age=' + (60 * 60 * 24 * 182) + ';SameSite=Lax';
      if (typeof gtag === 'function') {
        gtag('consent', 'update', {
          ad_storage: choice,
          ad_user_data: choice,
          ad_personalization: choice,
          analytics_storage: choice
        });
      }
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
