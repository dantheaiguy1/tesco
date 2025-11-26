import { Hono } from 'hono'
import { cors } from 'hono/cors'

type Bindings = {
  TESCO_DB: D1Database;
  GEMINI_API_KEY: string;
  // Vertex AI Service Account credentials
  VERTEX_PROJECT_ID: string;
  VERTEX_CLIENT_EMAIL: string;
  VERTEX_PRIVATE_KEY: string;
}

// ============================================================================
// VERTEX AI MODEL CONFIGURATION
// ============================================================================
// DUAL MODEL SUPPORT: Users can choose between quality vs speed
//
// BETTER (Default): Nano Banana Pro - gemini-3-pro-image-preview
//   - Best quality image generation (Gemini 3 Pro)
//   - ~3-4 seconds per image (~36 seconds for 10)
//   - Cost: ~$0.03-0.05 per product shoot
//
// CHEAPER: Flash 2.5 - gemini-2.5-flash-preview-image-generation
//   - Good quality, significantly faster (stable replacement for 2.0)
//   - ~1-2 seconds per image (~15 seconds for 10)
//   - Cost: ~$0.01-0.02 per product shoot
//
// ENDPOINT: Must use GLOBAL endpoint for both models
// ============================================================================
const VERTEX_REGION = 'global';

// Model configurations
const MODELS: Record<string, string> = {
  nano: 'gemini-3-pro-image-preview',              // BETTER - Nano Banana Pro (default)
  flash: 'gemini-2.5-flash-preview-image-generation'  // CHEAPER - Flash 2.5 (stable)
};

const MODEL_INFO: Record<string, { name: string; speed: string; quality: string; totalTime: string }> = {
  nano: { name: 'Nano Pro', speed: '~3-4s per image', quality: 'Best', totalTime: '~36 seconds' },
  flash: { name: 'Flash 2.5', speed: '~1-2s per image', quality: 'Good', totalTime: '~15 seconds' }
};

// Default model for backwards compatibility
const DEFAULT_MODEL = 'nano';

// Generate JWT for Google OAuth2
async function createJWT(clientEmail: string, privateKey: string): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: clientEmail,
    sub: clientEmail,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/cloud-platform'
  };

  const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const encodedPayload = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  // Import the private key
  const pemContents = privateKey
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\\n/g, '')
    .replace(/\s/g, '');
  
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signatureInput)
  );

  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  return `${signatureInput}.${encodedSignature}`;
}

// Get OAuth2 access token from Google
async function getAccessToken(clientEmail: string, privateKey: string): Promise<string> {
  const jwt = await createJWT(clientEmail, privateKey);
  
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get access token: ${error}`);
  }

  const data = await response.json() as { access_token: string };
  return data.access_token;
}

// Call Vertex AI Gemini API for image generation
async function generateImageWithVertex(
  projectId: string,
  clientEmail: string,
  privateKey: string,
  imageBase64: string,
  mimeType: string,
  prompt: string,
  modelKey: string = DEFAULT_MODEL // 'nano' or 'flash'
): Promise<{ success: boolean; image?: string; error?: string }> {
  try {
    const accessToken = await getAccessToken(clientEmail, privateKey);
    
    // Get the actual model name from the key
    const vertexModel = MODELS[modelKey] || MODELS[DEFAULT_MODEL];
    
    // Global endpoint uses aiplatform.googleapis.com without region prefix
    const endpoint = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${VERTEX_REGION}/publishers/google/models/${vertexModel}:generateContent`;
    
    console.log(`[Vertex AI] Model: ${modelKey} -> ${vertexModel}, Endpoint: ${endpoint.substring(0, 80)}...`);
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: imageBase64
              }
            },
            { text: prompt }
          ]
        }],
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT']
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Vertex AI ERROR] Status: ${response.status}, Model: ${modelKey}/${vertexModel}`);
      console.error(`[Vertex AI ERROR] Response: ${errorText.substring(0, 500)}`);
      let errorMsg = 'Vertex AI error';
      try {
        const errJson = JSON.parse(errorText);
        errorMsg = errJson.error?.message || errJson.error?.status || `API error: ${response.status}`;
      } catch {
        errorMsg = `API error: ${response.status}`;
      }
      return { success: false, error: `${errorMsg} [Model: ${vertexModel}]` };
    }

    const data = await response.json() as any;
    
    // Extract image from response
    if (data.candidates?.[0]?.content?.parts) {
      for (const part of data.candidates[0].content.parts) {
        if (part.inlineData?.data) {
          const resultMimeType = part.inlineData.mimeType || 'image/png';
          const imageData = `data:${resultMimeType};base64,${part.inlineData.data}`;
          return { success: true, image: imageData };
        }
      }
    }

    return { success: false, error: 'No image in response' };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('Vertex AI generation error:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('*', cors())

// Auto-migrate database on first request
async function ensureDatabase(db: D1Database) {
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        product_name TEXT,
        source_type TEXT NOT NULL CHECK (source_type IN ('upload', 'url')),
        source_url TEXT,
        original_image TEXT NOT NULL,
        lifestyle_image TEXT,
        ecommerce_image TEXT,
        instagram_image TEXT,
        macro_image TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generating', 'completed', 'failed')),
        error_message TEXT,
        model TEXT DEFAULT 'nano',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run()
    
    // Table for generated images (each row is one variation, ~50-100KB each)
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS generated_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        variation_type TEXT NOT NULL,
        variation_index INTEGER NOT NULL,
        image_data TEXT NOT NULL,
        model TEXT DEFAULT 'nano',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )
    `).run()
    
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at DESC)').run()
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)').run()
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_generated_images_session ON generated_images(session_id)').run()
    
    // Migration: Add model column if it doesn't exist (for existing databases)
    try {
      await db.prepare('ALTER TABLE sessions ADD COLUMN model TEXT DEFAULT \'nano\'').run()
    } catch (e) { /* Column already exists */ }
    try {
      await db.prepare('ALTER TABLE generated_images ADD COLUMN model TEXT DEFAULT \'nano\'').run()
    } catch (e) { /* Column already exists */ }
  } catch (err) {
    console.log('Database already initialized or error:', err)
  }
}

// Generate unique ID
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}

// Homepage
app.get('/', (c) => {
  return c.html(getHomePage())
})

// History page - redirect to home (now uses sidebar)
app.get('/history', (c) => {
  return c.redirect('/')
})

// Results page
app.get('/results/:id', (c) => {
  return c.html(getResultsPage(c.req.param('id')))
})

// API: Get all sessions
app.get('/api/sessions', async (c) => {
  try {
    const db = c.env.TESCO_DB
    await ensureDatabase(db)
    const result = await db.prepare(
      'SELECT * FROM sessions ORDER BY created_at DESC'
    ).all()
    return c.json({ success: true, sessions: result.results })
  } catch (error) {
    console.error('Error fetching sessions:', error)
    return c.json({ success: false, error: 'Failed to fetch sessions' }, 500)
  }
})

// API: Get single session with its generated images
app.get('/api/sessions/:id', async (c) => {
  try {
    const db = c.env.TESCO_DB
    const id = c.req.param('id')
    const session = await db.prepare(
      'SELECT * FROM sessions WHERE id = ?'
    ).bind(id).first()
    
    if (!session) {
      return c.json({ success: false, error: 'Session not found' }, 404)
    }
    
    // Get generated images for this session
    const images = await db.prepare(
      'SELECT variation_type, variation_index, image_data FROM generated_images WHERE session_id = ? ORDER BY variation_index'
    ).bind(id).all()
    
    return c.json({ 
      success: true, 
      session,
      images: images.results || []
    })
  } catch (error) {
    console.error('Error fetching session:', error)
    return c.json({ success: false, error: 'Failed to fetch session' }, 500)
  }
})

// API: Save a generated image
app.post('/api/sessions/:id/images', async (c) => {
  try {
    const db = c.env.TESCO_DB
    const sessionId = c.req.param('id')
    const { variation_type, variation_index, image_data } = await c.req.json()
    
    if (!variation_type || variation_index === undefined || !image_data) {
      return c.json({ success: false, error: 'Missing required fields' }, 400)
    }
    
    // Check if image already exists for this variation
    const existing = await db.prepare(
      'SELECT id FROM generated_images WHERE session_id = ? AND variation_index = ?'
    ).bind(sessionId, variation_index).first()
    
    if (existing) {
      // Update existing
      await db.prepare(
        'UPDATE generated_images SET image_data = ? WHERE session_id = ? AND variation_index = ?'
      ).bind(image_data, sessionId, variation_index).run()
    } else {
      // Insert new
      await db.prepare(
        'INSERT INTO generated_images (session_id, variation_type, variation_index, image_data) VALUES (?, ?, ?, ?)'
      ).bind(sessionId, variation_type, variation_index, image_data).run()
    }
    
    return c.json({ success: true })
  } catch (error) {
    console.error('Error saving image:', error)
    return c.json({ success: false, error: 'Failed to save image' }, 500)
  }
})

// API: Health check
app.get('/api/health', async (c) => {
  return c.json({ 
    status: 'ok',
    hasGeminiKey: !!c.env.GEMINI_API_KEY,
    keyLength: c.env.GEMINI_API_KEY?.length || 0,
    hasDB: !!c.env.TESCO_DB
  })
})

// API: Test POST body
app.post('/api/test-body', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  return c.json({
    bodyKeys: Object.keys(body),
    hasOriginalImage: 'originalImage' in body,
    originalImageType: typeof body.originalImage,
    originalImageLength: body.originalImage?.length || 0,
    firstChars: body.originalImage?.substring(0, 50) || 'none'
  })
})

