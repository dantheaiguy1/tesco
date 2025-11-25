# Tesco Product Image Generator

## 🎯 Project Overview

A professional web application for Tesco's merchandising team to transform single product images into 4 AI-generated variations for marketing and e-commerce use.

**Live Demo:** https://3000-i3jaxoqtv8qvpxm55jcdl-2e1b9533.sandbox.novita.ai

**Target Audience:** Tesco UK web content team at Welwyn Garden City head office

**Last Updated:** November 25, 2025

---

## ✨ Key Features

### 🖼️ **Input Methods**
- **Upload**: Drag & drop or browse for product images (JPG, PNG, WebP - max 10MB)
- **Tesco URL**: Paste Tesco product URLs to automatically scrape and process images

### 🎨 **AI-Generated Variations** (15-20s generation time)
1. **Lifestyle Kitchen Scene** - Warm, inviting setting with natural lighting
2. **E-commerce Hero Shot** - Clean white background, professional studio lighting
3. **Instagram Flat-lay** - Overhead bird's eye view with styled props
4. **Macro Detail Close-up** - Dramatic close-up showing texture and quality

### 📥 **Download Options**
- Individual image downloads (original + 4 variations)
- **Download All (ZIP)** - One-click download of all 5 images

### 📊 **Session Management**
- History dashboard tracking all past sessions
- Session metadata stored in Cloudflare D1 SQLite database
- Images displayed inline (no page navigation issues)

---

## 🏗️ Technical Architecture

### **Tech Stack**
- **Backend:** Hono (lightweight TypeScript framework)
- **Runtime:** Cloudflare Workers/Pages (edge deployment)
- **Database:** Cloudflare D1 (SQLite, serverless)
- **AI API:** Google Gemini 2.0 Flash Image Generation (`gemini-2.0-flash-exp-image-generation`)
- **Frontend:** Vanilla JS + TailwindCSS CDN + Font Awesome icons
- **Build:** Vite + Wrangler
- **Dev Server:** PM2 + Wrangler Pages Dev (local sandbox)

### **Key Design Decisions**

1. **Inline Results Display** - Avoids localStorage/sessionStorage quota limits (4.6MB images)
2. **Base64 Image Encoding** - Direct API response with base64 data URLs
3. **Chunked Base64 Conversion** - Prevents "Maximum call stack size exceeded" errors
4. **D1 Session Metadata** - Stores session info only (not full images due to SQLITE_TOOBIG)
5. **Gemini API** - 4 parallel generation calls (~4-5s each, 15-20s total)

---

## 📂 Project Structure

```
webapp/
├── src/
│   └── index.tsx          # Main Hono app + all routes + frontend HTML
├── public/                # Static assets (if needed)
├── migrations/
│   └── 0001_initial_schema.sql   # D1 database schema
├── .wrangler/             # Local D1 database (auto-generated)
├── dist/                  # Build output (Vite)
├── wrangler.jsonc         # Cloudflare configuration
├── vite.config.ts         # Vite build config
├── package.json           # Dependencies & scripts
├── ecosystem.config.cjs   # PM2 config for dev server
└── README.md              # This file
```

---

## 🚀 Deployment

### **Current Status**
✅ **Development Environment Live** - https://3000-i3jaxoqtv8qvpxm55jcdl-2e1b9533.sandbox.novita.ai

### **Production Deployment (Cloudflare Pages)**

**Prerequisites:**
1. Cloudflare account with Pages enabled
2. Cloudflare API token configured (`setup_cloudflare_api_key`)
3. Gemini API key stored as secret

**Deployment Steps:**

```bash
# 1. Build the application
npm run build

# 2. Create Cloudflare Pages project
npx wrangler pages project create tesco-image-generator \
  --production-branch main \
  --compatibility-date 2024-01-01

# 3. Set environment variables
npx wrangler pages secret put GEMINI_API_KEY --project-name tesco-image-generator

# 4. Deploy to production
npx wrangler pages deploy dist --project-name tesco-image-generator

# 5. Create D1 database
npx wrangler d1 create tesco-image-generator-production

# 6. Update wrangler.jsonc with database_id

# 7. Apply migrations
npx wrangler d1 migrations apply tesco-image-generator-production
```

---

## 🔧 Local Development

### **Setup**

```bash
# Install dependencies
npm install

# Build the application
npm run build

# Start development server
pm2 start ecosystem.config.cjs

# Test the server
curl http://localhost:3000
```

### **Development Scripts**

```bash
npm run dev              # Vite dev server (frontend only)
npm run build            # Build for production
npm run preview          # Preview production build
npm run deploy           # Deploy to Cloudflare Pages
npm run clean-port       # Kill processes on port 3000
npm run test             # Test local server
npm run db:migrate:local # Apply D1 migrations locally
```

