# ShopShot - Handover Brief
**Date:** 27 November 2025
**Project:** AI-Powered Product Photo Generator
**Live URL:** https://shopshot.pages.dev
**GitHub:** https://github.com/dantheaiguy1/tesco

---

## Executive Summary

ShopShot is a fully functional SaaS application that transforms product photos into 10 professional variations using AI (Google Vertex AI / Gemini). Users upload a single product image and receive hero shots, lifestyle images, flat-lays, and more in approximately 36 seconds.

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Framework | Hono (TypeScript) |
| Hosting | Cloudflare Pages |
| Database | Cloudflare D1 (SQLite) |
| AI Engine | Google Vertex AI (Gemini 2.5 Flash + Gemini 3 Pro Preview) |
| Payments | Stripe (Subscriptions + One-time Credit Packs) |
| Auth | Custom session-based (cookies + bcrypt-style hashing) |

---

## Current Status: FULLY OPERATIONAL ✅

### Working Features

1. **User Authentication**
   - Registration with email/password
   - Login/logout functionality
   - Session-based auth with secure cookies
   - Password hashing (PBKDF2 with SHA-256)

2. **Image Generation**
   - Upload product photo (JPG, PNG, WebP up to 10MB)
   - AI generates 10 professional variations:
     - Texture Detail
     - Label & Branding
     - Construction Detail
     - Color & Finish
     - Size Reference
     - Hero (White Background)
     - In-Use Action
     - Flat-Lay Styled
     - Environment Context
     - Multi-Angle
   - Two quality modes:
     - **Standard** (Gemini 2.5 Flash) - Fast & reliable (~8s per image)
     - **Pro** (Gemini 3 Pro Preview) - Best quality but beta/slower

3. **Credit System**
   - Dual credit types: Standard Credits + Pro Credits
   - Signup bonus: 10 Standard + 5 Pro credits
   - Credits deducted per image generated
   - Refund logic if generation fails

4. **Payments (Stripe)**
   - Subscription plans: Standard (£39/mo), Pro (£59/mo)
   - Credit top-up packs: £25, £50, £75, £100
   - Webhook handling for payment events
   - All Stripe secrets configured in Cloudflare

5. **UI/UX**
   - Premium SaaS design with radial gradient background
   - 3D decorative shapes (floating cubes/triangles)
   - Glassmorphism upload zone
   - ElevenLabs-style sidebar navigation
   - Mobile responsive
   - Session history in sidebar
   - Lightbox for viewing generated images
   - Download individual images or ZIP of all

---

## Database Schema (D1)

```sql
-- Users table
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  cheaper_credits INTEGER DEFAULT 10,  -- Standard credits
  better_credits INTEGER DEFAULT 5,    -- Pro credits
  subscription_status TEXT DEFAULT 'free',
  subscription_plan TEXT DEFAULT 'free',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Sessions table
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  product_name TEXT,
  source_type TEXT,
  original_image TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  model TEXT,
  user_id TEXT,
  credits_charged INTEGER DEFAULT 0,
  credits_refunded INTEGER DEFAULT 0,
  generation_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Generated images table
CREATE TABLE generated_images (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  variation_type TEXT NOT NULL,
  variation_index INTEGER NOT NULL,
  image_data TEXT,
  prompt TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Credit transactions table
CREATE TABLE credit_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance_after INTEGER,
  credit_type TEXT,
  type TEXT,
  description TEXT,
  stripe_payment_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## Environment Variables (Cloudflare Secrets)

All configured via `wrangler pages secret put`:

| Variable | Status | Description |
|----------|--------|-------------|
| `VERTEX_PROJECT_ID` | ✅ Set | Google Cloud project ID |
| `VERTEX_CLIENT_EMAIL` | ✅ Set | Service account email |
| `VERTEX_PRIVATE_KEY` | ✅ Set | Service account private key |
| `STRIPE_SECRET_KEY` | ✅ Set | Stripe secret key (live) |
| `STRIPE_PUBLISHABLE_KEY` | ✅ Set | Stripe publishable key (live) |
| `STRIPE_WEBHOOK_SECRET` | ✅ Set | Webhook signing secret |
| `STRIPE_PRICE_ID_SUBSCRIPTION` | ✅ Set | Standard subscription price ID |
| `STRIPE_PRICE_ID_TOPUP` | ✅ Set | Credit pack price ID |
| `SESSION_SECRET` | ✅ Set | Cookie signing secret |

**D1 Database Binding:**
- Binding name: `TESCO_DB`
- Database: `tesco-image-generator-db`
- ID: `7418ff05-a1c5-41d5-8238-4c1373e2b4f6`

---

## Key Pages & Routes

### Frontend Pages
| Route | Description |
|-------|-------------|
| `/` | Homepage - upload zone, quality selector, generate button |
| `/get-started` | Conversion page (value prop + signup + login option) |
| `/login` | Login page |
| `/register` | Registration page |
| `/logout` | Clears session, redirects to login |
| `/dashboard` | User dashboard with session history |
| `/pricing` | Subscription plans and credit packs |
| `/account` | Account settings |
| `/results/:id` | View generated images for a session |

### API Endpoints
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check (DB, Stripe, Gemini status) |
| `/api/auth/register` | POST | Create new user |
| `/api/auth/login` | POST | Login user |
| `/api/auth/logout` | POST | Logout user |
| `/api/auth/me` | GET | Get current user |
| `/api/upload` | POST | Upload image, create session |
| `/api/sessions` | GET | List user's sessions |
| `/api/sessions/:id` | GET/PATCH/DELETE | Session CRUD |
| `/api/generate/:id` | POST | Generate all 10 variations |
| `/api/generate-single/:sessionId/:index` | POST | Generate single variation |
| `/api/regenerate/:sessionId/:index` | POST | Regenerate a variation |
| `/api/billing/create-checkout` | POST | Create Stripe checkout |
| `/api/billing/webhook` | POST | Stripe webhook handler |

---

## Recent Changes (This Session)

### 1. Premium Homepage Redesign
- Radial gradient background (blue/purple/pink)
- 3D floating decorative shapes
- Glassmorphism upload zone with smaller icon (56px)
- Compact quality selector buttons (blue for Standard, gold for Pro)
- Removed prices from quality buttons (not relevant when logged in)
- Purple gradient "Generate" button

### 2. ElevenLabs-Style Sidebar
- Logo at top
- "✨ Generate New" button
- "HISTORY" section with session list
- User section:
  - **Logged out:** Login + Sign Up Free buttons
  - **Logged in:** Avatar, name, email, dropdown menu (Dashboard, Buy Credits, Account, Logout)
- Credits display at bottom (Standard + Pro)

### 3. Auth Flow Improvement
- Created `/get-started` conversion page
- Unauthenticated users trying to upload → redirected to `/get-started`
- Page shows:
  - Value proposition (left side): benefits, free credits banner
  - Signup form (right side): name, email, password
  - "Log in to existing account" option below
- Redirect param preserved so users return to where they were

### 4. Branding Updates
- Removed all "Nano Banana" and "Gemini" references
- Renamed to "Standard" and "Pro" quality modes
- Standard: "Amazing quality, fast & reliable"
- Pro: "Best quality possible (Beta)" with warning about potential slowness
- Default selection: Standard (flash model)

### 5. Bug Fixes
- Fixed D1 database migrations (added missing `user_id` column)
- Fixed checkout type validation (`pack` was rejected, now accepted)
- Added `SESSION_SECRET` for proper cookie signing
- Fixed Stripe secrets binding via wrangler CLI

---

## Stripe Configuration

### Products Created
| Product | Type | Price |
|---------|------|-------|
| ShopShot Standard | Subscription | £39.99/month |
| ShopShot Pro | Subscription | £59.99/month |
| Standard Credits Pack | One-time | £25 (400 credits) |
| Pro Credits Pack | One-time | £25 (115 credits) |

### Price IDs
- `STRIPE_PRICE_ID_SUBSCRIPTION`: `price_1SXod6K5jVZf8VX1wstxIyUM` (Standard)
- `STRIPE_PRICE_ID_TOPUP`: `price_1SXofAK5jVZf8VX1YmbbaUWW` (Standard pack)

### Webhook
- URL: `https://shopshot.pages.dev/api/billing/webhook`
- Events: `checkout.session.completed`, `invoice.payment_succeeded`, `customer.subscription.deleted`

