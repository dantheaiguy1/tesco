# ShopShot - Complete Project Handover

## Project Overview
**ShopShot** is an AI-powered product photography SaaS that transforms any product photo into 10 professional variations in ~36 seconds. Built with Hono framework on Cloudflare Pages.

**Live URL**: https://shopshot.pages.dev
**GitHub**: https://github.com/dantheaiguy1/tesco
**Cloudflare Project**: shopshot

---

## Quick Start for New Session

```bash
# Clone and setup
cd /home/user/webapp

# Build and deploy
npm run build
npx wrangler pages deploy dist --project-name shopshot

# Local development
npm run build
pm2 start ecosystem.config.cjs
# Then visit http://localhost:3000
```

---

## Technology Stack

- **Framework**: Hono (TypeScript)
- **Hosting**: Cloudflare Pages
- **Database**: Cloudflare D1 (SQLite)
- **AI**: Google Vertex AI (Gemini models)
- **Payments**: Stripe
- **Auth**: Custom session-based auth with cookies

---

## Cloudflare Configuration

### Project Details
- **Project Name**: `shopshot`
- **D1 Database Name**: `tesco-image-generator-db`
- **D1 Database ID**: `7418ff05-a1c5-41d5-8238-4c1373e2b4f6`
- **D1 Binding**: `TESCO_DB`

### wrangler.jsonc
```json
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

## Environment Variables / Secrets

### Required Cloudflare Pages Secrets
These are already configured in production. To view/update:
```bash
npx wrangler pages secret list --project-name shopshot
```

| Secret Name | Description | How to Get |
|-------------|-------------|------------|
| `GEMINI_API_KEY` | Google AI API key | Google AI Studio |
| `VERTEX_PROJECT_ID` | GCP Project ID for Vertex AI | Google Cloud Console |
| `VERTEX_CLIENT_EMAIL` | Service account email | GCP IAM |
| `VERTEX_PRIVATE_KEY` | Service account private key | GCP IAM (JSON key file) |
| `STRIPE_SECRET_KEY` | Stripe secret key (sk_live_...) | Stripe Dashboard |
| `STRIPE_PUBLISHABLE_KEY` | Stripe public key (pk_live_...) | Stripe Dashboard |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (whsec_...) | Stripe Webhooks |
| `STRIPE_PRICE_ID_SUBSCRIPTION` | Price ID for subscription | Stripe Products |
| `STRIPE_PRICE_ID_TOPUP` | Price ID for credit top-ups | Stripe Products |
| `SESSION_SECRET` | Random string for session signing | Generate: `openssl rand -hex 32` |

### Setting Secrets
```bash
# Set a secret
npx wrangler pages secret put SECRET_NAME --project-name shopshot

# Example
echo "your-api-key" | npx wrangler pages secret put GEMINI_API_KEY --project-name shopshot
```

### For Local Development (.dev.vars)
Create `/home/user/webapp/.dev.vars`:
```
GEMINI_API_KEY=your_gemini_key
VERTEX_PROJECT_ID=your_project_id
VERTEX_CLIENT_EMAIL=your_service_account@project.iam.gserviceaccount.com
VERTEX_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID_SUBSCRIPTION=price_...
STRIPE_PRICE_ID_TOPUP=price_...
SESSION_SECRET=random_32_char_string
```

---

## AI Models Configuration

### Vertex AI Models (in src/index.tsx)
```typescript
const MODELS = {
  nano: 'gemini-3-pro-image-preview',   // BETTER - Best quality, slower
  flash: 'gemini-2.5-flash-image'       // CHEAPER - Fast & reliable
};
```

### Credit Costs
- **Standard (flash)**: 1 cheaper_credit per image
- **Pro (nano)**: 1 better_credit per image
- Each generation = 10 images = 10 credits

---

## Pricing Configuration

### Subscription Plans (in src/index.tsx)
```typescript
const PRICING = {
  STANDARD: 39.99,  // GBP/month
  PRO: 59.99,       // GBP/month
}

const CREDITS = {
  SIGNUP_CHEAPER: 10,      // Free standard credits on signup
  SIGNUP_BETTER: 5,        // Free pro credits on signup
  STANDARD_CHEAPER: 500,   // Standard plan monthly credits
  STANDARD_BETTER: 45,
  PRO_CHEAPER: 300,        // Pro plan monthly credits
  PRO_BETTER: 175,
}
```

---

## Page Routes

| Route | Description | Auth Required |
|-------|-------------|---------------|
| `/` | Marketing homepage (logged out) / App (logged in) | No |
| `/app` | App homepage | Yes (redirects to /get-started) |
| `/get-started` | Pricing + Login form | No |
| `/register` | Signup form (accepts ?plan=free/standard/pro) | No |
| `/login` | Login form | No |
| `/pricing` | Full pricing page | No |
| `/results/:id` | View generation results | No |
| `/dashboard` | User dashboard | Yes |
| `/account` | Account settings | Yes |
| `/logout` | Logout and redirect | Yes |

---

## Database Schema

### Tables
1. **users** - User accounts with credits and subscription info
2. **sessions** - Image generation sessions
3. **credit_transactions** - Credit usage history
4. **stripe_events** - Stripe webhook event log
5. **user_sessions** - Auth session tokens

### Key Commands
```bash
# Apply migrations locally
npx wrangler d1 migrations apply TESCO_DB --local

# Apply migrations to production
npx wrangler d1 migrations apply TESCO_DB

# Query production database
npx wrangler d1 execute TESCO_DB --command "SELECT * FROM users LIMIT 10"
```

---

## Recent Changes (This Session)

1. **Separated signup/login flows**
   - `/get-started` now shows pricing (75%) + login only (25%)
   - `/register` handles signup with optional `?plan=` parameter
   - After signup with plan=standard/pro, auto-redirects to Stripe checkout

2. **Marketing Homepage**
   - New marketing page at `/` for logged-out users
   - Hero with full background image (product photo from Unsplash)
   - Features section, How It Works, Use Cases, Pricing preview
   - Final CTA section

3. **Security**
   - Removed anonymous upload/preview generation
   - All generation requires authentication
   - Server-side auth verification before any generation

---

## File Structure

```
/home/user/webapp/
├── src/
│   └── index.tsx          # Main app (all routes, pages, API)
├── migrations/
│   ├── 0001_initial.sql
│   └── 0002_users.sql
├── dist/                   # Built output
├── public/                 # Static assets
├── wrangler.jsonc          # Cloudflare config
├── package.json
├── vite.config.ts
├── tsconfig.json
└── ecosystem.config.cjs    # PM2 config for local dev
```

---

## Common Commands

```bash
# Build
npm run build

# Deploy to production
npx wrangler pages deploy dist --project-name shopshot

# Local development
npm run build
pm2 start ecosystem.config.cjs
pm2 logs shopshot --nostream

# Git
git add . && git commit -m "message" && git push origin main

# Check deployment
curl https://shopshot.pages.dev
```

---

## Stripe Webhook Setup

Endpoint: `https://shopshot.pages.dev/api/billing/webhook`

Events to enable:
- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

---

## Known Issues / TODO

1. Hero background image uses Unsplash - consider hosting own image for reliability
2. Tailwind loaded from CDN - should bundle for production
3. No password reset flow implemented yet
4. No email verification on signup

---

## Contact / Support

- **Support Email**: support@shopshot.ai (configured in footer)
- **GitHub**: https://github.com/dantheaiguy1/tesco

---

## Last Updated
November 27, 2025

**Last Commit**: `5e93767` - "Hero: full background image (no opacity), remove AI badge, add frosted glass content card"
