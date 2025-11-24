# Tesco Product Image Generator

Professional web application for Tesco's merchandising team that transforms single product images into 4 professional AI-generated variations.

## Live Demo URL

**Sandbox**: https://3000-i3jaxoqtv8qvpxm55jcdl-2e1b9533.sandbox.novita.ai

## Features

### Completed
- **Image Upload**: Drag & drop or click to upload product images (JPG, PNG, WebP up to 10MB)
- **Tesco URL Scraping**: Paste any Tesco.com product URL to auto-extract the product image
- **4 AI-Generated Variations** (using Gemini 2.0 Flash):
  - Lifestyle kitchen scene (warm, inviting, with context)
  - E-commerce hero shot (clean white background, professional)
  - Instagram flat-lay (overhead, styled, social media aesthetic)
  - Macro detail close-up (texture, quality emphasis)
- **Individual Downloads**: Download any single variation
- **ZIP Download**: Download all 5 images (original + 4 variations) as a single ZIP file
- **History Dashboard**: View all past generation sessions with thumbnails
- **Session Management**: Delete old sessions
- **Professional UI**: Tesco brand colors (#00539F blue, #EE1C2E red)
- **Progress Indicators**: Real-time loading states during generation (30-90 seconds)
- **Error Handling**: User-friendly error messages for all failure cases

## Tech Stack

- **Framework**: Hono (lightweight, fast edge framework)
- **Runtime**: Cloudflare Workers / Pages
- **Database**: Cloudflare D1 (SQLite for session metadata)
- **Storage**: Browser localStorage (for generated images)
- **AI**: Gemini 2.0 Flash Experimental Image Generation
- **Frontend**: Tailwind CSS (CDN), Font Awesome, JSZip

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Homepage with upload/URL input |
| `/history` | GET | History dashboard |
| `/results/:id` | GET | Results page for a session |
| `/api/upload` | POST | Upload an image file |
| `/api/scrape` | POST | Scrape image from Tesco URL |
| `/api/generate/:id` | POST | Generate 4 variations (30-90s) |
| `/api/sessions` | GET | List all sessions |
| `/api/sessions/:id` | GET | Get single session |
| `/api/sessions/:id` | DELETE | Delete a session |

## User Flow

1. **Upload or Paste URL**: User either uploads a product image or pastes a Tesco product URL
2. **Preview**: System shows preview of the original image
3. **Generate**: User clicks "Generate 4 Variations" button
4. **Processing**: Loading modal shows progress (30-90 seconds)
5. **Results**: All 5 images displayed in a grid with download buttons
6. **Download**: Individual or bulk ZIP download
7. **History**: Session metadata saved for future reference

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

## Project Structure

```
webapp/
├── src/
│   └── index.tsx          # Main Hono application (all routes + HTML)
├── migrations/
│   └── 0001_initial_schema.sql
├── ecosystem.config.cjs   # PM2 configuration
├── wrangler.jsonc         # Cloudflare configuration
├── package.json
└── README.md
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Google Gemini API key for image generation |

## Success Criteria

- [x] Upload image -> generates 4 variations -> downloads work
- [x] Paste Tesco URL -> extracts image -> generates variations
- [x] Navigate to history -> see past sessions
- [x] Zero crashes on normal use
- [x] Professional Tesco branding
- [x] Desktop optimized (1024px+)
- [x] Completes generation in 30-90 seconds

## Architecture Notes

- **Image Storage**: Generated images are returned in the API response and stored in browser localStorage, avoiding D1's size limits
- **Session Metadata**: Only session status and timestamps stored in D1
- **Chunked Base64**: Large file uploads use chunked encoding to avoid stack overflow

---

Built for Tesco UK Web Content Team, Welwyn Garden City Head Office
