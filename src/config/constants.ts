// ============================================================================
// SHOPSHOT CONSTANTS - Single source of truth for all configuration
// ============================================================================

export const CREDITS = {
  // Signup bonus (free tier).
  // Since Oct 2026 users choose which shots to generate and pay 1 credit per
  // image, so the grant no longer has to cover a fixed 10-image set. The
  // anonymous homepage preview is what demonstrates the product now; the
  // signup grant plus the weekly drip below is about giving people a reason
  // to come back, not a bigger one-off gift.
  SIGNUP_CHEAPER: 6,          // Free Standard credits on registration
  SIGNUP_BETTER: 2,           // Free Pro credits on registration - a taste of Pro quality

  // Free weekly drip for new accounts: DRIP_CHEAPER Standard credits on each
  // Monday (00:00 UTC) after signup, for the first DRIP_WEEKS Mondays.
  // Granted lazily on the next authenticated request - see accrueFreeDrip().
  DRIP_CHEAPER: 4,
  DRIP_WEEKS: 4,

  // Per-image costs (always 1 credit of the appropriate type)
  PER_IMAGE: 1,
  
  // 360° Video generation cost (uses cheaper credits)
  VIDEO_360: 40,              // 40 credits for 8-second 360° spin video
  
  // Subscription allocations (per month, on both monthly and annual billing).
  // Sized against COGS so gross margin stays healthy at 100% utilisation - see
  // UNIT_ECONOMICS below. Pro credits cost 3.4x Standard, so they are a
  // deliberate garnish on the lower tiers rather than a giveaway.
  STARTER_CHEAPER: 60,        // Starter: 60 standard credits/month (6 shoots)
  STARTER_BETTER: 5,          // Starter: 5 pro credits/month
  STANDARD_CHEAPER: 200,      // Standard: 200 standard credits/month (20 shoots)
  STANDARD_BETTER: 18,        // Standard: 18 pro credits/month
  PRO_CHEAPER: 600,           // Pro: 600 standard credits/month (60 shoots)
  PRO_BETTER: 60,             // Pro: 60 pro credits/month
  
  // Referral credits (both referrer and referred user get these)
  REFERRAL_CHEAPER: 5,        // 5 standard credits per successful referral
  REFERRAL_BETTER: 3,         // 3 pro credits per successful referral
  
  // Credit pack amounts (one-off top-ups), keyed by pack tier.
  //
  // Re-sized Oct 2026. The previous grants (400/800/1200/1600 Standard for
  // $25-$100) worked out at ~$0.06 per image, roughly half the per-image price
  // of the cheapest subscription, with credits that never expire. Pay-as-you-go
  // undercut every plan, so there was no reason to subscribe. Packs now carry a
  // modest premium over subscriptions instead (~$0.16-0.18 per Standard image
  // against Starter's ~$0.13), with a volume discount between pack sizes.
  // The Stripe pack prices and their dollar amounts are unchanged; only the
  // credits our webhook grants for them changed.
  PACKS: {
    CHEAPER: {
      PACK_25: 140,
      PACK_50: 290,
      PACK_75: 450,
      PACK_100: 620,
    },
    BETTER: {
      PACK_25: 41,
      PACK_50: 85,
      PACK_75: 130,
      PACK_100: 182,
    }
  }
}

// ============================================================================
// PRICES AND CURRENCY
// ============================================================================
// Two display/checkout currencies. GBP for visitors in the UK, USD for
// everyone else. Each Stripe Price object carries both currencies
// (currency_options), and create-checkout always passes the currency
// explicitly, so the currency on the page and the currency at checkout are
// decided by the same function and cannot disagree.
//
// GBP is gated behind the CURRENCY_GBP_ENABLED env flag so the site stays
// all-USD (and therefore consistent with checkout) until every Stripe price
// has had its GBP option added. See DEPLOY_CHECKLIST.md.

export type Currency = 'USD' | 'GBP';
export type PlanKey = 'starter' | 'standard' | 'pro';
export type Interval = 'month' | 'year';
export type PackTier = 25 | 50 | 75 | 100;

