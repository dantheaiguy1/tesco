# ShopShot - Complete Technical Specification

## Document Purpose
This specification provides everything an AI assistant needs to understand, maintain, and extend the ShopShot application. Read this document completely before making any changes.

---

## 1. PROJECT OVERVIEW

### What is ShopShot?
ShopShot is an AI-powered product photography tool that transforms a single product photo into 10 professional e-commerce images in seconds. It targets online sellers (eBay, Etsy, Amazon, Shopify) who need high-quality product photos without hiring photographers.

### Live URLs
- **Production**: https://shopshot.pages.dev
- **Admin Dashboard**: https://shopshot.pages.dev/admin
- **GitHub**: https://github.com/dantheaiguy1/tesco

### Tech Stack
| Layer | Technology |
|-------|------------|
| Backend | Hono (TypeScript) on Cloudflare Workers |
| Frontend | Vanilla JS + TailwindCSS (CDN) |
| Database | Cloudflare D1 (SQLite) |
| AI Models | Google Vertex AI (Gemini) |
| Payments | Stripe (subscriptions + one-time) |
| Email | Resend |
| Auth | Email/password + Google OAuth |
| Hosting | Cloudflare Pages |

---

## 2. CRITICAL AI MODEL CONFIGURATION

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  WARNING: DO NOT CHANGE THESE VALUES                                         ║
║                                                                              ║
║  The AI models and endpoints are specifically configured and tested.        ║
║  Changing them WILL break image generation.                                 ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

### Dual Model System
| Model | Internal Name | Vertex AI Model ID | Use Case |
|-------|---------------|-------------------|----------|
| **Pro (Better)** | `nano` | `gemini-3-pro-image-preview` | Best quality, slower |
| **Standard (Cheaper)** | `flash` | `gemini-2.5-flash-image` | Fast, reliable |

### Endpoint Configuration
```typescript
const VERTEX_REGION = 'global';  // MUST be global, not us-central1

// Endpoint URL pattern:
// https://aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/global/publishers/google/models/{MODEL}:generateContent
```

### Authentication Flow
1. Service Account credentials stored in Cloudflare secrets
2. JWT created with RS256 signing
3. JWT exchanged for access token via Google OAuth
4. Access token used for Vertex AI requests

---

## 3. DUAL CREDIT SYSTEM

### Credit Types
| Type | Model | API Cost | Purpose |
|------|-------|----------|---------|
| `cheaper_credits` | Flash (Standard) | ~£0.031/image | Fast, budget option |
| `better_credits` | Pro (Better) | ~£0.107/image | Premium quality |

### Credit Allocation
```typescript
const CREDITS = {
  // Signup bonus (free tier)
  SIGNUP_CHEAPER: 10,
  SIGNUP_BETTER: 5,
  
  // Per image cost
  PER_IMAGE: 1,
  
  // Monthly subscription allocations
  STANDARD_CHEAPER: 500,  // £39.99/month
  STANDARD_BETTER: 45,
  PRO_CHEAPER: 300,       // £59.99/month
  PRO_BETTER: 175,
}
```

### Credit Deduction Logic
```typescript
// In deductCredits() function:
// 1. Check which model user selected (flash = cheaper, nano = better)
// 2. Deduct 1 credit of appropriate type
// 3. Log transaction in credit_transactions table
```

---

## 4. DATABASE SCHEMA

### Database: Cloudflare D1 (SQLite)
**Binding Name**: `TESCO_DB`

### Tables

#### users
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  cheaper_credits INTEGER NOT NULL DEFAULT 10,
  better_credits INTEGER NOT NULL DEFAULT 5,
  subscription_status TEXT DEFAULT 'free',  -- free, active, canceled, past_due
  subscription_plan TEXT DEFAULT 'free',     -- free, standard, pro
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  email_verified INTEGER DEFAULT 0,
  email_verification_code TEXT,
  email_verification_expires DATETIME,
  google_id TEXT,
  role TEXT DEFAULT 'user',                  -- user, admin
  is_banned INTEGER DEFAULT 0,
  password_reset_token TEXT,
  password_reset_expires DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### sessions (image generation sessions)
