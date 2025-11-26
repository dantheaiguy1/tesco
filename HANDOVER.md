# ShopShot - Handover Document
**Date:** 2025-11-26
**GitHub:** https://github.com/dantheaiguy1/tesco

---

## Project Overview

ShopShot is an AI-powered product photography generator that creates 10 professional e-commerce image variations from a single product photo. Built as a multi-user SaaS with credit-based billing.

**Tech Stack:**
- Hono (TypeScript) on Cloudflare Workers/Pages
- Cloudflare D1 (SQLite) for database
- Google Vertex AI (Gemini) for image generation
- Stripe for payments (integration ready, needs live keys)
- Tailwind CSS + vanilla JS frontend

---

## Current State: 85% Complete

### What's DONE and Working

#### 1. Authentication System
- User registration with email/password (bcrypt hashed)
- Login/logout with secure session cookies
- Session management via `user_sessions` table
- Auth middleware on all routes (`app.use('*', ...)`)
- Protected API endpoints

#### 2. Credit System (JUST UPDATED - needs testing)
- **Per-image billing**: 1 credit deducted per SUCCESSFUL image generation
- Failed generations do NOT deduct credits
- 10 free credits on signup
- Credit balance tracked in `users.credits_balance`
- Transaction history in `credit_transactions` table
- Sidebar shows persistent credit indicator (bottom-left)
  - Green: 10+ credits
  - Yellow: 1-9 credits  
  - Red: 0 credits

#### 3. Database Schema (D1)
```
Tables:
- users (id, email, password_hash, name, credits_balance, subscription_status, stripe_customer_id, etc.)
- user_sessions (id, user_id, expires_at)
- sessions (id, user_id, product_name, status, credits_charged, generation_count, etc.)
- generated_images (id, session_id, variation_type, image_data, etc.)
- credit_transactions (id, user_id, amount, balance_after, type, description, etc.)
- stripe_events (id, type, user_id, processed, data)
```

#### 4. Image Generation
- 10 variation types per product:
  1. Texture Detail
  2. Label & Branding
  3. Construction
  4. Color & Finish
  5. Size Reference
  6. Hero (White BG)
  7. In-Use Action
  8. Flat-Lay
  9. Environment
  10. Multi-Angle
- Two AI models: "Nano Pro" (quality) and "Flash 2.5" (speed)
- Regeneration of individual images (1 credit each)

#### 5. Frontend Pages
- `/` - Homepage with upload zone and session sidebar
- `/login` - Login page
- `/register` - Registration page
- `/dashboard` - User dashboard with stats
- `/pricing` - Pricing plans
- `/account` - Account settings
- `/results/:id` - Results page (shares session view)

#### 6. Session Isolation
- Users can only see their own sessions
- API enforces user_id matching on all session operations

---

### What's IN PROGRESS

#### 1. Per-Image Credit Deduction (JUST CODED - NOT YET TESTED)
The latest commit changes credit deduction from bulk (10 credits after all images) to per-image (1 credit per successful generation).

**Key code changes made:**
```typescript
// New constant
const CREDITS = {
  SIGNUP_BONUS: 10,
  PER_IMAGE: 1,           // NEW - cost per successful image
  SINGLE_REGENERATION: 1,
  SUBSCRIPTION_MONTHLY: 300,
  TOPUP_PACK: 300,
}

// generate-single endpoint now:
// 1. Checks credits before generating
// 2. Calls Vertex AI
// 3. On SUCCESS only: deducts 1 credit via deductCredits()
// 4. Returns credits_remaining in response

// Frontend generateSingle() now:
// 1. Updates credits display after each successful image
// 2. Shows paywall if out of credits mid-generation
```

**Files modified:**
- `src/index.tsx` - Backend and frontend changes
- `migrations/0002_multi_user_saas.sql` - Database schema

**NEEDS TESTING:**
- Build the project (`npm run build`)
- Register fresh user (gets 10 credits)
- Upload image and start generation
- Watch credits count down from 10 to 0 as each image completes
- Verify failed images don't deduct credits
- Test running out of credits mid-generation (should show paywall)

---

### What's NOT YET DONE

#### 1. Stripe Integration (Backend Ready, Needs Config)
- Checkout session creation endpoint exists
- Webhook handler exists with signature verification
- **Missing:** Real Stripe API keys in `.dev.vars`
- **Missing:** Stripe products/prices created in Stripe dashboard
- **Missing:** Webhook endpoint registered in Stripe

