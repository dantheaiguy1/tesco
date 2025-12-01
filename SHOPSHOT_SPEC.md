# ShopShot - Complete Product Specification

**Version:** 1.0  
**Last Updated:** December 1, 2024  
**Live URL:** https://www.shopshot.co.uk  
**App URL:** https://www.shopshot.co.uk/app

---

## Executive Summary

ShopShot is an AI-powered product photography SaaS that transforms a single product photo into 10+ professional ecommerce variations in approximately 25 seconds. Target users are online sellers on eBay, Etsy, Amazon, Shopify who need professional product photos without hiring photographers.

---

## Core Value Proposition

- **Input:** 1 product photo (smartphone quality acceptable)
- **Output:** 10 professional variations + optional 360° spin video
- **Time:** ~25 seconds for 10 images (Standard mode)
- **Cost:** From free (15 credits) to £59.99/month subscription

---

## Technology Stack

| Component | Technology |
|-----------|------------|
| Framework | Hono (TypeScript) |
| Hosting | Cloudflare Pages |
| Database | Cloudflare D1 (SQLite) |
| AI - Images | Google Vertex AI (Gemini models) |
| AI - Video | Google Veo 3 Fast |
| Payments | Stripe |
| Email | Resend |
| Auth | Custom session-based + Google OAuth |
| Analytics | Google Tag Manager + GA4 |
| Voice Widget | ElevenLabs ConvAI |

---

## AI Models Configuration

### Image Generation Models

| Model Key | Model Name | Quality | Speed | Credit Type |
|-----------|------------|---------|-------|-------------|
| `flash` (default) | gemini-2.5-flash-image | Amazing | ~2-3s/image | Standard (cheaper_credits) |
| `nano` | gemini-3-pro-image-preview | Best (Beta) | ~10-30s/image | Pro (better_credits) |

### Video Generation

| Feature | Model | Duration | Cost |
|---------|-------|----------|------|
| 360° Spin | Veo 3 Fast | 8 seconds | 40 Standard credits |

---

## Dual Credit System

ShopShot uses two credit types to match different user needs:

### Credit Types

| Type | Internal Name | Use Case | API Model |
|------|---------------|----------|-----------|
| Standard Credits | `cheaper_credits` | Fast generation, bulk work | Gemini Flash |
| Pro Credits | `better_credits` | Best quality, hero shots | Gemini Pro |

### Credit Costs

| Action | Standard Credits | Pro Credits |
|--------|-----------------|-------------|
| 1 image generation | 1 | 1 |
| 10 image set | 10 | 10 |
| 360° video | 40 | N/A |

### Free Tier (Signup Bonus)
- 10 Standard Credits
- 5 Pro Credits

### Subscription Plans

| Plan | Price | Standard Credits/mo | Pro Credits/mo |
|------|-------|---------------------|----------------|
| Free | £0 | 10 (signup only) | 5 (signup only) |
| Standard | £39.99/mo | 500 | 45 |
| Pro | £59.99/mo | 300 | 175 |

### Credit Packs (One-time Purchase)

| Price | Standard Credits | Pro Credits |
|-------|-----------------|-------------|
| £25 | 400 | 115 |
| £50 | 800 | 230 |
| £75 | 1,200 | 350 |
| £100 | 1,600 | 465 |

---

## Image Variation Types

Each generation produces 10 strategic ecommerce images:

### Detail/Close-up Shots (1-5) - Trust Building

| # | Field | Label | Purpose |
|---|-------|-------|---------|
| 1 | `macro_texture` | Texture Detail | Material quality, surface detail |
| 2 | `label_branding` | Label & Branding | Logo, brand marks, typography |
| 3 | `construction_detail` | Construction Detail | Seams, stitching, build quality |
| 4 | `color_finish` | Color & Finish | True-to-life color accuracy |
| 5 | `scale_reference` | Size Reference | Hand/object for scale comparison |

### Context/Lifestyle Shots (6-10) - Conversion Driving

