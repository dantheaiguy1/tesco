// ============================================================================
// REFERRAL SYSTEM - Frontend
// ============================================================================
// Users get a unique referral link. When someone signs up via that link,
// BOTH the referrer and the new user get 5 Standard + 3 Pro credits.
// No cap on referrals.

let referralData = null;

/**
 * Load referral data for the current user
 */
async function loadReferralData() {
  try {
    const res = await fetch('/api/referral/stats', { credentials: 'include' });
    const data = await res.json();
    if (data.success) {
      referralData = data;
      return data;
    }
  } catch (e) {
    console.error('Failed to load referral data:', e);
  }
  return null;
}

/**
 * Get the referral link for the current user
 */
function getReferralLink() {
  if (!referralData?.code) return '';
  return `${window.location.origin}/get-started?ref=${referralData.code}`;
}

/**
 * Copy referral link to clipboard
 */
async function copyReferralLink() {
  const link = getReferralLink();
  if (!link) {
    alert('Please log in to get your referral link.');
    return;
  }
  
  try {
    await navigator.clipboard.writeText(link);
    const btn = document.getElementById('copy-referral-btn');
    if (btn) {
      const original = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-check mr-1"></i>Copied!';
      btn.classList.add('bg-green-500');
      setTimeout(() => {
        btn.innerHTML = original;
        btn.classList.remove('bg-green-500');
      }, 2000);
    }
  } catch (e) {
    // Fallback for older browsers
    const input = document.createElement('input');
    input.value = link;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    alert('Referral link copied!');
  }
}

/**
 * Share referral link via Web Share API or fallback
 */
async function shareReferralLink() {
  const link = getReferralLink();
  if (!link) return;
  
  const shareData = {
    title: 'ShopShot - AI Product Photography',
    text: 'Get 8 free AI product shots with ShopShot. Upload one photo, get 10 professional images in seconds.',
    url: link
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
    } catch (e) {
      if (e.name !== 'AbortError') copyReferralLink();
    }
  } else {
    copyReferralLink();
  }
}

/**
 * Get referral panel HTML for dashboard/account pages
 */
function getReferralPanelHTML(data) {
  if (!data) return '';
  
  const link = `${window.location.origin}/get-started?ref=${data.code}`;
  const totalEarned = (data.successful_referrals || 0) * 8; // 5 std + 3 pro = 8 total per referral

  return `
    <div class="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      <div class="px-6 py-4 border-b border-slate-100">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center">
            <i class="fas fa-gift text-white"></i>
          </div>
          <div>
            <h3 class="font-semibold text-brand-dark">Invite Friends, Earn Credits</h3>
            <p class="text-xs text-brand-gray">You BOTH get 5 Standard + 3 Pro credits</p>
          </div>
        </div>
      </div>
      
      <div class="p-6 space-y-4">
        <!-- Link -->
        <div>
          <label class="text-xs font-medium text-brand-gray uppercase tracking-wide">Your Referral Link</label>
          <div class="mt-1 flex items-center gap-2">
            <input type="text" value="${link}" readonly 
                   class="flex-1 px-3 py-2 bg-slate-50 rounded-lg text-sm text-brand-dark border border-slate-200 focus:outline-none truncate"
                   onclick="this.select()">
            <button onclick="copyReferralLink()" id="copy-referral-btn"
                    class="px-4 py-2 gradient-bg text-white rounded-lg text-sm font-medium transition whitespace-nowrap">
              <i class="fas fa-copy mr-1"></i>Copy
            </button>
            <button onclick="shareReferralLink()" 
                    class="px-3 py-2 border border-slate-200 rounded-lg text-brand-gray hover:text-brand-purple hover:border-purple-200 transition">
              <i class="fas fa-share-nodes"></i>
            </button>
          </div>
        </div>

        <!-- Stats -->
        <div class="grid grid-cols-3 gap-3">
          <div class="bg-slate-50 rounded-xl p-3 text-center">
            <div class="text-2xl font-bold text-brand-dark">${data.total_referrals || 0}</div>
            <div class="text-xs text-brand-gray">Invited</div>
          </div>
          <div class="bg-green-50 rounded-xl p-3 text-center">
            <div class="text-2xl font-bold text-green-600">${data.successful_referrals || 0}</div>
            <div class="text-xs text-brand-gray">Signed Up</div>
          </div>
          <div class="bg-purple-50 rounded-xl p-3 text-center">
            <div class="text-2xl font-bold text-purple-600">${totalEarned}</div>
            <div class="text-xs text-brand-gray">Credits Earned</div>
          </div>
        </div>

        <!-- Share buttons -->
        <div class="flex items-center gap-2 pt-2">
          <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent('I use ShopShot to create professional product photos in seconds with AI. Get 8 free credits:')}&url=${encodeURIComponent(link)}" 
             target="_blank" class="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-black text-white text-sm font-medium hover:bg-gray-800 transition">
            <i class="fab fa-x-twitter"></i> Share
          </a>
          <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}" 
             target="_blank" class="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-[#1877F2] text-white text-sm font-medium hover:bg-[#166FE5] transition">
            <i class="fab fa-facebook-f"></i> Share
          </a>
          <a href="https://wa.me/?text=${encodeURIComponent('Get 8 free AI product photography credits with ShopShot: ' + link)}"
             target="_blank" class="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-[#25D366] text-white text-sm font-medium hover:bg-[#20BD5A] transition">
            <i class="fab fa-whatsapp"></i> Share
          </a>
          <a href="mailto:?subject=${encodeURIComponent('Free AI Product Photography - ShopShot')}&body=${encodeURIComponent('I use ShopShot to create professional product photos in seconds. Upload 1 photo, get 10 pro shots. Get 8 free credits: ' + link)}"
             class="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-slate-600 text-white text-sm font-medium hover:bg-slate-700 transition">
            <i class="fas fa-envelope"></i> Email
          </a>
        </div>
      </div>
    </div>`;
}
