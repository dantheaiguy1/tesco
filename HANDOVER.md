# ShopShot - AI Assistant Handover Document

**Date:** November 26, 2025  
**Status:** PRODUCTION READY - ALL FEATURES WORKING  
**Owner:** Daniel David Peter Nichols (Superman)

---

## CRITICAL WARNING - READ FIRST

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  DO NOT CHANGE THE AI MODEL CONFIGURATION                                    ║
║                                                                              ║
║  MODEL: gemini-3-pro-image-preview (Nano Banana Pro)                        ║
║  REGION: global (NOT us-central1, NOT europe-west4)                         ║
║  ENDPOINT: aiplatform.googleapis.com                                         ║
║                                                                              ║
║  These values are CORRECT and FINAL. Do not suggest alternatives.           ║
║  See src/index.tsx lines 13-28 for the locked configuration.                ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

## 1. Project Overview

**ShopShot** transforms one product photo into 10 professional ecommerce shots using Google's Gemini 3 Pro Image API (Nano Banana Pro).

### URLs
- **Production:** https://shopshot.pages.dev
- **GitHub:** https://github.com/dantheaiguy1/tesco
- **Code Location:** `/home/user/webapp`

### What It Does
1. User uploads a product image (or pastes URL)
2. AI generates 10 professional variations in ~36 seconds
3. User can download all as ZIP, regenerate individuals, rename sessions
4. Session history persists in database

---

## 2. Current Status - ALL WORKING

| Feature | Status | Notes |
|---------|--------|-------|
| Image Upload | ✅ Working | Drag & drop, file select |
| URL Scraping | ✅ Working | Paste product URL |
| 10 Variations | ✅ Working | ~3-4 seconds each |
| Progress Bars | ✅ Working | Real-time per-variation |
| Lightbox Viewer | ✅ Working | Click to enlarge |
| Download All (ZIP) | ✅ Working | JSZip library |
| Individual Regenerate | ✅ Working | Per-variation button |
| Session Renaming | ✅ Working | Editable product name |
| History Page | ✅ Working | /history route |
| Advanced Mode | ✅ Working | Custom prompts modal |
| Database Storage | ✅ Working | Cloudflare D1 |
| Vertex AI Backend | ✅ Working | Pay-per-use, no quota limits |

---

## 3. Tech Stack

### Backend
- **Framework:** Hono (TypeScript)
- **Runtime:** Cloudflare Workers/Pages
- **Database:** Cloudflare D1 (SQLite)

### Frontend
- **JavaScript:** Vanilla JS (no framework)
- **CSS:** TailwindCSS via CDN
- **Icons:** Font Awesome via CDN
- **ZIP:** JSZip via CDN

### AI/ML
- **Model:** `gemini-3-pro-image-preview` (Nano Banana Pro)
- **Provider:** Google Vertex AI
- **Endpoint:** Global (`aiplatform.googleapis.com`)
- **Auth:** Service Account OAuth2 (JWT)

### Infrastructure
- **Hosting:** Cloudflare Pages
- **Database:** Cloudflare D1
- **Secrets:** Cloudflare Pages Secrets

---

## 4. File Structure

```
/home/user/webapp/
├── src/
│   └── index.tsx          # Main app (2723 lines) - backend + frontend
├── public/                 # Static assets (if any)
├── dist/                   # Build output
├── .dev.vars              # Local env vars (git-ignored)
├── wrangler.jsonc         # Cloudflare config
├── ecosystem.config.cjs   # PM2 dev server config
├── package.json           # Dependencies
├── tsconfig.json          # TypeScript config
├── vite.config.ts         # Build config
├── README.md              # Project docs
└── HANDOVER.md            # This file
```

---

## 5. Key Code Locations

### Model Configuration (DO NOT CHANGE)
**File:** `src/index.tsx` lines 13-28
```typescript
const VERTEX_REGION = 'global';
const VERTEX_MODEL = 'gemini-3-pro-image-preview';
```

### Environment Bindings
**File:** `src/index.tsx` lines 4-11
```typescript
type Bindings = {
  TESCO_DB: D1Database;
  GEMINI_API_KEY: string;
  VERTEX_PROJECT_ID: string;
  VERTEX_CLIENT_EMAIL: string;
  VERTEX_PRIVATE_KEY: string;
}
```

### API Routes
**File:** `src/index.tsx`

| Route | Line | Method | Purpose |
|-------|------|--------|---------|
| `/` | 223 | GET | Home page |
| `/history` | 228 | GET | History page |
| `/results/:id` | 233 | GET | Results page |
| `/api/health` | 317 | GET | Health check |
| `/api/upload` | 339 | POST | Upload image |
| `/api/scrape` | 394 | POST | Scrape URL |
| `/api/sessions` | 238 | GET | List sessions |
| `/api/sessions/:id` | 253 | GET | Get session |
| `/api/sessions/:id` | 715 | PATCH | Update session |
| `/api/sessions/:id` | 689 | DELETE | Delete session |
| `/api/sessions/:id/images` | 282 | POST | Save image |
| `/api/generate-single/:sessionId/:variationIndex` | 534 | POST | Generate one variation |
| `/api/generate/:id` | 613 | POST | Legacy: generate all |