| # | Field | Label | Purpose |
|---|-------|-------|---------|
| 6 | `hero_white` | Hero (White BG) | Amazon/eBay main image |
| 7 | `inuse_action` | In-Use Action | Product being used |
| 8 | `flatlay_styled` | Flat-Lay Styled | Instagram-ready composition |
| 9 | `environment_context` | Environment Context | Lifestyle setting |
| 10 | `multi_angle` | Multiple Angles | 3-view composite |

---

## User Flow

### Registration Flow
1. User visits `/register` (optionally with `?plan=free|standard|pro`)
2. Fills form: Name (optional), Email, Mobile Phone, Password
3. Agrees to Terms & Marketing (optional)
4. Account created with signup bonus credits
5. If plan=standard/pro: Auto-redirect to Stripe checkout
6. If plan=free: Redirect to app

### Generation Flow
1. User uploads product photo (drag-drop or click)
2. Enters product name (optional, improves prompts)
3. Selects model: Standard (fast) or Pro (quality)
4. Clicks "Generate"
5. Images generate one-by-one with live preview
6. Downloads individual images or full set
7. Optional: Generate 360° spin video

### 360° Video Flow
1. From results page, click "Create 360° Video"
2. System uses original uploaded image
3. Veo 3 Fast generates 8-second spin video
4. Progress polling every 5 seconds
5. Video available for download when complete

---

## Authentication System

### Methods
- **Email/Password:** Custom registration with bcrypt hashing
- **Google OAuth:** One-click sign-in via Google
- **Session Management:** Cookie-based with 30-day expiry

### Security Features
- CSRF protection via session tokens
- Password hashing (bcrypt)
- Email verification (Resend integration)
- Password reset flow
- Rate limiting on auth endpoints

### User Types
| Role | Capabilities |
|------|-------------|
| `user` | Standard access, generation, billing |
| `admin` | Full dashboard, user management, credit adjustments |

---

## Database Schema

### Tables

#### `users`
```sql
id TEXT PRIMARY KEY
email TEXT UNIQUE NOT NULL
password_hash TEXT
name TEXT
phone TEXT
cheaper_credits INTEGER DEFAULT 10
better_credits INTEGER DEFAULT 5
subscription_status TEXT ('free'|'active'|'canceled'|'past_due')
subscription_plan TEXT ('free'|'standard'|'pro')
stripe_customer_id TEXT
stripe_subscription_id TEXT
google_id TEXT
email_verified INTEGER DEFAULT 0
role TEXT DEFAULT 'user'
created_at DATETIME
```

#### `sessions` (Image Generation Sessions)
```sql
id TEXT PRIMARY KEY
user_id TEXT REFERENCES users(id)
product_name TEXT
source_type TEXT ('upload'|'url')
original_image TEXT (base64)
status TEXT ('pending'|'generating'|'completed'|'failed')
credits_charged INTEGER
model_used TEXT
-- Individual variation images stored as columns
macro_texture TEXT
label_branding TEXT
construction_detail TEXT
color_finish TEXT
scale_reference TEXT
hero_white TEXT
inuse_action TEXT
flatlay_styled TEXT
environment_context TEXT
multi_angle TEXT
created_at DATETIME
```

#### `generated_videos`
```sql
id TEXT PRIMARY KEY
user_id TEXT REFERENCES users(id)
session_id TEXT REFERENCES sessions(id)
original_image_url TEXT
video_url TEXT
status TEXT ('processing'|'completed'|'failed')
credits_charged INTEGER
operation_name TEXT (Veo operation ID)
duration_seconds INTEGER
created_at DATETIME
completed_at DATETIME
```

#### `credit_transactions`
```sql
id TEXT PRIMARY KEY
user_id TEXT REFERENCES users(id)
amount INTEGER
balance_after INTEGER
credit_type TEXT ('cheaper'|'better')
type TEXT ('signup_bonus'|'subscription'|'topup'|'generation'|'refund')
description TEXT
session_id TEXT
stripe_payment_id TEXT
created_at DATETIME
```

#### `stripe_events`
```sql
id TEXT PRIMARY KEY
type TEXT
user_id TEXT
processed INTEGER
data TEXT (JSON)
created_at DATETIME
```

#### `user_sessions` (Auth Sessions)
```sql
id TEXT PRIMARY KEY
user_id TEXT REFERENCES users(id)
expires_at DATETIME
created_at DATETIME
```

