# Tesco Product Image Generator

Professional web application for Tesco's merchandising team that transforms single product images into 4 professional variations using AI.

## Live Demo URL

**Sandbox**: https://3000-i3jaxoqtv8qvpxm55jcdl-2e1b9533.sandbox.novita.ai

## Features

### Completed
- **Image Upload**: Drag & drop or click to upload product images (JPG, PNG, WebP up to 10MB)
- **Tesco URL Scraping**: Paste any Tesco.com product URL to auto-extract the product image
- **4 AI-Generated Variations**:
  - Lifestyle kitchen scene (warm, inviting, with context)
  - E-commerce hero shot (clean white background, professional)
  - Instagram flat-lay (overhead, styled, social media aesthetic)
  - Macro detail close-up (texture, quality emphasis)
- **Individual Downloads**: Download any single variation
- **ZIP Download**: Download all 5 images (original + 4 variations) as a single ZIP file
- **History Dashboard**: View all past generation sessions with thumbnails
- **Session Management**: Delete old sessions, re-download past generations
- **Professional UI**: Tesco brand colors (#00539F blue, #EE1C2E red)
- **Progress Indicators**: Real-time loading states during generation
- **Error Handling**: User-friendly error messages for all failure cases

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Homepage with upload/URL input |
| `/history` | GET | History dashboard |
| `/results/:id` | GET | Results page for a session |
| `/api/upload` | POST | Upload an image file |
| `/api/scrape` | POST | Scrape image from Tesco URL |
| `/api/generate/:id` | POST | Generate 4 variations |
| `/api/sessions` | GET | List all sessions |
| `/api/sessions/:id` | GET | Get single session |
| `/api/sessions/:id` | DELETE | Delete a session |

## Tech Stack

- **Framework**: Hono (lightweight, fast)
- **Runtime**: Cloudflare Workers / Pages
- **Database**: Cloudflare D1 (SQLite)
- **AI**: Gemini 2.5 Flash Image (nano-banana)
- **Frontend**: Tailwind CSS, Font Awesome, JSZip

## Project Structure

```
webapp/
├── src/
│   └── index.tsx          # Main Hono application
├── migrations/
│   └── 0001_initial_schema.sql
├── ecosystem.config.cjs   # PM2 configuration
├── wrangler.jsonc         # Cloudflare configuration
├── package.json
└── README.md
```

## Local Development

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Apply D1 migrations locally
npm run db:migrate:local

# Start development server
pm2 start ecosystem.config.cjs

# Or directly with wrangler
npm run dev:sandbox
```

## Deployment to Cloudflare Pages

```bash
# 1. Setup Cloudflare API key
# Call setup_cloudflare_api_key first

# 2. Create D1 database (production)
npx wrangler d1 create tesco-image-db

# 3. Update wrangler.jsonc with database_id

# 4. Apply migrations to production
npm run db:migrate:prod

# 5. Deploy
npm run deploy:prod
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Google Gemini API key for image generation |

## User Flow

1. **Upload or Paste URL**: User either uploads a product image or pastes a Tesco product URL
2. **Preview**: System shows preview of the original image
3. **Generate**: User clicks "Generate 4 Variations" button
4. **Processing**: Loading modal shows progress (30-90 seconds)
5. **Results**: All 5 images displayed in a grid with download buttons
6. **Download**: Individual or bulk ZIP download
7. **History**: Session saved for future reference

## Not Yet Implemented

- R2 storage for production image persistence (currently uses D1 base64)
- Custom domain configuration
- User authentication (not required per spec)
- Rate limiting

## Recommended Next Steps

1. Deploy to Cloudflare Pages for production use
2. Set up R2 bucket for image storage (better for large files)
3. Add custom domain (e.g., images.tesco-internal.com)
4. Configure secrets via wrangler CLI for production API keys

## Success Criteria

- [x] Upload image and generate 4 variations
- [x] Paste Tesco URL and generate variations
- [x] Download individual images
- [x] Download all as ZIP
- [x] View history and re-download
- [x] Zero crashes, clear error messages
- [x] Professional Tesco branding
- [x] Desktop optimized (1024px+)

---

Built for Tesco UK Web Content Team, Welwyn Garden City Head Office
