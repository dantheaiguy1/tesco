import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  TESCO_DB: D1Database;
  GEMINI_API_KEY: string;
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors())

// Generate unique ID
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}

// Store images in base64 in D1 (for simplicity in demo - production would use R2)
// But we'll use external URLs from Gemini API responses

// Homepage
app.get('/', (c) => {
  return c.html(getHomePage())
})

// History page
app.get('/history', (c) => {
  return c.html(getHistoryPage())
})

// Results page
app.get('/results/:id', (c) => {
  return c.html(getResultsPage(c.req.param('id')))
})

// API: Get all sessions
app.get('/api/sessions', async (c) => {
  try {
    const db = c.env.TESCO_DB
    const result = await db.prepare(
      'SELECT * FROM sessions ORDER BY created_at DESC'
    ).all()
    return c.json({ success: true, sessions: result.results })
  } catch (error) {
    console.error('Error fetching sessions:', error)
    return c.json({ success: false, error: 'Failed to fetch sessions' }, 500)
  }
})

// API: Get single session
app.get('/api/sessions/:id', async (c) => {
  try {
    const db = c.env.TESCO_DB
    const id = c.req.param('id')
    const result = await db.prepare(
      'SELECT * FROM sessions WHERE id = ?'
    ).bind(id).first()
    
    if (!result) {
      return c.json({ success: false, error: 'Session not found' }, 404)
    }
    return c.json({ success: true, session: result })
  } catch (error) {
    console.error('Error fetching session:', error)
    return c.json({ success: false, error: 'Failed to fetch session' }, 500)
  }
})

// API: Create session from upload
app.post('/api/upload', async (c) => {
  try {
    const formData = await c.req.formData()
    const file = formData.get('image') as File
    
    if (!file) {
      return c.json({ success: false, error: 'No image file provided' }, 400)
    }

    // Check file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      return c.json({ success: false, error: 'File too large. Maximum size is 10MB.' }, 400)
    }

    // Check file type
    const validTypes = ['image/jpeg', 'image/png', 'image/webp']
    if (!validTypes.includes(file.type)) {
      return c.json({ success: false, error: 'Invalid file type. Please upload JPG, PNG, or WebP.' }, 400)
    }

    // Convert to base64 data URL
    const buffer = await file.arrayBuffer()
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
    const dataUrl = `data:${file.type};base64,${base64}`

    // Create session
    const db = c.env.TESCO_DB
    const sessionId = generateId()
    
    await db.prepare(`
      INSERT INTO sessions (id, product_name, source_type, original_image, status)
      VALUES (?, ?, 'upload', ?, 'pending')
    `).bind(sessionId, file.name.replace(/\.[^.]+$/, ''), dataUrl).run()

    return c.json({ success: true, sessionId, originalImage: dataUrl })
  } catch (error) {
    console.error('Upload error:', error)
    return c.json({ success: false, error: 'Failed to process upload' }, 500)
  }
})

// API: Scrape Tesco URL
app.post('/api/scrape', async (c) => {
  try {
    const { url } = await c.req.json()
    
    if (!url) {
      return c.json({ success: false, error: 'No URL provided' }, 400)
    }

    // Validate Tesco URL
    if (!url.includes('tesco.com')) {
      return c.json({ success: false, error: 'Please provide a valid Tesco product URL' }, 400)
    }

    // Fetch the page
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    })

    if (!response.ok) {
      return c.json({ success: false, error: 'Failed to fetch Tesco page. Please check the URL.' }, 400)
    }

    const html = await response.text()
    
    // Extract product image - try multiple patterns
    let imageUrl = null
    let productName = 'Tesco Product'

    // Try og:image meta tag first
    const ogImageMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i)
    if (ogImageMatch) {
      imageUrl = ogImageMatch[1]
    }
    
    // Try product image patterns
    if (!imageUrl) {
      const imgPatterns = [
        /src="(https:\/\/digitalcontent\.api\.tesco\.com[^"]+)"/i,
        /src="(https:\/\/img\.tesco\.com[^"]+)"/i,
        /data-src="(https:\/\/digitalcontent\.api\.tesco\.com[^"]+)"/i
      ]
      for (const pattern of imgPatterns) {
        const match = html.match(pattern)
        if (match) {
          imageUrl = match[1]
          break
        }
      }
    }

    // Extract product name from og:title or title tag
    const titleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i) ||
                       html.match(/<title>([^<]+)<\/title>/i)
    if (titleMatch) {
      productName = titleMatch[1].replace(/ - Tesco.*$/i, '').trim()
    }

    if (!imageUrl) {
      return c.json({ success: false, error: 'Could not find product image on this page. Try uploading directly.' }, 400)
    }

    // Fetch and convert image to base64
    const imageResponse = await fetch(imageUrl)
    if (!imageResponse.ok) {
      return c.json({ success: false, error: 'Failed to download product image' }, 400)
    }

    const imageBuffer = await imageResponse.arrayBuffer()
    const base64 = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)))
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg'
    const dataUrl = `data:${contentType};base64,${base64}`

    // Create session
    const db = c.env.TESCO_DB
    const sessionId = generateId()
    
    await db.prepare(`
      INSERT INTO sessions (id, product_name, source_type, source_url, original_image, status)
      VALUES (?, ?, 'url', ?, ?, 'pending')
    `).bind(sessionId, productName, url, dataUrl).run()

    return c.json({ success: true, sessionId, originalImage: dataUrl, productName })
  } catch (error) {
    console.error('Scrape error:', error)
    return c.json({ success: false, error: 'Failed to scrape Tesco URL' }, 500)
  }
})

