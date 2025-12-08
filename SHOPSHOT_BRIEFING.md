# ShopShot - Complete Technical Briefing Document

**Document Version:** 1.0  
**Last Updated:** December 2024  
**Purpose:** Comprehensive system documentation for AI assistants and developers  
**Live URL:** https://www.shopshot.co.uk  
**GitHub:** https://github.com/dantheaiguy1/tesco

---

## 1. Executive Summary

ShopShot is an AI-powered e-commerce product photography platform that transforms single product images into professional marketing assets. The application generates 10 unique product variations (5 detail shots + 5 lifestyle shots) using Google's Vertex AI image generation models, plus optional 360-degree product spin videos using Veo 3.

### Core Value Proposition
- **Problem:** Professional product photography costs £2,500+ and takes weeks
- **Solution:** AI-generated product images in under 60 seconds for £0.03-0.10 per image
- **Target Users:** E-commerce sellers, Shopify store owners, Amazon FBA sellers, small businesses

---

## 2. Technology Stack

### Frontend
- **Framework:** Hono (lightweight, Cloudflare-optimized)
- **Styling:** TailwindCSS (via CDN)
- **Icons:** Font Awesome 6.4
- **No build-time frontend framework** - all pages are server-rendered HTML with inline JavaScript

### Backend
- **Runtime:** Cloudflare Workers (edge deployment)
- **Framework:** Hono v4.x
- **Database:** Cloudflare D1 (SQLite-based)
- **Storage:** Cloudflare R2 (S3-compatible object storage)
- **Language:** TypeScript (single 22,000-line index.tsx file)

### External Services
| Service | Purpose | Binding Name |
|---------|---------|--------------|
| Google Vertex AI | Image generation (Gemini models) | `VERTEX_*` credentials |
| Google Veo 3 | 360° video generation | Same Vertex credentials |
| Stripe | Payments, subscriptions | `STRIPE_*` keys |
| Resend | Transactional emails | `RESEND_API_KEY` |
| Google OAuth | Social login | `GOOGLE_CLIENT_*` |
| GetLate.dev | Social media publishing | `LATE_API_KEY` |
| ElevenLabs | Voice synthesis (reserved) | `ELEVENLABS_API_KEY` |
| Pexels | Stock content (reserved) | `PEXELS_API_KEY` |

---

## 3. Dual Credit System

ShopShot operates a dual-credit economy with two distinct credit types:

### Credit Types
| Type | Model Used | API Cost | Use Case |
|------|------------|----------|----------|
| **Cheaper Credits** | Nano Banana (gemini-2.5-flash-image) | £0.031/credit | Fast generation, bulk work |
| **Better Credits** | Nano Banana Pro (gemini-3-pro-image-preview) | £0.107/credit | Premium quality |

### Credit Allocation
```javascript
CREDITS = {
  // Free signup bonus
  SIGNUP_CHEAPER: 10,
  SIGNUP_BETTER: 5,
  
  // Per-image cost
  PER_IMAGE: 1,
  
  // 360° Video (uses cheaper credits)
  VIDEO_360: 40,
  
  // Subscription monthly allocations
  STANDARD_CHEAPER: 500,  // £39.99/month
  STANDARD_BETTER: 45,
  PRO_CHEAPER: 300,       // £59.99/month
  PRO_BETTER: 175,
}
```

### Credit Packs (One-time purchases)
| Price | Cheaper Credits | Better Credits |
|-------|-----------------|----------------|
| £25 | 400 | 115 |
| £50 | 800 | 230 |
| £75 | 1,200 | 350 |
| £100 | 1,600 | 465 |

---

## 4. Image Generation System

### The 10-Variation Framework
ShopShot generates 10 strategic product variations per session:

**Detail Shots (1-5) - Trust Building, Return Reduction:**
1. **Macro Texture** - Close-up material/surface quality
2. **Label & Branding** - Product labels, tags, branding elements
3. **Construction Detail** - Stitching, joints, build quality
4. **Color & Finish** - True color representation, finish type
5. **Size Reference** - Scale context (hand, coin, ruler)

**Lifestyle Shots (6-10) - Conversion Driving:**
6. **Hero (White BG)** - Clean e-commerce standard shot
7. **In-Use Action** - Product being used naturally
8. **Flat-Lay Styled** - Overhead arrangement with props
9. **Environment Context** - Product in natural setting
10. **Multiple Angles** - Various viewpoints composite