### 10 Variation Definitions
**File:** `src/index.tsx` lines 491-502
```typescript
const variationDefinitions = [
  { field: 'macro_texture', label: '1. Texture Detail' },
  { field: 'label_branding', label: '2. Label & Branding' },
  { field: 'construction_detail', label: '3. Construction Detail' },
  { field: 'color_finish', label: '4. Color & Finish' },
  { field: 'scale_reference', label: '5. Size Reference' },
  { field: 'hero_white', label: '6. Hero (White BG)' },
  { field: 'inuse_action', label: '7. In-Use Action' },
  { field: 'flatlay_styled', label: '8. Flat-Lay Styled' },
  { field: 'environment_context', label: '9. Environment Context' },
  { field: 'multi_angle', label: '10. Multiple Angles' }
]
```

### Prompts
**File:** `src/index.tsx` lines 504-531
Function `getPrompts(productName)` returns strategic ecommerce prompts for each variation.

---

## 6. Database Schema

**Database:** Cloudflare D1  
**Binding:** `TESCO_DB`  
**Database ID:** `7418ff05-a1c5-41d5-8238-4c1373e2b4f6`

### Tables

**sessions**
```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  product_name TEXT NOT NULL,
  source_type TEXT NOT NULL,      -- 'upload' or 'url'
  source_url TEXT,
  original_image TEXT,            -- base64 thumbnail
  status TEXT DEFAULT 'pending',  -- pending/generating/completed/failed
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**generated_images**
```sql
CREATE TABLE generated_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  variation_type TEXT NOT NULL,
  variation_index INTEGER NOT NULL,
  image_data TEXT NOT NULL,       -- compressed base64
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
```

---

## 7. Environment Variables

### Production (Cloudflare Secrets)
```
VERTEX_PROJECT_ID=gen-lang-client-0469482378
VERTEX_CLIENT_EMAIL=shopshot-vertex-2@gen-lang-client-0469482378.iam.gserviceaccount.com
VERTEX_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n
GEMINI_API_KEY=(legacy - not used)
```

### Local Development (.dev.vars)
Same variables, stored in `/home/user/webapp/.dev.vars` (git-ignored)

---

## 8. Deployment Commands

### Build & Deploy
```bash
cd /home/user/webapp
npm run build
npx wrangler pages deploy dist --project-name shopshot
```

### Local Development
```bash
cd /home/user/webapp
npm run build
pm2 start ecosystem.config.cjs
# Test: curl http://localhost:3000/api/health
```

### Restart Server
```bash
fuser -k 3000/tcp 2>/dev/null || true
pm2 restart all
```

---

## 9. GCP/Vertex AI Details

### Project
- **Project ID:** gen-lang-client-0469482378
- **Billing Account:** 010883-7BFA46-FF87D1

### Service Account
- **Email:** shopshot-vertex-2@gen-lang-client-0469482378.iam.gserviceaccount.com
- **Role:** Vertex AI User

### API Endpoint
```
POST https://aiplatform.googleapis.com/v1/projects/gen-lang-client-0469482378/locations/global/publishers/google/models/gemini-3-pro-image-preview:generateContent
```

### Cost Monitoring
https://console.cloud.google.com/billing/010883-7BFA46-FF87D1/reports?project=gen-lang-client-0469482378

### Estimated Costs
- ~$0.03-0.05 per product shoot (10 variations)
- ~$30-50 per 1000 product shoots

---

## 10. Common Issues & Fixes

### "Publisher model format" Error
**Cause:** Wrong region  
**Fix:** Ensure `VERTEX_REGION = 'global'` (not us-central1)

### 429 Rate Limit
**Cause:** Using Google AI Studio instead of Vertex AI  
**Fix:** Use Vertex AI with service account (pay-per-use, no limits)

### Empty Advanced Mode Modal
**Cause:** CSS flexbox issue  
**Fix:** Already fixed - modal uses Tailwind classes

### Images Not Generating
1. Check `/api/health` endpoint
2. Verify Vertex AI credentials in Cloudflare secrets
3. Confirm service account has `Vertex AI User` role

---

## 11. What NOT to Change

1. **Model name** - Must be `gemini-3-pro-image-preview`
2. **Region** - Must be `global`
3. **Endpoint format** - Must use `aiplatform.googleapis.com` (not `{region}-aiplatform...`)
4. **Auth method** - Must use Service Account OAuth2

---

## 12. Future Enhancement Ideas

- [ ] Cloudflare R2 for image storage (larger files)
- [ ] Batch upload (multiple products)
- [ ] API rate limiting
- [ ] User authentication
- [ ] Usage analytics dashboard
- [ ] Custom variation templates
- [ ] White-label branding options

---

## 13. Contact & Support

**Owner:** Daniel David Peter Nichols  
**Email:** dan@danielnicholls.com  
**GitHub:** @dantheaiguy1

---

## Summary

ShopShot is **production-ready**. All 10 variations generate successfully using Nano Banana Pro via Vertex AI global endpoint. Do not modify the model configuration. Costs are pay-per-use with no quota limits.

**Live URL:** https://shopshot.pages.dev