```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  original_image TEXT NOT NULL,           -- Base64 encoded
  thumbnail TEXT,                          -- Smaller preview
  product_name TEXT,
  status TEXT DEFAULT 'pending',
  model TEXT DEFAULT 'flash',
  user_id TEXT,
  credits_charged INTEGER DEFAULT 0,
  generation_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### generated_images
```sql
CREATE TABLE generated_images (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  variation_index INTEGER NOT NULL,
  image_data TEXT,                         -- Base64 encoded
  prompt TEXT,
  status TEXT DEFAULT 'pending',
  model TEXT DEFAULT 'flash',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
```

#### credit_transactions
```sql
CREATE TABLE credit_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL,                 -- Positive = add, Negative = deduct
  balance_after INTEGER NOT NULL,
  credit_type TEXT DEFAULT 'cheaper',      -- cheaper, better
  type TEXT NOT NULL,                      -- signup_bonus, subscription, topup, generation, refund
  description TEXT,
  session_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### user_sessions (auth sessions)
```sql
CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### error_logs
```sql
CREATE TABLE error_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  error_type TEXT NOT NULL,
  error_message TEXT,
  user_id TEXT,
  endpoint TEXT,
  severity TEXT DEFAULT 'warning'          -- info, warning, critical
);
```

#### admin_actions
```sql
CREATE TABLE admin_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  target_user_id TEXT,
  details TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 5. API ENDPOINTS

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register` | Register new user (sends verification email) |
| POST | `/api/auth/verify-email` | Verify email with 6-digit code |
| POST | `/api/auth/resend-verification` | Resend verification code |
| POST | `/api/auth/login` | Login with email/password |
| POST | `/api/auth/logout` | Logout (clear session) |
| GET | `/api/auth/me` | Get current user info |
| POST | `/api/auth/forgot-password` | Request password reset email |
| POST | `/api/auth/reset-password` | Reset password with token |
| GET | `/api/auth/google` | Initiate Google OAuth |
| GET | `/api/auth/google/callback` | Google OAuth callback |

### Image Generation
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload` | Upload product image, create session |
| POST | `/api/generate/:sessionId` | Generate all 10 variations |
| POST | `/api/generate-single/:sessionId/:index` | Regenerate single variation |
| GET | `/api/sessions` | List user's sessions |
| GET | `/api/sessions/:id` | Get session details |
| GET | `/api/sessions/:id/images` | Get generated images |
| PATCH | `/api/sessions/:id` | Update session (rename) |
| DELETE | `/api/sessions/:id` | Delete session |

### Billing
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/billing/create-checkout` | Create Stripe checkout session |
| POST | `/api/billing/webhook` | Stripe webhook handler |
| GET | `/api/billing/portal` | Get Stripe customer portal URL |
| GET | `/api/credits/balance` | Get user's credit balance |
| GET | `/api/credits/history` | Get credit transaction history |

### Admin (requires role = 'admin')
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/dashboard` | Get dashboard KPIs and data |
| GET | `/api/admin/users` | Search/list users |
| GET | `/api/admin/users/:id` | Get user details |
| POST | `/api/admin/users/:id/credits` | Add credits to user |
| POST | `/api/admin/users/:id/ban` | Ban/unban user |
| POST | `/api/admin/users/:id/role` | Change user role |
| GET | `/api/admin/export/users` | Export users as CSV |

### Utility
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check with service status |

---

## 6. PAGE ROUTES

| Route | Auth Required | Description |
|-------|---------------|-------------|
| `/` | No | Landing page (marketing) |
| `/app` | Yes | Main app (upload interface) |
| `/login` | No | Login page |
| `/register` | No | Registration page |
| `/forgot-password` | No | Request password reset |
| `/reset-password` | No | Reset password form |
| `/get-started` | No | Conversion-focused signup |
| `/dashboard` | Yes | User dashboard |
| `/account` | Yes | Account settings |
| `/pricing` | No | Pricing page |
| `/results/:id` | No | View generation results |
| `/history` | Yes | Redirects to `/` |
| `/admin` | Admin only | Admin dashboard |
| `/logout` | No | Logout and redirect |

---

## 7. 10 VARIATION TYPES

Each product photo generates these 10 professional variations:

| Index | Name | Description |
|-------|------|-------------|
| 0 | Texture Detail | Extreme close-up macro shot |
| 1 | Label & Branding | Brand elements focus |
| 2 | Hero (White BG) | Clean studio shot on white |
| 3 | In-Use Action | Product being used |
| 4 | Flat-Lay | Overhead styled arrangement |
| 5 | Environment | Lifestyle context shot |
| 6 | Color & Finish | Surface quality showcase |
| 7 | Size Reference | Scale comparison |
| 8 | Construction | Build quality details |
| 9 | Packaging | Retail presentation |

---

## 8. ENVIRONMENT VARIABLES

All stored as Cloudflare Pages secrets:

```bash
# AI Generation
VERTEX_PROJECT_ID=gen-lang-client-0469482378
VERTEX_CLIENT_EMAIL=shopshot-vertex-2@gen-lang-client-0469482378.iam.gserviceaccount.com
VERTEX_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GEMINI_API_KEY=xxx  # Legacy, not used with Vertex AI

# Stripe
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_PUBLISHABLE_KEY=pk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_ID_SUBSCRIPTION=price_xxx
STRIPE_PRICE_ID_TOPUP=price_xxx

# Email
RESEND_API_KEY=re_xxx

# Google OAuth
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxx

# Session
SESSION_SECRET=xxx

# Database (auto-bound)
TESCO_DB=<D1 binding>
```

---

## 9. FILE STRUCTURE

```
webapp/
├── src/
│   └── index.tsx              # Main app (ALL code - backend + frontend)
├── public/
│   └── static/
│       └── examples/          # Homepage example images
├── dist/                      # Build output
│   └── _worker.js             # Compiled Worker
├── .dev.vars                  # Local env vars (git-ignored)
├── wrangler.jsonc             # Cloudflare config
├── ecosystem.config.cjs       # PM2 config for local dev
├── package.json
├── tsconfig.json
├── README.md
└── SHOPSHOT_SPECIFICATION.md  # This file
```

---

## 10. KEY FUNCTIONS

### Image Generation Flow
```
1. User uploads image → POST /api/upload
   - Creates session in DB
   - Stores base64 image
   - Returns sessionId

2. User clicks generate → POST /api/generate/:sessionId
   - Checks credits
   - Deducts credits upfront
   - Calls generateAllVariations()

3. For each of 10 variations:
   - Build prompt using VARIATION_PROMPTS[index]
   - Call Vertex AI with image + prompt
   - Store result in generated_images table
   - Update progress via polling

4. User polls → GET /api/sessions/:id/images
   - Returns current status of all 10 images
   - Frontend shows progress bars
```

### Authentication Flow
```
Email Registration:
1. POST /api/auth/register → Create user, send 6-digit code
2. POST /api/auth/verify-email → Verify code, activate account
3. Set session cookie, redirect to /app

Google OAuth:
1. GET /api/auth/google → Redirect to Google
2. Google callback → /api/auth/google/callback
3. Create/update user, set session cookie
4. Redirect to /app

Session Management:
- Cookie name: 'session'
- httpOnly, secure, sameSite: 'Lax'
- 30-day expiration
- Stored in user_sessions table
```

### Credit Deduction Flow
```typescript
async function deductCredits(db, userId, creditType, sessionId) {
  // 1. Get user's current balance
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  
  // 2. Check sufficient credits
  const column = creditType === 'better' ? 'better_credits' : 'cheaper_credits';
  if (user[column] < 1) return { success: false, error: 'Insufficient credits' };
  
  // 3. Deduct credit
  const newBalance = user[column] - 1;
  await db.prepare(`UPDATE users SET ${column} = ? WHERE id = ?`).bind(newBalance, userId).run();
  
  // 4. Log transaction
  await db.prepare(`INSERT INTO credit_transactions ...`).run();
  
  return { success: true, newBalance };
}
```

---

## 11. STRIPE INTEGRATION

### Checkout Types
| Type | Mode | What it does |
|------|------|--------------|
| `subscription` | subscription | Start monthly plan |
| `topup` | payment | One-time credit pack |