// API: Create session from upload
app.post('/api/upload', async (c) => {
  try {
    const db = c.env.TESCO_DB
    await ensureDatabase(db)
    
    const formData = await c.req.formData()
    const file = formData.get('image') as File
    const thumbnail = formData.get('thumbnail') as string | null
    const model = (formData.get('model') as string) || DEFAULT_MODEL
    
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

    // Convert to base64 data URL (chunked to avoid stack overflow)
    const buffer = await file.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    let binary = ''
    const chunkSize = 8192
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize)
      binary += String.fromCharCode.apply(null, chunk as any)
    }
    const base64 = btoa(binary)
    const dataUrl = `data:${file.type};base64,${base64}`

    // Create session with thumbnail for History page
    const sessionId = generateId()
    const productName = file.name.replace(/\.[^.]+$/, '')
    
    // Store thumbnail in D1 (small enough to fit in row limit)
    // Thumbnail is ~20-40KB, well under D1's 1MB limit
    await db.prepare(`
      INSERT INTO sessions (id, product_name, source_type, original_image, status, model)
      VALUES (?, ?, 'upload', ?, 'pending', ?)
    `).bind(sessionId, productName, thumbnail || '', model).run()

    return c.json({ success: true, sessionId, originalImage: dataUrl, model })
  } catch (error) {
    console.error('Upload error:', error)
    return c.json({ success: false, error: 'Failed to process upload' }, 500)
  }
})

// API: Scrape URL
app.post('/api/scrape', async (c) => {
  try {
    const db = c.env.TESCO_DB
    await ensureDatabase(db)
    
    const body = await c.req.json()
    const { url, model: requestModel } = body
    const model = requestModel || DEFAULT_MODEL
    
    if (!url) {
      return c.json({ success: false, error: 'No URL provided' }, 400)
    }

    // Fetch the page
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    })

    if (!response.ok) {
      return c.json({ success: false, error: 'Failed to fetch page. Please check the URL.' }, 400)
    }

    const html = await response.text()
    
    // Extract product image - try multiple patterns
    let imageUrl = null
    let productName = 'Product'

    // Try og:image meta tag first
    const ogImageMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i)
    if (ogImageMatch) {
      imageUrl = ogImageMatch[1]
    }
    
    // Try product image patterns
    if (!imageUrl) {
      const imgPatterns = [
        /src="(https:\/\/[^"]+\.(jpg|jpeg|png|webp)[^"]*)"/i,
        /data-src="(https:\/\/[^"]+\.(jpg|jpeg|png|webp)[^"]*)"/i
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
      productName = titleMatch[1].trim().substring(0, 100)
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
    const imgBytes = new Uint8Array(imageBuffer)
    let imgBinary = ''
    const imgChunkSize = 8192
    for (let i = 0; i < imgBytes.length; i += imgChunkSize) {
      const chunk = imgBytes.subarray(i, i + imgChunkSize)
      imgBinary += String.fromCharCode.apply(null, chunk as any)
    }
    const base64 = btoa(imgBinary)
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg'
    const dataUrl = `data:${contentType};base64,${base64}`

    // Create session
    const sessionId = generateId()
    
    // Store only metadata in D1 (base64 images are too large for D1's 1MB row limit)
    await db.prepare(`
      INSERT INTO sessions (id, product_name, source_type, source_url, original_image, status, model)
      VALUES (?, ?, 'url', ?, '', 'pending', ?)
    `).bind(sessionId, productName, url, model).run()

    return c.json({ success: true, sessionId, originalImage: dataUrl, productName, model })
  } catch (error) {
    console.error('Scrape error:', error)
    return c.json({ success: false, error: 'Failed to scrape URL' }, 500)
  }
})

// Variation definitions (shared between API and frontend)
// 5 DETAIL/CLOSE-UP SHOTS (1-5) - Trust-building, return-reducing
// 5 CONTEXT/LIFESTYLE SHOTS (6-10) - Conversion-driving
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

// Shared prompt generator function - Strategic ecommerce prompts
function getPrompts(productName: string): Record<string, string> {
  return {
    // === DETAIL/CLOSE-UP SHOTS (1-5) - Trust-building, return-reducing ===
    
    'macro_texture': `Extreme close-up macro photography showing this ${productName} material texture and surface detail. Shallow depth of field with soft bokeh background. Professional studio lighting highlighting weave pattern, grain, or surface texture. Rich color saturation, crisp sharp focus on texture details. Commercial product photography emphasizing quality and craftsmanship. High resolution 2k, premium detail shot that builds customer trust.`,
    
    'label_branding': `Close-up product photography focused on this ${productName} branding elements, logo, and label details. Professional studio lighting, sharp focus on typography and brand marks. Slight angle showing product dimensionality while keeping text completely readable. Commercial catalog photography style, color-accurate brand presentation. High resolution 2k, editorial detail quality.`,
    
    'construction_detail': `Detailed close-up showing this ${productName} construction quality - seams, stitching, joints, edges, or assembly details. Professional studio lighting emphasizing craftsmanship. Shallow depth of field isolating key quality indicators. Premium product photography highlighting durability and attention to detail. High resolution 2k, trust-building detail shot that reduces returns.`,
    
    'color_finish': `Close-up photography of this ${productName} emphasizing true-to-life color accuracy and surface finish. Professional color-corrected studio lighting. Neutral background to showcase product color without distraction. Lighting angles showing sheen, matte finish, or surface quality. Commercial product photography for accurate buyer expectations. High resolution 2k, color-faithful presentation.`,
    
    'scale_reference': `Product photography of this ${productName} with clear scale reference showing actual size. Close-up composition with human hand partially in frame OR common object for size comparison. Professional studio lighting, clear perspective on product dimensions. Ecommerce photography that reduces size-related returns. High resolution 2k, practical size-accurate presentation.`,
    
    // === CONTEXT/LIFESTYLE SHOTS (6-10) - Conversion-driving ===
    
    'hero_white': `Clean professional product photo of this ${productName} on pure white background. Studio lighting from multiple angles. Product positioned at slight 45-degree angle showing depth and dimensionality. Soft natural shadow underneath. Centered composition. Amazon and Shopify listing style. High resolution 2k, catalog-quality commercial photography.`,
    
    'inuse_action': `This ${productName} being actively used in real-world scenario. Natural hands interacting with product showing scale and functionality. Authentic everyday setting. Lifestyle photography demonstrating practical application. Candid moment captured. Relatable use-case photography. Natural lighting. High resolution 2k, genuine user experience style.`,
    
    'flatlay_styled': `Flat-lay composition of this ${productName} photographed directly from above. Product styled with complementary accessories and props on neutral surface. Instagram aesthetic with intentional negative space. Natural window lighting. Curated lifestyle arrangement. Social media content style. Balanced composition. High resolution 2k, aspirational product styling.`,
    
    'environment_context': `This ${productName} in natural environment relevant to its use. Soft natural lighting showing product in realistic setting. Background slightly blurred to emphasize product as hero. Lifestyle photography creating emotional connection and showing product purpose. Authentic scene composition. High resolution 2k, contextual storytelling style.`,
    
    'multi_angle': `This ${productName} shown from three key angles in single composition: front view, side profile, and top-down perspective. Clean white or grey background. Professional studio lighting consistent across all angles. Commercial photography showing complete product understanding. Informative multi-view layout. High resolution 2k, comprehensive product documentation style.`
  }
}

// API: Generate a single variation (called individually for each)
app.post('/api/generate-single/:sessionId/:variationIndex', async (c) => {
  const sessionId = c.req.param('sessionId')
  const variationIndex = parseInt(c.req.param('variationIndex'))
  const db = c.env.TESCO_DB
  
  // Vertex AI credentials
  const projectId = c.env.VERTEX_PROJECT_ID
  const clientEmail = c.env.VERTEX_CLIENT_EMAIL
  const privateKey = c.env.VERTEX_PRIVATE_KEY
  
  try {
    const body = await c.req.json().catch(() => ({}))
    const originalImage = body.originalImage
    const productName = body.productName || 'product'
    const customPrompt = body.customPrompt // User-provided custom prompt
    const modelKey = body.model || DEFAULT_MODEL // 'nano' or 'flash'
    
    if (!originalImage || originalImage.length < 100) {
      return c.json({ success: false, error: 'No image provided', field: variationDefinitions[variationIndex]?.field }, 400)
    }
    
    // Check for Vertex AI credentials
    if (!projectId || !clientEmail || !privateKey) {
      return c.json({ success: false, error: 'Vertex AI credentials not configured', field: variationDefinitions[variationIndex]?.field }, 500)
    }

    const prompts: Record<string, string> = getPrompts(productName)
    
    const variation = variationDefinitions[variationIndex]
    if (!variation) {
      return c.json({ success: false, error: 'Invalid variation index', field: 'unknown' }, 400)
    }
    
    // Use custom prompt if provided, otherwise use default
    const prompt = customPrompt || prompts[variation.field]
    const isCustom = !!customPrompt
    const modelInfo = MODEL_INFO[modelKey] || MODEL_INFO[DEFAULT_MODEL]
    console.log(`[${variation.field}] Generating with ${modelInfo.name} (${modelKey})...`)
    
    const startTime = Date.now()
    
    // Extract mime type and base64 data from data URL
    const mimeType = originalImage.split(';')[0].split(':')[1]
    const imageBase64 = originalImage.split(',')[1]
    
    // Call Vertex AI with selected model
    const result = await generateImageWithVertex(
      projectId,
      clientEmail,
      privateKey,
      imageBase64,
      mimeType,
      prompt,
      modelKey
    )
    
    const elapsed = Date.now() - startTime
    console.log(`[${variation.field}] Response in ${elapsed}ms, success: ${result.success}`)
    
    if (!result.success) {
      console.error(`[${variation.field}] API error:`, result.error)
      return c.json({ success: false, error: result.error, field: variation.field }, 500)
    }
    
    console.log(`[${variation.field}] Success!${isCustom ? ' (Custom Prompt)' : ''} [${modelInfo.name}]`)
    return c.json({ 
      success: true, 
      field: variation.field, 
      label: variation.label,
      image: result.image,
      elapsed,
      isCustom,
      model: modelKey,
      modelName: modelInfo.name
    })
    
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error(`Error:`, errorMsg)
    return c.json({ success: false, error: errorMsg, field: variationDefinitions[variationIndex]?.field || 'unknown' }, 500)
  }
})