Required `.dev.vars` entries:
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID_SUBSCRIPTION=price_...
STRIPE_PRICE_ID_TOPUP=price_...
```

#### 2. Production Deployment
- Cloudflare Pages project needs to be created
- D1 database needs to be created remotely
- Environment secrets need to be set
- Migrations need to be applied to production D1

#### 3. Header User Menu
- Should show user avatar + credits when logged in
- Currently may still show login/signup buttons after login (needs verification after build)

#### 4. Advanced Mode
- Custom prompt editing per variation
- UI exists but may need polish

---

## Key Files

```
/home/user/webapp/
├── src/
│   └── index.tsx          # Main app (5000+ lines - backend + frontend)
├── migrations/
│   ├── 0001_initial_schema.sql
│   └── 0002_multi_user_saas.sql
├── .dev.vars              # Local environment variables (secrets)
├── wrangler.jsonc         # Cloudflare config
├── ecosystem.config.cjs   # PM2 config for local dev
├── package.json
└── HANDOVER.md            # This file
```

---

## How to Run Locally

```bash
cd /home/user/webapp

# 1. Apply migrations (if DB was reset)
npx wrangler d1 migrations apply tesco-image-generator-db --local

# 2. Build
npm run build

# 3. Start with PM2
pm2 restart tesco-image-generator
# OR if not running:
pm2 start ecosystem.config.cjs

# 4. Test
curl http://localhost:3000/api/health
```

---

## Environment Variables (.dev.vars)

```
# Vertex AI (working)
VERTEX_PROJECT_ID=gen-lang-client-0469482378
VERTEX_CLIENT_EMAIL=shopshot-vertex-2@gen-lang-client-0469482378.iam.gserviceaccount.com
VERTEX_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Stripe (placeholders - need real keys)
STRIPE_SECRET_KEY=sk_test_placeholder
STRIPE_PUBLISHABLE_KEY=pk_test_placeholder
STRIPE_WEBHOOK_SECRET=whsec_placeholder
STRIPE_PRICE_ID_SUBSCRIPTION=price_placeholder
STRIPE_PRICE_ID_TOPUP=price_placeholder

# Session
SESSION_SECRET=your-secret-key
```

---

## Database State

The local D1 database may have been reset during development. After restart:
1. Apply migrations
2. Register a fresh test user
3. User gets 10 credits automatically

---

## API Endpoints Summary

### Auth
- `POST /api/auth/register` - Create account (10 free credits)
- `POST /api/auth/login` - Login, get session cookie
- `POST /api/auth/logout` - Clear session
- `GET /api/auth/me` - Get current user

### Credits
- `GET /api/credits/balance` - Get balance + subscription status
- `GET /api/credits/history` - Get transaction history

### Sessions
- `GET /api/sessions` - List user's sessions
- `GET /api/sessions/:id` - Get session details + images
- `POST /api/sessions/:id/complete` - Mark session complete

### Generation
- `POST /api/upload` - Upload image, create session
- `POST /api/scrape` - Scrape product from URL
- `POST /api/generate-single/:sessionId/:variationIndex` - Generate one image (deducts 1 credit on success)
- `POST /api/regenerate/:sessionId/:variationIndex` - Regenerate one image (deducts 1 credit)

### Billing
- `POST /api/billing/create-checkout` - Create Stripe checkout session
- `POST /api/billing/webhook` - Stripe webhook handler
- `GET /api/billing/portal` - Stripe customer portal redirect

---

## Immediate Next Steps

1. **Build and test per-image credit deduction**
   - `npm run build`
   - Register new user
   - Generate images, watch credits decrement

2. **Fix any UI issues**
   - Header showing correct auth state
   - Credits indicator updating in real-time

3. **Set up Stripe** (when ready for payments)
   - Create Stripe test account
   - Add products/prices
   - Configure webhooks
   - Add real keys to `.dev.vars`

4. **Deploy to production**
   - Create Cloudflare Pages project
   - Create production D1 database
   - Apply migrations
   - Set secrets
   - Deploy

---

## Testing Protocol Reference

A comprehensive testing protocol was provided covering:
- Phase 1: Database integrity
- Phase 2: Backend API testing
- Phase 3: Frontend testing
- Phase 4: Stripe integration
- Phase 5: Security testing
- Phase 6: Performance testing

Most of Phase 1-2 passed. Phase 3-6 pending after build works.

---

## Known Issues

1. **Build timeout** - The sandbox was experiencing memory issues causing `npm run build` to hang. Fresh chat should resolve.

2. **D1 state mismatch** - Wrangler CLI and running server sometimes use different D1 instances. Restart server after migrations.

3. **Stripe keys** - Using placeholders, so billing endpoints return 500. Need real test keys.

---

## Contact / Notes

- Project owner: Daniel Nicholls (Superman)
- AI Academy Brotherhood project
- Goal: SaaS product photography tool with credit-based monetization
