// ============================================================================
// MARKETPLACE EXPORT - Client-side image processing for platform-specific formats
// ============================================================================
// This gets injected as inline <script> in the results page
// Uses canvas API for resizing/reformatting - zero server cost

export function getMarketplaceExportScript(): string {
  return `
  // Marketplace Export Presets
  const EXPORT_PRESETS = {
    ebay: { name: 'eBay', icon: '🛍️', width: 1600, height: 1600, bgColor: '#FFFFFF', format: 'jpeg', quality: 0.92 },
    etsy: { name: 'Etsy', icon: '🧶', width: 2000, height: 2000, bgColor: null, format: 'jpeg', quality: 0.92 },
    amazon: { name: 'Amazon', icon: '📦', width: 2000, height: 2000, bgColor: '#FFFFFF', format: 'jpeg', quality: 0.95 },
    depop: { name: 'Depop/Vinted', icon: '👗', width: 1080, height: 1350, bgColor: null, format: 'jpeg', quality: 0.90 },
    shopify: { name: 'Shopify', icon: '🛒', width: 2048, height: 2048, bgColor: null, format: 'png', quality: 1 },
    instagram_square: { name: 'Instagram Post', icon: '📸', width: 1080, height: 1080, bgColor: null, format: 'jpeg', quality: 0.90 },
    instagram_story: { name: 'Instagram Story', icon: '📱', width: 1080, height: 1920, bgColor: null, format: 'jpeg', quality: 0.90 },
    facebook: { name: 'Facebook Ad', icon: '👍', width: 1200, height: 628, bgColor: null, format: 'jpeg', quality: 0.90 },
    tiktok: { name: 'TikTok Shop', icon: '🎵', width: 1080, height: 1080, bgColor: '#FFFFFF', format: 'jpeg', quality: 0.92 },
    hd: { name: 'HD Download', icon: '💎', width: 2000, height: 2000, bgColor: null, format: 'png', quality: 1 }
  };

  // Process a single image for a marketplace
  async function processImageForMarketplace(imageSrc, preset) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = preset.width;
        canvas.height = preset.height;
        const ctx = canvas.getContext('2d');

        // Fill background if specified (e.g., white for Amazon/eBay)
        if (preset.bgColor) {
          ctx.fillStyle = preset.bgColor;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        // Calculate fit dimensions (contain within target, centered)
        const imgRatio = img.width / img.height;
        const canvasRatio = canvas.width / canvas.height;
        let drawW, drawH, drawX, drawY;

        if (imgRatio > canvasRatio) {
          // Image is wider - fit by width
          drawW = canvas.width;
          drawH = canvas.width / imgRatio;
          drawX = 0;
          drawY = (canvas.height - drawH) / 2;
        } else {
          // Image is taller - fit by height
          drawH = canvas.height;
          drawW = canvas.height * imgRatio;
          drawX = (canvas.width - drawW) / 2;
          drawY = 0;
        }

        // For white BG presets, add padding (product takes ~85% of frame)
        if (preset.bgColor) {
          const padding = 0.075; // 7.5% padding each side
          const maxW = canvas.width * (1 - padding * 2);
          const maxH = canvas.height * (1 - padding * 2);
          if (imgRatio > (maxW / maxH)) {
            drawW = maxW;
            drawH = maxW / imgRatio;
          } else {
            drawH = maxH;
            drawW = maxH * imgRatio;
          }
          drawX = (canvas.width - drawW) / 2;
          drawY = (canvas.height - drawH) / 2;
        }

        ctx.drawImage(img, drawX, drawY, drawW, drawH);

        const mimeType = preset.format === 'png' ? 'image/png' : 'image/jpeg';
        canvas.toBlob((blob) => {
          resolve(blob);
        }, mimeType, preset.quality);
      };
      img.onerror = reject;
      img.src = imageSrc;
    });
  }

  // Export a single image for a specific marketplace
  async function exportSingleForMarketplace(imageSrc, presetKey, filename) {
    const preset = EXPORT_PRESETS[presetKey];
    if (!preset) return;

    try {
      const blob = await processImageForMarketplace(imageSrc, preset);
      const ext = preset.format === 'png' ? 'png' : 'jpg';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename + '_' + preset.name.replace(/[^a-zA-Z0-9]/g, '_') + '.' + ext;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
      alert('Failed to export image. Please try again.');
    }
  }

  // Export ALL images for a specific marketplace as ZIP
  async function exportAllForMarketplace(presetKey) {
    const preset = EXPORT_PRESETS[presetKey];
    if (!preset) return;

    const exportBtn = document.getElementById('export-all-btn');
    if (exportBtn) {
      exportBtn.disabled = true;
      exportBtn.innerHTML = '<span class="spinner-sm"></span> Processing...';
    }

    try {
      const zip = new JSZip();
      const productName = document.getElementById('product-name-edit')?.value || 'product';
      const safeName = productName.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
      const ext = preset.format === 'png' ? 'png' : 'jpg';
      
      // Get all generated images from lightbox array
      const images = lightboxImages.filter(img => img.src && img.label !== 'Original');
      
      let processed = 0;
      for (const img of images) {
        try {
          const blob = await processImageForMarketplace(img.src, preset);
          const labelSafe = img.label.replace(/[^a-zA-Z0-9]/g, '_');
          zip.file(safeName + '_' + labelSafe + '.' + ext, blob);
          processed++;
          if (exportBtn) {
            exportBtn.innerHTML = '<span class="spinner-sm"></span> ' + processed + '/' + images.length;
          }
        } catch (e) {
          console.error('Failed to process image:', img.label, e);
        }
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = safeName + '_' + preset.name.replace(/[^a-zA-Z0-9]/g, '_') + '.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Batch export failed:', err);
      alert('Failed to create export. Please try again.');
    } finally {
      if (exportBtn) {
        exportBtn.disabled = false;
        exportBtn.innerHTML = '📥 Download for...';
      }
    }
  }

  // Build the marketplace export dropdown HTML
  function showExportDropdown(e) {
    e.stopPropagation();
    const existing = document.getElementById('export-dropdown');
    if (existing) { existing.remove(); return; }

    const btn = e.currentTarget;
    const rect = btn.getBoundingClientRect();
    
    const dropdown = document.createElement('div');
    dropdown.id = 'export-dropdown';
    dropdown.style.cssText = 'position:fixed;top:' + (rect.bottom + 4) + 'px;right:' + (window.innerWidth - rect.right) + 'px;background:white;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.15);border:1px solid #E5E7EB;z-index:1000;min-width:220px;overflow:hidden;animation:fadeIn 0.15s ease;';
    
    let html = '<div style="padding:12px 16px;border-bottom:1px solid #F3F4F6;font-size:11px;font-weight:600;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;">Export for Platform</div>';
    
    for (const [key, preset] of Object.entries(EXPORT_PRESETS)) {
      html += '<div onclick="exportAllForMarketplace(\\'' + key + '\\')" style="padding:10px 16px;cursor:pointer;display:flex;align-items:center;gap:10px;transition:background 0.15s;font-size:13px;color:#374151;" onmouseover="this.style.background=\\'#F3F4F6\\'" onmouseout="this.style.background=\\'transparent\\'">';
      html += '<span style="font-size:16px;">' + preset.icon + '</span>';
      html += '<div><div style="font-weight:500;">' + preset.name + '</div>';
      html += '<div style="font-size:11px;color:#9CA3AF;">' + preset.width + '×' + preset.height;
      if (preset.bgColor) html += ' · White BG';
      html += ' · ' + preset.format.toUpperCase() + '</div></div></div>';
    }
    
    dropdown.innerHTML = html;
    document.body.appendChild(dropdown);
    
    // Close on click outside
    setTimeout(() => {
      document.addEventListener('click', function closeDropdown() {
        dropdown.remove();
        document.removeEventListener('click', closeDropdown);
      }, { once: true });
    }, 10);
  }
  `;
}

// CSS for the export button spinner
export function getMarketplaceExportCSS(): string {
  return `
    .spinner-sm {
      display: inline-block;
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }
    .export-btn {
      padding: 10px 20px;
      background: linear-gradient(135deg, #059669 0%, #10B981 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      position: relative;
    }
    .export-btn:hover { opacity: 0.9; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
  `;
}