### Generation Flow
```
User Upload → Session Created → Model Selection → 
→ Generate 10 Variations (parallel) → Deduct Credits → 
→ Save to D1 Database (base64) → Display Results
```

### Brand Colors Feature
Users can save 5 brand colors to their account. These are injected into AI prompts to ensure generated images incorporate brand-appropriate color palettes for props, backgrounds, and styling elements.

---

## 5. 360° Video Generation (Veo 3)

### How It Works
1. User uploads product image
2. System detects aspect ratio (must be 16:9 or 9:16 for Veo)
3. Background removal via Gemini (if needed)
4. Veo 3 generates 8-second rotating product video
5. Video stored and linked to session

### Cost
- 40 cheaper credits per video (~£1.24 internal cost)
- Only available to authenticated users with sufficient credits

### Technical Details
- Uses Google's Veo 3 model via Vertex AI
- Supports 16:9 (landscape) and 9:16 (portrait) aspect ratios
- 8-second duration (fixed)
- MP4 output format

---

## 6. Database Schema

### Core Tables

**users**
```sql
- id (TEXT PRIMARY KEY)
- email (TEXT UNIQUE)
- password_hash (TEXT)
- name (TEXT)
- cheaper_credits (INTEGER DEFAULT 10)
- better_credits (INTEGER DEFAULT 5)
- subscription_status ('free'|'active'|'canceled'|'past_due')
- subscription_plan ('free'|'standard'|'pro')
- stripe_customer_id (TEXT)
- role ('user'|'admin')
- email_verified (INTEGER)
- google_id (TEXT) - for OAuth users
```

**sessions**
```sql
- id (TEXT PRIMARY KEY)
- user_id (TEXT)
- product_name (TEXT)
- source_type ('upload'|'url')
- original_image (TEXT) - base64
- status ('pending'|'generating'|'completed'|'failed')
- model ('nano'|'flash')
- credits_charged (INTEGER)
- brand_colors (TEXT) - JSON array
```

**generated_images**
```sql
- id (INTEGER PRIMARY KEY)
- session_id (TEXT)
- variation_type (TEXT)
- variation_index (INTEGER)
- image_data (TEXT) - base64
- model (TEXT)
```

**generated_videos**
```sql
- id (TEXT PRIMARY KEY)
- user_id (TEXT)
- session_id (TEXT)
- video_url (TEXT)
- status ('processing'|'completed'|'failed')
- credits_charged (INTEGER DEFAULT 40)
```

**credit_transactions**
```sql
- id (TEXT PRIMARY KEY)
- user_id (TEXT)
- amount (INTEGER)
- balance_after (INTEGER)
- credit_type ('cheaper'|'better')
- type ('signup_bonus'|'subscription'|'topup'|'generation'|'regeneration'|'refund'|'video_360')
```

**social_posts**
```sql
- id (TEXT PRIMARY KEY)
- platform ('youtube'|'instagram'|'twitter')
- caption (TEXT)
- image_url (TEXT)
- status ('draft'|'scheduled'|'published'|'failed')
- scheduled_for (DATETIME)
```

---

## 7. API Endpoints Reference

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Create new account |
| POST | `/api/auth/login` | Email/password login |
| POST | `/api/auth/logout` | End session |
| GET | `/api/auth/me` | Get current user |
| GET | `/api/auth/google` | Initiate Google OAuth |
| GET | `/api/auth/google/callback` | OAuth callback |
| POST | `/api/auth/verify-email` | Verify email code |
| POST | `/api/auth/forgot-password` | Request reset |
| POST | `/api/auth/reset-password` | Complete reset |

### Image Generation
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload` | Create session from image upload |
| POST | `/api/scrape` | Create session from URL |
| POST | `/api/generate-single/:sessionId/:variationIndex` | Generate one variation |
| POST | `/api/regenerate/:sessionId/:variationIndex` | Regenerate (1 credit) |
| POST | `/api/sessions/:id/complete` | Mark session complete |
| GET | `/api/sessions` | List user's sessions |
| GET | `/api/sessions/:id` | Get session with images |
| DELETE | `/api/sessions/:id` | Delete session |

### 360° Video
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/generate-360-video` | Start video generation |
| GET | `/api/generate-360-video/:videoId` | Poll status |
| GET | `/api/sessions/:sessionId/videos` | Get session videos |