// Annual is 10x monthly, rounded down to a whole unit ("two months free").
// GBP figures are set at UK price points rather than converted to the penny.
export const PLAN_PRICES: Record<Currency, Record<PlanKey, Record<Interval, number>>> = {
  USD: {
    starter:  { month: 9.99,  year: 99 },
    standard: { month: 29.99, year: 299 },
    pro:      { month: 79.99, year: 799 },
  },
  GBP: {
    starter:  { month: 7.99,  year: 79 },
    standard: { month: 24.99, year: 249 },
    pro:      { month: 64.99, year: 649 },
  },
};

export const PACK_TIERS: PackTier[] = [25, 50, 75, 100];

export const PACK_PRICES: Record<Currency, Record<PackTier, number>> = {
  USD: { 25: 25, 50: 50, 75: 75, 100: 100 },
  GBP: { 25: 20, 50: 40, 75: 60, 100: 80 },
};

export const CURRENCY_SYMBOL: Record<Currency, string> = { USD: '$', GBP: '£' };

/**
 * The currency a visitor sees and pays in. Logged-in users keep the currency
 * recorded at signup, so they see the same prices on every device and network.
 * Everyone else is decided by Cloudflare's CF-IPCountry header.
 */
export function resolveCurrency(opts: { gbpEnabled: boolean; country?: string | null; userCurrency?: string | null }): Currency {
  if (!opts.gbpEnabled) return 'USD';
  if (opts.userCurrency === 'GBP' || opts.userCurrency === 'USD') return opts.userCurrency;
  return opts.country === 'GB' ? 'GBP' : 'USD';
}

/** "$9.99", "£7.99", "$99", "£79" - whole amounts drop the pence. */
export function formatMoney(amount: number, currency: Currency): string {
  const sym = CURRENCY_SYMBOL[currency];
  return Number.isInteger(amount) ? `${sym}${amount}` : `${sym}${amount.toFixed(2)}`;
}

export function planPrice(currency: Currency, plan: PlanKey, interval: Interval = 'month'): string {
  return formatMoney(PLAN_PRICES[currency][plan][interval], currency);
}

export function packPrice(currency: Currency, tier: PackTier): string {
  return formatMoney(PACK_PRICES[currency][tier], currency);
}

/** Whole shoots a Standard credit allowance buys, at IMAGES_PER_SHOOT per shoot. */
export function shootsFor(cheaperCredits: number): number {
  return Math.floor(cheaperCredits / IMAGES_PER_SHOOT);
}

// Legacy USD-only view of PLAN_PRICES, kept for the few server-side uses that
// genuinely mean USD (unit-economics maths). Do not use for anything a visitor
// sees - use planPrice() with the resolved currency instead.
export const PRICING = {
  STARTER: PLAN_PRICES.USD.starter.month,
  STANDARD: PLAN_PRICES.USD.standard.month,
  PRO: PLAN_PRICES.USD.pro.month,
  STARTER_ANNUAL: PLAN_PRICES.USD.starter.year,
  STANDARD_ANNUAL: PLAN_PRICES.USD.standard.year,
  PRO_ANNUAL: PLAN_PRICES.USD.pro.year,
  PACK_25: PACK_PRICES.USD[25],
  PACK_50: PACK_PRICES.USD[50],
  PACK_75: PACK_PRICES.USD[75],
  PACK_100: PACK_PRICES.USD[100],
}

// First-month discount, promoted in the paywall modal. Must be a percent-off
// coupon in Stripe: a fixed-amount coupon only works in its own currency and
// would stop applying the moment a GBP checkout uses it.
export const WELCOME_COUPON = { CODE: 'WELCOME20', PERCENT_OFF: 20 };

// Months of allocation you pay for on an annual plan. 10 of 12 = 16.7% off.
export const ANNUAL_MONTHS_CHARGED = 10;
export const ANNUAL_DISCOUNT_PCT = Math.round((1 - ANNUAL_MONTHS_CHARGED / 12) * 100);

// ============================================================================
// UNIT ECONOMICS - the basis for every number above
// ============================================================================
// Keep these current. If Google changes image pricing, the plan allocations
// need revisiting, and this is the only place that records why they are what
// they are.
export const UNIT_COST_USD = {
  CHEAPER_IMAGE: 0.039,       // gemini-2.5-flash-image
  BETTER_IMAGE: 0.134,        // gemini-3-pro-image-preview
  STRIPE_PCT: 0.029,
  STRIPE_FIXED: 0.30,
};

