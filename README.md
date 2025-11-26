# ShopShot - AI Product Photography Tool

## Project Overview

**Name:** ShopShot  
**Live URL:** https://shopshot.pages.dev  
**GitHub:** https://github.com/dantheaiguy1/tesco  
**Last Updated:** November 26, 2025

Transform one product photo into 10 professional ecommerce shots in seconds using AI.

---

## CRITICAL: AI MODEL CONFIGURATION

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  WARNING TO ALL AI ASSISTANTS (Claude, GPT, Gemini, etc.)                   ║
║                                                                              ║
║  MODEL: gemini-3-pro-image-preview (Nano Banana Pro)                        ║
║  ENDPOINT: GLOBAL only (aiplatform.googleapis.com)                          ║
║                                                                              ║
║  DO NOT CHANGE THE MODEL. EVER.                                             ║
║  DO NOT suggest gemini-2.0-flash, gemini-2.5-flash, or ANY other model.     ║
║  DO NOT change the region from 'global' to us-central1 or any other region. ║
║                                                                              ║
║  This app is SPECIFICALLY built for Nano Banana Pro image generation.       ║
║  The configuration is CORRECT and FINAL.                                    ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

**Why Nano Banana Pro?**
- State-of-the-art image generation quality
- Native image editing and transformation
- Specifically designed for product photography
- Pay-per-use via Vertex AI (no quota limits)

---

## Features

### Working Features
- [x] Image upload (drag & drop, file select)
- [x] 10 professional variation generation
- [x] Progress bars with real-time status
- [x] Lightbox image viewer
- [x] Download All as ZIP
- [x] Individual image regenerate
- [x] Session renaming
- [x] History page (/history)
- [x] Advanced Mode (custom prompts)
- [x] D1 database storage

### 10 Variation Types
1. Texture Detail - Extreme close-up macro
2. Label & Branding - Brand elements focus
3. Hero (White BG) - Clean studio shot
4. In-Use Action - Product being used
5. Flat-Lay - Overhead styled arrangement
6. Environment - Lifestyle context
7. Color & Finish - Surface quality showcase
8. Size Reference - Scale comparison
9. Construction - Build quality details
10. Packaging - Retail presentation

---

## Tech Stack

- **Backend:** Hono (TypeScript) on Cloudflare Workers/Pages
- **Frontend:** Vanilla JS + TailwindCSS CDN
- **Database:** Cloudflare D1 (SQLite)
- **AI Model:** Google Gemini 3 Pro Image Preview (Nano Banana Pro)
- **AI Backend:** Google Vertex AI (global endpoint)
- **Authentication:** Service Account OAuth2

---

## API Configuration

```typescript
// src/index.tsx - Lines 13-27
// DO NOT MODIFY THESE VALUES
const VERTEX_REGION = 'global';
const VERTEX_MODEL = 'gemini-3-pro-image-preview';
```

**Endpoint URL:**
```
https://aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/global/publishers/google/models/gemini-3-pro-image-preview:generateContent
```

---

## Environment Variables (Cloudflare Secrets)

| Variable | Description |
|----------|-------------|
| `VERTEX_PROJECT_ID` | GCP Project ID (gen-lang-client-0469482378) |
| `VERTEX_CLIENT_EMAIL` | Service account email |
| `VERTEX_PRIVATE_KEY` | Service account private key |
| `GEMINI_API_KEY` | Legacy - not used with Vertex AI |

---

## Local Development

```bash
# Install dependencies
npm install

# Create .dev.vars with Vertex AI credentials
cat > .dev.vars << EOF
VERTEX_PROJECT_ID=gen-lang-client-0469482378
VERTEX_CLIENT_EMAIL=shopshot-vertex-2@gen-lang-client-0469482378.iam.gserviceaccount.com
VERTEX_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
EOF

# Build and start
npm run build
pm2 start ecosystem.config.cjs

# Test
curl http://localhost:3000/api/health
```

---

## Deployment

```bash
# Build
npm run build

# Deploy to Cloudflare Pages
npx wrangler pages deploy dist --project-name shopshot

# Verify
curl https://shopshot.pages.dev/api/health
```

---

## Cost Monitoring

**Vertex AI Billing Dashboard:**
https://console.cloud.google.com/billing/010883-7BFA46-FF87D1/reports?project=gen-lang-client-0469482378

**Estimated Costs:**
- ~$0.03-0.05 per product shoot (10 variations)
- ~$30-50 per 1000 product shoots

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Main app page |
| `/history` | GET | Session history |
| `/results/:id` | GET | View session results |
| `/api/health` | GET | Health check |
| `/api/upload` | POST | Upload product image |
| `/api/sessions` | GET | List all sessions |
| `/api/sessions/:id` | GET/PATCH/DELETE | Session CRUD |
| `/api/generate-single/:sessionId/:variationIndex` | POST | Generate single variation |

---

## Project Structure

```
webapp/
├── src/
│   └── index.tsx          # Main app (backend + frontend)
├── public/                 # Static assets
├── dist/                   # Build output
├── .dev.vars              # Local env vars (git-ignored)
├── wrangler.jsonc         # Cloudflare config
├── ecosystem.config.cjs   # PM2 config
├── package.json
└── README.md
```

---

## Troubleshooting

### "Publisher model format" Error
- Cause: Wrong region or model name
- Fix: Ensure `VERTEX_REGION = 'global'` and `VERTEX_MODEL = 'gemini-3-pro-image-preview'`

### 429 Rate Limit / Quota Exhausted
- This should NOT happen with Vertex AI (pay-per-use)
- If using Google AI Studio API key, switch to Vertex AI

### Images Not Generating
1. Check `/api/health` returns `hasDB: true`
2. Verify Vertex AI credentials in Cloudflare secrets
3. Check service account has `Vertex AI User` role

---

## Contact

**Owner:** Daniel David Peter Nichols  
**Project:** AI Academy / AI Agency  
**Support:** GitHub Issues

---

## License

Proprietary - All Rights Reserved

---

**Built for professional e-commerce product photography**