---

## File Structure

```
/home/user/webapp/
├── src/
│   └── index.tsx          # Main application (all routes, pages, logic)
├── public/                 # Static assets
├── dist/                   # Build output
├── migrations/             # D1 database migrations
├── wrangler.toml           # Cloudflare configuration
├── package.json            # Dependencies and scripts
├── tsconfig.json           # TypeScript config
├── vite.config.ts          # Vite build config
├── ecosystem.config.cjs    # PM2 config for local dev
└── HANDOVER_BRIEF.md       # This document
```

---

## Deployment Commands

```bash
# Build
npm run build

# Deploy to Cloudflare Pages
npx wrangler pages deploy dist --project-name shopshot

# Add secrets
npx wrangler pages secret put SECRET_NAME --project-name shopshot

# Local development
npm run build
pm2 start ecosystem.config.cjs

# D1 database commands
npx wrangler d1 execute tesco-image-generator-db --command="SQL" --remote
```

---

## Known Issues / Notes

1. **Pro Model Instability**: Gemini 3 Pro Preview (`gemini-3-pro-image-preview`) is in preview and can be slow (60-90+ seconds) or fail. Standard model is recommended for reliability.

2. **Session Cookie**: If `SESSION_SECRET` changes, all existing sessions become invalid. Users need to log out and log back in.

3. **Credit Display Sync**: After signup, credits display correctly. If there's a mismatch, logging out and back in refreshes the values.

4. **D1 Binding**: Must be configured in Cloudflare Pages dashboard under Settings > Functions > D1 database bindings (binding name: `TESCO_DB`).

---

## Next Steps / Suggestions

1. **Email verification** - Add email confirmation on signup
2. **Password reset** - Forgot password flow
3. **Usage analytics** - Track generation stats, popular products
4. **Image storage** - Move to R2 for persistent storage (currently base64 in DB)
5. **Custom prompts** - Advanced mode UI is built but could be expanded
6. **Bulk generation** - Upload multiple products at once
7. **API access** - Developer API for programmatic access
8. **Terms & Privacy pages** - Currently placeholder links

---

## Health Check

Verify the app is working:
```bash
curl https://shopshot.pages.dev/api/health
```

Expected response:
```json
{
  "status": "ok",
  "hasGeminiKey": true,
  "hasDB": true,
  "hasStripe": true
}
```

---

## Contact

This project was built for Daniel Nicholls (Superman) as part of the AI Academy / AI Agency portfolio.

**Repository:** https://github.com/dantheaiguy1/tesco
**Live App:** https://shopshot.pages.dev