---

## API Endpoints

### Public Pages
| Route | Description |
|-------|-------------|
| `GET /` | Marketing page (logged out) or App (logged in) |
| `GET /pricing` | Full pricing page |
| `GET /faq` | FAQ with Schema.org markup |
| `GET /about` | About page |
| `GET /contact` | Contact form |
| `GET /blog` | Blog index (19 articles) |
| `GET /blog/:slug` | Individual blog post |
| `GET /privacy` | Privacy policy |
| `GET /terms` | Terms of service |
| `GET /refunds` | Refund policy |
| `GET /cookies` | Cookie policy |

### Auth Routes
| Route | Method | Description |
|-------|--------|-------------|
| `/login` | GET | Login page |
| `/register` | GET | Registration page |
| `/get-started` | GET | Pricing + Login combo |
| `/logout` | GET | Logout and redirect |
| `/api/auth/register` | POST | Create account |
| `/api/auth/login` | POST | Authenticate |
| `/api/auth/logout` | POST | End session |
| `/api/auth/me` | GET | Current user info |
| `/api/auth/google` | GET | Start Google OAuth |
| `/api/auth/google/callback` | GET | Google OAuth callback |
| `/api/auth/forgot-password` | POST | Request password reset |
| `/api/auth/reset-password` | POST | Complete password reset |
| `/api/auth/verify-email` | POST | Verify email token |
| `/api/auth/resend-verification` | POST | Resend verification email |

### App Routes (Auth Required)
| Route | Method | Description |
|-------|--------|-------------|
| `/app` | GET | Main application |
| `/dashboard` | GET | User dashboard |
| `/account` | GET | Account settings |
| `/history` | GET | Generation history |
| `/results/:id` | GET | View session results |

### Generation API
| Route | Method | Description |
|-------|--------|-------------|
| `/api/upload` | POST | Upload image, create session |
| `/api/generate-single/:sessionId/:variationIndex` | POST | Generate single variation |
| `/api/generate/:id` | POST | Generate all variations |
| `/api/regenerate/:sessionId/:variationIndex` | POST | Regenerate specific variation |
| `/api/sessions` | GET | List user sessions |
| `/api/sessions/:id` | GET | Get session details |
| `/api/sessions/:id/complete` | POST | Mark session complete |
| `/api/sessions/:id/images` | POST | Save images to session |
| `/api/sessions/:id/video` | POST | Save video to session |

### 360° Video API
| Route | Method | Description |
|-------|--------|-------------|
| `/api/generate-360-video` | POST | Start video generation |
| `/api/generate-360-video/:videoId` | GET | Poll video status |
| `/api/sessions/:sessionId/videos` | GET | Get session videos |

### Billing API
| Route | Method | Description |
|-------|--------|-------------|
| `/api/credits/balance` | GET | Get credit balance |
| `/api/credits/history` | GET | Get transaction history |
| `/api/billing/create-checkout` | POST | Create Stripe checkout session |
| `/api/billing/webhook` | POST | Stripe webhook handler |
| `/api/billing/portal` | GET | Stripe customer portal |

### Admin API
| Route | Method | Description |
|-------|--------|-------------|
| `/admin` | GET | Admin dashboard page |
| `/api/admin/dashboard` | GET | Dashboard stats |
| `/api/admin/users` | GET | List all users |
| `/api/admin/users/:id` | GET | Get user details |
| `/api/admin/users/:id/credits` | POST | Adjust user credits |
| `/api/admin/users/:id/ban` | POST | Ban/unban user |
| `/api/admin/users/:id/role` | POST | Change user role |
| `/api/admin/export/users` | GET | Export users CSV |
| `/api/admin/system-health` | GET | System health check |
| `/api/admin/recent-activity` | GET | Recent activity log |
| `/api/admin/feature-suggestions` | GET | View feature requests |