// API: Generate variations (legacy - kept for compatibility)
app.post('/api/generate/:id', async (c) => {
  const sessionId = c.req.param('id')
  const db = c.env.TESCO_DB
  
  console.log('Generate endpoint called for session:', sessionId)
  
  try {
    const session = await db.prepare(
      'SELECT * FROM sessions WHERE id = ?'
    ).bind(sessionId).first() as any
    
    if (!session) {
      return c.json({ success: false, error: 'Session not found' }, 404)
    }

    const body = await c.req.json().catch(() => ({}))
    const originalImage = body.originalImage || session.original_image
    
    if (!originalImage || originalImage.length < 100) {
      return c.json({ success: false, error: 'No original image provided' }, 400)
    }

    // Vertex AI credentials
    const projectId = c.env.VERTEX_PROJECT_ID
    const clientEmail = c.env.VERTEX_CLIENT_EMAIL
    const privateKey = c.env.VERTEX_PRIVATE_KEY
    
    if (!projectId || !clientEmail || !privateKey) {
      return c.json({ success: false, error: 'Vertex AI credentials not configured' }, 500)
    }
    
    const productName = session.product_name || 'product'
    const prompts: Record<string, string> = getPrompts(productName)
    const results: Record<string, string> = {}
    const errors: string[] = []
    
    // Extract mime type and base64 from original image
    const mimeType = originalImage.split(';')[0].split(':')[1]
    const imageBase64 = originalImage.split(',')[1]

    for (const variation of variationDefinitions) {
      try {
        const result = await generateImageWithVertex(
          projectId,
          clientEmail,
          privateKey,
          imageBase64,
          mimeType,
          prompts[variation.field]
        )
        
        if (result.success && result.image) {
          results[variation.field] = result.image
        } else {
          errors.push(`${variation.field}: ${result.error}`)
        }
      } catch (err) {
        errors.push(`${variation.field}: ${err}`)
      }
    }

    await db.prepare('UPDATE sessions SET status = ? WHERE id = ?').bind('completed', sessionId).run()
    
    return c.json({ 
      success: true, 
      results,
      originalImage,
      productName: session.product_name,
      debug: { resultCount: Object.keys(results).length, errors }
    })
  } catch (error) {
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

// API: Delete all sessions
app.delete('/api/sessions', async (c) => {
  try {
    const db = c.env.TESCO_DB
    await db.prepare('DELETE FROM sessions').run()
    return c.json({ success: true })
  } catch (error) {
    console.error('Delete all error:', error)
    return c.json({ success: false, error: 'Failed to delete sessions' }, 500)
  }
})

// API: Update session (status or name)
app.patch('/api/sessions/:id', async (c) => {
  try {
    const db = c.env.TESCO_DB
    const id = c.req.param('id')
    const body = await c.req.json()
    const { status, product_name } = body
    
    // Update status if provided
    if (status) {
      if (!['pending', 'generating', 'completed', 'failed'].includes(status)) {
        return c.json({ success: false, error: 'Invalid status' }, 400)
      }
      await db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(status, id).run()
    }
    
    // Update name if provided
    if (product_name !== undefined) {
      await db.prepare('UPDATE sessions SET product_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(product_name, id).run()
    }
    
    return c.json({ success: true })
  } catch (error) {
    console.error('Update error:', error)
    return c.json({ success: false, error: 'Failed to update session' }, 500)
  }
})

// HTML Templates - ShopShot Branded
function getHomePage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ShopShot - Product Photo Generator</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'><stop offset='0%25' style='stop-color:%233B82F6'/><stop offset='100%25' style='stop-color:%238B5CF6'/></linearGradient></defs><rect width='100' height='100' rx='22' fill='url(%23g)'/><circle cx='50' cy='50' r='28' fill='none' stroke='white' stroke-width='6'/><circle cx='50' cy='50' r='12' fill='white'/><rect x='70' y='25' width='12' height='8' rx='2' fill='white'/></svg>">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
  <style>
    * { font-family: 'Inter', system-ui, sans-serif; }
    
    /* Sidebar - Compact 180px */
    .sidebar {
      position: fixed;
      left: 0;
      top: 0;
      bottom: 0;
      width: 180px;
      background: white;
      border-right: 1px solid #E5E7EB;
      z-index: 30;
      display: flex;
      flex-direction: column;
    }
    .sidebar-header {
      padding: 12px;
      border-bottom: 1px solid #E5E7EB;
    }
    .new-btn {
      width: 100%;
      height: 40px;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: all 0.2s;
    }
    .new-btn:hover { opacity: 0.9; transform: translateY(-1px); }
    
    .session-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }
    
    /* Compact session items - 44px height */
    .session-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px;
      height: 44px;
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.15s;
      position: relative;
    }
    .session-item:hover { background: #F3F4F6; }
    .session-item.active { background: #EFF6FF; }
    .session-item.active .session-name { color: #3B82F6; }
    
    .session-icon {
      width: 20px;
      height: 20px;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .session-text { flex: 1; min-width: 0; }
    .session-name {
      font-size: 13px;
      font-weight: 500;
      color: #1F2937;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .session-name-input {
      font-size: 13px;
      font-weight: 500;
      color: #1F2937;
      background: transparent;
      border: none;
      outline: none;
      width: 100%;
      padding: 0;
    }
    .session-name-input:focus { background: white; padding: 2px 4px; border-radius: 3px; }
    .session-meta {
      font-size: 11px;
      color: #9CA3AF;
    }
    .session-delete {
      opacity: 0;
      position: absolute;
      right: 4px;
      top: 50%;
      transform: translateY(-50%);
      width: 16px;
      height: 16px;
      font-size: 10px;
      color: #9CA3AF;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .session-item:hover .session-delete { opacity: 1; }
    .session-delete:hover { color: #EF4444; }
    
    .sidebar-footer {
      padding: 12px;
      border-top: 1px solid #E5E7EB;
      font-size: 11px;
      color: #9CA3AF;
    }
    
    /* Main content */
    .main-content {
      margin-left: 180px;
      min-height: 100vh;
      background: #F9FAFB;
    }
    
    /* Header */
    .header {
      height: 60px;
      background: white;
      border-bottom: 1px solid #E5E7EB;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 24px;
    }
    .logo { display: flex; align-items: center; gap: 8px; }
    .logo-icon {
      width: 28px;
      height: 28px;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .logo-icon svg { width: 16px; height: 16px; color: white; }
    .logo-text { font-size: 18px; font-weight: 700; color: #1F2937; }
    .hamburger { display: none; }
    
    /* Upload area - centered, compact */
    .upload-container {
      max-width: 440px;
      margin: 0 auto;
      padding: 48px 24px;
    }
    .upload-header {
      margin-bottom: 24px;
    }
    .upload-header h1 {
      font-size: 28px;
      font-weight: 700;
      color: #1F2937;
      margin-bottom: 4px;
    }
    .upload-header p {
      font-size: 15px;
      color: #6B7280;
    }
    
    /* Upload zone - compact */
    .upload-zone {
      width: 100%;
      height: 200px;
      border: 2px dashed #D1D5DB;
      border-radius: 12px;
      background: white;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s;
    }
    .upload-zone:hover { border-color: #3B82F6; background: #F0F9FF; }
    .upload-zone.dragover { border-color: #3B82F6; background: #EFF6FF; }
    .upload-icon { font-size: 32px; margin-bottom: 12px; }
    .upload-primary { font-size: 15px; font-weight: 500; color: #374151; }
    .upload-secondary { font-size: 13px; color: #9CA3AF; margin-top: 4px; }
    .upload-formats { font-size: 12px; color: #9CA3AF; margin-top: 12px; }
    
    /* Image preview */
    .image-preview {
      text-align: center;
      padding: 16px;
      background: white;
      border-radius: 12px;
      border: 1px solid #E5E7EB;
    }
    .image-preview img {
      max-width: 280px;
      max-height: 200px;
      border-radius: 8px;
      margin-bottom: 12px;
    }
    .change-image { font-size: 13px; color: #3B82F6; cursor: pointer; }
    .change-image:hover { text-decoration: underline; }
    
    /* Quality selector - inline compact */
    .quality-section {
      margin-top: 20px;
    }
    .quality-label {
      font-size: 13px;
      font-weight: 500;
      color: #6B7280;
      margin-bottom: 8px;
    }
    .quality-options {
      display: flex;
      gap: 12px;
    }
    .quality-btn {
      flex: 1;
      padding: 12px;
      border: 1.5px solid #E5E7EB;
      border-radius: 8px;
      background: white;
      cursor: pointer;
      transition: all 0.2s;
      text-align: center;
    }
    .quality-btn:hover { border-color: #3B82F6; }
    .quality-btn.active {
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      border-color: transparent;
      color: white;
    }
    .quality-btn.active .q-label,
    .quality-btn.active .q-detail { color: white; }
    .quality-btn.active .q-detail { opacity: 0.9; }
    .q-label { font-size: 14px; font-weight: 600; color: #1F2937; }
    .q-detail { font-size: 12px; color: #6B7280; margin-top: 2px; }
    
    /* Advanced mode link */
    .advanced-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 16px;
      font-size: 13px;
      color: #3B82F6;
      cursor: pointer;
    }
    .advanced-link:hover { text-decoration: underline; }
    
    /* Generate button */
    .generate-btn {
      width: 100%;
      height: 52px;
      margin-top: 20px;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      color: white;
      border: none;
      border-radius: 10px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
      transition: all 0.2s;
    }
    .generate-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(59, 130, 246, 0.4); }
    .generate-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }
    
    /* Results section */
    .results-container {
      padding: 24px;
      max-width: 1200px;
      margin: 0 auto;
    }
    .results-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
      flex-wrap: wrap;
      gap: 12px;
    }
    .product-name-edit {
      font-size: 24px;
      font-weight: 700;
      color: #1F2937;
      border: none;
      background: transparent;
      outline: none;
      max-width: 400px;
    }
    .product-name-edit:focus { border-bottom: 2px solid #3B82F6; }
    .results-actions { display: flex; gap: 12px; }
    .download-all-btn {
      padding: 10px 20px;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .download-all-btn:hover { opacity: 0.9; }
    .delete-session-btn {
      padding: 10px 16px;
      background: transparent;
      color: #6B7280;
      border: 1px solid #E5E7EB;
      border-radius: 8px;
      font-size: 14px;
      cursor: pointer;
    }
    .delete-session-btn:hover { color: #EF4444; border-color: #EF4444; }
    
    /* Thumbnail grid - 5 columns */
    .thumb-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 16px;
    }
    @media (max-width: 1200px) { .thumb-grid { grid-template-columns: repeat(4, 1fr); } }
    @media (max-width: 900px) { .thumb-grid { grid-template-columns: repeat(3, 1fr); } }
    @media (max-width: 600px) { .thumb-grid { grid-template-columns: repeat(2, 1fr); } }
    
    .image-card {
      background: white;
      border: 1px solid #E5E7EB;
      border-radius: 10px;
      padding: 8px;
      transition: all 0.2s;
      position: relative;
    }
    .image-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    .image-card img {
      width: 100%;
      aspect-ratio: 1;
      object-fit: cover;
      border-radius: 6px;
      cursor: pointer;
    }
    .card-overlay {
      position: absolute;
      top: 8px;
      left: 8px;
      right: 8px;
      bottom: 32px;
      background: rgba(0,0,0,0.5);
      border-radius: 6px;
      display: none;
      align-items: center;
      justify-content: center;
      gap: 12px;
      pointer-events: none;  /* Allow clicks to pass through to image */
    }
    .image-card:hover .card-overlay { display: flex; }
    .card-overlay button {
      width: 36px;
      height: 36px;
      background: white;
      border: none;
      border-radius: 50%;
      cursor: pointer;
      font-size: 14px;
      pointer-events: auto;  /* Buttons remain clickable */
    }
    .card-label {
      font-size: 12px;
      font-weight: 500;
      color: #6B7280;
      text-align: center;
      margin-top: 8px;
    }
    
    /* Loading state */
    .card-loading {
      background: linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%);
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
    }
    @keyframes shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
    .card-progress {
      position: absolute;
      bottom: 40px;
      left: 12px;
      right: 12px;
      height: 4px;
      background: #E5E7EB;
      border-radius: 2px;
      overflow: hidden;
    }
    .card-progress-bar {
      height: 100%;
      background: linear-gradient(90deg, #3B82F6, #8B5CF6);
      transition: width 0.3s;
    }
    
    /* Lightbox */
    .lightbox {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.9);
      z-index: 100;
      display: none;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      padding: 20px;
    }
    .lightbox.open { display: flex; }
    .lightbox-close {
      position: absolute;
      top: 20px;
      right: 20px;
      width: 44px;
      height: 44px;
      background: rgba(255,255,255,0.1);
      border: none;
      border-radius: 50%;
      color: white;
      font-size: 20px;
      cursor: pointer;
    }
    .lightbox-title {
      color: white;
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    .lightbox-image {
      max-width: 90vw;
      max-height: 70vh;
      border-radius: 12px;
    }
    .lightbox-nav {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      width: 44px;
      height: 44px;
      background: rgba(255,255,255,0.1);
      border: none;
      border-radius: 50%;
      color: white;
      font-size: 18px;
      cursor: pointer;
    }
    .lightbox-nav.prev { left: 20px; }
    .lightbox-nav.next { right: 20px; }
    .lightbox-download {
      margin-top: 20px;
      padding: 12px 24px;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
    }
    
    /* Error toast */
    .error-toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #1F2937;
      color: white;
      padding: 16px 20px;
      border-radius: 10px;
      display: none;
      align-items: center;
      gap: 12px;
      max-width: 400px;
      z-index: 200;
    }
    .error-toast.show { display: flex; }
    
    /* Advanced mode modal */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.5);
      z-index: 100;
      display: none;
      align-items: center;
      justify-content: center;
    }
    .modal-overlay.open { display: flex; }
    .modal {
      background: white;
      border-radius: 12px;
      width: 90%;
      max-width: 600px;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
    }
    .modal-header {
      padding: 16px 20px;
      border-bottom: 1px solid #E5E7EB;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .modal-header h3 { font-size: 16px; font-weight: 600; color: #1F2937; }
    .modal-close {
      width: 32px;
      height: 32px;
      background: #F3F4F6;
      border: none;
      border-radius: 50%;
      cursor: pointer;
    }
    .modal-body {
      flex: 1;
      overflow-y: auto;
      padding: 16px 20px;
    }
    .prompt-item {
      padding: 12px 0;
      border-bottom: 1px solid #F3F4F6;
    }
    .prompt-item:last-child { border-bottom: none; }
    .prompt-label {
      font-size: 13px;
      font-weight: 500;
      color: #374151;
      margin-bottom: 6px;
    }
    .prompt-input {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid #E5E7EB;
      border-radius: 6px;
      font-size: 13px;
      resize: vertical;
      min-height: 60px;
    }
    .prompt-input:focus { border-color: #3B82F6; outline: none; }
    .modal-footer {
      padding: 16px 20px;
      border-top: 1px solid #E5E7EB;
    }
    .modal-done {
      width: 100%;
      padding: 12px;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
    }
    
    /* Mobile */
    @media (max-width: 768px) {
      .sidebar {
        transform: translateX(-100%);
        width: 280px;
        z-index: 50;
      }
      .sidebar.open { transform: translateX(0); }
      .sidebar-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.5);
        z-index: 40;
        display: none;
      }
      .sidebar-overlay.open { display: block; }
      .main-content { margin-left: 0; }
      .hamburger {
        display: flex;
        width: 40px;
        height: 40px;
        background: #F3F4F6;
        border: none;
        border-radius: 8px;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        margin-right: 12px;
      }
      .upload-container { padding: 24px 16px; }
      .quality-options { flex-direction: column; }
    }
  </style>
</head>
<body>
  <!-- Sidebar overlay (mobile) -->
  <div id="sidebar-overlay" class="sidebar-overlay" onclick="toggleSidebar()"></div>
  
  <!-- Compact Sidebar -->
  <aside id="sidebar" class="sidebar">
    <div class="sidebar-header">
      <button class="new-btn" onclick="resetToUpload()">
        + New Generation
      </button>
    </div>
    <div id="session-list" class="session-list">
      <div style="text-align:center; padding:24px 8px; color:#9CA3AF; font-size:13px;">
        No sessions yet
      </div>
    </div>
    <div class="sidebar-footer">
      <span id="session-count">0 generations</span>
    </div>
  </aside>

  <!-- Main Content -->
  <div class="main-content">
    <!-- Header -->
    <header class="header">
      <div class="logo">
        <button class="hamburger" onclick="toggleSidebar()">☰</button>
        <div class="logo-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </div>
        <span class="logo-text">ShopShot</span>
      </div>
      <div id="header-actions"></div>
    </header>

    <!-- Upload Screen -->
    <div id="upload-screen" class="upload-container">
      <div class="upload-header">
        <h1>ShopShot</h1>
        <p>Transform one photo into 10 professional shots</p>
      </div>

      <!-- Upload Zone -->
      <div id="upload-zone" class="upload-zone" onclick="document.getElementById('file-input').click()"
           ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event)">
        <input type="file" id="file-input" accept="image/*" style="display:none" onchange="handleFileSelect(event)">
        <div id="upload-prompt">
          <div class="upload-icon">☁️</div>
          <div class="upload-primary">Drop your product image here</div>
          <div class="upload-secondary">or click to browse</div>
          <div class="upload-formats">JPG, PNG, WebP up to 10MB</div>
        </div>
        <div id="upload-preview" class="image-preview" style="display:none">
          <img id="preview-image" src="" alt="Preview">
          <div class="change-image" onclick="event.stopPropagation(); resetUpload()">Change image</div>
        </div>
      </div>

      <!-- Quality Selector -->
      <div class="quality-section">
        <div class="quality-label">Quality:</div>
        <div class="quality-options">
          <button class="quality-btn" data-model="flash" onclick="selectModel('flash')">
            <div class="q-label">Cheaper</div>
            <div class="q-detail">Flash 2.5 · ~15s</div>
          </button>
          <button class="quality-btn active" data-model="nano" onclick="selectModel('nano')">
            <div class="q-label">Better</div>
            <div class="q-detail">Nano Pro · ~36s</div>
          </button>
        </div>
      </div>

      <!-- Advanced Mode -->
      <div class="advanced-link" onclick="openAdvancedMode()">
        ⚙️ Advanced Mode (Custom Prompts)
      </div>

      <!-- Generate Button -->
      <button id="generate-btn" class="generate-btn" onclick="generateVariations()" disabled>
        Generate 10 Professional Shots
      </button>
    </div>

    <!-- Results Screen (hidden initially) -->
    <div id="results-screen" class="results-container" style="display:none">
      <div class="results-header">
        <input type="text" id="product-name-edit" class="product-name-edit" value="Product" 
               onblur="saveProductName()" onkeypress="if(event.key==='Enter')this.blur()">
        <div class="results-actions">
          <button class="download-all-btn" onclick="downloadAllAsZip()">
            ⬇️ Download All (ZIP)
          </button>
          <button class="delete-session-btn" onclick="deleteCurrentSession()">
            🗑️ Delete
          </button>
        </div>
      </div>
      <div id="thumb-grid" class="thumb-grid"></div>
    </div>
  </div>

  <!-- Lightbox -->
  <div id="lightbox" class="lightbox" onclick="closeLightbox()">
    <button class="lightbox-close" onclick="closeLightbox()">✕</button>
    <button class="lightbox-nav prev" onclick="event.stopPropagation(); navigateLightbox(-1)">‹</button>
    <button class="lightbox-nav next" onclick="event.stopPropagation(); navigateLightbox(1)">›</button>
    <div class="lightbox-title" id="lightbox-title"></div>
    <img id="lightbox-image" class="lightbox-image" onclick="event.stopPropagation()">
    <button class="lightbox-download" onclick="event.stopPropagation(); downloadCurrentImage()">⬇️ Download</button>
  </div>

  <!-- Error Toast -->
  <div id="error-toast" class="error-toast">
    <span>⚠️</span>
    <span id="error-message"></span>
  </div>

  <!-- Advanced Mode Modal -->
  <div id="advanced-modal" class="modal-overlay" onclick="closeAdvancedMode()">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-header">
        <h3>Custom Prompts</h3>
        <button class="modal-close" onclick="closeAdvancedMode()">✕</button>
      </div>
      <div class="modal-body" id="prompt-list"></div>
      <div class="modal-footer">
        <button class="modal-done" onclick="closeAdvancedMode()">Done</button>
      </div>
    </div>
  </div>

  <script>
    // State
    let currentSessionId = null;
    let selectedFile = null;
    let currentOriginalImage = null;
    let selectedModel = 'nano';
    let sidebarOpen = false;
    let sessions = [];
    let lightboxImages = [];
    let currentLightboxIndex = 0;
    let customPrompts = {};

    // Variation definitions
    const variationDefs = [
      { field: 'original', label: 'Original', isOriginal: true },
      { field: 'macro_texture', label: '1. Texture Detail' },
      { field: 'label_branding', label: '2. Label & Branding' },
      { field: 'construction_detail', label: '3. Construction' },
      { field: 'color_finish', label: '4. Color & Finish' },
      { field: 'scale_reference', label: '5. Size Reference' },
      { field: 'hero_white', label: '6. Hero (White BG)' },
      { field: 'inuse_action', label: '7. In-Use Action' },
      { field: 'flatlay_styled', label: '8. Flat-Lay' },
      { field: 'environment_context', label: '9. Environment' },
      { field: 'multi_angle', label: '10. Multi-Angle' }
    ];

    const MODEL_INFO = {
      nano: { name: 'Nano Pro', time: '~36s' },
      flash: { name: 'Flash 2.5', time: '~15s' }
    };

    // Sidebar
    function toggleSidebar() {
      sidebarOpen = !sidebarOpen;
      document.getElementById('sidebar').classList.toggle('open', sidebarOpen);
      document.getElementById('sidebar-overlay').classList.toggle('open', sidebarOpen);
    }

    async function loadSessions() {
      try {
        const res = await fetch('/api/sessions');
        const data = await res.json();
        if (data.success) {
          sessions = data.sessions || [];
          renderSessionList();
        }
      } catch (e) { console.error('Load sessions failed:', e); }
    }

    function renderSessionList() {
      const list = document.getElementById('session-list');
      const count = document.getElementById('session-count');
      if (count) count.textContent = sessions.length + ' generation' + (sessions.length !== 1 ? 's' : '');
      
      if (!sessions.length) {
        list.innerHTML = '<div style="text-align:center; padding:24px 8px; color:#9CA3AF; font-size:13px;">No sessions yet</div>';
        return;
      }
      
      list.innerHTML = sessions.map(s => {
        const isActive = s.id === currentSessionId;
        const timeAgo = getTimeAgo(new Date(s.created_at));
        const model = s.model === 'flash' ? 'Flash' : 'Nano';
        return '<div class="session-item' + (isActive ? ' active' : '') + '" onclick="loadSession(\\'' + s.id + '\\')">' +
          '<div class="session-icon">📸</div>' +
          '<div class="session-text">' +
            '<input type="text" class="session-name-input" value="' + (s.product_name || 'Untitled').replace(/"/g, '&quot;') + '" ' +
              'onclick="event.stopPropagation()" onblur="saveSessionName(\\'' + s.id + '\\', this)" onkeypress="if(event.key===\\'Enter\\')this.blur()">' +
            '<div class="session-meta">' + timeAgo + ' · ' + model + '</div>' +
          '</div>' +
          '<div class="session-delete" onclick="event.stopPropagation(); deleteSession(\\'' + s.id + '\\')">✕</div>' +
        '</div>';
      }).join('');
    }

    function getTimeAgo(date) {
      const s = Math.floor((Date.now() - date) / 1000);
      if (s < 60) return 'Just now';
      if (s < 3600) return Math.floor(s / 60) + 'm ago';
      if (s < 86400) return Math.floor(s / 3600) + 'h ago';
      return Math.floor(s / 86400) + 'd ago';
    }

    async function saveSessionName(id, input) {
      const name = input.value.trim() || 'Untitled';
      try {
        await fetch('/api/sessions/' + id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_name: name })
        });
        const s = sessions.find(x => x.id === id);
        if (s) s.product_name = name;
      } catch (e) { console.error('Save name failed:', e); }
    }

    async function deleteSession(id) {
      if (!confirm('Delete this session?')) return;
      try {
        await fetch('/api/sessions/' + id, { method: 'DELETE' });
        sessions = sessions.filter(s => s.id !== id);
        renderSessionList();
        if (id === currentSessionId) resetToUpload();
      } catch (e) { showError('Delete failed'); }
    }

    function loadSession(id) {
      window.location.href = '/results/' + id;
    }

    function resetToUpload() {
      window.location.href = '/';
    }

    // Model selection
    function selectModel(model) {
      selectedModel = model;
      document.querySelectorAll('.quality-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.model === model);
      });
    }

    // File handling
    function handleDragOver(e) {
      e.preventDefault();
      e.currentTarget.classList.add('dragover');
    }
    function handleDragLeave(e) {
      e.currentTarget.classList.remove('dragover');
    }
    function handleDrop(e) {
      e.preventDefault();
      e.currentTarget.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) processFile(file);
    }
    function handleFileSelect(e) {
      const file = e.target.files[0];
      if (file) processFile(file);
    }

    function processFile(file) {
      if (file.size > 10 * 1024 * 1024) {
        showError('File too large (max 10MB)');
        return;
      }
      selectedFile = file;
      const reader = new FileReader();
      reader.onload = (e) => {
        currentOriginalImage = e.target.result;
        document.getElementById('preview-image').src = currentOriginalImage;
        document.getElementById('upload-prompt').style.display = 'none';
        document.getElementById('upload-preview').style.display = 'block';
        document.getElementById('upload-zone').style.height = 'auto';
        document.getElementById('generate-btn').disabled = false;
        
        // Upload immediately
        uploadImage();
      };
      reader.readAsDataURL(file);
    }

    function resetUpload() {
      selectedFile = null;
      currentOriginalImage = null;
      currentSessionId = null;
      document.getElementById('upload-prompt').style.display = 'block';
      document.getElementById('upload-preview').style.display = 'none';
      document.getElementById('upload-zone').style.height = '200px';
      document.getElementById('generate-btn').disabled = true;
      document.getElementById('file-input').value = '';
    }

    async function uploadImage() {
      if (!selectedFile) return;
      
      const formData = new FormData();
      formData.append('image', selectedFile);
      formData.append('model', selectedModel);
      
      // Create thumbnail
      const canvas = document.createElement('canvas');
      const img = new Image();
      img.src = currentOriginalImage;
      await new Promise(r => img.onload = r);
      const size = 200;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const scale = Math.max(size / img.width, size / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      formData.append('thumbnail', canvas.toDataURL('image/jpeg', 0.7));

      try {
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
          currentSessionId = data.sessionId;
          loadSessions();
        }
      } catch (e) { console.error('Upload failed:', e); }
    }

    // Generation
    async function generateVariations() {
      if (!currentSessionId || !currentOriginalImage) {
        showError('Please upload an image first');
        return;
      }

      // Switch to results view
      document.getElementById('upload-screen').style.display = 'none';
      document.getElementById('results-screen').style.display = 'block';
      document.getElementById('product-name-edit').value = selectedFile?.name?.replace(/\\.[^.]+$/, '') || 'Product';

      // Build grid with loading states
      const grid = document.getElementById('thumb-grid');
      lightboxImages = [];
      
      grid.innerHTML = variationDefs.map((v, i) => {
        if (v.isOriginal) {
          lightboxImages.push({ src: currentOriginalImage, label: 'Original' });
          return '<div class="image-card" id="card-' + i + '">' +
            '<img src="' + currentOriginalImage + '" onclick="openLightbox(' + i + ')">' +
            '<div class="card-label">Original</div>' +
          '</div>';
        }
        return '<div class="image-card" id="card-' + i + '">' +
          '<div class="card-loading" style="width:100%; aspect-ratio:1; border-radius:6px;"></div>' +
          '<div class="card-progress"><div class="card-progress-bar" id="progress-' + i + '" style="width:0%"></div></div>' +
          '<div class="card-label">' + v.label + '</div>' +
        '</div>';
      }).join('');

      // Generate each variation
      const startTime = Date.now();
      const promises = [];
      
      for (let i = 1; i < variationDefs.length; i++) {
        promises.push(generateSingle(i, startTime));
      }
      
      await Promise.allSettled(promises);
      
      // Update session
      try {
        await fetch('/api/sessions/' + currentSessionId, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed' })
        });
        loadSessions();
      } catch (e) {}
    }

    async function generateSingle(index, startTime) {
      const v = variationDefs[index];
      const progressBar = document.getElementById('progress-' + index);
      
      // Animate progress
      let progress = 0;
      const interval = setInterval(() => {
        progress = Math.min(95, progress + 2);
        if (progressBar) progressBar.style.width = progress + '%';
      }, 500);

      try {
        const res = await fetch('/api/generate-single/' + currentSessionId + '/' + (index - 1), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            originalImage: currentOriginalImage,
            productName: document.getElementById('product-name-edit')?.value || 'Product',
            customPrompt: customPrompts[index],
            model: selectedModel
          })
        });

        clearInterval(interval);
        const data = await res.json();
        const card = document.getElementById('card-' + index);
        
        if (data.success && data.image) {
          lightboxImages[index] = { src: data.image, label: v.label };
          card.innerHTML = '<img src="' + data.image + '" onclick="openLightbox(' + index + ')">' +
            '<div class="card-overlay">' +
              '<button onclick="event.stopPropagation(); regenerate(' + index + ')">🔄</button>' +
              '<button onclick="event.stopPropagation(); downloadImage(' + index + ')">⬇️</button>' +
            '</div>' +
            '<div class="card-label">' + v.label + '</div>';
        } else {
          card.innerHTML = '<div style="width:100%; aspect-ratio:1; background:#FEE2E2; border-radius:6px; display:flex; align-items:center; justify-content:center; color:#DC2626; cursor:pointer" onclick="regenerate(' + index + ')">⚠️ Retry</div>' +
            '<div class="card-label">' + v.label + '</div>';
        }
      } catch (e) {
        clearInterval(interval);
        const card = document.getElementById('card-' + index);
        card.innerHTML = '<div style="width:100%; aspect-ratio:1; background:#FEE2E2; border-radius:6px; display:flex; align-items:center; justify-content:center; color:#DC2626; cursor:pointer" onclick="regenerate(' + index + ')">⚠️ Retry</div>' +
          '<div class="card-label">' + variationDefs[index].label + '</div>';
      }
    }

    async function regenerate(index) {
      const card = document.getElementById('card-' + index);
      const v = variationDefs[index];
      card.innerHTML = '<div class="card-loading" style="width:100%; aspect-ratio:1; border-radius:6px;"></div>' +
        '<div class="card-progress"><div class="card-progress-bar" style="width:50%"></div></div>' +
        '<div class="card-label">' + v.label + '</div>';
      await generateSingle(index, Date.now());
    }

    // Lightbox
    function openLightbox(index) {
      if (!lightboxImages[index]) return;
      currentLightboxIndex = index;
      document.getElementById('lightbox-title').textContent = lightboxImages[index].label;
      document.getElementById('lightbox-image').src = lightboxImages[index].src;
      document.getElementById('lightbox').classList.add('open');
    }

    function closeLightbox() {
      document.getElementById('lightbox').classList.remove('open');
    }

    function navigateLightbox(dir) {
      let next = currentLightboxIndex + dir;
      while (next >= 0 && next < lightboxImages.length && !lightboxImages[next]) next += dir;
      if (next >= 0 && next < lightboxImages.length && lightboxImages[next]) {
        openLightbox(next);
      }
    }

    function downloadCurrentImage() {
      if (!lightboxImages[currentLightboxIndex]) return;
      downloadDataUrl(lightboxImages[currentLightboxIndex].src, lightboxImages[currentLightboxIndex].label + '.png');
    }

    function downloadImage(index) {
      if (!lightboxImages[index]) return;
      downloadDataUrl(lightboxImages[index].src, lightboxImages[index].label + '.png');
    }

    function downloadDataUrl(dataUrl, filename) {
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      a.click();
    }

    async function downloadAllAsZip() {
      const zip = new JSZip();
      lightboxImages.forEach((img, i) => {
        if (img && img.src) {
          const base64 = img.src.split(',')[1];
          zip.file(img.label.replace(/[^a-z0-9]/gi, '_') + '.png', base64, { base64: true });
        }
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      downloadDataUrl(url, 'shopshot-images.zip');
      URL.revokeObjectURL(url);
    }

    // Product name
    async function saveProductName() {
      if (!currentSessionId) return;
      const name = document.getElementById('product-name-edit').value.trim();
      try {
        await fetch('/api/sessions/' + currentSessionId, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_name: name })
        });
        loadSessions();
      } catch (e) {}
    }

    async function deleteCurrentSession() {
      if (!currentSessionId || !confirm('Delete this session?')) return;
      try {
        await fetch('/api/sessions/' + currentSessionId, { method: 'DELETE' });
        resetToUpload();
      } catch (e) { showError('Delete failed'); }
    }

    // Advanced mode
    function openAdvancedMode() {
      const list = document.getElementById('prompt-list');
      list.innerHTML = variationDefs.slice(1).map((v, i) => {
        const idx = i + 1;
        return '<div class="prompt-item">' +
          '<div class="prompt-label">' + v.label + '</div>' +
          '<textarea class="prompt-input" id="prompt-' + idx + '" placeholder="Custom prompt (leave empty for default)">' + (customPrompts[idx] || '') + '</textarea>' +
        '</div>';
      }).join('');
      document.getElementById('advanced-modal').classList.add('open');
    }

    function closeAdvancedMode() {
      variationDefs.slice(1).forEach((v, i) => {
        const idx = i + 1;
        const textarea = document.getElementById('prompt-' + idx);
        if (textarea) customPrompts[idx] = textarea.value.trim();
      });
      document.getElementById('advanced-modal').classList.remove('open');
    }

    // Error
    function showError(msg) {
      document.getElementById('error-message').textContent = msg;
      document.getElementById('error-toast').classList.add('show');
      setTimeout(() => document.getElementById('error-toast').classList.remove('show'), 4000);
    }

    // Init
    document.addEventListener('DOMContentLoaded', () => {
      loadSessions();
    });

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeLightbox();
        closeAdvancedMode();
        if (sidebarOpen) toggleSidebar();
      }
      if (document.getElementById('lightbox').classList.contains('open')) {
        if (e.key === 'ArrowLeft') navigateLightbox(-1);
        if (e.key === 'ArrowRight') navigateLightbox(1);
      }
    });
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
  <title>Results - ShopShot</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'><stop offset='0%25' style='stop-color:%233B82F6'/><stop offset='100%25' style='stop-color:%238B5CF6'/></linearGradient></defs><rect width='100' height='100' rx='22' fill='url(%23g)'/><circle cx='50' cy='50' r='28' fill='none' stroke='white' stroke-width='6'/><circle cx='50' cy='50' r='12' fill='white'/><rect x='70' y='25' width='12' height='8' rx='2' fill='white'/></svg>">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
          colors: {
            'brand': { 'blue': '#3B82F6', 'purple': '#8B5CF6', 'dark': '#0F172A', 'gray': '#64748B', 'light': '#F8FAFC' }
          }
        }
      }
    }
  </script>
  <style>
    * { font-family: 'Inter', system-ui, sans-serif; }
    .gradient-bg { background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%); }
    .glass { background: rgba(255, 255, 255, 0.8); backdrop-filter: blur(12px); }
    .card-3d { background: white; box-shadow: 0 4px 12px rgba(0,0,0,0.08); transition: all 0.3s ease; }
    .card-3d:hover { transform: translateY(-4px); box-shadow: 0 12px 24px rgba(0,0,0,0.12); }
    .lightbox-backdrop { background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(8px); }
  </style>
