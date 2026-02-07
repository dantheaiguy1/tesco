// ============================================================================
// EXPANDED VARIATION MENU - Swappable shot types + Style/Mood Presets
// ============================================================================
// Users can pick from a larger library of shot types and mood presets
// to customise their 10-image generation

const VARIATION_LIBRARY = {
  // == DETAIL / CLOSE-UP SHOTS ==
  detail: {
    label: 'Detail & Close-Up',
    icon: 'fa-magnifying-glass-plus',
    shots: {
      'macro_texture': { label: 'Texture Detail', desc: 'Extreme macro showing surface quality', category: 'detail' },
      'label_branding': { label: 'Label & Branding', desc: 'Angled close-up of logos and branding', category: 'detail' },
      'construction_detail': { label: 'Construction', desc: 'Technical detail of build quality', category: 'detail' },
      'color_finish': { label: 'Color & Finish', desc: 'Surface finish under dramatic light', category: 'detail' },
      'scale_reference': { label: 'Size Reference', desc: 'Product held in hand for scale', category: 'detail' },
      'material_closeup': { label: 'Material Close-up', desc: 'Ultra close-up of material weave/grain', category: 'detail' },
      'hardware_detail': { label: 'Hardware Detail', desc: 'Zips, buttons, clasps, hinges close-up', category: 'detail' },
      'stitching_detail': { label: 'Stitching Detail', desc: 'Seam and stitching quality macro', category: 'detail' },
      'inside_view': { label: 'Inside View', desc: 'Interior/lining of the product', category: 'detail' },
      'packaging_shot': { label: 'Packaging', desc: 'Product with its packaging/box', category: 'detail' },
    }
  },
  // == HERO / STUDIO SHOTS ==
  studio: {
    label: 'Hero & Studio',
    icon: 'fa-camera',
    shots: {
      'hero_white': { label: 'Hero (White BG)', desc: 'Classic e-commerce white background', category: 'studio' },
      'hero_gradient': { label: 'Hero (Gradient)', desc: 'Product on smooth gradient background', category: 'studio' },
      'hero_dark': { label: 'Hero (Dark)', desc: 'Product on dramatic dark background', category: 'studio' },
      'three_quarter': { label: '3/4 Angle', desc: 'Classic 3/4 product angle', category: 'studio' },
      'top_down': { label: 'Top Down', desc: 'Directly overhead bird\'s-eye view', category: 'studio' },
      'side_profile': { label: 'Side Profile', desc: 'Clean side-on product profile', category: 'studio' },
      'back_view': { label: 'Back View', desc: 'Product rear showing construction', category: 'studio' },
      'multi_angle': { label: 'Multiple Angles', desc: 'Composite of 3 different angles', category: 'studio' },
      'shadow_play': { label: 'Shadow Play', desc: 'Dramatic shadow and light contrast', category: 'studio' },
      'floating': { label: 'Floating', desc: 'Product floating with soft shadow below', category: 'studio' },
    }
  },
  // == LIFESTYLE / CONTEXT SHOTS ==
  lifestyle: {
    label: 'Lifestyle & Context',
    icon: 'fa-house',
    shots: {
      'inuse_action': { label: 'In-Use Action', desc: 'Product being actively used', category: 'lifestyle' },
      'flatlay_styled': { label: 'Flat-Lay', desc: 'Top-down styled arrangement', category: 'lifestyle' },
      'environment_context': { label: 'Environment', desc: 'Product in its natural setting', category: 'lifestyle' },
      'kitchen_scene': { label: 'Kitchen Scene', desc: 'Product in a modern kitchen', category: 'lifestyle' },
      'desk_workspace': { label: 'Desk Workspace', desc: 'Product on a styled desk', category: 'lifestyle' },
      'outdoor_natural': { label: 'Outdoor Natural', desc: 'Product in outdoor/garden setting', category: 'lifestyle' },
      'cozy_home': { label: 'Cozy Home', desc: 'Product in warm home interior', category: 'lifestyle' },
      'gym_fitness': { label: 'Gym / Fitness', desc: 'Product in fitness/gym context', category: 'lifestyle' },
      'travel_adventure': { label: 'Travel', desc: 'Product in travel/adventure scene', category: 'lifestyle' },
      'seasonal_festive': { label: 'Seasonal / Festive', desc: 'Product with seasonal styling', category: 'lifestyle' },
    }
  },
  // == SOCIAL MEDIA OPTIMISED ==
  social: {
    label: 'Social Media',
    icon: 'fa-share-nodes',
    shots: {
      'instagram_aesthetic': { label: 'Instagram Aesthetic', desc: 'Pastel tones, clean layout, trendy', category: 'social' },
      'tiktok_style': { label: 'TikTok Style', desc: 'Bold, eye-catching, high contrast', category: 'social' },
      'pinterest_styled': { label: 'Pinterest Styled', desc: 'Aspirational lifestyle composition', category: 'social' },
      'unboxing_moment': { label: 'Unboxing Moment', desc: 'Fresh-from-box reveal shot', category: 'social' },
      'before_after': { label: 'Before/After Layout', desc: 'Split-screen transformation', category: 'social' },
      'gift_wrapped': { label: 'Gift Wrapped', desc: 'Product styled as a gift', category: 'social' },
    }
  }
};