/** Monthly COGS of a plan's full allocation, at 100% utilisation. */
export function planCogs(cheaper: number, better: number): number {
  return cheaper * UNIT_COST_USD.CHEAPER_IMAGE + better * UNIT_COST_USD.BETTER_IMAGE;
}

/** Gross margin of a plan at 100% utilisation, after Stripe fees. */
export function planGrossMargin(priceUsd: number, cheaper: number, better: number, months = 1): number {
  const net = priceUsd - (priceUsd * UNIT_COST_USD.STRIPE_PCT + UNIT_COST_USD.STRIPE_FIXED);
  const cogs = planCogs(cheaper, better) * months;
  return (net - cogs) / net;
}

// At 100% utilisation, after Stripe fees:
//   Free       6 std + 2 pro, plus 4 std/week x4  COGS $1.13 max (acquisition cost)
//   Starter   $9.99   60 std +  5 pro         COGS $3.01   GM ~68%   $0.154/image
//   Standard  $29.99 200 std + 18 pro         COGS $10.21  GM ~65%   $0.138/image
//   Pro       $79.99 600 std + 60 pro         COGS $31.44  GM ~59%   $0.121/image
// Per-image price falls as the tier rises, so volume is rewarded, while margin
// stays in a defensible band instead of collapsing to 5% at the top as it did
// under the previous $59.99 / 800+175 Pro plan.

// ============================================================================
// MARKETPLACE EXPORT PRESETS
// ============================================================================
export const MARKETPLACE_PRESETS = {
  ebay: {
    name: 'eBay',
    icon: '🛍️',
    formats: [
      { name: 'Main Image', width: 1600, height: 1600, bgColor: '#FFFFFF', format: 'jpeg' as const },
      { name: 'Gallery', width: 1200, height: 1200, bgColor: null, format: 'jpeg' as const },
    ]
  },
  etsy: {
    name: 'Etsy',
    icon: '🧶',
    formats: [
      { name: 'Listing Photo', width: 2000, height: 2000, bgColor: null, format: 'jpeg' as const },
    ]
  },
  amazon: {
    name: 'Amazon',
    icon: '📦',
    formats: [
      { name: 'Main (White BG)', width: 2000, height: 2000, bgColor: '#FFFFFF', format: 'jpeg' as const },
      { name: 'Lifestyle', width: 2000, height: 2000, bgColor: null, format: 'jpeg' as const },
    ]
  },
  depop: {
    name: 'Depop / Vinted',
    icon: '👗',
    formats: [
      { name: 'Portrait', width: 1080, height: 1350, bgColor: null, format: 'jpeg' as const },
    ]
  },
  shopify: {
    name: 'Shopify',
    icon: '🛒',
    formats: [
      { name: 'Product Image', width: 2048, height: 2048, bgColor: null, format: 'png' as const },
    ]
  },
  instagram: {
    name: 'Instagram',
    icon: '📸',
    formats: [
      { name: 'Square Post', width: 1080, height: 1080, bgColor: null, format: 'jpeg' as const },
      { name: 'Story/Reel', width: 1080, height: 1920, bgColor: null, format: 'jpeg' as const },
    ]
  },
  facebook: {
    name: 'Facebook',
    icon: '👍',
    formats: [
      { name: 'Ad Image', width: 1200, height: 628, bgColor: null, format: 'jpeg' as const },
    ]
  },
  tiktok: {
    name: 'TikTok Shop',
    icon: '🎵',
    formats: [
      { name: 'Product Image', width: 1080, height: 1080, bgColor: '#FFFFFF', format: 'jpeg' as const },
    ]
  },
  general: {
    name: 'HD Download',
    icon: '💎',
    formats: [
      { name: 'High Resolution', width: 2000, height: 2000, bgColor: null, format: 'png' as const },
    ]
  }
}