// API: Generate variations
app.post('/api/generate/:id', async (c) => {
  const sessionId = c.req.param('id')
  const db = c.env.TESCO_DB
  
  try {
    // Get session
    const session = await db.prepare(
      'SELECT * FROM sessions WHERE id = ?'
    ).bind(sessionId).first() as any
    
    if (!session) {
      return c.json({ success: false, error: 'Session not found' }, 404)
    }

    // Update status to generating
    await db.prepare(
      'UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind('generating', sessionId).run()

    const apiKey = c.env.GEMINI_API_KEY
    const originalImage = session.original_image
    const productName = session.product_name || 'product'

    // Define the 4 variation prompts
    const variations = [
      {
        field: 'lifestyle_image',
        prompt: `Create a warm, inviting lifestyle kitchen scene featuring this ${productName}. Place the product naturally on a kitchen counter or table with soft morning light, cozy ambient lighting, wooden surfaces, fresh ingredients nearby, and a homey atmosphere. The product should be the hero but feel integrated into a real family kitchen moment. Professional food photography style with shallow depth of field.`
      },
      {
        field: 'ecommerce_image',
        prompt: `Create a professional e-commerce hero shot of this ${productName}. Pure clean white background, perfect studio lighting with soft shadows, product centered and perfectly lit, crisp sharp focus, professional commercial product photography. The image should look like it belongs on a premium retail website. No distracting elements, just the product presented beautifully.`
      },
      {
        field: 'instagram_image',
        prompt: `Create a trendy Instagram flat-lay composition featuring this ${productName}. Overhead bird's eye view, styled on a marble or wooden surface with complementary props like fresh herbs, linens, artisanal items, and lifestyle accessories. Modern social media aesthetic with beautiful natural lighting, Pinterest-worthy styling. The product should be the star but surrounded by aesthetically pleasing complementary items.`
      },
      {
        field: 'macro_image',
        prompt: `Create a dramatic macro close-up detail shot of this ${productName}. Extreme close-up showing texture, quality, and craftsmanship. Emphasize premium quality through sharp detail photography - show the fine details, surface textures, colors, and quality indicators. Professional macro photography with precise focus and beautiful bokeh background. Make viewers feel they can almost touch the product.`
      }
    ]

    const results: Record<string, string> = {}

    // Generate each variation using Gemini API
    for (const variation of variations) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [
                  {
                    inline_data: {
                      mime_type: originalImage.split(';')[0].split(':')[1],
                      data: originalImage.split(',')[1]
                    }
                  },
                  {
                    text: variation.prompt
                  }
                ]
              }],
              generationConfig: {
                responseModalities: ["image", "text"],
                responseMimeType: "image/jpeg"
              }
            })
          }
        )

        if (!response.ok) {
          const errorText = await response.text()
          console.error(`Gemini API error for ${variation.field}:`, errorText)
          continue
        }

        const data = await response.json() as any
        
        // Extract image from response
        if (data.candidates?.[0]?.content?.parts) {
          for (const part of data.candidates[0].content.parts) {
            if (part.inlineData?.data) {
              results[variation.field] = `data:image/jpeg;base64,${part.inlineData.data}`
              break
            }
          }
        }
      } catch (err) {
        console.error(`Error generating ${variation.field}:`, err)
      }
    }

    // Update session with results
    await db.prepare(`
      UPDATE sessions 
      SET lifestyle_image = ?,
          ecommerce_image = ?,
          instagram_image = ?,
          macro_image = ?,
          status = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      results.lifestyle_image || null,
      results.ecommerce_image || null,
      results.instagram_image || null,
      results.macro_image || null,
      'completed',
      sessionId
    ).run()

    return c.json({ success: true, results })
  } catch (error) {
    console.error('Generation error:', error)
    
    // Update session with error
    await db.prepare(
      'UPDATE sessions SET status = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind('failed', String(error), sessionId).run()
    
    return c.json({ success: false, error: 'Failed to generate variations' }, 500)
  }
})

// API: Delete session
app.delete('/api/sessions/:id', async (c) => {
  try {
    const db = c.env.TESCO_DB
    const id = c.req.param('id')
    
    await db.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run()
    return c.json({ success: true })
  } catch (error) {
    console.error('Delete error:', error)
    return c.json({ success: false, error: 'Failed to delete session' }, 500)
  }
})

// HTML Templates
function getHomePage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Product Image Generator - Tesco Merchandising</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            'tesco-blue': '#00539F',
            'tesco-red': '#EE1C2E',
            'tesco-dark': '#1a1a2e',
          }
        }
      }
    }
  </script>
  <style>
    .upload-zone {
      border: 3px dashed #00539F;
      transition: all 0.3s ease;
    }
    .upload-zone:hover, .upload-zone.dragover {
      border-color: #EE1C2E;
      background-color: rgba(238, 28, 46, 0.05);
    }
    .tab-active {
      border-bottom: 3px solid #00539F;
      color: #00539F;
    }
    .pulse-loader {
      animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  </style>
</head>
<body class="bg-gray-50 min-h-screen">
  <!-- Header -->
  <header class="bg-tesco-blue text-white shadow-lg">
    <div class="max-w-7xl mx-auto px-6 py-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 bg-white rounded-lg flex items-center justify-center">
            <span class="text-tesco-blue font-bold text-xl">T</span>
          </div>
          <div>
            <h1 class="text-2xl font-bold">Product Image Generator</h1>
            <p class="text-blue-200 text-sm">Merchandising Team Tool</p>
          </div>
        </div>
        <nav class="flex items-center gap-6">
          <a href="/" class="flex items-center gap-2 px-4 py-2 bg-white/10 rounded-lg hover:bg-white/20 transition">
            <i class="fas fa-home"></i>
            <span>Home</span>
          </a>
          <a href="/history" class="flex items-center gap-2 px-4 py-2 hover:bg-white/10 rounded-lg transition">
            <i class="fas fa-history"></i>
            <span>History</span>
          </a>
        </nav>
      </div>
    </div>
  </header>

  <main class="max-w-5xl mx-auto px-6 py-10">
    <!-- Hero Section -->
    <div class="text-center mb-10">
      <h2 class="text-3xl font-bold text-gray-800 mb-3">Transform Product Images</h2>
      <p class="text-gray-600 text-lg">Upload a product image or paste a Tesco URL to generate 4 professional variations</p>
    </div>

    <!-- Main Card -->
    <div class="bg-white rounded-2xl shadow-xl overflow-hidden">
      <!-- Tabs -->
      <div class="flex border-b">
        <button id="tab-upload" onclick="switchTab('upload')" class="flex-1 py-4 px-6 font-semibold text-gray-600 hover:text-tesco-blue transition tab-active">
          <i class="fas fa-upload mr-2"></i>Upload Image
        </button>
        <button id="tab-url" onclick="switchTab('url')" class="flex-1 py-4 px-6 font-semibold text-gray-600 hover:text-tesco-blue transition">
          <i class="fas fa-link mr-2"></i>Tesco Product URL
        </button>
      </div>

      <div class="p-8">
        <!-- Upload Panel -->
        <div id="panel-upload">
          <div id="upload-zone" class="upload-zone rounded-xl p-12 text-center cursor-pointer bg-gray-50"
               ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event)"
               onclick="document.getElementById('file-input').click()">
            <input type="file" id="file-input" accept="image/jpeg,image/png,image/webp" class="hidden" onchange="handleFileSelect(event)">
            <div id="upload-prompt">
              <i class="fas fa-cloud-upload-alt text-6xl text-tesco-blue mb-4"></i>
              <p class="text-xl font-semibold text-gray-700 mb-2">Drag & drop your image here</p>
              <p class="text-gray-500 mb-4">or click to browse</p>
              <div class="inline-flex items-center gap-2 text-sm text-gray-400 bg-gray-100 px-4 py-2 rounded-full">
                <i class="fas fa-info-circle"></i>
                JPG, PNG, or WebP - Max 10MB
              </div>
            </div>
            <div id="upload-preview" class="hidden">
              <img id="preview-image" class="max-h-64 mx-auto rounded-lg shadow-md mb-4">
              <p id="preview-filename" class="text-gray-700 font-medium"></p>
            </div>
          </div>
        </div>

        <!-- URL Panel -->
        <div id="panel-url" class="hidden">
          <div class="max-w-2xl mx-auto">
            <label class="block text-gray-700 font-medium mb-3">Tesco Product URL</label>
            <div class="flex gap-3">
              <input type="url" id="url-input" placeholder="https://www.tesco.com/groceries/en-GB/products/..."
                     class="flex-1 px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-tesco-blue focus:outline-none transition">
              <button onclick="scrapeUrl()" class="px-6 py-3 bg-tesco-blue text-white rounded-xl font-semibold hover:bg-blue-700 transition">
                <i class="fas fa-search mr-2"></i>Fetch
              </button>
            </div>
            <p class="text-sm text-gray-500 mt-2">
              <i class="fas fa-lightbulb text-yellow-500 mr-1"></i>
              Paste any Tesco.com product page URL
            </p>
          </div>
          
          <!-- URL Preview -->
          <div id="url-preview" class="hidden mt-8 p-6 bg-gray-50 rounded-xl">
            <div class="flex items-start gap-6">
              <img id="url-preview-image" class="w-32 h-32 object-contain rounded-lg bg-white shadow">
              <div>
                <h3 id="url-preview-name" class="text-xl font-semibold text-gray-800 mb-2"></h3>
                <p class="text-sm text-gray-500 mb-4">Product image extracted successfully</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Generate Button -->
        <div class="mt-8 text-center">
          <button id="generate-btn" onclick="generateVariations()" disabled
                  class="px-10 py-4 bg-tesco-red text-white rounded-xl font-bold text-lg hover:bg-red-600 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg">
            <i class="fas fa-magic mr-2"></i>Generate 4 Variations
          </button>
          <p class="text-sm text-gray-500 mt-3">
            <i class="fas fa-clock mr-1"></i>
            Generation takes 30-90 seconds
          </p>
        </div>
      </div>
    </div>

    <!-- Info Cards -->
    <div class="grid md:grid-cols-4 gap-4 mt-10">
      <div class="bg-white rounded-xl p-5 shadow-md text-center">
        <div class="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <i class="fas fa-home text-amber-600 text-xl"></i>
        </div>
        <h3 class="font-semibold text-gray-800 mb-1">Lifestyle Scene</h3>
        <p class="text-sm text-gray-500">Warm kitchen setting</p>
      </div>
      <div class="bg-white rounded-xl p-5 shadow-md text-center">
        <div class="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <i class="fas fa-shopping-cart text-blue-600 text-xl"></i>
        </div>
        <h3 class="font-semibold text-gray-800 mb-1">E-commerce Hero</h3>
        <p class="text-sm text-gray-500">Clean white background</p>
      </div>
      <div class="bg-white rounded-xl p-5 shadow-md text-center">
        <div class="w-12 h-12 bg-pink-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <i class="fab fa-instagram text-pink-600 text-xl"></i>
        </div>
        <h3 class="font-semibold text-gray-800 mb-1">Instagram Flat-lay</h3>
        <p class="text-sm text-gray-500">Social media aesthetic</p>
      </div>
      <div class="bg-white rounded-xl p-5 shadow-md text-center">
        <div class="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <i class="fas fa-search-plus text-green-600 text-xl"></i>
        </div>
        <h3 class="font-semibold text-gray-800 mb-1">Macro Detail</h3>
        <p class="text-sm text-gray-500">Texture close-up</p>
      </div>
    </div>
  </main>

  <!-- Loading Modal -->
  <div id="loading-modal" class="hidden fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
    <div class="bg-white rounded-2xl p-10 max-w-md w-full mx-4 text-center shadow-2xl">
      <div class="mb-6">
        <div class="w-20 h-20 mx-auto bg-tesco-blue rounded-full flex items-center justify-center pulse-loader">
          <i class="fas fa-wand-magic-sparkles text-white text-3xl"></i>
        </div>
      </div>
      <h3 class="text-2xl font-bold text-gray-800 mb-3">Generating Variations</h3>
      <p class="text-gray-600 mb-6">AI is creating 4 professional product images</p>
      <div class="bg-gray-100 rounded-full h-3 mb-4 overflow-hidden">
        <div id="progress-bar" class="bg-gradient-to-r from-tesco-blue to-tesco-red h-full rounded-full transition-all duration-500" style="width: 0%"></div>
      </div>
      <p class="text-sm text-gray-500">
        <i class="fas fa-clock mr-1"></i>
        <span id="progress-text">Starting generation...</span>
      </p>
    </div>
  </div>

  <!-- Error Toast -->
  <div id="error-toast" class="hidden fixed bottom-6 right-6 bg-red-600 text-white px-6 py-4 rounded-xl shadow-2xl max-w-md z-50">
    <div class="flex items-start gap-3">
      <i class="fas fa-exclamation-circle text-xl mt-0.5"></i>
      <div>
        <p class="font-semibold">Error</p>
        <p id="error-message" class="text-sm opacity-90"></p>
      </div>
      <button onclick="hideError()" class="ml-4 hover:opacity-70">
        <i class="fas fa-times"></i>
      </button>
    </div>
  </div>

  <script>
    let currentSessionId = null;
    let currentTab = 'upload';
    let selectedFile = null;

    function switchTab(tab) {
      currentTab = tab;
      document.getElementById('panel-upload').classList.toggle('hidden', tab !== 'upload');
      document.getElementById('panel-url').classList.toggle('hidden', tab !== 'url');
      document.getElementById('tab-upload').classList.toggle('tab-active', tab === 'upload');
      document.getElementById('tab-url').classList.toggle('tab-active', tab === 'url');
      
      // Reset state
      currentSessionId = null;
      selectedFile = null;
      document.getElementById('generate-btn').disabled = true;
      document.getElementById('upload-prompt').classList.remove('hidden');
      document.getElementById('upload-preview').classList.add('hidden');
      document.getElementById('url-preview').classList.add('hidden');
      document.getElementById('url-input').value = '';
    }

    function handleDragOver(e) {
      e.preventDefault();
      document.getElementById('upload-zone').classList.add('dragover');
    }

    function handleDragLeave(e) {
      e.preventDefault();
      document.getElementById('upload-zone').classList.remove('dragover');
    }

    function handleDrop(e) {
      e.preventDefault();
      document.getElementById('upload-zone').classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        processFile(files[0]);
      }
    }

    function handleFileSelect(e) {
      const files = e.target.files;
      if (files.length > 0) {
        processFile(files[0]);
      }
    }

    async function processFile(file) {
      // Validate file type
      const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!validTypes.includes(file.type)) {
        showError('Invalid file type. Please upload JPG, PNG, or WebP.');
        return;
      }

      // Validate file size (10MB)
      if (file.size > 10 * 1024 * 1024) {
        showError('File too large. Maximum size is 10MB.');
        return;
      }

      selectedFile = file;

      // Show preview
      const reader = new FileReader();
      reader.onload = (e) => {
        document.getElementById('preview-image').src = e.target.result;
        document.getElementById('preview-filename').textContent = file.name;
        document.getElementById('upload-prompt').classList.add('hidden');
        document.getElementById('upload-preview').classList.remove('hidden');
      };
      reader.readAsDataURL(file);

      // Upload file
      const formData = new FormData();
      formData.append('image', file);

      try {
        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData
        });
        const data = await response.json();
        
        if (data.success) {
          currentSessionId = data.sessionId;
          document.getElementById('generate-btn').disabled = false;
        } else {
          showError(data.error || 'Upload failed');
        }
      } catch (error) {
        showError('Failed to upload image. Please try again.');
      }
    }

    async function scrapeUrl() {
      const url = document.getElementById('url-input').value.trim();
      if (!url) {
        showError('Please enter a Tesco product URL');
        return;
      }

      try {
        const response = await fetch('/api/scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
        const data = await response.json();
        
        if (data.success) {
          currentSessionId = data.sessionId;
          document.getElementById('url-preview-image').src = data.originalImage;
          document.getElementById('url-preview-name').textContent = data.productName;
          document.getElementById('url-preview').classList.remove('hidden');
          document.getElementById('generate-btn').disabled = false;
        } else {
          showError(data.error || 'Failed to fetch product');
        }
      } catch (error) {
        showError('Failed to fetch Tesco URL. Please try again.');
      }
    }

    async function generateVariations() {
      if (!currentSessionId) {
        showError('Please upload an image or fetch a product first');
        return;
      }

      // Show loading modal
      document.getElementById('loading-modal').classList.remove('hidden');
      document.getElementById('generate-btn').disabled = true;

      // Simulate progress
      let progress = 0;
      const progressTexts = [
        'Starting generation...',
        'Creating lifestyle scene...',
        'Creating e-commerce shot...',
        'Creating Instagram flat-lay...',
        'Creating macro detail...',
        'Finalizing images...'
      ];
      
      const progressInterval = setInterval(() => {
        progress += Math.random() * 15;
        if (progress > 95) progress = 95;
        document.getElementById('progress-bar').style.width = progress + '%';
        const textIndex = Math.min(Math.floor(progress / 20), progressTexts.length - 1);
        document.getElementById('progress-text').textContent = progressTexts[textIndex];
      }, 2000);

      try {
        const response = await fetch('/api/generate/' + currentSessionId, {
          method: 'POST'
        });
        const data = await response.json();
        
        clearInterval(progressInterval);
        document.getElementById('progress-bar').style.width = '100%';
        document.getElementById('progress-text').textContent = 'Complete!';
        
        if (data.success) {
          setTimeout(() => {
            window.location.href = '/results/' + currentSessionId;
          }, 500);
        } else {
          document.getElementById('loading-modal').classList.add('hidden');
          document.getElementById('generate-btn').disabled = false;
          showError(data.error || 'Generation failed');
        }
      } catch (error) {
        clearInterval(progressInterval);
        document.getElementById('loading-modal').classList.add('hidden');
        document.getElementById('generate-btn').disabled = false;
        showError('Generation failed. Please try again.');
      }
    }

    function showError(message) {
      document.getElementById('error-message').textContent = message;
      document.getElementById('error-toast').classList.remove('hidden');
      setTimeout(hideError, 5000);
    }

    function hideError() {
      document.getElementById('error-toast').classList.add('hidden');
    }
  </script>
</body>
</html>`
}

