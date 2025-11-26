# ShopShot - Cloudflare Deployment Handover

## Quick Start - Deploy Immediately

```bash
# Clone and deploy
git clone https://github.com/dantheaiguy1/tesco.git
cd tesco
npm install
npm run build
npx wrangler pages deploy dist --project-name shopshot
```

## Project Overview

**ShopShot** is an AI-powered product photo generator that transforms product images into professional marketing shots using Google's Vertex AI (Gemini models).

- **Repository**: https://github.com/dantheaiguy1/tesco
- **Tech Stack**: Hono.js + Cloudflare Pages + D1 Database + Vertex AI
- **Status**: Fully tested and ready for production deployment

---

## Cloudflare Configuration Required

### 1. D1 Database

The project uses an existing D1 database. Verify it exists or create:

```bash
# Check if database exists
npx wrangler d1 list

# Database details (from wrangler.jsonc):
# - database_name: tesco-image-generator-db
# - database_id: 7418ff05-a1c5-41d5-8238-4c1373e2b4f6
```

If database doesn't exist:
```bash
npx wrangler d1 create tesco-image-generator-db
# Update wrangler.jsonc with new database_id
```

### 2. Environment Variables (Secrets)

Set these secrets in Cloudflare Pages dashboard or via CLI:

```bash
# Vertex AI (Google Cloud) - REQUIRED for image generation
npx wrangler pages secret put VERTEX_PROJECT_ID
# Value: gen-lang-client-0469482378

npx wrangler pages secret put VERTEX_CLIENT_EMAIL
# Value: shopshot-vertex-2@gen-lang-client-0469482378.iam.gserviceaccount.com

npx wrangler pages secret put VERTEX_PRIVATE_KEY
# Value: (Full PEM private key - see .dev.vars in repo for format)

# Stripe - REQUIRED for payments
npx wrangler pages secret put STRIPE_SECRET_KEY
npx wrangler pages secret put STRIPE_PUBLISHABLE_KEY
npx wrangler pages secret put STRIPE_WEBHOOK_SECRET
npx wrangler pages secret put STRIPE_PRICE_ID_SUBSCRIPTION
npx wrangler pages secret put STRIPE_PRICE_ID_TOPUP

# Session - REQUIRED for auth
npx wrangler pages secret put SESSION_SECRET
# Value: Any secure random string (32+ characters)
```

### 3. wrangler.jsonc Configuration

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "shopshot",
  "compatibility_date": "2025-11-24",
  "pages_build_output_dir": "./dist",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [
    {
      "binding": "TESCO_DB",
      "database_name": "tesco-image-generator-db",
      "database_id": "7418ff05-a1c5-41d5-8238-4c1373e2b4f6"
    }
  ]
}
```

---

## Deployment Commands

```bash
# Build and deploy
npm run build
npx wrangler pages deploy dist --project-name shopshot

# Or use the convenience script
npm run deploy:prod
```

---

## Post-Deployment Verification

### 1. Health Check
```
GET https://shopshot.pages.dev/api/health
```
Expected response:
```json
{
  "status": "ok",
  "hasGeminiKey": false,
  "keyLength": 0,
  "hasDB": true,
  "hasStripe": true
}
```

### 2. Test User Registration
```bash
curl -X POST https://shopshot.pages.dev/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123","name":"Test User"}'
```
Expected: User created with 10 Standard + 5 Pro credits

### 3. Test Pages Load
- `/` - Main app (product photo generator)
- `/login` - Login page
- `/register` - Registration page  
- `/pricing` - Pricing & plans
- `/dashboard` - User dashboard (requires auth)
- `/account` - Account settings (requires auth)

---

## Dual Credit System

The app uses two types of credits:

| Credit Type | Model | Speed | Use Case |
|-------------|-------|-------|----------|
| **Standard** (cheaper_credits) | Flash / Nano Banana | ~8 seconds | Fast, reliable generation |
| **Pro** (better_credits) | Nano / Nano Banana Pro | ~60-90+ seconds | Best quality (currently slow) |

### Signup Bonuses
- 10 Standard credits
- 5 Pro credits

### Known Issue
The Pro model (`gemini-3-pro-image-preview`) is currently experiencing high latency (60-90+ seconds) from Google's API. The app defaults to the Standard model for better user experience.

---

## Key Features

1. **Image Upload** - Upload product photos (JPG, PNG, WebP up to 10MB)
2. **AI Generation** - Generate 10 professional product shot variations
3. **Dual Credit System** - Standard (fast) and Pro (quality) options
4. **User Authentication** - Email/password with session cookies
5. **Stripe Integration** - Subscriptions and credit pack purchases
6. **Session Management** - Track and manage generation sessions

---

## File Structure

```
tesco/
├── src/
│   └── index.tsx          # Main application (all routes + UI)
├── dist/
│   └── _worker.js         # Built worker (deploy this)
├── .dev.vars              # Local environment variables (DO NOT COMMIT)
├── wrangler.jsonc         # Cloudflare configuration
├── package.json           # Dependencies and scripts
└── CLOUDFLARE_DEPLOY_HANDOVER.md  # This file
```

---

## Stripe Webhook Setup

After deployment, configure Stripe webhook:

1. Go to Stripe Dashboard → Developers → Webhooks
2. Add endpoint: `https://shopshot.pages.dev/api/billing/webhook`
3. Select events:
   - `checkout.session.completed`
   - `invoice.payment_succeeded`
   - `customer.subscription.deleted`
4. Copy webhook signing secret to `STRIPE_WEBHOOK_SECRET`

---

## Database Schema

The D1 database auto-initializes with these tables:
- `users` - User accounts with dual credits
- `sessions` - Image generation sessions
- `generated_images` - Generated image data
- `credit_transactions` - Credit history
- `user_sessions` - Auth sessions
- `stripe_events` - Webhook idempotency

---

## Troubleshooting

### "Vertex AI credentials not configured"
Ensure all three Vertex AI secrets are set:
- `VERTEX_PROJECT_ID`
- `VERTEX_CLIENT_EMAIL`
- `VERTEX_PRIVATE_KEY`

### Image generation timing out
The Pro model is slow. Use Standard model (flash) for faster results.

### Database errors
Run migrations or let the app auto-initialize:
```bash
npx wrangler d1 migrations apply TESCO_DB
```

---

## Contact

Repository: https://github.com/dantheaiguy1/tesco
Last Updated: November 26, 2025