### Utility API
| Route | Method | Description |
|-------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/contact` | POST | Contact form submission |
| `/api/feature-suggestions` | POST | Submit feature request |
| `/api/support-chat` | POST | Support chat message |
| `/robots.txt` | GET | SEO robots file |
| `/sitemap.xml` | GET | XML sitemap |

---

## Stripe Integration

### Webhook Events Handled
- `checkout.session.completed` - Process new subscriptions/purchases
- `customer.subscription.updated` - Handle plan changes
- `customer.subscription.deleted` - Handle cancellations
- `invoice.payment_succeeded` - Credit subscription renewals
- `invoice.payment_failed` - Mark subscription past_due

### Products Required in Stripe
1. **Standard Subscription** - £39.99/month recurring
2. **Pro Subscription** - £59.99/month recurring
3. **Credit Packs** - £25, £50, £75, £100 one-time payments

---

## SEO Features

### Implemented
- Canonical URLs on all pages
- Open Graph meta tags
- Twitter Card meta tags
- Schema.org structured data (Organization, SoftwareApplication, FAQ, Article)
- XML sitemap at `/sitemap.xml`
- Robots.txt at `/robots.txt`
- Semantic HTML with proper heading hierarchy
- Mobile-responsive design

### Blog
- 19 SEO-optimized articles
- Categories: Guides, Tutorials, Platform Guides
- Featured post system
- Publication dates (Nov 10 - Dec 1, 2024)
- AI-generated hero images per article

---

## Analytics & Tracking

### Google Tag Manager
- Container ID: `GTM-PNKMSPJN`
- Implemented on all pages

### Google Analytics 4
- Measurement ID: `G-FJR6WVMLHE`
- Page views tracked
- Event tracking ready

---

## Environment Variables

### Required Secrets (Cloudflare Pages)
```
GEMINI_API_KEY          # Google AI API key
VERTEX_PROJECT_ID       # GCP Project ID
VERTEX_CLIENT_EMAIL     # Service account email
VERTEX_PRIVATE_KEY      # Service account private key (PEM format)
STRIPE_SECRET_KEY       # sk_live_...
STRIPE_PUBLISHABLE_KEY  # pk_live_...
STRIPE_WEBHOOK_SECRET   # whsec_...
SESSION_SECRET          # Random 32-char string
RESEND_API_KEY          # Resend email API key
GOOGLE_CLIENT_ID        # Google OAuth client ID
GOOGLE_CLIENT_SECRET    # Google OAuth client secret
```

---

## File Structure

```
/home/user/webapp/
├── src/
│   ├── index.tsx         # Main app (15,661 lines)
│   ├── blog-pages.ts     # Blog content & templates
│   ├── legal-pages.ts    # Privacy, Terms, Refunds, Cookies
│   └── info-pages.ts     # FAQ, About, Contact
├── public/
│   └── static/
│       ├── blog/         # 19 blog hero images
│       ├── examples/     # Example images
│       ├── hero-studio.jpg
│       └── style.css
├── migrations/
│   ├── 0001_initial_schema.sql
│   ├── 0002_multi_user_saas.sql
│   └── 0003_add_image_data_column.sql
├── dist/                 # Built output
├── wrangler.jsonc        # Cloudflare config
├── package.json
├── vite.config.ts
├── tsconfig.json
├── ecosystem.config.cjs  # PM2 local dev config
└── README.md
```

---

## Deployment

### Build & Deploy
```bash
npm run build
npx wrangler pages deploy dist --project-name shopshot
```

### Local Development
```bash
npm run build
pm2 start ecosystem.config.cjs
# Visit http://localhost:3000
```

### Database Operations
```bash
# Apply migrations (production)
npx wrangler d1 execute TESCO_DB --command "SQL_HERE"

# Query database
npx wrangler d1 execute TESCO_DB --command "SELECT * FROM users LIMIT 10"
```

---

## Quick Reference

| Item | Value |
|------|-------|
| Live URL | https://www.shopshot.co.uk |
| GitHub | https://github.com/dantheaiguy1/tesco |
| Cloudflare Project | `shopshot` |
| D1 Database | `tesco-image-generator-db` |
| D1 Database ID | `7418ff05-a1c5-41d5-8238-4c1373e2b4f6` |
| Support Email | support@shopshot.co.uk |

---

## Contact

**Owner:** Daniel David Peter Nichols  
**Company:** ShopShot Ltd  
**Location:** Burwash, East Sussex, England  
**Email:** support@shopshot.co.uk
