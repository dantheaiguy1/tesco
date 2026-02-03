# ShopShot - AI Product Photography Tool

## Project Overview

**Name:** ShopShot  
**Live URL:** https://www.shopshot.co.uk  
**GitHub:** https://github.com/dantheaiguy1/tesco  
**Last Updated:** February 3, 2026

Transform one product photo into 10 professional ecommerce shots in seconds using AI.

---

## AI MODEL CONFIGURATION (Updated Feb 2026)

ShopShot now uses **Gemini API Direct** for image generation (500 RPM limit = all 10 images in parallel!).

**Primary API: Gemini API Direct**
- Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- Models:
  - `gemini-2.5-flash-image` - Standard (fast, high-volume)
  - `gemini-3-pro-image-preview` - Pro/Premium (best quality)

**Fallback: Vertex AI** (if Gemini Direct fails)
- Endpoint: `https://aiplatform.googleapis.com/v1/projects/{project}/locations/global/publishers/google/models/{model}:generateContent`
- Same models as above

---

## Features

### Core Features
- [x] Image upload (drag & drop, file select)
- [x] 10 professional variation generation (parallel!)
- [x] Progress bars with real-time status
- [x] Lightbox image viewer
- [x] Download All as ZIP
- [x] Individual image regenerate
- [x] Session renaming
- [x] History page (/history)
- [x] Advanced Mode (custom prompts)
- [x] D1 database storage
- [x] User authentication (email/password + Google OAuth)
- [x] Credit system (Standard + Premium credits)
- [x] Stripe subscription integration
- [x] 360 video generation (experimental)
- [x] Thumbs up/down feedback system
- [x] Admin dashboard & analytics

### 10 Variation Types
1. Macro/Texture Detail - Extreme close-up macro
2. Label & Branding - Brand elements focus
3. Construction Detail - Build quality details
4. Color & Finish - Surface quality showcase
5. Scale Reference - Size comparison
6. Hero (White BG) - Clean studio shot
7. In-Use Action - Product being used
8. Flat-Lay Styled - Overhead styled arrangement
9. Environment Context - Lifestyle setting

---

## Tech Stack

- **Backend:** Hono (TypeScript) on Cloudflare Workers/Pages
- **Frontend:** Vanilla JS + TailwindCSS CDN
- **Database:** Cloudflare D1 (SQLite)
- **AI Model:** Gemini API Direct (gemini-2.5-flash-image / gemini-3-pro-image-preview)
- **AI Fallback:** Google Vertex AI (global endpoint)
- **Authentication:** Session-based + Google OAuth
- **Payments:** Stripe Checkout + Webhooks
- **Email:** Resend API
- **Marketing:** Loops integration

---

## Environment Variables (Cloudflare Secrets)

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | **Primary** - Gemini API Direct key |
| `VERTEX_PROJECT_ID` | Fallback - GCP Project ID |
| `VERTEX_CLIENT_EMAIL` | Fallback - Service account email |
| `VERTEX_PRIVATE_KEY` | Fallback - Service account private key |
| `STRIPE_SECRET_KEY` | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `RESEND_API_KEY` | Email service |
| `GOOGLE_CLIENT_ID` | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret |

---

## API Endpoints

### Public
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Landing page |
| `/app` | GET | Main application |
| `/pricing` | GET | Pricing page |
| `/history` | GET | Session history |
| `/results/:id` | GET | View session results |
| `/login` | GET | Login page |
| `/register` | GET | Registration page |

### API
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/auth/register` | POST | User registration |
| `/api/auth/login` | POST | User login |
| `/api/auth/google` | POST | Google OAuth |
| `/api/sessions` | GET | List user sessions |
| `/api/generate-single/:sessionId/:variationIndex` | POST | Generate single variation |
| `/api/feedback` | POST | Submit image feedback |
| `/api/regenerate-with-feedback/:sessionId/:variationIndex` | POST | Regenerate with feedback |

### Admin
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/admin/analytics` | GET | Admin dashboard |
| `/api/admin/analytics/overview` | GET | Stats overview |
| `/api/admin/analytics/funnel` | GET | Conversion funnel |
| `/api/admin/analytics/feedback` | GET | Feedback analytics |
| `/api/admin/users` | GET | User management |

---

## Local Development

```bash
# Install dependencies
npm install

# Create .dev.vars with credentials
cat > .dev.vars << EOF
GEMINI_API_KEY=your-gemini-api-key
VERTEX_PROJECT_ID=your-project-id
VERTEX_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com
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
curl https://www.shopshot.co.uk/api/health
```

---

## Admin Dashboard

**URL:** https://www.shopshot.co.uk/admin/analytics

Features:
- Conversion funnel (Visits → Signups → Uploads → Generations → Purchases)
- User feedback analytics (Thumbs up/down, reasons, by variation type)
- Live activity stream
- User management
- Generation statistics

---

## Feedback System

Users can rate generated images:
- 👍 Thumbs up - Good result
- 👎 Thumbs down - Opens feedback modal with reasons:
  - Wrong theme/context
  - Product distorted
  - Wrong colors
  - Bad composition
  - Background issue
  - Other

Feedback is stored in `image_feedback` table and visible in admin analytics.

---

## Project Structure

```
webapp/
├── src/
│   └── index.tsx          # Main app (backend + frontend)
├── public/                 # Static assets
│   └── static/            # Images, logos
├── dist/                   # Build output
├── migrations/            # D1 database migrations
├── .dev.vars              # Local env vars (git-ignored)
├── wrangler.jsonc         # Cloudflare config
├── ecosystem.config.cjs   # PM2 config
├── package.json
└── README.md
```

---

## Contact

**Owner:** Daniel David Peter Nicholls  
**Email:** dan@danielnicholls.com  
**Project:** ShopShot AI Product Photography

---

## License

Proprietary - All Rights Reserved

---

**Built for professional e-commerce product photography**
