// ============================================================================
// MARKETPLACE EXPORT PRESETS - Client-side image resizing & formatting
// ============================================================================
// All processing happens in the browser using Canvas API
// No server costs, instant results, works offline

const MARKETPLACE_PRESETS = {
  // eBay presets
  'ebay-standard': { name: 'eBay Standard', width: 1600, height: 1600, bg: '#FFFFFF', platform: 'ebay', padding: 0.05 },
  'ebay-lifestyle': { name: 'eBay Lifestyle', width: 1200, height: 1200, bg: null, platform: 'ebay', padding: 0 },
  // Amazon presets
  'amazon-main': { name: 'Amazon Main', width: 2000, height: 2000, bg: '#FFFFFF', platform: 'amazon', padding: 0.08 },
  'amazon-secondary': { name: 'Amazon Secondary', width: 2000, height: 2000, bg: null, platform: 'amazon', padding: 0 },
  // Etsy presets
  'etsy-listing': { name: 'Etsy Listing', width: 2000, height: 2000, bg: null, platform: 'etsy', padding: 0 },
  'etsy-square': { name: 'Etsy Square', width: 2700, height: 2025, bg: null, platform: 'etsy', padding: 0 },
  // Depop / Vinted (4:5 portrait)
  'depop-portrait': { name: 'Depop / Vinted', width: 1080, height: 1350, bg: '#FFFFFF', platform: 'depop', padding: 0.04 },
  // Shopify presets
  'shopify-square': { name: 'Shopify Square', width: 2048, height: 2048, bg: '#FFFFFF', platform: 'shopify', padding: 0.05 },
  'shopify-rect': { name: 'Shopify Rectangle', width: 2048, height: 1365, bg: null, platform: 'shopify', padding: 0 },
  // Social media
  'social-square': { name: 'Instagram Square', width: 1080, height: 1080, bg: null, platform: 'social', padding: 0 },
  'social-portrait': { name: 'Instagram Story', width: 1080, height: 1920, bg: null, platform: 'social', padding: 0 },
  'social-landscape': { name: 'Facebook/Twitter', width: 1200, height: 630, bg: null, platform: 'social', padding: 0 },
  // Web optimised
  'web-thumbnail': { name: 'Web Thumbnail', width: 600, height: 600, bg: '#FFFFFF', platform: 'web', padding: 0.03 },
  'web-hero': { name: 'Web Hero Banner', width: 1920, height: 800, bg: null, platform: 'web', padding: 0 },
};

const PLATFORM_ICONS = {
  ebay: 'fa-store',
  amazon: 'fa-box-open',
  etsy: 'fa-paint-brush',
  depop: 'fa-shirt',
  shopify: 'fa-shop',
  social: 'fa-share-nodes',
  web: 'fa-globe',
};

const PLATFORM_COLORS = {
  ebay: { bg: '#E53238', text: 'white' },
  amazon: { bg: '#FF9900', text: 'white' },
  etsy: { bg: '#F1641E', text: 'white' },
  depop: { bg: '#FF2300', text: 'white' },
  shopify: { bg: '#7AB55C', text: 'white' },
  social: { bg: '#E1306C', text: 'white' },
  web: { bg: '#3B82F6', text: 'white' },
};

/**
 * Resize and format a single image for a marketplace preset
 * @param {string} imageDataUrl - base64 data URL of the source image
 * @param {object} preset - marketplace preset config
 * @returns {Promise<string>} - base64 data URL of the resized image
 */
function resizeForMarketplace(imageDataUrl, preset) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = preset.width;
      canvas.height = preset.height;
      const ctx = canvas.getContext('2d');

      // Fill background if specified (white bg for eBay/Amazon requirements)
      if (preset.bg) {
        ctx.fillStyle = preset.bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      // Calculate dimensions with padding
      const padX = canvas.width * (preset.padding || 0);
      const padY = canvas.height * (preset.padding || 0);
      const availW = canvas.width - padX * 2;
      const availH = canvas.height - padY * 2;

      // Fit image within available area maintaining aspect ratio
      const scale = Math.min(availW / img.width, availH / img.height);
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      const drawX = padX + (availW - drawW) / 2;
      const drawY = padY + (availH - drawH) / 2;

      // Use high quality rendering
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, drawX, drawY, drawW, drawH);

      // Output as JPEG for smaller file sizes (PNG for transparent bg)
      const format = preset.bg ? 'image/jpeg' : 'image/png';
      const quality = preset.bg ? 0.92 : undefined;
      resolve(canvas.toDataURL(format, quality));
    };
    img.onerror = () => reject(new Error('Failed to load image for resizing'));
    img.src = imageDataUrl;
  });
}

/**
 * Export all images for a specific marketplace preset as ZIP
 */