// Style/Mood presets that modify the overall generation approach
const STYLE_PRESETS = {
  'default': { label: 'Default', desc: 'Clean, professional e-commerce style', modifier: '' },
  'minimalist': { label: 'Minimalist', desc: 'Ultra clean, lots of whitespace, zen', modifier: 'STYLE: Ultra minimalist. Maximum negative space. Clean lines. Zen-like simplicity. Monochromatic or very limited color palette.' },
  'luxury': { label: 'Luxury', desc: 'Premium feel, rich textures, dark backgrounds', modifier: 'STYLE: Luxury premium feel. Rich dark backgrounds. Gold accents. Velvet textures. Dramatic lighting. High-end editorial quality.' },
  'rustic': { label: 'Rustic', desc: 'Natural materials, warm tones, artisanal', modifier: 'STYLE: Rustic artisanal feel. Natural wood and linen textures. Warm earth tones. Handcrafted aesthetic. Golden hour lighting.' },
  'vibrant': { label: 'Vibrant', desc: 'Bold colors, energetic, eye-catching', modifier: 'STYLE: Vibrant and bold. Saturated colors. High energy composition. Pop art influence. Eye-catching contrasts.' },
  'editorial': { label: 'Editorial', desc: 'Magazine-quality, artistic angles', modifier: 'STYLE: High-end editorial. Magazine-quality composition. Artistic angles. Cinematic lighting. Fashion photography influence.' },
  'scandinavian': { label: 'Scandinavian', desc: 'Light woods, soft whites, hygge', modifier: 'STYLE: Scandinavian design. Light oak wood. Soft white linen. Warm grays. Hygge atmosphere. Clean and cozy.' },
  'industrial': { label: 'Industrial', desc: 'Concrete, metal, raw materials', modifier: 'STYLE: Industrial aesthetic. Concrete surfaces. Exposed metal. Raw materials. Urban loft setting. Moody lighting.' },
  'tropical': { label: 'Tropical', desc: 'Lush greens, bright, summery', modifier: 'STYLE: Tropical paradise. Lush green plants. Bright natural light. Summer vibes. Fresh and vibrant colors.' },
  'vintage': { label: 'Vintage', desc: 'Retro tones, nostalgic, film grain', modifier: 'STYLE: Vintage aesthetic. Warm faded tones. Slight film grain. Nostalgic feel. Retro props and surfaces. Analogue photography look.' },
};

// Current selected variations (defaults to the standard 10)
let selectedVariations = [
  'macro_texture', 'label_branding', 'construction_detail', 'color_finish', 'scale_reference',
  'hero_white', 'inuse_action', 'flatlay_styled', 'environment_context', 'multi_angle'
];
let selectedStyle = 'default';

/**
 * Get the variation selector panel HTML for the app page
 */