### Webhook Events Handled
| Event | Action |
|-------|--------|
| `checkout.session.completed` | Add credits, activate subscription |
| `invoice.payment_succeeded` | Add monthly credits (renewal) |
| `customer.subscription.deleted` | Mark user as canceled |
| `invoice.payment_failed` | Mark user as past_due |

### Webhook Endpoint
```
POST /api/billing/webhook
- Verifies signature with STRIPE_WEBHOOK_SECRET
- Idempotent (checks stripe_events table)
- Logs errors to error_logs table
```

---

## 12. ADMIN DASHBOARD

### Access
- Route: `/admin`
- Requires: `user.role === 'admin'`
- To grant admin: `UPDATE users SET role = 'admin' WHERE email = 'xxx'`

### Features
1. **KPI Cards**: Total users, active subscribers, MRR, credits consumed
2. **Signups Chart**: Daily signups for last 30 days
3. **Cancellations Chart**: Daily cancellations for last 30 days
4. **Activity Feed**: Recent signups/cancellations with user details
5. **Revenue Breakdown**: By plan (Free/Standard/Pro)
6. **Error Log**: Last 24 hours with severity indicators
7. **Quick Actions**: Search users, add credits, export CSV
8. **User Modal**: Full user profile, transactions, ban/unban

### Auto-Refresh
Dashboard refreshes every 30 seconds automatically.

---

## 13. COMMON OPERATIONS

### Add Credits to User (Admin)
```bash
# Via API
curl -X POST https://shopshot.pages.dev/api/admin/users/{userId}/credits \
  -H "Content-Type: application/json" \
  -H "Cookie: session=xxx" \
  -d '{"amount": 50, "creditType": "cheaper", "reason": "Compensation"}'

# Via D1 directly
npx wrangler d1 execute tesco-image-generator-db --remote \
  --command="UPDATE users SET cheaper_credits = cheaper_credits + 50 WHERE email = 'user@example.com'"
```

### Grant Admin Access
```bash
npx wrangler d1 execute tesco-image-generator-db --remote \
  --command="UPDATE users SET role = 'admin' WHERE email = 'admin@example.com'"
```

### Check System Health
```bash
curl https://shopshot.pages.dev/api/health | jq .
```

### Deploy Changes
```bash
cd /home/user/webapp
npm run build
npx wrangler pages deploy dist --project-name shopshot
git add -A && git commit -m "Description" && git push origin main
```

---

## 14. KNOWN LIMITATIONS

1. **Cloudflare Workers Limits**
   - 10ms CPU time (free) / 30ms (paid) per request
   - 10MB compressed bundle size
   - No filesystem access at runtime

2. **Google OAuth**
   - Currently in test mode (only approved test users)
   - To allow all users: Publish app in Google Cloud Console

3. **Resend Email**
   - Using sandbox address (`onboarding@resend.dev`)
   - To use custom domain: Verify domain in Resend dashboard

4. **Image Storage**
   - Images stored as base64 in D1 (not ideal for large scale)
   - Future: Migrate to Cloudflare R2 for blob storage

---

## 15. TROUBLESHOOTING

### "Publisher model format" Error
- **Cause**: Wrong region or model name
- **Fix**: Ensure `VERTEX_REGION = 'global'`

### Images Not Generating
1. Check `/api/health` returns all services OK
2. Verify Vertex AI credentials in Cloudflare secrets
3. Check service account has `Vertex AI User` role in GCP

### 429 Rate Limit
- Shouldn't happen with Vertex AI (pay-per-use)
- If using Google AI Studio key instead, switch to Vertex AI

### User Can't Login
- Check if `email_verified = 1` in users table
- Check if `is_banned = 0`
- For Google users, ensure `google_id` is set

### Webhook Not Working
- Verify `STRIPE_WEBHOOK_SECRET` is set
- Check webhook URL in Stripe dashboard matches
- Look for errors in admin dashboard error log

---

## 16. CONTACT & OWNERSHIP

**Owner**: Daniel David Peter Nichols
**Project**: AI Academy / AI Agency
**Support**: GitHub Issues

---

## Document Version
- **Created**: November 28, 2025
- **Last Updated**: November 28, 2025
- **App Version**: Production

---

**END OF SPECIFICATION**
