// ============================================================================
// EXPANDED PROMPTS - All 20 variation types with size context
// ============================================================================

export function getExpandedPrompts(productName: string, productSize: string = 'medium'): Record<string, string> {
  const lifestyleContext: Record<string, string> = {
    'tiny': 'a very small item like jewelry, a USB drive, or earbuds',
    'small': 'a pocket-sized item like a phone case, wallet, or cosmetic',
    'medium': 'a standard-sized item like a shoe, book, or water bottle',
    'large': 'a larger item like a backpack, appliance, or furniture piece'
  }
  
  const context = lifestyleContext[productSize] || lifestyleContext['medium']
  
  return {
    // === ORIGINAL 10 SHOTS ===
    'macro_texture': `Professional product photography: extreme macro close-up of the ${productName} showing surface texture and material quality. Camera positioned very close to capture material grain, weave, or micro-texture detail. Dramatic side lighting with shadows in grooves. Shallow depth of field, blurred background. High-end commercial quality.`,
    
    'label_branding': `Professional product photography: angled close-up of the ${productName} highlighting branding, logo, or text. Product tilted 30 degrees showing identifying marks clearly. Sharp focus on branding elements. Clean grey gradient studio background. Commercial catalog style.`,
    
    'construction_detail': `Professional product photography: technical detail shot of the ${productName} from side or back angle. Focus on build quality - edges, seams, buttons, ports, hinges, joints. Inspection angle revealing craftsmanship. Side lighting emphasizing depth. Documentary style.`,
    
    'color_finish': `Professional product photography: 3/4 beauty shot of the ${productName} showcasing color accuracy and surface finish. Photographed at eye level. Large soft light source creating gentle gradients across the surface. True color reproduction. Clean neutral background. Catalog-quality color reference.`,
    
    'scale_reference': `Professional product photography: the ${productName} (${context}) placed next to a common everyday object for size reference. The comparison object should be universally recognized. Clean, simple composition on a light surface. Both objects clearly visible and in focus. Commercial style.`,
    
    'hero_white': `Professional product photography: hero shot of the ${productName} on a pure white background. Product centered, perfectly lit with soft studio lighting. No shadows, clean cutout style. The product takes up 80% of the frame. This is an e-commerce main listing image. Photographic quality, not a render.`,
    
    'inuse_action': `Professional product photography: the ${productName} (${context}) being used naturally in a real-life setting. Show it in action - being held, worn, operated, or actively used by a person in context. Authentic lifestyle moment. Natural warm lighting. Aspirational but relatable. Editorial lifestyle photography quality.`,
    
    'flatlay_styled': `Professional product photography: styled flat-lay arrangement featuring the ${productName} as the hero product. Shot from directly above. Surrounded by complementary lifestyle props. Organized, intentional layout on a textured surface. Instagram-worthy styling. Natural light from above. Editorial flat-lay photography.`,
    
    'environment_context': `Professional product photography: the ${productName} (${context}) placed in a realistic interior or setting where it would naturally be used. Show the product in its intended environment. Contextual storytelling. Natural interior lighting through a window. Lifestyle editorial quality.`,
    
    'multi_angle': `Professional product photography: the ${productName} photographed from a dynamic 45-degree elevated angle. Show a perspective not seen in other shots - maybe slightly from above and to the side, revealing the top and one side. Clean studio backdrop. This completes a multi-angle product view set.`,

    // === NEW 10 SHOTS ===
    'packaging_shot': `Professional product photography: the ${productName} shown with its packaging, box, or container. Product partially emerging from or artfully arranged next to its retail packaging. Show the unboxing experience. Clean studio lighting. Premium product packaging photography. The packaging should look premium and gift-ready.`,
    
    'gift_unboxing': `Professional product photography: the ${productName} presented as a gift or in an unboxing scene. Tissue paper, ribbon, or gift box elements. Warm, inviting atmosphere. The feeling of receiving something special. Soft bokeh lights in background. Holiday gifting editorial style.`,
    
    'seasonal_holiday': `Professional product photography: the ${productName} in a festive seasonal setting. Warm fairy lights, natural greenery, cozy textures. The product is the star but the setting tells a seasonal story. Warm, inviting atmosphere perfect for holiday marketing. Editorial quality.`,
    
    'hand_held': `Professional product photography: the ${productName} (${context}) being held naturally in a person's hand or hands. Focus on the product with the hands providing scale and human connection. Clean, bright background. The grip/hold should feel natural and comfortable. Lifestyle commercial photography.`,
    
    'group_collection': `Professional product photography: the ${productName} shown as part of a curated collection or group. Multiple units or related items arranged artfully together. Suggesting a range or set. Clean studio background with subtle gradient. Catalog collection photography style.`,
    
    'infographic_layout': `Professional product photography: the ${productName} in a clean infographic-style layout. The product centered with clean white space around it for text overlay. Minimal, structured composition optimized for adding callout labels and feature text. Amazon A+ content style. Ultra-clean, graphic design-ready.`,
    
    'dark_moody': `Professional product photography: the ${productName} in a dark, moody studio setting. Rich black background with dramatic rim lighting creating elegant highlights on the product edges. Premium, high-end feel. Think luxury brand advertising. Minimal, sophisticated, cinematic quality.`,
    
    'outdoor_nature': `Professional product photography: the ${productName} (${context}) placed in a beautiful outdoor natural setting. Lush greenery, natural stone, or scenic landscape. Golden hour natural lighting. The product harmonizing with nature. Adventure/lifestyle brand photography quality.`,
    
    'minimalist_floating': `Professional product photography: the ${productName} appearing to float on a clean, gradient background. Soft shadow beneath. Minimalist composition with generous negative space. The product is isolated and elevated, creating a premium floating effect. Modern tech-brand aesthetic.`,
    
    'comparison_scale': `Professional product photography: the ${productName} (${context}) shown with visual scale indicators. Placed next to a ruler, coins, or grid for precise size communication. Technical yet aesthetically pleasing. Clean white background. Informational commercial photography for detailed product specifications.`,
  }
}