</head>
<body class="bg-brand-light min-h-screen">
  <header class="glass sticky top-0 z-40 border-b border-white/20">
    <div class="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
      <a href="/" class="flex items-center gap-3">
        <div class="w-10 h-10 gradient-bg rounded-xl flex items-center justify-center shadow-lg">
          <svg class="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/>
            <circle cx="12" cy="12" r="4" fill="currentColor"/>
          </svg>
        </div>
        <span class="text-xl font-bold text-brand-dark">ShopShot</span>
      </a>
      <nav class="flex items-center gap-4">
        <a href="/" class="px-4 py-2 rounded-lg text-sm font-medium text-brand-dark hover:bg-brand-purple/10 transition">
          <i class="fas fa-plus mr-2 text-brand-purple"></i>New
        </a>
      </nav>
    </div>
  </header>

  <main class="max-w-6xl mx-auto px-6 py-8">
    <div id="loading" class="text-center py-20">
      <div class="w-12 h-12 rounded-full border-4 border-brand-purple/30 border-t-brand-purple animate-spin mx-auto mb-4"></div>
      <p class="text-brand-gray">Loading results...</p>
    </div>

    <div id="error" class="hidden text-center py-20">
      <div class="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
        <i class="fas fa-exclamation-triangle text-3xl text-red-500"></i>
      </div>
      <h3 class="text-2xl font-bold text-brand-dark mb-2">No Images Found</h3>
      <p class="text-brand-gray mb-6">This session has no saved images or was created before image saving was enabled.</p>
      <a href="/" class="inline-block gradient-bg px-6 py-3 text-white rounded-xl font-semibold">
        <i class="fas fa-plus mr-2"></i>Generate New Images
      </a>
    </div>

    <div id="results" class="hidden">
      <div class="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <div>
          <div class="flex items-center gap-2 group">
            <h1 id="session-name" class="text-2xl sm:text-3xl font-bold text-brand-dark cursor-pointer hover:text-brand-purple transition" 
                onclick="startEditName()" title="Click to rename">Loading...</h1>
            <button onclick="startEditName()" class="text-brand-gray hover:text-brand-purple transition opacity-0 group-hover:opacity-100 p-1">
              <i class="fas fa-pencil text-sm"></i>
            </button>
          </div>
          <input type="text" id="session-name-input" 
                 class="hidden text-2xl sm:text-3xl font-bold text-brand-dark bg-transparent border-b-2 border-brand-purple outline-none w-full max-w-md"
                 onblur="saveSessionName()" onkeydown="handleNameKeydown(event)">
          <p id="session-info" class="text-brand-gray mt-1 text-sm"></p>
        </div>
        <div class="flex items-center gap-3">
          <a href="/" class="px-4 py-2.5 border border-slate-200 rounded-xl font-medium text-brand-dark hover:bg-slate-50 transition text-sm flex items-center gap-2">
            <i class="fas fa-plus"></i>
            <span>New</span>
          </a>
          <button onclick="downloadAll()" class="gradient-bg px-4 py-2.5 rounded-xl font-medium text-white flex items-center gap-2 text-sm shadow-lg">
            <i class="fas fa-download"></i>
            <span>Download All</span>
          </button>
        </div>
      </div>
      
      <div id="images-grid" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4"></div>
    </div>
  </main>

  <!-- Lightbox -->
  <div id="lightbox" class="hidden fixed inset-0 lightbox-backdrop z-50 flex flex-col items-center justify-center p-4">
    <button onclick="closeLightbox()" class="absolute top-4 right-4 w-10 h-10 rounded-full glass flex items-center justify-center text-white hover:bg-white/20 transition">
      <i class="fas fa-xmark text-xl"></i>
    </button>
    <h3 id="lightbox-title" class="text-white text-lg font-semibold mb-4"></h3>
    <div class="relative flex-1 flex items-center justify-center w-full max-w-4xl">
      <button onclick="navigateLightbox(-1)" class="absolute left-2 w-10 h-10 rounded-full glass flex items-center justify-center text-white hover:bg-white/20 transition">
        <i class="fas fa-chevron-left"></i>
      </button>
      <button onclick="navigateLightbox(1)" class="absolute right-2 w-10 h-10 rounded-full glass flex items-center justify-center text-white hover:bg-white/20 transition">
        <i class="fas fa-chevron-right"></i>
      </button>
      <img id="lightbox-image" class="max-w-full max-h-[70vh] rounded-xl shadow-2xl object-contain">
    </div>
    <button onclick="downloadCurrent()" class="mt-4 gradient-bg px-6 py-3 rounded-xl text-white font-semibold flex items-center gap-2">
      <i class="fas fa-download"></i>
      <span>Download</span>
    </button>
  </div>

  <script>
    const sessionId = '${sessionId}';
    let images = [];
    let currentIndex = 0;
    let sessionData = null;
    
    const variationLabels = {
      'original': 'Original',
      'macro_texture': 'Texture Detail',
      'label_branding': 'Label & Branding', 
      'construction_detail': 'Construction',
      'color_finish': 'Color & Finish',
      'scale_reference': 'Size Reference',
      'hero_white': 'Hero (White BG)',
      'inuse_action': 'In-Use Action',
      'flatlay_styled': 'Flat-Lay',
      'environment_context': 'Environment',
      'multi_angle': 'Multi-Angle'
    };
    
    async function loadSession() {
      try {
        const response = await fetch('/api/sessions/' + sessionId);
        const data = await response.json();
        
        if (!data.success) {
          showError();
          return;
        }
        
        sessionData = data.session;
        
        // Build images array (original + generated)
        if (sessionData.original_image && sessionData.original_image.length > 50) {
          images.push({ type: 'original', data: sessionData.original_image, label: 'Original' });
        }
        
        if (data.images && data.images.length > 0) {
          data.images.forEach(img => {
            images.push({
              type: img.variation_type,
              data: img.image_data,
              label: variationLabels[img.variation_type] || img.variation_type
            });
          });
        }
        
        if (images.length === 0) {
          showError();
          return;
        }
        
        displayResults();
      } catch (error) {
        console.error('Error loading session:', error);
        showError();
      }
    }
    
    function showError() {
      document.getElementById('loading').classList.add('hidden');
      document.getElementById('error').classList.remove('hidden');
    }
    
    function displayResults() {
      document.getElementById('loading').classList.add('hidden');
      document.getElementById('results').classList.remove('hidden');
      
      document.getElementById('session-name').textContent = sessionData.product_name || 'Product Shots';
      document.getElementById('session-name-input').value = sessionData.product_name || '';
      const date = new Date(sessionData.created_at).toLocaleDateString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
      });
      document.getElementById('session-info').textContent = images.length + ' images - ' + date;
      
      const grid = document.getElementById('images-grid');
      grid.innerHTML = images.map((img, idx) => {
        const isOriginal = img.type === 'original';
        const regenButton = isOriginal ? '' : \`
          <button onclick="event.stopPropagation(); regenerateImage(\${idx})" 
                  class="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90 shadow-lg flex items-center justify-center text-brand-gray hover:text-brand-purple hover:bg-white transition opacity-0 group-hover:opacity-100"
                  title="Regenerate this image">
            <i class="fas fa-rotate text-sm"></i>
          </button>
        \`;
        return \`
          <div id="card-\${idx}" class="card-3d rounded-xl overflow-hidden cursor-pointer group relative" onclick="openLightbox(\${idx})">
            <div class="aspect-square bg-slate-100 relative">
              <img id="img-\${idx}" src="\${img.data}" class="w-full h-full object-cover" loading="lazy">
              \${regenButton}
              <div id="loading-\${idx}" class="hidden absolute inset-0 bg-white/90 flex flex-col items-center justify-center">
                <div class="w-8 h-8 rounded-full border-3 border-brand-purple/30 border-t-brand-purple animate-spin mb-2"></div>
                <p class="text-xs text-brand-gray">Regenerating...</p>
              </div>
            </div>
            <div class="p-3 text-center border-t border-slate-100">
              <p class="text-xs font-medium text-brand-dark truncate">\${img.label}</p>
            </div>
          </div>
        \`;
      }).join('');
    }
    
    // Session name editing
    function startEditName() {
      const display = document.getElementById('session-name');
      const input = document.getElementById('session-name-input');
      display.classList.add('hidden');
      display.nextElementSibling.classList.add('hidden'); // Hide pencil button
      input.classList.remove('hidden');
      input.focus();
      input.select();
    }
    
    function handleNameKeydown(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveSessionName();
      }
      if (e.key === 'Escape') {
        cancelEditName();
      }
    }
    
    function cancelEditName() {
      const display = document.getElementById('session-name');
      const input = document.getElementById('session-name-input');
      input.value = display.textContent;
      input.classList.add('hidden');
      display.classList.remove('hidden');
      display.nextElementSibling.classList.remove('hidden');
    }
    
    async function saveSessionName() {
      const display = document.getElementById('session-name');
      const input = document.getElementById('session-name-input');
      const newName = input.value.trim() || 'Product Shots';
      
      display.textContent = newName;
      input.classList.add('hidden');
      display.classList.remove('hidden');
      display.nextElementSibling.classList.remove('hidden');
      
      try {
        await fetch('/api/sessions/' + sessionId, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_name: newName })
        });
        sessionData.product_name = newName;
      } catch (err) {
        console.error('Failed to save name:', err);
      }
    }
    
    // Image regeneration
    async function regenerateImage(idx) {
      const img = images[idx];
      if (img.type === 'original') return; // Can't regenerate original
      
      // Find variation index (1-10) from type
      const variationTypes = ['macro_texture', 'label_branding', 'construction_detail', 'color_finish', 
                              'scale_reference', 'hero_white', 'inuse_action', 'flatlay_styled', 
                              'environment_context', 'multi_angle'];
      const variationIndex = variationTypes.indexOf(img.type);
      if (variationIndex === -1) {
        alert('Cannot regenerate this image type');
        return;
      }
      
      // Show loading state
      const loadingEl = document.getElementById('loading-' + idx);
      const imgEl = document.getElementById('img-' + idx);
      if (loadingEl) loadingEl.classList.remove('hidden');
      
      try {
        // Get original image from first image in array
        const originalImage = images.find(i => i.type === 'original')?.data;
        if (!originalImage) {
          alert('Original image not found');
          return;
        }
        
        // Call API to regenerate
        const response = await fetch('/api/generate-single/' + sessionId + '/' + variationIndex, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            originalImage: originalImage,
            productName: sessionData.product_name || 'product'
          })
        });
        
        const data = await response.json();
        
        if (data.success && data.image) {
          // Update image in array
          images[idx].data = data.image;
          
          // Update UI
          if (imgEl) imgEl.src = data.image;
          
          // Save to database
          await saveRegeneratedImage(img.type, variationIndex + 1, data.image);
        } else {
          alert('Regeneration failed: ' + (data.error || 'Unknown error'));
        }
      } catch (err) {
        console.error('Regeneration error:', err);
        alert('Failed to regenerate image');
      } finally {
        if (loadingEl) loadingEl.classList.add('hidden');
      }
    }
    
    async function saveRegeneratedImage(variationType, variationIndex, imageData) {
      try {
        // Compress image before saving
        const compressed = await compressForStorage(imageData);
        
        await fetch('/api/sessions/' + sessionId + '/images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            variation_type: variationType,
            variation_index: variationIndex,
            image_data: compressed
          })
        });
      } catch (err) {
        console.error('Failed to save regenerated image:', err);
      }
    }
    
    function compressForStorage(base64Data) {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxSize = 800;
          let width = img.width;
          let height = img.height;
          
          if (width > maxSize || height > maxSize) {
            if (width > height) {
              height = (height / width) * maxSize;
              width = maxSize;
            } else {
              width = (width / height) * maxSize;
              height = maxSize;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.onerror = () => resolve(base64Data);
        img.src = base64Data;
      });
    }
    
    function openLightbox(idx) {
      currentIndex = idx;
      renderLightbox();
      document.getElementById('lightbox').classList.remove('hidden');
    }
    
    function closeLightbox() {
      document.getElementById('lightbox').classList.add('hidden');
    }
    
    function navigateLightbox(dir) {
      currentIndex = (currentIndex + dir + images.length) % images.length;
      renderLightbox();
    }
    
    function renderLightbox() {
      const img = images[currentIndex];
      document.getElementById('lightbox-title').textContent = img.label + ' (' + (currentIndex + 1) + '/' + images.length + ')';
      document.getElementById('lightbox-image').src = img.data;
    }
    
    function downloadCurrent() {
      const img = images[currentIndex];
      const link = document.createElement('a');
      link.href = img.data;
      link.download = 'shopshot-' + img.type + '.jpg';
      link.click();
    }
    
    async function downloadAll() {
      const zip = new JSZip();
      images.forEach((img, idx) => {
        const base64 = img.data.split(',')[1];
        zip.file((idx + 1).toString().padStart(2, '0') + '-' + img.type + '.jpg', base64, { base64: true });
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = (sessionData.product_name || 'shopshot') + '-images.zip';
      link.click();
    }
    
    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (document.getElementById('lightbox').classList.contains('hidden')) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') navigateLightbox(-1);
      if (e.key === 'ArrowRight') navigateLightbox(1);
    });
    
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
  <title>History - ShopShot</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'><stop offset='0%25' style='stop-color:%233B82F6'/><stop offset='100%25' style='stop-color:%238B5CF6'/></linearGradient></defs><rect width='100' height='100' rx='22' fill='url(%23g)'/><circle cx='50' cy='50' r='28' fill='none' stroke='white' stroke-width='6'/><circle cx='50' cy='50' r='12' fill='white'/><rect x='70' y='25' width='12' height='8' rx='2' fill='white'/></svg>">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
          colors: {
            'brand': { 'blue': '#3B82F6', 'purple': '#8B5CF6', 'dark': '#0F172A', 'gray': '#64748B', 'light': '#F8FAFC' }
          }
        }
      }
    }
  </script>
  <style>
    * { font-family: 'Inter', system-ui, sans-serif; }
    .gradient-bg { background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%); }
    .glass { background: rgba(255, 255, 255, 0.8); backdrop-filter: blur(12px); }
    .card-hover { transition: all 0.3s ease; }
    .card-hover:hover { transform: translateY(-4px); box-shadow: 0 12px 24px rgba(0,0,0,0.12); }
  </style>
</head>
<body class="bg-brand-light min-h-screen">
  <header class="glass sticky top-0 z-40 border-b border-white/20">
    <div class="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
      <a href="/" class="flex items-center gap-3">
        <div class="w-10 h-10 gradient-bg rounded-xl flex items-center justify-center shadow-lg">
          <svg class="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/>
            <circle cx="12" cy="12" r="4" fill="currentColor"/>
          </svg>
        </div>
        <span class="text-xl font-bold text-brand-dark">ShopShot</span>
      </a>
      <nav class="flex items-center gap-4">
        <a href="/" class="px-4 py-2 rounded-lg text-sm font-medium text-brand-dark hover:bg-brand-purple/10 transition">
          <i class="fas fa-sparkles mr-2 text-brand-purple"></i>New
        </a>
        <a href="/history" class="px-4 py-2 rounded-lg text-sm font-medium text-brand-purple bg-brand-purple/10">
          <i class="fas fa-clock-rotate-left mr-2"></i>History
        </a>
      </nav>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-6 py-10">
    <div class="flex items-center justify-between mb-8">
      <div>
        <h2 class="text-3xl font-bold text-brand-dark">Generation History</h2>
        <p class="text-brand-gray mt-1">View and manage your previous generations</p>
      </div>
      <div class="flex items-center gap-3">
        <button onclick="clearAllSessions()" class="px-4 py-2.5 text-red-500 border border-red-200 rounded-xl font-medium hover:bg-red-50 transition text-sm">
          <i class="fas fa-trash mr-2"></i>Clear All
        </button>
        <a href="/" class="gradient-bg px-5 py-2.5 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transition">
          <i class="fas fa-plus mr-2"></i>New Generation
        </a>
      </div>
    </div>

    <div id="loading" class="text-center py-20">
      <div class="w-12 h-12 rounded-full border-4 border-brand-purple/30 border-t-brand-purple animate-spin mx-auto mb-4"></div>
      <p class="text-brand-gray">Loading history...</p>
    </div>

    <div id="empty" class="hidden text-center py-20">
      <div class="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-6">
        <i class="fas fa-clock-rotate-left text-4xl text-slate-300"></i>
      </div>
      <h3 class="text-2xl font-bold text-brand-dark mb-2">No History Yet</h3>
      <p class="text-brand-gray mb-6">Generate your first product shots to see them here</p>
      <a href="/" class="inline-block gradient-bg px-6 py-3 text-white rounded-xl font-semibold shadow-lg">
        <i class="fas fa-sparkles mr-2"></i>Create First Generation
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
          day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        
        const statusBadge = session.status === 'completed' 
          ? '<span class="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full"><i class="fas fa-check mr-1"></i>Done</span>'
          : session.status === 'generating'
          ? '<span class="px-2 py-1 bg-amber-100 text-amber-700 text-xs rounded-full"><i class="fas fa-spinner fa-spin mr-1"></i>Processing</span>'
          : session.status === 'failed'
          ? '<span class="px-2 py-1 bg-red-100 text-red-700 text-xs rounded-full"><i class="fas fa-times mr-1"></i>Failed</span>'
          : '<span class="px-2 py-1 bg-slate-100 text-slate-700 text-xs rounded-full">Pending</span>';
        
        const sourceIcon = session.source_type === 'url' 
          ? '<i class="fas fa-link text-brand-gray"></i>' 
          : '<i class="fas fa-upload text-brand-gray"></i>';
        
        const hasImage = session.original_image && session.original_image.length > 10;
        const imageContent = hasImage
          ? '<img src="' + session.original_image + '" class="w-full h-full object-contain">'
          : '<div class="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200"><i class="fas fa-image text-4xl text-slate-300"></i></div>';
        
        return \`
          <div class="bg-white rounded-2xl shadow-lg overflow-hidden card-hover group" data-session-id="\${session.id}">
            <div class="aspect-video bg-slate-100 relative overflow-hidden cursor-pointer" onclick="viewSession('\${session.id}')">
              \${imageContent}
              <div class="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition flex items-end justify-center pb-4">
                <span class="text-white font-medium text-sm"><i class="fas fa-eye mr-2"></i>View Results</span>
              </div>
            </div>
            <div class="p-4">
              <div class="flex items-start justify-between mb-2 gap-2">
                <div class="flex-1 min-w-0">
                  <h3 id="name-display-\${session.id}" class="font-semibold text-brand-dark truncate cursor-pointer hover:text-brand-purple transition" 
                      onclick="startEditSessionName('\${session.id}')" title="Click to rename">\${session.product_name || 'Untitled'}</h3>
                  <input type="text" id="name-input-\${session.id}" 
                         class="hidden w-full font-semibold text-brand-dark bg-transparent border-b-2 border-brand-purple outline-none"
                         value="\${session.product_name || ''}"
                         onblur="saveSessionName('\${session.id}')"
                         onkeydown="handleNameKeydown(event, '\${session.id}')">
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                  <button onclick="event.stopPropagation(); startEditSessionName('\${session.id}')" 
                          class="text-brand-gray hover:text-brand-purple transition opacity-0 group-hover:opacity-100 p-1">
                    <i class="fas fa-pencil text-xs"></i>
                  </button>
                  \${statusBadge}
                </div>
              </div>
              <div class="flex items-center justify-between text-sm text-brand-gray">
                <span class="flex items-center gap-2">\${sourceIcon} \${date}</span>
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
    
    function startEditSessionName(id) {
      event.stopPropagation();
      const display = document.getElementById('name-display-' + id);
      const input = document.getElementById('name-input-' + id);
      if (!display || !input) return;
      
      display.classList.add('hidden');
      input.classList.remove('hidden');
      input.focus();
      input.select();
    }
    
    function handleNameKeydown(e, id) {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveSessionName(id);
      }
      if (e.key === 'Escape') {
        cancelEditName(id);
      }
    }
    
    function cancelEditName(id) {
      const display = document.getElementById('name-display-' + id);
      const input = document.getElementById('name-input-' + id);
      if (!display || !input) return;
      
      input.value = display.textContent;
      input.classList.add('hidden');
      display.classList.remove('hidden');
    }
    
    async function saveSessionName(id) {
      const display = document.getElementById('name-display-' + id);
      const input = document.getElementById('name-input-' + id);
      if (!display || !input) return;
      
      const newName = input.value.trim() || 'Untitled';
      display.textContent = newName;
      input.classList.add('hidden');
      display.classList.remove('hidden');
      
      try {
        await fetch('/api/sessions/' + id, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_name: newName })
        });
      } catch (err) {
        console.error('Failed to save session name:', err);
      }
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

    async function clearAllSessions() {
      if (!confirm('Delete ALL sessions? This cannot be undone.')) return;
      
      try {
        await fetch('/api/sessions', { method: 'DELETE' });
        loadHistory();
      } catch (error) {
        alert('Failed to clear sessions');
      }
    }

    loadHistory();
  </script>
</body>
</html>`
}

export default app