function getVariationSelectorHTML() {
  return `
    <div id="variation-selector" class="hidden" onclick="if(event.target===this)closeVariationSelector()">
      <div class="bg-white rounded-2xl shadow-lg border border-slate-100 max-w-2xl mx-auto max-h-[80vh] overflow-hidden flex flex-col" onclick="event.stopPropagation()">
        <!-- Header -->
        <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-shrink-0">
          <div>
            <h3 class="font-bold text-brand-dark text-lg">Customise Your Shots</h3>
            <p class="text-sm text-brand-gray">Pick 10 shot types and a style preset</p>
          </div>
          <button onclick="closeVariationSelector()" class="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center">
            <i class="fas fa-xmark text-brand-gray"></i>
          </button>
        </div>

        <!-- Style Presets -->
        <div class="px-6 py-3 border-b border-slate-100 flex-shrink-0">
          <label class="text-xs font-semibold text-brand-gray uppercase tracking-wide">Style Preset</label>
          <div class="flex gap-2 mt-2 overflow-x-auto pb-2" id="style-preset-row">
            ${Object.entries(STYLE_PRESETS).map(([key, preset]) => `
              <button onclick="selectStylePreset('${key}')" 
                      class="style-preset-btn flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition
                             ${key === 'default' ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-slate-200 text-brand-gray hover:border-purple-300'}"
                      data-style="${key}" title="${preset.desc}">
                ${preset.label}
              </button>
            `).join('')}
          </div>
        </div>

        <!-- Shot Types -->
        <div class="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium text-brand-dark"><span id="selected-count">10</span>/10 shots selected</span>
            <button onclick="resetVariations()" class="text-xs text-blue-500 hover:text-blue-600">Reset to defaults</button>
          </div>
          ${Object.entries(VARIATION_LIBRARY).map(([catKey, category]) => `
            <div>
              <h4 class="text-sm font-semibold text-brand-dark flex items-center gap-2 mb-2">
                <i class="fas ${category.icon} text-brand-purple text-xs"></i>
                ${category.label}
              </h4>
              <div class="grid grid-cols-2 gap-1.5">
                ${Object.entries(category.shots).map(([key, shot]) => `
                  <label class="variation-option flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition text-left
                                ${selectedVariations.includes(key) ? 'border-purple-300 bg-purple-50' : 'border-slate-100 hover:border-slate-200'}"
                         data-key="${key}">
                    <input type="checkbox" value="${key}" 
                           ${selectedVariations.includes(key) ? 'checked' : ''}
                           onchange="toggleVariation('${key}')" 
                           class="mt-0.5 accent-purple-500">
                    <div>
                      <span class="text-sm font-medium text-brand-dark">${shot.label}</span>
                      <p class="text-[11px] text-brand-gray leading-tight">${shot.desc}</p>
                    </div>
                  </label>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>

        <!-- Footer -->
        <div class="px-6 py-4 border-t border-slate-100 flex items-center justify-between flex-shrink-0 bg-white">
          <button onclick="closeVariationSelector()" class="px-4 py-2 text-sm text-brand-gray hover:text-brand-dark transition">Cancel</button>
          <button onclick="applyVariationSelection()" class="gradient-bg px-6 py-2.5 rounded-xl text-white font-semibold text-sm shadow-lg">
            <i class="fas fa-check mr-1"></i>Apply Selection
          </button>
        </div>
      </div>
    </div>`;
}

function toggleVariation(key) {
  console.log('[ShopShot] toggleVariation called:', key);
  const idx = selectedVariations.indexOf(key);
  if (idx > -1) {
    selectedVariations.splice(idx, 1);
  } else {
    if (selectedVariations.length >= 10) {
      alert('Maximum 10 shots per generation. Deselect one first.');
      // Uncheck the checkbox
      const cb = document.querySelector(`input[value="${key}"]`);
      if (cb) cb.checked = false;
      return;
    }
    selectedVariations.push(key);
  }
  updateVariationUI();
}

function selectStylePreset(key) {
  console.log('[ShopShot] selectStylePreset called:', key);
  selectedStyle = key;
  syncStylePresetUI();
}

// Robust style preset UI sync using classList instead of fragile regex replacement
function syncStylePresetUI() {
  const activeClasses = ['border-purple-500', 'bg-purple-50', 'text-purple-700'];
  const inactiveClasses = ['border-slate-200', 'text-brand-gray'];
  
  document.querySelectorAll('.style-preset-btn').forEach(btn => {
    if (btn.dataset.style === selectedStyle) {
      // Make active
      inactiveClasses.forEach(c => btn.classList.remove(c));
      activeClasses.forEach(c => btn.classList.add(c));
    } else {
      // Make inactive
      activeClasses.forEach(c => btn.classList.remove(c));
      inactiveClasses.forEach(c => btn.classList.add(c));
    }
  });
}

function updateVariationUI() {
  document.getElementById('selected-count').textContent = selectedVariations.length;
  document.querySelectorAll('.variation-option').forEach(opt => {
    const key = opt.dataset.key;
    const cb = opt.querySelector('input[type="checkbox"]');
    if (selectedVariations.includes(key)) {
      opt.classList.add('border-purple-300', 'bg-purple-50');
      opt.classList.remove('border-slate-100');
      if (cb) cb.checked = true;
    } else {
      opt.classList.remove('border-purple-300', 'bg-purple-50');
      opt.classList.add('border-slate-100');
      if (cb) cb.checked = false;
    }
  });
}

function resetVariations() {
  selectedVariations = [
    'macro_texture', 'label_branding', 'construction_detail', 'color_finish', 'scale_reference',
    'hero_white', 'inuse_action', 'flatlay_styled', 'environment_context', 'multi_angle'
  ];
  selectedStyle = 'default';
  updateVariationUI();
  syncStylePresetUI();
}

function openVariationSelector() {
  const selector = document.getElementById('variation-selector');
  if (selector) {
    selector.classList.remove('hidden');
    selector.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.7);backdrop-filter:blur(4px);z-index:10001;display:flex !important;align-items:center;justify-content:center;padding:20px;';
    updateVariationUI();
    syncStylePresetUI();
    console.log('[ShopShot] openVariationSelector - modal opened');
  }
}

function closeVariationSelector() {
  const selector = document.getElementById('variation-selector');
  if (selector) {
    // Nuclear option: force hide via every method available
    selector.style.display = 'none';
    selector.style.position = '';
    selector.style.inset = '';
    selector.style.background = '';
    selector.style.backdropFilter = '';
    selector.style.zIndex = '';
    selector.style.padding = '';
    selector.style.cssText = 'display:none !important;';
    selector.classList.add('hidden');
    console.log('[ShopShot] closeVariationSelector completed');
  }
}

function applyVariationSelection() {
  console.log('[ShopShot] applyVariationSelection called, selectedVariations:', selectedVariations.length, 'selectedStyle:', selectedStyle);
  
  if (selectedVariations.length === 0) {
    alert('Please select at least 1 shot type.');
    return;
  }
  
  // Close the modal
  const selector = document.getElementById('variation-selector');
  if (selector) {
    // Direct DOM manipulation - most reliable way to hide
    selector.style.display = 'none';
    selector.style.position = '';
    selector.style.inset = '';
    selector.style.background = '';
    selector.style.backdropFilter = '';
    selector.style.zIndex = '';
    selector.style.padding = '';
    selector.classList.add('hidden');
    console.log('[ShopShot] Modal hidden via direct style.display = none');
  }
  
  // Update the variationDefs array used by the generation engine
  if (typeof updateVariationDefs === 'function') {
    updateVariationDefs(selectedVariations, selectedStyle);
  }
  
  // Show confirmation on the customise button
  const btn = document.getElementById('customize-shots-btn');
  if (btn) {
    const label = btn.querySelector('span') || btn;
    const orig = label.textContent;
    const styleName = STYLE_PRESETS[selectedStyle]?.label || 'Default';
    label.textContent = `✓ ${selectedVariations.length} shots · ${styleName}`;
    btn.style.borderColor = '#8B5CF6';
    btn.style.background = '#F5F3FF';
    setTimeout(() => {
      label.textContent = orig;
      btn.style.borderColor = '';
      btn.style.background = '';
    }, 3000);
  }
}

// Get the active style modifier for prompt injection
function getActiveStyleModifier() {
  return STYLE_PRESETS[selectedStyle]?.modifier || '';
}

// Get the full shot library for prompt lookup 
function getExpandedPrompts(productName, productSize) {
  const base = {
    // Detail shots
    'material_closeup': `Professional product photography: ultra close-up macro shot of the ${productName} material. Focus on the grain, weave, or texture pattern. Dramatic side lighting. Shallow depth of field.`,
    'hardware_detail': `Professional product photography: extreme close-up of ${productName} hardware details - zips, buttons, clasps, hinges. Side lighting highlighting metallic finish. Dark background.`,
    'stitching_detail': `Professional product photography: macro shot of ${productName} seams and stitching. Shows quality of thread work and construction precision. Side lighting.`,
    'inside_view': `Professional product photography: interior view of ${productName} showing lining, inner pockets, or internal structure. Studio lighting on neutral background.`,
    'packaging_shot': `Professional product photography: ${productName} artfully displayed with its retail packaging or box. Styled product unboxing scene. Clean studio setting.`,
    // Studio shots
    'hero_gradient': `Professional product photography: ${productName} centered on smooth gradient background transitioning from light to dark. Soft studio lighting. Commercial catalog style.`,
    'hero_dark': `Professional product photography: ${productName} on dramatic dark/black background. Rim lighting highlighting edges. Moody luxury feel.`,
    'three_quarter': `Professional product photography: classic 3/4 angle shot of ${productName}. Shows depth and dimension. Even studio lighting. Clean white background.`,
    'top_down': `Professional product photography: directly overhead bird's-eye view of ${productName}. Flat, symmetrical composition. Even lighting, no shadows.`,
    'side_profile': `Professional product photography: exact side-on profile of ${productName}. Clean white background. Product perfectly level. Catalog documentation style.`,
    'back_view': `Professional product photography: rear view of ${productName} showing back construction, labels, ports. Clean studio background. Even lighting.`,
    'shadow_play': `Professional product photography: ${productName} with dramatic shadow and light interplay. Hard directional light creating bold geometric shadows. Artistic commercial style.`,
    'floating': `Professional product photography: ${productName} appearing to float in space with soft drop shadow below. Pure white background. Weightless, premium feel.`,
    // Social shots
    'instagram_aesthetic': `Lifestyle product photography: ${productName} in an Instagram-worthy pastel-toned scene. Soft natural lighting. Trendy props. Muted aesthetic with clean lines.`,
    'tiktok_style': `Product photography: ${productName} in a bold, high-contrast, eye-catching composition. Bright colors. Dynamic angles. Gen-Z aesthetic.`,
    'pinterest_styled': `Styled product photography: ${productName} in an aspirational Pinterest-worthy scene. Beautiful composition with complementary lifestyle props. Warm, inviting lighting.`,
    'unboxing_moment': `Product photography: ${productName} fresh from its packaging in an unboxing reveal moment. Tissue paper, box lid askew. Excitement and discovery feel.`,
    'before_after': `Product photography: split-screen composition with ${productName} in raw state on the left and styled/finished on the right. Transformation reveal.`,
    'gift_wrapped': `Product photography: ${productName} styled as a gift with tissue paper, ribbon, or bow. Gift-giving occasion setting. Warm, celebratory lighting.`,
    // Lifestyle shots
    'kitchen_scene': `Lifestyle product photography: ${productName} photographed in a bright, modern kitchen setting. Marble countertops, fresh ingredients nearby. Warm natural light.`,
    'desk_workspace': `Lifestyle product photography: ${productName} on a styled modern workspace desk. Laptop, coffee, notebook nearby. Productive, clean aesthetic.`,
    'outdoor_natural': `Lifestyle product photography: ${productName} in an outdoor natural setting. Golden hour light, grass/trees/sky visible. Fresh air feel.`,
    'cozy_home': `Lifestyle product photography: ${productName} in a warm, cozy home interior. Soft blankets, warm lighting, comfortable atmosphere.`,
    'gym_fitness': `Lifestyle product photography: ${productName} in a gym or fitness setting. Clean equipment, motivational atmosphere. Action-ready composition.`,
    'travel_adventure': `Lifestyle product photography: ${productName} in a travel/adventure context. Maps, luggage, or scenic backdrop. Wanderlust aesthetic.`,
    'seasonal_festive': `Lifestyle product photography: ${productName} styled with seasonal decor. Festive props appropriate to current season. Celebratory warm lighting.`,
  };
  return base;
}