async function exportForMarketplace(presetKey, images, productName) {
  const preset = MARKETPLACE_PRESETS[presetKey];
  if (!preset) return;

  const statusEl = document.getElementById('export-status');
  if (statusEl) {
    statusEl.textContent = `Preparing ${preset.name} export...`;
    statusEl.classList.remove('hidden');
  }

  try {
    const zip = new JSZip();
    const folder = zip.folder(`${productName || 'shopshot'}-${preset.platform}`);

    for (let i = 0; i < images.length; i++) {
      if (statusEl) statusEl.textContent = `Resizing image ${i + 1} of ${images.length}...`;
      
      const resized = await resizeForMarketplace(images[i].data, preset);
      const base64 = resized.split(',')[1];
      const ext = preset.bg ? 'jpg' : 'png';
      const filename = `${(i + 1).toString().padStart(2, '0')}-${images[i].type}.${ext}`;
      folder.file(filename, base64, { base64: true });
    }

    if (statusEl) statusEl.textContent = 'Creating ZIP...';
    
    const blob = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${productName || 'shopshot'}-${preset.platform}-${preset.width}x${preset.height}.zip`;
    link.click();
    URL.revokeObjectURL(link.href);

    if (statusEl) {
      statusEl.textContent = 'Export complete!';
      setTimeout(() => statusEl.classList.add('hidden'), 2000);
    }

    // Track export event
    try {
      await fetch('/api/analytics/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'marketplace_export', data: { preset: presetKey, platform: preset.platform, image_count: images.length } })
      });
    } catch (e) { /* analytics is non-critical */ }

  } catch (err) {
    console.error('Export error:', err);
    if (statusEl) {
      statusEl.textContent = 'Export failed. Please try again.';
      setTimeout(() => statusEl.classList.add('hidden'), 3000);
    }
  }
}

/**
 * Export a single image for a specific marketplace preset
 */
async function exportSingleForMarketplace(presetKey, imageDataUrl, imageName) {
  const preset = MARKETPLACE_PRESETS[presetKey];
  if (!preset) return;

  try {
    const resized = await resizeForMarketplace(imageDataUrl, preset);
    const link = document.createElement('a');
    link.href = resized;
    const ext = preset.bg ? 'jpg' : 'png';
    link.download = `${imageName || 'shopshot'}-${preset.platform}-${preset.width}x${preset.height}.${ext}`;
    link.click();
  } catch (err) {
    console.error('Single export error:', err);
    alert('Export failed. Please try again.');
  }
}

/**
 * Render the marketplace export panel HTML
 */
function getMarketplaceExportHTML() {
  const platforms = {};
  Object.entries(MARKETPLACE_PRESETS).forEach(([key, preset]) => {
    if (!platforms[preset.platform]) platforms[preset.platform] = [];
    platforms[preset.platform].push({ key, ...preset });
  });

  let html = `
    <div id="marketplace-export-panel" class="mt-6 bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
      <button onclick="toggleExportPanel()" class="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
            <i class="fas fa-file-export text-white"></i>
          </div>
          <div class="text-left">
            <h3 class="font-semibold text-brand-dark">Export for Marketplace</h3>
            <p class="text-xs text-brand-gray">Auto-resize for eBay, Amazon, Etsy, Shopify & more</p>
          </div>
        </div>
        <i id="export-panel-chevron" class="fas fa-chevron-down text-brand-gray transition-transform"></i>
      </button>
      <div id="export-panel-body" class="hidden border-t border-slate-100">
        <div class="p-4 sm:p-6 space-y-4">
          <p id="export-status" class="hidden text-sm text-brand-purple font-medium text-center py-2 bg-purple-50 rounded-lg"></p>`;

  Object.entries(platforms).forEach(([platform, presets]) => {
    const color = PLATFORM_COLORS[platform];
    const icon = PLATFORM_ICONS[platform];
    html += `
          <div>
            <div class="flex items-center gap-2 mb-2">
              <span class="inline-flex items-center justify-center w-6 h-6 rounded-md text-xs" style="background:${color.bg}; color:${color.text}">
                <i class="fas ${icon}"></i>
              </span>
              <span class="text-sm font-semibold text-brand-dark capitalize">${platform === 'social' ? 'Social Media' : platform === 'web' ? 'Web Optimised' : platform.charAt(0).toUpperCase() + platform.slice(1)}</span>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">`;
    
    presets.forEach(p => {
      const bgLabel = p.bg ? `<span class="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded">White BG</span>` : '';
      html += `
              <button onclick="exportForMarketplace('${p.key}', images, sessionData?.product_name)" 
                      class="flex items-center justify-between px-3 py-2.5 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/50 transition text-left group">
                <div>
                  <span class="text-sm font-medium text-brand-dark">${p.name}</span>
                  <span class="text-[11px] text-brand-gray ml-1">${p.width}x${p.height}</span>
                  ${bgLabel}
                </div>
                <i class="fas fa-download text-brand-gray group-hover:text-blue-500 transition text-sm"></i>
              </button>`;
    });

    html += `
            </div>
          </div>`;
  });

  html += `
        </div>
      </div>
    </div>`;

  return html;
}

function toggleExportPanel() {
  const body = document.getElementById('export-panel-body');
  const chevron = document.getElementById('export-panel-chevron');
  body.classList.toggle('hidden');
  chevron.style.transform = body.classList.contains('hidden') ? '' : 'rotate(180deg)';
}

/**
 * Get the marketplace export dropdown for lightbox (single image export)
 */
function getLightboxExportHTML() {
  let options = '';
  Object.entries(MARKETPLACE_PRESETS).forEach(([key, preset]) => {
    options += `<option value="${key}">${preset.name} (${preset.width}x${preset.height})</option>`;
  });

  return `
    <div class="flex items-center gap-2 mt-3">
      <select id="lightbox-export-preset" class="bg-white/10 text-white border border-white/20 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-white/40" style="max-width: 200px;">
        <option value="">Export as...</option>
        ${options}
      </select>
      <button onclick="exportCurrentFromLightbox()" class="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm font-medium transition">
        <i class="fas fa-file-export mr-1"></i>Export
      </button>
    </div>`;
}

function exportCurrentFromLightbox() {
  const select = document.getElementById('lightbox-export-preset');
  const presetKey = select.value;
  if (!presetKey) {
    alert('Please select an export format');
    return;
  }
  const img = images[currentIndex];
  exportSingleForMarketplace(presetKey, img.data, `${sessionData?.product_name || 'shopshot'}-${img.type}`);
}