### Credits & Billing
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/credits/balance` | Get credit balances |
| GET | `/api/credits/history` | Transaction history |
| POST | `/api/billing/create-checkout` | Stripe checkout |
| POST | `/api/billing/webhook` | Stripe webhooks |
| GET | `/api/billing/portal` | Customer portal |

### Brand Colors
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/account/brand-colors` | Get saved colors |
| POST | `/api/account/brand-colors` | Save colors |
| POST | `/api/sessions/:id/brand-colors` | Apply to session |

### Admin (requires admin role)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/dashboard` | Dashboard stats |
| GET | `/api/admin/users` | Search users |
| GET | `/api/admin/users/:id` | User details |
| POST | `/api/admin/users/:id/credits` | Add credits |
| POST | `/api/admin/users/:id/ban` | Ban/unban |
| POST | `/api/admin/users/:id/role` | Change role |
| GET | `/api/admin/export/users` | CSV export |
| GET | `/api/admin/system-health` | Health metrics |
| GET | `/api/admin/recent-activity` | Live activity |

---

## 8. Social Media Hub (Admin Only)

The Social Command Centre allows admins to create and schedule social media content.

### Features
- **AI Content Generation** - Gemini-powered caption writing
- **AI Image Generation** - Social media optimized images
- **Multi-Platform Publishing** - Instagram, Twitter/X, YouTube Shorts
- **Content Calendar** - Schedule posts in advance
- **7-Day Content Strategy** - Auto-suggests content types by day

### Supported Platforms
| Platform | Aspect Ratio | Max Caption | Account ID |
|----------|--------------|-------------|------------|
| Instagram | 1:1 (1080x1080) | 2,200 chars | 692dc17af43160a0bc999b2f |
| Twitter/X | 16:9 (1200x675) | 280 chars | 692dc345f43160a0bc999b35 |
| YouTube Shorts | 9:16 (1080x1920) | 5,000 chars | 692dc20df43160a0bc999b32 |

### Content Strategy by Day
| Day | Content Type | Hook Formula |
|-----|--------------|--------------|
| Monday | Problem/Agitation | "Why is [pain] still costing you [£££]?" |
| Tuesday | Feature Spotlight | "[Feature] just saved [user] [result]" |
| Wednesday | Customer Win | "[Name] did [result] in [time]" |
| Thursday | Industry Contrarian | "Everyone says [myth]. They're wrong." |
| Friday | Speed Demo | "This took [X seconds]. Photographer quoted [weeks]." |
| Saturday | Behind the Scenes | "How we built [feature]" |
| Sunday | Founder Insight | "[X years], [Y failures], [Z breakthrough]" |

### Social API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/social/posts` | List posts |
| POST | `/api/social/posts` | Create post |
| PUT | `/api/social/posts/:id` | Update post |
| DELETE | `/api/social/posts/:id` | Delete post |
| POST | `/api/social/publish/:id` | Publish via GetLate |
| POST | `/api/social/generate-caption` | AI caption |
| POST | `/api/social/generate-image` | AI image |
| GET | `/api/social/analytics` | Stats |
| GET | `/api/social/roadmap` | Content calendar |

---

## 9. Page Routes

### Public Pages
| Route | Description |
|-------|-------------|
| `/` | Marketing homepage (logged out) / App (logged in) |
| `/get-started` | Conversion-focused signup page |
| `/login` | Login form |
| `/register` | Registration form |
| `/forgot-password` | Password reset request |
| `/reset-password` | Password reset form |
| `/pricing` | Pricing page |
| `/faq` | FAQ page |
| `/about` | About page |
| `/contact` | Contact form |
| `/blog` | Blog index |
| `/blog/:slug` | Individual blog posts |
| `/privacy` | Privacy policy |
| `/terms` | Terms of service |
| `/refunds` | Refund policy |
| `/cookies` | Cookie policy |

### Authenticated Pages
| Route | Description |
|-------|-------------|
| `/app` | Main application |
| `/dashboard` | User dashboard |
| `/account` | Account settings |
| `/results/:id` | Session results page |
| `/history` | Redirects to home (sidebar) |

### Admin Pages
| Route | Description |
|-------|-------------|
| `/admin` | Admin dashboard |
| `/admin/social` | Social Command Centre |
| `/admin/social-studio` | Legacy redirect to /admin/social |

---

## 10. Environment Variables (Bindings)