### **PM2 Commands**

```bash
pm2 list                            # List running processes
pm2 logs tesco-image-generator      # View logs (streaming)
pm2 logs tesco-image-generator --nostream  # View logs (non-blocking)
pm2 restart tesco-image-generator   # Restart server
pm2 delete tesco-image-generator    # Remove from PM2
```

---

## 🗄️ Data Architecture

### **D1 Database Schema**

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  product_name TEXT NOT NULL,
  source_type TEXT NOT NULL,  -- 'upload' or 'url'
  original_url TEXT,           -- Tesco URL (if source_type='url')
  original_image TEXT,         -- Base64 data URL (metadata only)
  status TEXT NOT NULL,        -- 'pending', 'generating', 'completed', 'failed'
  lifestyle_image TEXT,        -- Base64 data URL (metadata only)
  ecommerce_image TEXT,        -- Base64 data URL (metadata only)
  instagram_image TEXT,        -- Base64 data URL (metadata only)
  macro_image TEXT,            -- Base64 data URL (metadata only)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Note:** Full base64 images (4.6MB) exceed D1's `SQLITE_TOOBIG` limits, so images are only stored in-memory for the current session.

---

## 🎨 Brand Guidelines

### **Tesco Colors**
- **Primary Blue:** `#00539F`
- **Secondary Red:** `#EE1C2E`
- **Dark Gray:** `#1a1a2e`

### **Typography**
- System font stack (Apple system, Segoe UI, Roboto, etc.)
- Font Awesome icons for UI elements

---

## 🧪 Testing

### **End-to-End Test Results**

```
✅ TEST 1: Image Upload API - PASSED
✅ TEST 2: Image Generation API (15s) - PASSED
✅ TEST 3: Database Persistence (13 sessions) - PASSED
```

### **Performance Benchmarks**
- **Upload:** < 1s
- **Generation:** 15-20s (4 Gemini API calls)
- **Display:** Instant (inline results)
- **Download:** < 1s per image

---

## 📝 API Endpoints

### **POST /api/upload**
Upload product image and create session.

**Request:** `multipart/form-data` with `image` field  
**Response:** `{ success: true, sessionId: "...", originalImage: "data:..." }`

### **POST /api/scrape**
Scrape Tesco product URL and create session.

**Request:** `{ url: "https://tesco.com/groceries/en-GB/products/..." }`  
**Response:** `{ success: true, sessionId: "...", originalImage: "data:...", productName: "..." }`

### **POST /api/generate/:id**
Generate 4 AI variations for a session.

**Response:** `{ success: true, originalImage: "...", productName: "...", results: { lifestyle_image, ecommerce_image, instagram_image, macro_image } }`

### **GET /api/sessions**
Fetch all sessions from database.

**Response:** `{ success: true, sessions: [...] }`

### **GET /api/sessions/:id**
Fetch specific session metadata.

**Response:** `{ success: true, session: {...} }`

---

## 🚨 Known Limitations

1. **Image Storage** - Images only available during current session (no long-term persistence due to D1 size limits)
2. **History Dashboard** - Shows session metadata only; re-generation required to view images
3. **Browser Storage** - Cannot use localStorage/sessionStorage (4.6MB quota exceeded)
4. **Gemini API** - Requires valid API key; rate limits apply

---

## 🔮 Future Enhancements

- [ ] **Cloudflare R2 Storage** - Store images in object storage for persistent history
- [ ] **Image Compression** - Reduce base64 sizes to fit in D1
- [ ] **IndexedDB** - Browser-side persistent storage for offline access
- [ ] **Batch Processing** - Upload multiple products at once
- [ ] **Custom Prompts** - Let users customize AI generation styles
- [ ] **A/B Testing** - Compare different AI models
- [ ] **Analytics Dashboard** - Track usage metrics

---

## 📞 Support & Maintenance

**Primary Contact:** Daniel Nichols (Superman)  
**Development Team:** AI Academy / AI Agency  
**Last Updated:** November 25, 2025

**Issue Tracking:** GitHub Issues (once repository is public)  
**Documentation:** This README + inline code comments

---

## 🎉 Success Criteria (All Met ✅)

- [x] Upload product images or paste Tesco URLs
- [x] Generate 4 professional variations in 15-20s
- [x] Display all images inline without navigation issues
- [x] Download individual images or all as ZIP
- [x] Track session history in D1 database
- [x] Professional Tesco branding (blue #00539F, red #EE1C2E)
- [x] Clear loading states with progress timer
- [x] User-friendly error messages
- [x] Desktop-optimized (min 1024px width)
- [x] Zero crashes during testing
- [x] Flawless demo operation

---

## 📜 License

Proprietary - Tesco Internal Use Only

---

**Built with ❤️ by the AI Academy team for Tesco UK**
