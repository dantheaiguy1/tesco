-- ShopShot Social Media Command Centre - Seed Data
-- Created: December 5, 2025

-- Insert platform connections (GetLate account IDs)
INSERT OR REPLACE INTO platform_connections (account_type, platform, social_network_key, is_connected) VALUES
('shopshot', 'instagram', '692dc17af43160a0bc999b2f', 1),
('shopshot', 'twitter', '692dc345f43160a0bc999b35', 1),
('shopshot', 'youtube', '692dc20df43160a0bc999b32', 1);

-- Insert content pillars for ShopShot
INSERT OR REPLACE INTO content_pillars (name, short_code, description, color, sort_order) VALUES
('Product Demo', 'DEMO', 'Show ShopShot in action - before/after, speed demos, quality comparisons', '#22c55e', 1),
('Tips & Education', 'TIPS', 'Product photography tips, e-commerce advice, best practices', '#3b82f6', 2),
('Behind the Scenes', 'BTS', 'Founder story, building in public, development updates', '#a855f7', 3),
('Social Proof', 'PROOF', 'Customer results, testimonials, case studies, success stories', '#f97316', 4),
('Problem/Solution', 'PROB', 'Pain points of traditional photography, why ShopShot exists', '#ef4444', 5),
('Launch & Promo', 'LAUNCH', 'Launch countdown, special offers, feature announcements', '#14b8a6', 6);

-- Insert voice profile for ShopShot
INSERT OR REPLACE INTO voice_profiles (account_type, voice_name, voice_description, tone, style, example_captions) VALUES
('shopshot', 'ShopShot Official', 
'ShopShot is the AI product photography tool that turns one photo into 10 professional variations in 25 seconds. Founded by Daniel Nicholls, solo bootstrapped founder from East Sussex, UK. We speak directly, back claims with data, and call out industry BS. We spent £12k on photographers once and got worse conversion rates - never again. No emojis. No corporate speak. No "unlock your potential" nonsense. Just straight talk about saving money and time on product photography.',
'Direct, confident, slightly witty, data-backed, founder-authentic',
'Short punchy sentences. Active voice. Specific numbers over vague claims. Challenge industry norms. Self-deprecating humor when appropriate. British spelling.',
'["Most sellers spend £500 per product photoshoot. I spent £12k once and got worse conversion rates. Never again.", "Your product photos shouldnt look like an AI fever dream. Heres how to fix that.", "Amazon rejected your main image again? Yeah, because the background isnt pure white. ShopShot does compliance by default.", "Traditional photography: £500/product, 3-week wait. ShopShot: £0.80/product, 25 seconds. Do the math."]'
);

-- Insert core brand knowledge sections
INSERT OR REPLACE INTO brand_knowledge (section, content, priority, source) VALUES
('brand_identity', 'ShopShot is an AI-powered product photography SaaS tool. One photo in, 10 professional variations out, in 25 seconds. Founded by Daniel David Peter Nichols (Superman) from Burwash, East Sussex, UK. Launched December 2025. Solo founder, bootstrapped. Mission: Democratize professional product photography for e-commerce sellers.', 1, 'manual'),

('value_proposition', 'Old Way: £400-600 per photographer shoot, 10 products max, 2-3 week turnaround. ShopShot: £39.99-59.99/month, unlimited products, 25 seconds per product. Cost savings: 95%+ reduction. Time savings: weeks to seconds. £500/product vs £0.80/product.', 1, 'manual'),

('target_audience', 'Primary: E-commerce sellers on Shopify, Amazon, eBay, Etsy, WooCommerce. Secondary: Marketing agencies, product designers, small brands. Geographic: Global, English-language focus, UK-first pricing in GBP.', 1, 'manual'),

('pricing_plans', 'Free Plan: Limited credits, test both AI models, no credit card required. Standard Plan: £39.99/month, ~500 credits (~50 products), credit rollover up to 1000. Pro Plan: £59.99/month, ~470 credits, 4x more Pro model access, priority support. Credit Packs: £25-100 one-time, never expire.', 1, 'manual'),

('product_features', '10 variations per product (white background, lifestyle, detail shots, size reference). 3D rotating video included. Dual AI models: Standard (2-3 sec, great quality) and Pro (60-90 sec, best quality). Individual image regeneration (1 credit). Credit rollover (2x plan limit). High-res downloads, full commercial rights.', 1, 'manual'),

('founder_story', 'Daniel spent £12k on product photography once and got worse conversion rates than DIY phone photos. That sparked the idea. Built ShopShot MVP in about a week using AI coding tools. Serial tech entrepreneur, fitness devotee, based in rural East Sussex. Building in public, bootstrapped, no VC money.', 1, 'manual'),

('voice_rules', 'NO emojis in captions. NO em dashes (use regular hyphens). NO exclamation marks unless genuine surprise. NO buzzwords: revolutionary, game-changing, disrupting, unlocking potential. YES to specifics: numbers, examples, named pain points. YES to contractions. British spelling.', 1, 'manual'),

('banned_phrases', 'Are you ready? Take your business to the next level. Crush your goals. Game changer. Revolutionary. Disrupting. Unlock your potential. Excited to announce. Thrilled to share. Our cutting-edge technology. Join thousands of satisfied customers.', 1, 'manual'),

('competitors', 'Traditional photographers: £400-600/shoot, 2-3 week turnaround, 10 products max. Pebblely: $19-99/month, 40-1000 credits. PhotoRoom: Background removal focus, $9.99/month. Canva: General design tool, not product photography specific.', 1, 'manual'),

('key_stats', 'Cost per product: £0.80 (Standard plan). Generation time: 25 seconds for 10 images. Savings vs photographer: 95%+. Annual savings example: £9,520 for 200 products. Target: 250 paying users = £10k MRR.', 1, 'manual'),

('launch_info', 'Soft launch: December 2025. Official launch: January 1, 2026. Currently live at shopshot.co.uk. Pre-launch focus: Build anticipation, early signups, founder story content.', 1, 'manual'),

('platform_specs', 'Instagram: 1:1 aspect ratio, 2200 char max. X/Twitter: 16:9 aspect ratio, 280 char max. YouTube Shorts: 9:16 aspect ratio, video only, 5000 char max.', 1, 'manual');