```typescript
type Bindings = {
  // Database
  TESCO_DB: D1Database;
  
  // Vertex AI (Image & Video Generation)
  GEMINI_API_KEY: string;
  VERTEX_PROJECT_ID: string;
  VERTEX_CLIENT_EMAIL: string;
  VERTEX_PRIVATE_KEY: string;
  
  // Stripe (Payments)
  STRIPE_SECRET_KEY: string;
  STRIPE_PUBLISHABLE_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRICE_ID_SUBSCRIPTION: string;
  STRIPE_PRICE_ID_TOPUP: string;
  
  // Auth
  SESSION_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  
  // Email
  RESEND_API_KEY: string;
  
  // Social Media
  LATE_API_KEY: string;
  VIDEO_BUCKET: R2Bucket;
  SOCIAL_MEDIA_BUCKET: R2Bucket;
  
  // Reserved for future use
  ELEVENLABS_API_KEY: string;
  ELEVENLABS_VOICE_ID: string;
  PEXELS_API_KEY: string;
}
```

---

## 11. Deployment

### Cloudflare Pages Configuration
```jsonc
// wrangler.jsonc
{
  "name": "shopshot",
  "compatibility_date": "2024-01-01",
  "pages_build_output_dir": "./dist",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [{
    "binding": "TESCO_DB",
    "database_name": "tesco-image-gen",
    "database_id": "..."
  }],
  "r2_buckets": [
    { "binding": "VIDEO_BUCKET", "bucket_name": "..." },
    { "binding": "SOCIAL_MEDIA_BUCKET", "bucket_name": "..." }
  ]
}
```

### Build & Deploy Commands
```bash
npm run build          # Vite build
npm run deploy         # Build + deploy to Cloudflare
npm run dev           # Local development with wrangler
```

### Production URLs
- **Primary:** https://www.shopshot.co.uk
- **Cloudflare:** https://shopshot.pages.dev

---

## 12. Analytics & Tracking

- **Google Tag Manager:** GTM-PNKMSPJN
- **Google Analytics 4:** G-FJR6WVMLHE

Both are injected into all pages via `GTM_HEAD` and `GTM_BODY` constants.

---

## 13. Email Integration

### Transactional Emails (Resend)
- Email verification codes
- Password reset links
- Admin notifications (new signups)
- Contact form submissions

### Marketing Emails (Loops)
- New user welcome sequence
- Trigger events for automation

---

## 14. Security Features

- PBKDF2 password hashing (Web Crypto API)
- Session-based authentication with secure cookies
- Email verification required for new accounts
- Google OAuth as alternative login
- Admin role-based access control
- User banning capability
- Stripe webhook signature verification

---

## 15. File Structure

```
webapp/
├── src/
│   ├── index.tsx          # Main app (22,000 lines)
│   ├── legal-pages.ts     # Privacy, Terms, etc.
│   ├── info-pages.ts      # FAQ, About, Contact
│   └── blog-pages.ts      # Blog content
├── public/
│   └── favicon files
├── dist/                  # Build output
├── wrangler.jsonc         # Cloudflare config
├── package.json
├── vite.config.ts
└── tsconfig.json
```

---

## 16. Known Limitations

1. **Single File Architecture** - All 22,000 lines in one file (technical debt)
2. **No Real-time Updates** - Polling-based status checks
3. **Base64 Image Storage** - Images stored as base64 in D1, not R2
4. **No Image CDN** - Images served inline, not via CDN
5. **Admin-only Social Hub** - No user-facing social features
6. **UK-focused** - Pricing in GBP, content strategy UK-centric

---

## 17. Future Considerations

### Potential Enhancements
- Image storage migration to R2 with CDN
- Multi-language support
- API access for enterprise users
- White-label capability
- Batch processing for bulk uploads
- Shopify/WooCommerce integrations
- A/B testing for generated images

### Reserved Infrastructure
- ElevenLabs API key (voice synthesis)
- Pexels API key (stock content)
- R2 buckets for media storage

---

## 18. Support & Contact

- **Admin Email:** Notifications sent to admin on new signups
- **Contact Form:** `/contact` - submissions via Resend
- **Feature Requests:** In-app suggestion system

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Dec 2024 | Initial comprehensive briefing |

---

*This document should be provided to any AI assistant working on ShopShot to ensure complete context of the system architecture, capabilities, and constraints.*
