// ============================================================================
// BEFORE/AFTER COMPARISON SLIDER
// ============================================================================
// Drag slider to compare original vs generated images side by side

function getComparisonSliderCSS() {
  return `
    .comparison-container {
      position: relative;
      width: 100%;
      max-width: 600px;
      margin: 0 auto;
      overflow: hidden;
      border-radius: 12px;
      cursor: col-resize;
      touch-action: none;
      user-select: none;
    }
    .comparison-container img {
      display: block;
      width: 100%;
      height: auto;
      pointer-events: none;
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
      object-fit: cover;
    }
    .comparison-slider-line {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 3px;
      background: white;
      z-index: 10;
      box-shadow: 0 0 8px rgba(0,0,0,0.3);
    }
    .comparison-slider-handle {
      position: absolute;
      top: 50%;
      transform: translate(-50%, -50%);
      width: 44px;
      height: 44px;
      background: white;
      border-radius: 50%;
      box-shadow: 0 2px 12px rgba(0,0,0,0.25);
      z-index: 11;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .comparison-slider-handle::before {
      content: '';
      width: 0;
      height: 0;
      border-top: 6px solid transparent;
      border-bottom: 6px solid transparent;
      border-right: 8px solid #6366F1;
      margin-right: 4px;
    }
    .comparison-slider-handle::after {
      content: '';
      width: 0;
      height: 0;
      border-top: 6px solid transparent;
      border-bottom: 6px solid transparent;
      border-left: 8px solid #6366F1;
      margin-left: 4px;
    }
    .comparison-label {
      position: absolute;
      top: 12px;
      padding: 4px 12px;
      background: rgba(0,0,0,0.6);
      color: white;
      font-size: 12px;
      font-weight: 600;
      border-radius: 20px;
      z-index: 5;
      pointer-events: none;
    }
    .comparison-label-before { left: 12px; }
    .comparison-label-after { right: 12px; }
  `;
}

/**
 * Create a comparison slider between two images
 * @param {string} containerId - ID of the container element
 * @param {string} beforeSrc - base64/URL of the "before" image (original)
 * @param {string} afterSrc - base64/URL of the "after" image (generated)
 * @param {string} beforeLabel - Label for before image
 * @param {string} afterLabel - Label for after image
 */
function createComparisonSlider(containerId, beforeSrc, afterSrc, beforeLabel, afterLabel) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div class="comparison-container" id="${containerId}-slider">
      <img src="${beforeSrc}" alt="${beforeLabel || 'Original'}" draggable="false">
      <div class="comparison-after" id="${containerId}-after">
        <img src="${afterSrc}" alt="${afterLabel || 'Generated'}" draggable="false">
      </div>
      <div class="comparison-slider-line" id="${containerId}-line"></div>
      <div class="comparison-slider-handle" id="${containerId}-handle"></div>
      <span class="comparison-label comparison-label-before">${beforeLabel || 'Original'}</span>
      <span class="comparison-label comparison-label-after">${afterLabel || 'Generated'}</span>
    </div>
  `;

  const slider = document.getElementById(`${containerId}-slider`);
  const afterEl = document.getElementById(`${containerId}-after`);
  const lineEl = document.getElementById(`${containerId}-line`);
  const handleEl = document.getElementById(`${containerId}-handle`);
  
  let isDragging = false;
  let sliderPos = 0.5; // Start at 50%

  function updatePosition(x) {
    const rect = slider.getBoundingClientRect();
    sliderPos = Math.max(0.02, Math.min(0.98, (x - rect.left) / rect.width));
    const pct = sliderPos * 100;
    afterEl.style.clipPath = `inset(0 0 0 ${pct}%)`;
    lineEl.style.left = `${pct}%`;
    handleEl.style.left = `${pct}%`;
  }

  // Initial position
  requestAnimationFrame(() => {
    updatePosition(slider.getBoundingClientRect().left + slider.getBoundingClientRect().width * 0.5);
  });

  // Mouse events
  slider.addEventListener('mousedown', (e) => {
    isDragging = true;
    updatePosition(e.clientX);
  });
  document.addEventListener('mousemove', (e) => {
    if (isDragging) {
      e.preventDefault();
      updatePosition(e.clientX);
    }
  });
  document.addEventListener('mouseup', () => { isDragging = false; });

  // Touch events
  slider.addEventListener('touchstart', (e) => {
    isDragging = true;
    updatePosition(e.touches[0].clientX);
  });
  document.addEventListener('touchmove', (e) => {
    if (isDragging) {
      e.preventDefault();
      updatePosition(e.touches[0].clientX);
    }
  }, { passive: false });
  document.addEventListener('touchend', () => { isDragging = false; });
}

/**
 * Open comparison modal between original and a selected generated image
 */
function openComparisonModal(originalSrc, generatedSrc, generatedLabel) {
  // Remove existing modal
  const existing = document.getElementById('comparison-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'comparison-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.95);backdrop-filter:blur(8px);z-index:60;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;';
  
  modal.innerHTML = `
    <button onclick="document.getElementById('comparison-modal').remove()" 
            style="position:absolute;top:16px;right:16px;width:40px;height:40px;background:rgba(255,255,255,0.15);border:none;border-radius:50%;color:white;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:65;">
      <i class="fas fa-xmark"></i>
    </button>
    <h3 style="color:white;font-size:18px;font-weight:600;margin-bottom:16px;">
      <i class="fas fa-arrows-left-right" style="margin-right:8px;color:#8B5CF6;"></i>
      Compare: Original vs ${generatedLabel || 'Generated'}
    </h3>
    <div id="comparison-slider-container" style="width:100%;max-width:600px;"></div>
    <p style="color:rgba(255,255,255,0.5);font-size:12px;margin-top:12px;">Drag the slider to compare</p>
  `;

  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  document.body.appendChild(modal);

  // Inject CSS if not already present
  if (!document.getElementById('comparison-slider-css')) {
    const style = document.createElement('style');
    style.id = 'comparison-slider-css';
    style.textContent = getComparisonSliderCSS();
    document.head.appendChild(style);
  }

  // Create the slider
  createComparisonSlider('comparison-slider-container', originalSrc, generatedSrc, 'Original', generatedLabel);
}