// ============================================================================
// VARIATION DEFINITIONS - Full menu of available shot types
// ============================================================================
export const ALL_VARIATION_TYPES = [
  // Original 10 (default set)
  { field: 'macro_texture', label: 'Texture Detail', icon: '🔍', category: 'detail', default: true },
  { field: 'label_branding', label: 'Label & Branding', icon: '🏷️', category: 'detail', default: true },
  { field: 'construction_detail', label: 'Construction Detail', icon: '🔧', category: 'detail', default: true },
  { field: 'color_finish', label: 'Color & Finish', icon: '🎨', category: 'detail', default: true },
  { field: 'scale_reference', label: 'Size Reference', icon: '📏', category: 'detail', default: true },
  { field: 'hero_white', label: 'Hero (White BG)', icon: '⬜', category: 'studio', default: true },
  { field: 'inuse_action', label: 'In-Use Action', icon: '🏃', category: 'lifestyle', default: true },
  { field: 'flatlay_styled', label: 'Flat-Lay Styled', icon: '📐', category: 'lifestyle', default: true },
  { field: 'environment_context', label: 'Environment Context', icon: '🌿', category: 'lifestyle', default: true },
  { field: 'multi_angle', label: 'Multiple Angles', icon: '🔄', category: 'studio', default: true },
  
  // NEW additions (users can swap these in)
  { field: 'packaging_shot', label: 'Packaging Shot', icon: '📦', category: 'detail', default: false },
  { field: 'gift_unboxing', label: 'Gift / Unboxing', icon: '🎁', category: 'lifestyle', default: false },
  { field: 'seasonal_holiday', label: 'Seasonal / Holiday', icon: '🎄', category: 'lifestyle', default: false },
  { field: 'hand_held', label: 'Hand-Held / In-Hand', icon: '🤲', category: 'lifestyle', default: false },
  { field: 'group_collection', label: 'Group / Collection', icon: '🗂️', category: 'studio', default: false },
  { field: 'infographic_layout', label: 'Infographic Layout', icon: '📊', category: 'studio', default: false },
  { field: 'dark_moody', label: 'Dark / Moody Studio', icon: '🌑', category: 'studio', default: false },
  { field: 'outdoor_nature', label: 'Outdoor / Nature', icon: '🌳', category: 'lifestyle', default: false },
  { field: 'minimalist_floating', label: 'Minimalist Floating', icon: '✨', category: 'studio', default: false },
  { field: 'comparison_scale', label: 'Comparison Scale', icon: '⚖️', category: 'detail', default: false },
]

// ============================================================================
// STYLE PRESETS - Mood/aesthetic modifiers for prompts
// ============================================================================
export const STYLE_PRESETS = [
  {
    id: 'default',
    name: 'Clean Studio',
    icon: '⬜',
    description: 'Professional white/grey backgrounds',
    promptModifier: '',
    preview: '/static/styles/clean-studio.jpg'
  },
  {
    id: 'rustic',
    name: 'Rustic Warmth',
    icon: '🪵',
    description: 'Wood textures, warm tones, craft market',
    promptModifier: 'Use a warm rustic aesthetic with natural wood surfaces, warm amber lighting, craft-market feel, organic textures like burlap and dried flowers.',
    preview: '/static/styles/rustic.jpg'
  },
  {
    id: 'minimal',
    name: 'Modern Minimal',
    icon: '◻️',
    description: 'Geometric shapes, muted tones, editorial',
    promptModifier: 'Use a modern minimalist aesthetic with geometric shapes, muted neutral tones, clean lines, editorial magazine style, ample negative space.',
    preview: '/static/styles/minimal.jpg'
  },
  {
    id: 'luxury',
    name: 'Luxury Dark',
    icon: '🖤',
    description: 'Black backgrounds, dramatic lighting',
    promptModifier: 'Use a luxury dark aesthetic with rich black backgrounds, dramatic rim lighting, gold accents, premium feel, high-end catalog style.',
    preview: '/static/styles/luxury.jpg'
  },
  {
    id: 'nature',
    name: 'Nature / Organic',
    icon: '🌿',
    description: 'Plants, earth tones, natural textures',
    promptModifier: 'Use a natural organic aesthetic with lush green plants, earth tones, stone and terracotta surfaces, soft natural daylight, botanical feel.',
    preview: '/static/styles/nature.jpg'
  },
  {
    id: 'urban',
    name: 'Urban Street',
    icon: '🏙️',
    description: 'Concrete, brick, industrial vibes',
    promptModifier: 'Use an urban street aesthetic with concrete textures, exposed brick walls, industrial metal elements, raw street-style energy, warehouse feel.',
    preview: '/static/styles/urban.jpg'
  },
  {
    id: 'summer',
    name: 'Summer Vibes',
    icon: '☀️',
    description: 'Bright, airy, sunshine, outdoor',
    promptModifier: 'Use a bright summer aesthetic with natural sunlight, airy feel, light pastel backgrounds, fresh flowers, beach or garden elements.',
    preview: '/static/styles/summer.jpg'
  },
  {
    id: 'christmas',
    name: 'Christmas / Holiday',
    icon: '🎄',
    description: 'Festive, warm lights, gift-wrapped',
    promptModifier: 'Use a festive Christmas aesthetic with warm fairy lights, red and green accents, pine branches, gift wrapping elements, cozy winter atmosphere.',
    preview: '/static/styles/christmas.jpg'
  },
  {
    id: 'pastel',
    name: 'Pastel Dream',
    icon: '🩷',
    description: 'Soft pastels, feminine, beauty',
    promptModifier: 'Use a soft pastel aesthetic with pale pink, lavender, and mint tones, dreamy soft focus elements, silk textures, feminine beauty style.',
    preview: '/static/styles/pastel.jpg'
  },
  {
    id: 'bold',
    name: 'Bold & Vibrant',
    icon: '🎯',
    description: 'Saturated colors, energetic, pop art',
    promptModifier: 'Use a bold vibrant aesthetic with highly saturated colors, energetic composition, pop art influence, dynamic color blocks, eye-catching contrast.',
    preview: '/static/styles/bold.jpg'
  },
]

