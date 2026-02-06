// ============================================================================
// BEFORE/AFTER COMPARISON SLIDER - Client-side image comparison
// ============================================================================

export function getComparisonSliderCSS(): string {
  return `
    .comparison-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.85);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.2s ease;
    }
    .comparison-container {
      position: relative;
      max-width: 90vw;
      max-height: 80vh;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      touch-action: none;
      user-select: none;
    }
    .comparison-container img {
      display: block;
      max-width: 90vw;
      max-height: 80vh;
      object-fit: contain;
    }
    .comparison-after {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    .comparison-after img {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .comparison-slider {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 4px;
      background: white;
      cursor: ew-resize;
      z-index: 10;
      box-shadow: 0 0 8px rgba(0,0,0,0.3);
    }
    .comparison-slider::before {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 40px;
      height: 40px;
      background: white;
      border-radius: 50%;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }
    .comparison-slider::after {
      content: '◀ ▶';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 12px;
      color: #374151;
      white-space: nowrap;
      letter-spacing: 2px;
    }
    .comparison-labels {
      position: absolute;
      bottom: 16px;
      left: 0;
      right: 0;
      display: flex;
      justify-content: space-between;
      padding: 0 16px;
      pointer-events: none;
      z-index: 5;
    }
    .comparison-label {
      padding: 6px 14px;
      background: rgba(0,0,0,0.6);
      color: white;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      backdrop-filter: blur(8px);
    }
    .comparison-close {
      position: absolute;
      top: 12px;
      right: 12px;
      width: 36px;
      height: 36px;
      background: rgba(0,0,0,0.6);
      color: white;
      border: none;
      border-radius: 50%;
      font-size: 20px;
      cursor: pointer;
      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .comparison-close:hover { background: rgba(0,0,0,0.8); }
  `;
}

export function getComparisonSliderScript(): string {
  return `
  function openComparison(originalSrc, generatedSrc, label) {
    const overlay = document.createElement('div');
    overlay.className = 'comparison-overlay';
    overlay.id = 'comparison-overlay';
    
    overlay.innerHTML = 
      '<div class="comparison-container" id="comparison-box">' +
        '<img src="' + originalSrc + '" style="visibility:hidden;" id="comparison-sizer">' +
        '<img src="' + originalSrc + '" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;">' +
        '<div class="comparison-after" id="comparison-after" style="clip-path:inset(0 0 0 50%);">' +
          '<img src="' + generatedSrc + '">' +
        '</div>' +
        '<div class="comparison-slider" id="comparison-slider" style="left:50%;"></div>' +
        '<div class="comparison-labels">' +
          '<span class="comparison-label">Original</span>' +
          '<span class="comparison-label">' + label + '</span>' +
        '</div>' +
        '<button class="comparison-close" onclick="closeComparison()">×</button>' +
      '</div>';
    
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const slider = document.getElementById('comparison-slider');
    const afterEl = document.getElementById('comparison-after');
    const box = document.getElementById('comparison-box');
    let isDragging = false;

    function updateSlider(clientX) {
      const rect = box.getBoundingClientRect();
      let pct = ((clientX - rect.left) / rect.width) * 100;
      pct = Math.max(2, Math.min(98, pct));
      slider.style.left = pct + '%';
      afterEl.style.clipPath = 'inset(0 0 0 ' + pct + '%)';
    }

    slider.addEventListener('mousedown', (e) => { isDragging = true; e.preventDefault(); });
    slider.addEventListener('touchstart', (e) => { isDragging = true; e.preventDefault(); }, { passive: false });
    
    document.addEventListener('mousemove', (e) => { if (isDragging) updateSlider(e.clientX); });
    document.addEventListener('touchmove', (e) => { if (isDragging) updateSlider(e.touches[0].clientX); }, { passive: false });
    
    document.addEventListener('mouseup', () => { isDragging = false; });
    document.addEventListener('touchend', () => { isDragging = false; });

    // Click on overlay (not box) to close
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeComparison(); });
  }

  function closeComparison() {
    const overlay = document.getElementById('comparison-overlay');
    if (overlay) {
      overlay.remove();
      document.body.style.overflow = '';
    }
  }
  `;
}