function getResultsPage(sessionId: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Results - Tesco Image Generator</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            'tesco-blue': '#00539F',
            'tesco-red': '#EE1C2E',
          }
        }
      }
    }
  </script>
</head>
<body class="bg-gray-50 min-h-screen">
  <!-- Header -->
  <header class="bg-tesco-blue text-white shadow-lg">
    <div class="max-w-7xl mx-auto px-6 py-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 bg-white rounded-lg flex items-center justify-center">
            <span class="text-tesco-blue font-bold text-xl">T</span>
          </div>
          <div>
            <h1 class="text-2xl font-bold">Product Image Generator</h1>
            <p class="text-blue-200 text-sm">Merchandising Team Tool</p>
          </div>
        </div>
        <nav class="flex items-center gap-6">
          <a href="/" class="flex items-center gap-2 px-4 py-2 hover:bg-white/10 rounded-lg transition">
            <i class="fas fa-home"></i>
            <span>Home</span>
          </a>
          <a href="/history" class="flex items-center gap-2 px-4 py-2 hover:bg-white/10 rounded-lg transition">
            <i class="fas fa-history"></i>
            <span>History</span>
          </a>
        </nav>
      </div>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-6 py-10">
    <div id="loading" class="text-center py-20">
      <i class="fas fa-spinner fa-spin text-4xl text-tesco-blue mb-4"></i>
      <p class="text-gray-600">Loading results...</p>
    </div>

    <div id="content" class="hidden">
      <!-- Header -->
      <div class="flex items-center justify-between mb-8">
        <div>
          <h2 id="product-name" class="text-3xl font-bold text-gray-800">Product Variations</h2>
          <p id="session-date" class="text-gray-500 mt-1"></p>
        </div>
        <div class="flex items-center gap-4">
          <a href="/" class="px-5 py-2.5 border-2 border-tesco-blue text-tesco-blue rounded-lg font-semibold hover:bg-tesco-blue hover:text-white transition">
            <i class="fas fa-plus mr-2"></i>New Generation
          </a>
          <button onclick="downloadAll()" class="px-5 py-2.5 bg-tesco-red text-white rounded-lg font-semibold hover:bg-red-600 transition">
            <i class="fas fa-download mr-2"></i>Download All (ZIP)
          </button>
        </div>
      </div>

      <!-- Image Grid -->
      <div class="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <!-- Original -->
        <div class="bg-white rounded-xl shadow-lg overflow-hidden">
          <div class="bg-gray-800 text-white px-4 py-2 text-center font-semibold">
            <i class="fas fa-image mr-2"></i>Original
          </div>
          <div class="p-4">
            <img id="img-original" class="w-full h-48 object-contain bg-gray-100 rounded-lg mb-3">
            <button onclick="downloadImage('original')" class="w-full py-2 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition">
              <i class="fas fa-download mr-2"></i>Download
            </button>
          </div>
        </div>

        <!-- Lifestyle -->
        <div class="bg-white rounded-xl shadow-lg overflow-hidden">
          <div class="bg-amber-500 text-white px-4 py-2 text-center font-semibold">
            <i class="fas fa-home mr-2"></i>Lifestyle
          </div>
          <div class="p-4">
            <img id="img-lifestyle" class="w-full h-48 object-contain bg-gray-100 rounded-lg mb-3">
            <button onclick="downloadImage('lifestyle')" class="w-full py-2 bg-amber-100 text-amber-700 rounded-lg font-medium hover:bg-amber-200 transition">
              <i class="fas fa-download mr-2"></i>Download
            </button>
          </div>
        </div>

        <!-- E-commerce -->
        <div class="bg-white rounded-xl shadow-lg overflow-hidden">
          <div class="bg-blue-500 text-white px-4 py-2 text-center font-semibold">
            <i class="fas fa-shopping-cart mr-2"></i>E-commerce
          </div>
          <div class="p-4">
            <img id="img-ecommerce" class="w-full h-48 object-contain bg-gray-100 rounded-lg mb-3">
            <button onclick="downloadImage('ecommerce')" class="w-full py-2 bg-blue-100 text-blue-700 rounded-lg font-medium hover:bg-blue-200 transition">
              <i class="fas fa-download mr-2"></i>Download
            </button>
          </div>
        </div>

        <!-- Instagram -->
        <div class="bg-white rounded-xl shadow-lg overflow-hidden">
          <div class="bg-pink-500 text-white px-4 py-2 text-center font-semibold">
            <i class="fab fa-instagram mr-2"></i>Instagram
          </div>
          <div class="p-4">
            <img id="img-instagram" class="w-full h-48 object-contain bg-gray-100 rounded-lg mb-3">
            <button onclick="downloadImage('instagram')" class="w-full py-2 bg-pink-100 text-pink-700 rounded-lg font-medium hover:bg-pink-200 transition">
              <i class="fas fa-download mr-2"></i>Download
            </button>
          </div>
        </div>

        <!-- Macro -->
        <div class="bg-white rounded-xl shadow-lg overflow-hidden">
          <div class="bg-green-500 text-white px-4 py-2 text-center font-semibold">
            <i class="fas fa-search-plus mr-2"></i>Macro
          </div>
          <div class="p-4">
            <img id="img-macro" class="w-full h-48 object-contain bg-gray-100 rounded-lg mb-3">
            <button onclick="downloadImage('macro')" class="w-full py-2 bg-green-100 text-green-700 rounded-lg font-medium hover:bg-green-200 transition">
              <i class="fas fa-download mr-2"></i>Download
            </button>
          </div>
        </div>
      </div>

      <!-- Full Size Preview Modal -->
      <div id="preview-modal" class="hidden fixed inset-0 bg-black/80 flex items-center justify-center z-50" onclick="closePreview()">
        <div class="max-w-4xl max-h-[90vh] p-4">
          <img id="preview-img" class="max-w-full max-h-full rounded-lg shadow-2xl">
        </div>
        <button class="absolute top-6 right-6 text-white text-3xl hover:opacity-70">
          <i class="fas fa-times"></i>
        </button>
      </div>
    </div>

    <div id="error" class="hidden text-center py-20">
      <i class="fas fa-exclamation-circle text-6xl text-red-400 mb-4"></i>
      <h3 class="text-2xl font-bold text-gray-800 mb-2">Session Not Found</h3>
      <p class="text-gray-600 mb-6">This session may have expired or doesn't exist.</p>
      <a href="/" class="px-6 py-3 bg-tesco-blue text-white rounded-lg font-semibold hover:bg-blue-700 transition">
        <i class="fas fa-plus mr-2"></i>Create New
      </a>
    </div>
  </main>

  <script>
    const sessionId = '${sessionId}';
    let sessionData = null;

    async function loadSession() {
      try {
        const response = await fetch('/api/sessions/' + sessionId);
        const data = await response.json();
        
        if (data.success && data.session) {
          sessionData = data.session;
          displayResults();
        } else {
          showError();
        }
      } catch (error) {
        showError();
      }
    }

    function displayResults() {
      document.getElementById('loading').classList.add('hidden');
      document.getElementById('content').classList.remove('hidden');

      document.getElementById('product-name').textContent = sessionData.product_name || 'Product Variations';
      document.getElementById('session-date').textContent = 'Generated on ' + new Date(sessionData.created_at).toLocaleString();

      // Set images
      document.getElementById('img-original').src = sessionData.original_image || '';
      document.getElementById('img-lifestyle').src = sessionData.lifestyle_image || '';
      document.getElementById('img-ecommerce').src = sessionData.ecommerce_image || '';
      document.getElementById('img-instagram').src = sessionData.instagram_image || '';
      document.getElementById('img-macro').src = sessionData.macro_image || '';

      // Add click handlers for preview
      document.querySelectorAll('[id^="img-"]').forEach(img => {
        img.style.cursor = 'pointer';
        img.onclick = (e) => {
          e.stopPropagation();
          openPreview(img.src);
        };
      });
    }

    function showError() {
      document.getElementById('loading').classList.add('hidden');
      document.getElementById('error').classList.remove('hidden');
    }

    function openPreview(src) {
      document.getElementById('preview-img').src = src;
      document.getElementById('preview-modal').classList.remove('hidden');
    }

    function closePreview() {
      document.getElementById('preview-modal').classList.add('hidden');
    }

    function downloadImage(type) {
      let dataUrl;
      let filename;
      
      switch(type) {
        case 'original':
          dataUrl = sessionData.original_image;
          filename = 'original.jpg';
          break;
        case 'lifestyle':
          dataUrl = sessionData.lifestyle_image;
          filename = 'lifestyle.jpg';
          break;
        case 'ecommerce':
          dataUrl = sessionData.ecommerce_image;
          filename = 'ecommerce.jpg';
          break;
        case 'instagram':
          dataUrl = sessionData.instagram_image;
          filename = 'instagram.jpg';
          break;
        case 'macro':
          dataUrl = sessionData.macro_image;
          filename = 'macro.jpg';
          break;
      }

      if (!dataUrl) return;

      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = (sessionData.product_name || 'product').replace(/[^a-z0-9]/gi, '_') + '_' + filename;
      link.click();
    }

    async function downloadAll() {
      const zip = new JSZip();
      const productName = (sessionData.product_name || 'product').replace(/[^a-z0-9]/gi, '_');
      
      const images = [
        { name: 'original.jpg', data: sessionData.original_image },
        { name: 'lifestyle.jpg', data: sessionData.lifestyle_image },
        { name: 'ecommerce.jpg', data: sessionData.ecommerce_image },
        { name: 'instagram.jpg', data: sessionData.instagram_image },
        { name: 'macro.jpg', data: sessionData.macro_image }
      ];

      for (const img of images) {
        if (img.data) {
          const base64Data = img.data.split(',')[1];
          zip.file(productName + '_' + img.name, base64Data, { base64: true });
        }
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = productName + '_all_variations.zip';
      link.click();
    }

    // Load on page load
    loadSession();
  </script>
</body>
</html>`
}

function getHistoryPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>History - Tesco Image Generator</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            'tesco-blue': '#00539F',
            'tesco-red': '#EE1C2E',
          }
        }
      }
    }
  </script>
</head>
<body class="bg-gray-50 min-h-screen">
  <!-- Header -->
  <header class="bg-tesco-blue text-white shadow-lg">
    <div class="max-w-7xl mx-auto px-6 py-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 bg-white rounded-lg flex items-center justify-center">
            <span class="text-tesco-blue font-bold text-xl">T</span>
          </div>
          <div>
            <h1 class="text-2xl font-bold">Product Image Generator</h1>
            <p class="text-blue-200 text-sm">Merchandising Team Tool</p>
          </div>
        </div>
        <nav class="flex items-center gap-6">
          <a href="/" class="flex items-center gap-2 px-4 py-2 hover:bg-white/10 rounded-lg transition">
            <i class="fas fa-home"></i>
            <span>Home</span>
          </a>
          <a href="/history" class="flex items-center gap-2 px-4 py-2 bg-white/10 rounded-lg hover:bg-white/20 transition">
            <i class="fas fa-history"></i>
            <span>History</span>
          </a>
        </nav>
      </div>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-6 py-10">
    <div class="flex items-center justify-between mb-8">
      <div>
        <h2 class="text-3xl font-bold text-gray-800">Generation History</h2>
        <p class="text-gray-600 mt-1">View and download your previous image generations</p>
      </div>
      <a href="/" class="px-5 py-2.5 bg-tesco-blue text-white rounded-lg font-semibold hover:bg-blue-700 transition">
        <i class="fas fa-plus mr-2"></i>New Generation
      </a>
    </div>

    <div id="loading" class="text-center py-20">
      <i class="fas fa-spinner fa-spin text-4xl text-tesco-blue mb-4"></i>
      <p class="text-gray-600">Loading history...</p>
    </div>

    <div id="empty" class="hidden text-center py-20">
      <div class="w-24 h-24 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-6">
        <i class="fas fa-history text-4xl text-gray-400"></i>
      </div>
      <h3 class="text-2xl font-bold text-gray-800 mb-2">No History Yet</h3>
      <p class="text-gray-600 mb-6">Generate your first product variations to see them here</p>
      <a href="/" class="inline-block px-6 py-3 bg-tesco-blue text-white rounded-lg font-semibold hover:bg-blue-700 transition">
        <i class="fas fa-magic mr-2"></i>Create First Generation
      </a>
    </div>

    <div id="sessions" class="hidden grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"></div>
  </main>

  <script>
    async function loadHistory() {
      try {
        const response = await fetch('/api/sessions');
        const data = await response.json();
        
        document.getElementById('loading').classList.add('hidden');
        
        if (data.success && data.sessions && data.sessions.length > 0) {
          displaySessions(data.sessions);
        } else {
          document.getElementById('empty').classList.remove('hidden');
        }
      } catch (error) {
        document.getElementById('loading').classList.add('hidden');
        document.getElementById('empty').classList.remove('hidden');
      }
    }

    function displaySessions(sessions) {
      const container = document.getElementById('sessions');
      container.classList.remove('hidden');
      
      container.innerHTML = sessions.map(session => {
        const date = new Date(session.created_at).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
        
        const statusBadge = session.status === 'completed' 
          ? '<span class="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full"><i class="fas fa-check mr-1"></i>Completed</span>'
          : session.status === 'generating'
          ? '<span class="px-2 py-1 bg-yellow-100 text-yellow-700 text-xs rounded-full"><i class="fas fa-spinner fa-spin mr-1"></i>Generating</span>'
          : session.status === 'failed'
          ? '<span class="px-2 py-1 bg-red-100 text-red-700 text-xs rounded-full"><i class="fas fa-times mr-1"></i>Failed</span>'
          : '<span class="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-full">Pending</span>';
        
        const sourceIcon = session.source_type === 'url' 
          ? '<i class="fas fa-link text-gray-400"></i>' 
          : '<i class="fas fa-upload text-gray-400"></i>';
        
        return \`
          <div class="bg-white rounded-xl shadow-lg overflow-hidden hover:shadow-xl transition cursor-pointer group" onclick="viewSession('\${session.id}')">
            <div class="aspect-video bg-gray-100 relative overflow-hidden">
              <img src="\${session.original_image}" class="w-full h-full object-contain">
              <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                <span class="text-white font-semibold"><i class="fas fa-eye mr-2"></i>View Results</span>
              </div>
            </div>
            <div class="p-4">
              <div class="flex items-start justify-between mb-2">
                <h3 class="font-semibold text-gray-800 truncate flex-1">\${session.product_name || 'Untitled Product'}</h3>
                \${statusBadge}
              </div>
              <div class="flex items-center justify-between text-sm text-gray-500">
                <span class="flex items-center gap-1">\${sourceIcon} \${date}</span>
                <button onclick="event.stopPropagation(); deleteSession('\${session.id}')" 
                        class="text-red-400 hover:text-red-600 transition opacity-0 group-hover:opacity-100">
                  <i class="fas fa-trash"></i>
                </button>
              </div>
            </div>
          </div>
        \`;
      }).join('');
    }

    function viewSession(id) {
      window.location.href = '/results/' + id;
    }

    async function deleteSession(id) {
      if (!confirm('Delete this session? This cannot be undone.')) return;
      
      try {
        await fetch('/api/sessions/' + id, { method: 'DELETE' });
        loadHistory();
      } catch (error) {
        alert('Failed to delete session');
      }
    }

    loadHistory();
  </script>
</body>
</html>`
}

export default app