// Quick preset combinations for variation selection
export const VARIATION_QUICK_PRESETS = {
  'default': {
    name: 'All Defaults',
    description: 'The original 10-shot set',
    variations: ['macro_texture', 'label_branding', 'construction_detail', 'color_finish', 'scale_reference', 'hero_white', 'inuse_action', 'flatlay_styled', 'environment_context', 'multi_angle']
  },
  'ebay_optimized': {
    name: 'eBay Optimized',
    description: 'Best for eBay listings',
    variations: ['hero_white', 'macro_texture', 'label_branding', 'scale_reference', 'construction_detail', 'multi_angle', 'inuse_action', 'packaging_shot', 'flatlay_styled', 'infographic_layout']
  },
  'social_media': {
    name: 'Social Media Pack',
    description: 'Lifestyle-heavy for social',
    variations: ['hero_white', 'inuse_action', 'flatlay_styled', 'environment_context', 'hand_held', 'gift_unboxing', 'outdoor_nature', 'minimalist_floating', 'dark_moody', 'color_finish']
  },
  'detailed_product': {
    name: 'Detailed Product',
    description: 'Maximum product detail',
    variations: ['hero_white', 'macro_texture', 'label_branding', 'construction_detail', 'color_finish', 'scale_reference', 'multi_angle', 'packaging_shot', 'comparison_scale', 'infographic_layout']
  },
  'lifestyle_focus': {
    name: 'Lifestyle Focus',
    description: 'Context-rich lifestyle shots',
    variations: ['hero_white', 'inuse_action', 'flatlay_styled', 'environment_context', 'hand_held', 'outdoor_nature', 'gift_unboxing', 'seasonal_holiday', 'group_collection', 'minimalist_floating']
  }
}

// ============================================================================
// BATCH PROCESSING CONFIG
// ============================================================================
export const BATCH_CONFIG = {
  MAX_ITEMS: 20,
  MAX_FILE_SIZE_MB: 20,
  SUPPORTED_FORMATS: ['image/jpeg', 'image/png', 'image/webp'],
}

// ============================================================================
// DERIVED VALUES - use these in copy so marketing text can never drift
// from the actual grant again.
// ============================================================================
export const SIGNUP_CREDITS_TOTAL = CREDITS.SIGNUP_CHEAPER + CREDITS.SIGNUP_BETTER;
export const REFERRAL_CREDITS_TOTAL = CREDITS.REFERRAL_CHEAPER + CREDITS.REFERRAL_BETTER;
export const IMAGES_PER_SHOOT = 10;
