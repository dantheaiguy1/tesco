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
// VERTEX AI MODEL CONFIGURATION - DO NOT CHANGE
// ============================================================================
// MODEL: Nano Banana Pro (gemini-3-pro-image-preview)
// 
// WARNING TO AI ASSISTANTS (Claude, GPT, etc.):
// DO NOT change VERTEX_MODEL under ANY circumstances.
// DO NOT suggest gemini-2.0-flash, gemini-2.5-flash, or any other model.
// This app is SPECIFICALLY built for Nano Banana Pro image generation.
// The model name "gemini-3-pro-image-preview" is CORRECT and FINAL.
//
// ENDPOINT: Must use GLOBAL endpoint (not us-central1, europe-west4, etc.)
// Gemini 3 Pro Image Preview ONLY works on the global endpoint.
// ============================================================================
const VERTEX_REGION = 'global'; // DO NOT CHANGE - global endpoint required
const VERTEX_MODEL = 'gemini-3-pro-image-preview'; // DO NOT CHANGE - Nano Banana Pro

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
  prompt: string
): Promise<{ success: boolean; image?: string; error?: string }> {
  try {
    const accessToken = await getAccessToken(clientEmail, privateKey);
    
    // Global endpoint uses aiplatform.googleapis.com without region prefix
    const endpoint = VERTEX_REGION === 'global'
      ? `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${VERTEX_REGION}/publishers/google/models/${VERTEX_MODEL}:generateContent`
      : `https://${VERTEX_REGION}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${VERTEX_REGION}/publishers/google/models/${VERTEX_MODEL}:generateContent`;
    
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
      console.error('Vertex AI error:', errorText);
      let errorMsg = 'Vertex AI error';
      try {
        const errJson = JSON.parse(errorText);
        errorMsg = errJson.error?.message || errJson.error?.status || `API error: ${response.status}`;
      } catch {
        errorMsg = `API error: ${response.status}`;
      }
      return { success: false, error: errorMsg };
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )
    `).run()
    
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at DESC)').run()
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)').run()
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_generated_images_session ON generated_images(session_id)').run()
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
      INSERT INTO sessions (id, product_name, source_type, original_image, status)
      VALUES (?, ?, 'upload', ?, 'pending')
    `).bind(sessionId, productName, thumbnail || '').run()

    return c.json({ success: true, sessionId, originalImage: dataUrl })
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
    
    const { url } = await c.req.json()
    
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
      INSERT INTO sessions (id, product_name, source_type, source_url, original_image, status)
      VALUES (?, ?, 'url', ?, '', 'pending')
    `).bind(sessionId, productName, url).run()

    return c.json({ success: true, sessionId, originalImage: dataUrl, productName })
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
    console.log(`[${variation.field}] Generating with Vertex AI...`)
    
    const startTime = Date.now()
    
    // Extract mime type and base64 data from data URL
    const mimeType = originalImage.split(';')[0].split(':')[1]
    const imageBase64 = originalImage.split(',')[1]
    
    // Call Vertex AI
    const result = await generateImageWithVertex(
      projectId,
      clientEmail,
      privateKey,
      imageBase64,
      mimeType,
      prompt
    )
    
    const elapsed = Date.now() - startTime
    console.log(`[${variation.field}] Response in ${elapsed}ms, success: ${result.success}`)
    
    if (!result.success) {
      console.error(`[${variation.field}] API error:`, result.error)
      return c.json({ success: false, error: result.error, field: variation.field }, 500)
    }
    
    console.log(`[${variation.field}] Success!${isCustom ? ' (Custom Prompt)' : ''}`)
    return c.json({ 
      success: true, 
      field: variation.field, 
      label: variation.label,
      image: result.image,
      elapsed,
      isCustom
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
  <title>ShopShot - Transform Product Photos into Professional Shots</title>
  <meta name="description" content="Transform one product photo into 10 professional ecommerce shots in 90 seconds. Reduce returns, increase conversions.">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'><stop offset='0%25' style='stop-color:%233B82F6'/><stop offset='100%25' style='stop-color:%238B5CF6'/></linearGradient></defs><rect width='100' height='100' rx='22' fill='url(%23g)'/><circle cx='50' cy='50' r='28' fill='none' stroke='white' stroke-width='6'/><circle cx='50' cy='50' r='12' fill='white'/><rect x='70' y='25' width='12' height='8' rx='2' fill='white'/></svg>">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
          },
          colors: {
            'brand': {
              'blue': '#3B82F6',
              'purple': '#8B5CF6',
              'indigo': '#6366F1',
              'dark': '#0F172A',
              'gray': '#64748B',
              'light': '#F8FAFC',
              'muted': '#94A3B8',
            }
          }
        }
      }
    }
  </script>
  <style>
    * { font-family: 'Inter', system-ui, -apple-system, sans-serif; }
    
    /* Gradient Utilities */
    .gradient-text {
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 50%, #EC4899 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .gradient-bg {
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
    }
    .gradient-bg-vibrant {
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 50%, #EC4899 100%);
    }
    
    /* Hero Background */
    .hero-bg {
      background: 
        radial-gradient(ellipse 80% 50% at 50% -20%, rgba(120, 119, 198, 0.15) 0%, transparent 50%),
        radial-gradient(ellipse 60% 40% at 80% 50%, rgba(59, 130, 246, 0.1) 0%, transparent 40%),
        radial-gradient(ellipse 60% 40% at 20% 80%, rgba(139, 92, 246, 0.1) 0%, transparent 40%),
        #F8FAFC;
    }
    
    /* Glassmorphism */
    .glass {
      background: rgba(255, 255, 255, 0.7);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.3);
    }
    .glass-dark {
      background: rgba(15, 23, 42, 0.8);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
    }
    
    /* Cards */
    .card-3d {
      background: white;
      box-shadow: 
        0 0 0 1px rgba(0,0,0,0.03),
        0 2px 4px rgba(0,0,0,0.03),
        0 12px 24px rgba(0,0,0,0.06);
      transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .card-3d:hover {
      transform: translateY(-8px) scale(1.02);
      box-shadow: 
        0 0 0 1px rgba(0,0,0,0.03),
        0 8px 16px rgba(0,0,0,0.08),
        0 24px 48px rgba(0,0,0,0.12);
    }
    
    /* Upload Zone */
    .upload-zone {
      border: 2px dashed #CBD5E1;
      background: linear-gradient(180deg, rgba(248,250,252,0.8) 0%, rgba(241,245,249,0.5) 100%);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .upload-zone:hover, .upload-zone.dragover {
      border-color: #8B5CF6;
      background: linear-gradient(180deg, rgba(139,92,246,0.05) 0%, rgba(59,130,246,0.05) 100%);
      transform: scale(1.01);
    }
    
    /* Buttons */
    .btn-primary {
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      box-shadow: 0 4px 14px 0 rgba(59, 130, 246, 0.4);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .btn-primary:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px 0 rgba(59, 130, 246, 0.5);
    }
    .btn-primary:active:not(:disabled) {
      transform: translateY(0);
    }
    .btn-secondary {
      background: white;
      border: 1px solid #E2E8F0;
      transition: all 0.2s ease;
    }
    .btn-secondary:hover {
      border-color: #8B5CF6;
      background: rgba(139,92,246,0.05);
    }
    
    /* Animations */
    @keyframes float {
      0%, 100% { transform: translateY(0px) rotate(-6deg); }
      50% { transform: translateY(-12px) rotate(-6deg); }
    }
    @keyframes float-slow {
      0%, 100% { transform: translateY(0px); }
      50% { transform: translateY(-8px); }
    }
    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(30px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes scaleIn {
      from { opacity: 0; transform: scale(0.9); }
      to { opacity: 1; transform: scale(1); }
    }
    @keyframes shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    @keyframes pulse-ring {
      0% { transform: scale(0.8); opacity: 0.8; }
      50% { transform: scale(1); opacity: 0.4; }
      100% { transform: scale(0.8); opacity: 0.8; }
    }
    
    .animate-float { animation: float 4s ease-in-out infinite; }
    .animate-float-slow { animation: float-slow 5s ease-in-out infinite; }
    .animate-fadeInUp { animation: fadeInUp 0.6s ease-out forwards; }
    .animate-scaleIn { animation: scaleIn 0.4s ease-out forwards; }
    .animate-spin { animation: spin 1s linear infinite; }
    .animate-pulse-ring { animation: pulse-ring 2s ease-in-out infinite; }
    
    .shimmer {
      background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
    }
    
    /* Thumbnail Grid */
    .thumb-card {
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .thumb-card:hover {
      transform: translateY(-4px) scale(1.03);
      box-shadow: 0 12px 24px rgba(0,0,0,0.15);
    }
    .thumb-card.loading {
      background: linear-gradient(135deg, #F1F5F9 0%, #E2E8F0 100%);
    }
    .thumb-card.success {
      border: 2px solid #10B981;
    }
    .thumb-card.failed {
      border: 2px solid #EF4444;
      opacity: 0.7;
    }
    
    /* Lightbox */
    .lightbox-backdrop {
      background: rgba(15, 23, 42, 0.95);
      backdrop-filter: blur(8px);
    }
    
    /* Responsive */
    @media (max-width: 768px) {
      .hero-title { font-size: 1.875rem !important; }
      .hero-icon { width: 64px !important; height: 64px !important; }
    }
    
    /* When results are showing, allow scrolling */
    body.showing-results {
      height: auto;
      overflow: auto;
    }
    body.showing-results #main-content {
      height: auto;
      min-height: 100vh;
      padding-top: 5rem;
      justify-content: flex-start;
    }
  </style>
</head>
<body class="hero-bg h-screen overflow-hidden">
  <!-- Header -->
  <header class="glass fixed top-0 left-0 right-0 z-40 border-b border-white/20">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="h-14 flex items-center justify-between">
        <a href="/" class="flex items-center gap-2.5 group">
          <div class="w-9 h-9 gradient-bg rounded-xl flex items-center justify-center shadow-lg group-hover:shadow-xl transition-shadow">
            <svg class="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/>
              <circle cx="12" cy="12" r="4" fill="currentColor"/>
              <rect x="18" y="6" width="4" height="3" rx="1" fill="currentColor"/>
            </svg>
          </div>
          <span class="text-lg font-bold text-brand-dark">ShopShot</span>
        </a>
        
        <nav class="flex items-center gap-1">
          <a href="/" class="px-3 py-1.5 rounded-lg text-sm font-medium text-brand-dark hover:bg-brand-purple/10 transition flex items-center gap-2">
            <i class="fas fa-sparkles text-brand-purple"></i>
            <span class="hidden sm:inline">New</span>
          </a>
          <a href="/history" class="px-3 py-1.5 rounded-lg text-sm font-medium text-brand-gray hover:bg-brand-purple/10 transition flex items-center gap-2">
            <i class="fas fa-clock-rotate-left"></i>
            <span class="hidden sm:inline">History</span>
          </a>
        </nav>
      </div>
    </div>
  </header>

  <main id="main-content" class="h-screen flex flex-col items-center justify-center px-4 sm:px-6 pt-14">
    <!-- Hero Section -->
    <div id="hero-section" class="text-center mb-6 animate-fadeInUp">
      <!-- 3D Floating Icon -->
      <div class="mb-4 relative inline-block">
        <div class="animate-float">
          <div class="hero-icon w-16 h-16 sm:w-20 sm:h-20 gradient-bg-vibrant rounded-2xl flex items-center justify-center shadow-2xl transform -rotate-6">
            <i class="fas fa-camera text-white text-2xl sm:text-3xl"></i>
          </div>
        </div>
      </div>
      
      <h1 class="hero-title text-3xl sm:text-4xl lg:text-5xl font-extrabold mb-2 tracking-tight">
        <span class="gradient-text">ShopShot</span>
      </h1>
      <p class="text-base sm:text-lg text-brand-gray max-w-md mx-auto leading-relaxed">
        Transform one photo into <span class="font-semibold text-brand-dark">10 professional shots</span>
      </p>
    </div>

    <!-- Upload Card -->
    <div id="upload-section" class="card-3d rounded-2xl sm:rounded-3xl overflow-hidden animate-fadeInUp w-full max-w-xl" style="animation-delay: 0.1s">
      <div class="p-5 sm:p-8">
        <!-- Upload Zone -->
        <div id="upload-zone" class="upload-zone rounded-xl sm:rounded-2xl p-6 sm:p-8 text-center cursor-pointer"
             ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event)"
             onclick="document.getElementById('file-input').click()">
          <input type="file" id="file-input" accept="image/jpeg,image/png,image/webp" class="hidden" onchange="handleFileSelect(event)">
          
          <div id="upload-prompt">
            <div class="w-14 h-14 sm:w-16 sm:h-16 mx-auto mb-4 rounded-xl bg-gradient-to-br from-brand-blue/10 to-brand-purple/10 flex items-center justify-center">
              <i class="fas fa-cloud-arrow-up text-2xl sm:text-3xl gradient-text"></i>
            </div>
            <p class="text-base sm:text-lg font-semibold text-brand-dark mb-1">Drop your product image here</p>
            <p class="text-sm text-brand-gray mb-4">or click to browse</p>
            <div class="inline-flex items-center gap-2 text-xs text-brand-muted bg-brand-light px-3 py-1.5 rounded-full border border-slate-200">
              <i class="fas fa-image text-brand-purple"></i>
              JPG, PNG, WebP up to 10MB
            </div>
          </div>
          
          <div id="upload-preview" class="hidden">
            <img id="preview-image" class="max-h-40 sm:max-h-48 mx-auto rounded-xl shadow-lg mb-3 border border-slate-200">
            <p id="preview-filename" class="text-brand-dark font-medium text-sm mb-1"></p>
            <button onclick="event.stopPropagation(); resetUpload()" class="text-xs text-brand-gray hover:text-brand-purple transition">
              <i class="fas fa-xmark mr-1"></i> Change image
            </button>
          </div>
        </div>

        <!-- Advanced Mode Toggle -->
        <div class="mt-4 flex items-center justify-between">
          <button id="advanced-toggle" onclick="toggleAdvancedMode()" class="flex items-center gap-2 text-sm text-brand-gray hover:text-brand-purple transition">
            <i id="advanced-icon" class="fas fa-sliders text-xs"></i>
            <span>Advanced Mode</span>
            <span id="custom-count-badge" class="text-xs bg-brand-purple/10 text-brand-purple px-2 py-0.5 rounded-full">Custom Prompts</span>
          </button>
        </div>

        <!-- Generate Button -->
        <div class="mt-5 text-center">
          <button id="generate-btn" onclick="generateVariations()" disabled
                  class="btn-primary w-full px-6 py-3.5 text-white rounded-xl font-semibold text-base disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none disabled:transform-none">
            <i class="fas fa-sparkles mr-2"></i>
            Generate 10 Professional Shots
          </button>
          <p class="text-xs text-brand-muted mt-3 flex items-center justify-center gap-1.5">
            <i class="fas fa-bolt text-amber-500"></i>
            Takes about 60-90 seconds
          </p>
        </div>
      </div>
    </div>

    <!-- Results Section (Initially Hidden) -->
    <div id="results-section" class="hidden"></div>
  </main>

  <!-- Lightbox Modal -->
  <div id="lightbox" class="hidden fixed inset-0 lightbox-backdrop z-50 flex flex-col items-center justify-center p-4">
    <button onclick="closeLightbox()" class="absolute top-4 right-4 sm:top-6 sm:right-6 w-10 h-10 sm:w-12 sm:h-12 rounded-full glass flex items-center justify-center text-white hover:bg-white/20 transition z-10">
      <i class="fas fa-xmark text-xl"></i>
    </button>
    
    <h3 id="lightbox-title" class="text-white text-lg sm:text-xl font-semibold mb-4"></h3>
    
    <div class="relative flex-1 flex items-center justify-center w-full max-w-5xl">
      <!-- Nav Arrows -->
      <button onclick="navigateLightbox(-1)" class="absolute left-2 sm:left-4 w-10 h-10 sm:w-12 sm:h-12 rounded-full glass flex items-center justify-center text-white hover:bg-white/20 transition z-10">
        <i class="fas fa-chevron-left text-xl"></i>
      </button>
      <button onclick="navigateLightbox(1)" class="absolute right-2 sm:right-4 w-10 h-10 sm:w-12 sm:h-12 rounded-full glass flex items-center justify-center text-white hover:bg-white/20 transition z-10">
        <i class="fas fa-chevron-right text-xl"></i>
      </button>
      
      <img id="lightbox-image" class="max-w-full max-h-[60vh] sm:max-h-[70vh] rounded-2xl shadow-2xl object-contain animate-scaleIn">
    </div>
    
    <button id="lightbox-download" onclick="downloadCurrentImage()" class="mt-4 sm:mt-6 btn-primary px-6 sm:px-8 py-3 rounded-xl text-white font-semibold flex items-center gap-2">
      <i class="fas fa-download"></i>
      <span>Download Image</span>
    </button>
  </div>

  <!-- Error Toast -->
  <div id="error-toast" class="hidden fixed bottom-4 sm:bottom-6 right-4 sm:right-6 glass-dark text-white px-6 py-4 rounded-2xl shadow-2xl max-w-sm z-50 animate-scaleIn">
    <div class="flex items-start gap-3">
      <div class="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0">
        <i class="fas fa-exclamation text-red-400"></i>
      </div>
      <div class="flex-1">
        <p class="font-semibold text-sm">Something went wrong</p>
        <p id="error-message" class="text-sm text-white/70 mt-1"></p>
      </div>
      <button onclick="hideError()" class="text-white/50 hover:text-white transition">
        <i class="fas fa-xmark"></i>
      </button>
    </div>
  </div>

  <!-- Advanced Mode Modal (moved outside all containers) -->
  <div id="advanced-panel" class="fixed inset-0 z-[9999] bg-black/60 hidden items-center justify-center p-4" style="display:none;">
    <div class="bg-white rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl overflow-hidden">
      <!-- Header -->
      <div class="flex items-center justify-between px-5 py-4 border-b border-slate-200 flex-shrink-0">
        <div>
          <h3 class="text-base font-semibold text-slate-800">Customize Generation Prompts</h3>
          <p class="text-xs text-slate-500 mt-1">Edit any prompt to customize that variation</p>
        </div>
        <button onclick="toggleAdvancedMode()" class="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition">
          <i class="fas fa-xmark text-slate-500"></i>
        </button>
      </div>
      <!-- Scrollable Prompt List -->
      <div id="prompt-list" class="flex-1 overflow-y-auto" style="min-height:200px;">
        <!-- Prompts populated by JS -->
      </div>
      <!-- Footer -->
      <div class="px-5 py-4 border-t border-slate-200 bg-slate-50 flex-shrink-0">
        <button onclick="toggleAdvancedMode()" class="btn-primary w-full py-3 rounded-xl text-white font-semibold">
          <i class="fas fa-check mr-2"></i>Done - Apply Prompts
        </button>
      </div>
    </div>
  </div>

  <script>
    // State
    let currentSessionId = null;
    let selectedFile = null;
    let currentOriginalImage = null;
    let currentLightboxIndex = 0;
    let lightboxImages = [];
    
    // Variation Definitions with default prompts
    const variationDefs = [
      { field: 'original', label: 'Original', icon: 'fas fa-image', filename: '00-original.jpg', isOriginal: true, defaultPrompt: '' },
      { field: 'macro_texture', label: 'Texture Detail', icon: 'fas fa-search-plus', filename: '01-texture-detail.jpg', defaultPrompt: 'Extreme close-up macro photography showing the material texture and surface detail. Shallow depth of field with soft bokeh background. Professional studio lighting highlighting weave pattern, grain, or surface texture. Rich color saturation, crisp sharp focus on texture details. Commercial product photography emphasizing quality and craftsmanship. High resolution 2k, premium detail shot.' },
      { field: 'label_branding', label: 'Label & Branding', icon: 'fas fa-tag', filename: '02-label-branding.jpg', defaultPrompt: 'Close-up product photography focused on branding elements, logo, and label details. Professional studio lighting, sharp focus on typography and brand marks. Slight angle showing product dimensionality while keeping text completely readable. Commercial catalog photography style, color-accurate brand presentation. High resolution 2k, editorial detail quality.' },
      { field: 'construction_detail', label: 'Construction', icon: 'fas fa-tools', filename: '03-construction.jpg', defaultPrompt: 'Detailed close-up showing construction quality - seams, stitching, joints, edges, or assembly details. Professional studio lighting emphasizing craftsmanship. Shallow depth of field isolating key quality indicators. Premium product photography highlighting durability and attention to detail. High resolution 2k, trust-building detail shot.' },
      { field: 'color_finish', label: 'Color & Finish', icon: 'fas fa-palette', filename: '04-color-finish.jpg', defaultPrompt: 'Close-up photography emphasizing true-to-life color accuracy and surface finish. Professional color-corrected studio lighting. Neutral background to showcase product color without distraction. Lighting angles showing sheen, matte finish, or surface quality. Commercial product photography for accurate buyer expectations. High resolution 2k.' },
      { field: 'scale_reference', label: 'Size Reference', icon: 'fas fa-ruler', filename: '05-size-reference.jpg', defaultPrompt: 'Product photography with clear scale reference showing actual size. Close-up composition with human hand partially in frame OR common object for size comparison. Professional studio lighting, clear perspective on product dimensions. Ecommerce photography that reduces size-related returns. High resolution 2k.' },
      { field: 'hero_white', label: 'Hero (White BG)', icon: 'fas fa-square', filename: '06-hero-white.jpg', defaultPrompt: 'Clean professional product photo on pure white background. Studio lighting from multiple angles. Product positioned at slight 45-degree angle showing depth and dimensionality. Soft natural shadow underneath. Centered composition. Amazon and Shopify listing style. High resolution 2k, catalog-quality commercial photography.' },
      { field: 'inuse_action', label: 'In-Use Action', icon: 'fas fa-hand-pointer', filename: '07-in-use.jpg', defaultPrompt: 'Product being actively used in real-world scenario. Natural hands interacting with product showing scale and functionality. Authentic everyday setting. Lifestyle photography demonstrating practical application. Candid moment captured. Relatable use-case photography. Natural lighting. High resolution 2k.' },
      { field: 'flatlay_styled', label: 'Flat-Lay', icon: 'fab fa-instagram', filename: '08-flat-lay.jpg', defaultPrompt: 'Flat-lay composition photographed directly from above. Product styled with complementary accessories and props on neutral surface. Instagram aesthetic with intentional negative space. Natural window lighting. Curated lifestyle arrangement. Social media content style. Balanced composition. High resolution 2k.' },
      { field: 'environment_context', label: 'Environment', icon: 'fas fa-tree', filename: '09-environment.jpg', defaultPrompt: 'Product in natural environment relevant to its use. Soft natural lighting showing product in realistic setting. Background slightly blurred to emphasize product as hero. Lifestyle photography creating emotional connection and showing product purpose. Authentic scene composition. High resolution 2k.' },
      { field: 'multi_angle', label: 'Multi-Angle', icon: 'fas fa-cube', filename: '10-multi-angle.jpg', defaultPrompt: 'Product shown from three key angles in single composition: front view, side profile, and top-down perspective. Clean white or grey background. Professional studio lighting consistent across all angles. Commercial photography showing complete product understanding. Informative multi-view layout. High resolution 2k.' }
    ];
    
    // Custom prompts storage (index 1-10 maps to variations)
    let customPrompts = {};
    let advancedModeEnabled = false;

    // Session Name Editing
    let currentSessionName = '';
    
    function startEditName() {
      const display = document.getElementById('session-name-display');
      const input = document.getElementById('session-name-input');
      if (!display || !input) return;
      
      currentSessionName = display.textContent.trim();
      input.value = currentSessionName;
      display.classList.add('hidden');
      input.classList.remove('hidden');
      input.focus();
      input.select();
    }
    
    function cancelEditName() {
      const display = document.getElementById('session-name-display');
      const input = document.getElementById('session-name-input');
      if (!display || !input) return;
      
      input.classList.add('hidden');
      display.classList.remove('hidden');
    }
    
    async function saveSessionName() {
      const display = document.getElementById('session-name-display');
      const input = document.getElementById('session-name-input');
      if (!display || !input) return;
      
      const newName = input.value.trim() || currentSessionName;
      display.textContent = newName;
      input.classList.add('hidden');
      display.classList.remove('hidden');
      
      // Save to database
      if (currentSessionId && newName !== currentSessionName) {
        try {
          await fetch('/api/sessions/' + currentSessionId, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ product_name: newName })
          });
          currentSessionName = newName;
        } catch (err) {
          console.error('Failed to save session name:', err);
        }
      }
    }

    // Advanced Mode Functions
    function toggleAdvancedMode() {
      advancedModeEnabled = !advancedModeEnabled;
      const panel = document.getElementById('advanced-panel');
      const icon = document.getElementById('advanced-icon');
      
      console.log('Toggle advanced mode:', advancedModeEnabled);
      
      if (advancedModeEnabled) {
        populatePromptList(); // Populate BEFORE showing
        panel.style.display = 'flex';
        panel.classList.remove('hidden');
        if (icon) icon.style.transform = 'rotate(90deg)';
        document.body.style.overflow = 'hidden';
      } else {
        panel.style.display = 'none';
        panel.classList.add('hidden');
        if (icon) icon.style.transform = 'rotate(0deg)';
        document.body.style.overflow = '';
      }
    }
    
    // Count custom prompts for badge display
    function getCustomPromptCount() {
      let count = 0;
      for (let i = 1; i < variationDefs.length; i++) {
        if (customPrompts[i] && customPrompts[i] !== variationDefs[i].defaultPrompt) {
          count++;
        }
      }
      return count;
    }
    
    function populatePromptList() {
      console.log('populatePromptList called, variationDefs.length:', variationDefs.length);
      
      const list = document.getElementById('prompt-list');
      if (!list) {
        console.error('prompt-list element not found');
        return;
      }
      list.innerHTML = '';
      
      // Skip index 0 (Original) - only show variations 1-10
      for (let i = 1; i < variationDefs.length; i++) {
        const v = variationDefs[i];
        const isCustom = customPrompts[i] && customPrompts[i] !== v.defaultPrompt;
        const currentPrompt = customPrompts[i] || v.defaultPrompt;
        
        const item = document.createElement('div');
        item.className = 'p-4 border-b border-slate-100';
        item.innerHTML = \`
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2">
              <div class="w-7 h-7 rounded-lg bg-purple-100 flex items-center justify-center">
                <i class="\${v.icon} text-purple-600 text-xs"></i>
              </div>
              <span class="text-sm font-medium text-slate-800">\${v.label}</span>
              <span id="item-badge-\${i}" class="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium \${isCustom ? '' : 'hidden'}">CUSTOM</span>
            </div>
            <button onclick="resetPrompt(\${i})" class="text-xs text-slate-500 hover:text-purple-600 transition \${isCustom ? '' : 'hidden'}" id="reset-btn-\${i}">
              <i class="fas fa-undo mr-1"></i>Reset
            </button>
          </div>
          <textarea 
            id="prompt-\${i}" 
            rows="3" 
            class="w-full text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 resize-none focus:border-purple-500 focus:bg-white focus:outline-none transition"
            onchange="updateCustomPrompt(\${i}, this.value)"
            oninput="updateCustomPrompt(\${i}, this.value)"
            placeholder="Enter custom prompt..."
          >\${currentPrompt}</textarea>
        \`;
        list.appendChild(item);
      }
      console.log('Populated prompts, list children:', list.children.length);
    }
    
    function updateCustomPrompt(index, value) {
      const v = variationDefs[index];
      const isCustom = value.trim() !== v.defaultPrompt;
      customPrompts[index] = value.trim();
      
      // Update custom badge visibility in list
      const resetBtn = document.getElementById('reset-btn-' + index);
      const itemBadge = document.getElementById('item-badge-' + index);
      if (resetBtn) {
        resetBtn.style.display = isCustom ? 'inline' : 'none';
      }
      if (itemBadge) {
        itemBadge.style.display = isCustom ? 'inline' : 'none';
      }
      
      // Update main toggle badge
      updateCustomCountBadge();
    }
    
    function updateCustomCountBadge() {
      const count = getCustomPromptCount();
      const badge = document.getElementById('custom-count-badge');
      if (badge) {
        if (count > 0) {
          badge.textContent = count + ' Custom';
          badge.className = 'text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium';
        } else {
          badge.textContent = 'Custom Prompts';
          badge.className = 'text-xs bg-brand-purple/10 text-brand-purple px-2 py-0.5 rounded-full';
        }
      }
    }
    
    function resetPrompt(index) {
      const v = variationDefs[index];
      customPrompts[index] = v.defaultPrompt;
      
      const textarea = document.getElementById('prompt-' + index);
      if (textarea) {
        textarea.value = v.defaultPrompt;
      }
      
      const resetBtn = document.getElementById('reset-btn-' + index);
      const itemBadge = document.getElementById('item-badge-' + index);
      if (resetBtn) {
        resetBtn.style.display = 'none';
      }
      if (itemBadge) {
        itemBadge.style.display = 'none';
      }
      
      // Update main toggle badge
      updateCustomCountBadge();
    }
    
    function getPromptForVariation(index) {
      const v = variationDefs[index];
      if (customPrompts[index] && customPrompts[index].trim()) {
        return customPrompts[index];
      }
      return null; // Return null to use server default
    }
    
    function isCustomPrompt(index) {
      const v = variationDefs[index];
      return customPrompts[index] && customPrompts[index].trim() !== v.defaultPrompt;
    }

    // Drag & Drop Handlers
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
      if (e.dataTransfer.files.length > 0) {
        processFile(e.dataTransfer.files[0]);
      }
    }

    function handleFileSelect(e) {
      if (e.target.files.length > 0) {
        processFile(e.target.files[0]);
      }
    }

    function resetUpload() {
      document.getElementById('file-input').value = '';
      document.getElementById('upload-prompt').classList.remove('hidden');
      document.getElementById('upload-preview').classList.add('hidden');
      document.getElementById('generate-btn').disabled = true;
      selectedFile = null;
      currentOriginalImage = null;
      currentSessionId = null;
    }

    // Create thumbnail for History page (150x150, JPEG, ~10-30KB)
    function createThumbnail(file) {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const size = 150;
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          
          // Calculate crop to make square
          const minDim = Math.min(img.width, img.height);
          const sx = (img.width - minDim) / 2;
          const sy = (img.height - minDim) / 2;
          
          ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.onerror = () => resolve('');
        img.src = URL.createObjectURL(file);
      });
    }
    
    // Compress image for storage (max 800px, JPEG quality 0.8, ~50-150KB)
    function compressImageForStorage(base64Data) {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxSize = 800;
          let width = img.width;
          let height = img.height;
          
          // Scale down if larger than maxSize
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
        img.onerror = () => resolve(base64Data); // Return original if error
        img.src = base64Data;
      });
    }
    
    // Save generated image to database
    async function saveGeneratedImage(sessionId, variationType, variationIndex, imageData) {
      try {
        // Compress image before saving
        const compressed = await compressImageForStorage(imageData);
        
        await fetch('/api/sessions/' + sessionId + '/images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            variation_type: variationType,
            variation_index: variationIndex,
            image_data: compressed
          })
        });
        console.log('[' + variationIndex + '] Image saved to database');
      } catch (err) {
        console.error('[' + variationIndex + '] Failed to save image:', err);
      }
    }
    
    // Regenerate a single variation
    async function regenerateVariation(cardIndex) {
      if (cardIndex === 0) return; // Can't regenerate original
      
      const varDef = variationDefs[cardIndex];
      const variationIndex = cardIndex - 1; // API uses 0-indexed
      
      // Show loading
      const loadingEl = document.getElementById('regen-loading-' + cardIndex);
      if (loadingEl) loadingEl.classList.remove('hidden');
      
      // Check for custom prompt
      const customPrompt = getPromptForVariation(cardIndex);
      const isCustom = isCustomPrompt(cardIndex);
      
      try {
        const response = await fetch('/api/generate-single/' + currentSessionId + '/' + variationIndex, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            originalImage: currentOriginalImage,
            productName: document.getElementById('session-name-display')?.textContent || 'product',
            customPrompt: customPrompt
          })
        });
        
        const data = await response.json();
        
        if (data.success && data.image) {
          // Re-render the entire card to update Custom badge if needed
          updateThumbnail(cardIndex, data.image, true, isCustom || data.isCustom);
          
          // Update in results store
          window.currentResults.results[varDef.field] = data.image;
          
          // Save to database
          saveGeneratedImage(currentSessionId, varDef.field, cardIndex, data.image);
          
          console.log('[' + cardIndex + '] Regenerated successfully' + (isCustom ? ' (Custom Prompt)' : ''));
        } else {
          alert('Regeneration failed: ' + (data.error || 'Unknown error'));
          if (loadingEl) loadingEl.classList.add('hidden');
        }
      } catch (err) {
        console.error('Regeneration error:', err);
        alert('Failed to regenerate. Please try again.');
        if (loadingEl) loadingEl.classList.add('hidden');
      }
    }

    async function processFile(file) {
      const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!validTypes.includes(file.type)) {
        showError('Invalid file type. Please upload JPG, PNG, or WebP.');
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        showError('File too large. Maximum size is 10MB.');
        return;
      }

      selectedFile = file;

      const reader = new FileReader();
      reader.onload = (e) => {
        document.getElementById('preview-image').src = e.target.result;
        document.getElementById('preview-filename').textContent = file.name;
        document.getElementById('upload-prompt').classList.add('hidden');
        document.getElementById('upload-preview').classList.remove('hidden');
      };
      reader.readAsDataURL(file);

      // Create thumbnail for History page
      const thumbnail = await createThumbnail(file);

      const formData = new FormData();
      formData.append('image', file);
      formData.append('thumbnail', thumbnail);

      try {
        const response = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await response.json();
        
        if (data.success) {
          currentSessionId = data.sessionId;
          currentOriginalImage = data.originalImage;
          document.getElementById('generate-btn').disabled = false;
        } else {
          showError(data.error || 'Upload failed');
        }
      } catch (error) {
        showError('Failed to upload image. Please try again.');
      }
    }

    async function generateVariations() {
      if (!currentSessionId) {
        showError('Please upload an image first');
        return;
      }

      // Hide upload UI, show results grid
      document.getElementById('hero-section').classList.add('hidden');
      document.getElementById('upload-section').classList.add('hidden');
      document.body.classList.add('showing-results');
      
      // Store results
      window.currentResults = {
        originalImage: currentOriginalImage,
        productName: 'Product',
        results: {}
      };
      
      // Build and show results grid
      showProgressiveResults();
      
      // Update session status to generating
      try {
        await fetch('/api/sessions/' + currentSessionId, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'generating' })
        });
      } catch (e) {
        console.error('Failed to update session status:', e);
      }
      
      // Start all 10 generations in parallel
      const startTime = Date.now();
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(generateSingleVariation(i, startTime));
      }
      
      await Promise.allSettled(promises);
      
      // Update session status to completed
      try {
        await fetch('/api/sessions/' + currentSessionId, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'completed' })
        });
      } catch (e) {
        console.error('Failed to update session status:', e);
      }
      
      // Update header with completion time
      const totalTime = Math.floor((Date.now() - startTime) / 1000);
      const subtitle = document.querySelector('#results-header-subtitle');
      if (subtitle) {
        subtitle.textContent = 'Completed in ' + totalTime + 's - ' + lightboxImages.length + ' images ready';
      }
    }
    
    async function generateSingleVariation(index, startTime) {
      const field = variationDefs[index + 1]?.field;
      if (!field) return;
      
      const cardIndex = index + 1;
      const requestStart = Date.now();
      console.log('[' + index + '] Starting ' + field + '...');
      
      // Start progress animation - shows real elapsed time
      updateProgressState(cardIndex, 'connecting', 0);
      
      // Animate progress bar over 45 seconds (linear fill)
      let progressInterval = setInterval(() => {
        const elapsed = (Date.now() - requestStart) / 1000;
        const currentCard = document.getElementById('card-' + cardIndex);
        if (currentCard && !currentCard.dataset.complete) {
          const progressBar = document.getElementById('progress-' + cardIndex);
          if (progressBar) {
            // Linear fill: 0% at 0s, 95% at 45s
            const fillPercent = Math.min(95, (elapsed / 45) * 95);
            progressBar.style.width = fillPercent + '%';
          }
        }
      }, 100);
      
      try {
        // Check for custom prompt
        const customPrompt = getPromptForVariation(index + 1);
        
        const response = await fetch('/api/generate-single/' + currentSessionId + '/' + index, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            originalImage: currentOriginalImage,
            productName: 'Product',
            customPrompt: customPrompt
          })
        });
        
        // Stop the time tracking interval
        clearInterval(progressInterval);
        const totalTime = Math.round((Date.now() - requestStart) / 1000);
        
        console.log('[' + index + '] Response status: ' + response.status + ' after ' + totalTime + 's');
        
        if (!response.ok) {
          markCardComplete(cardIndex);
          updateProgressState(cardIndex, 'failed', totalTime);
          updateThumbnail(cardIndex, null, false);
          return;
        }
        
        // Response headers received - server finished, downloading data
        updateProgressState(cardIndex, 'downloading', totalTime);
        
        const data = await response.json();
        
        console.log('[' + index + '] Response data:', data.success ? 'SUCCESS' : 'FAILED - ' + (data.error || 'unknown'));
        
        if (data.success && data.image) {
          markCardComplete(cardIndex);
          updateProgressState(cardIndex, 'complete', totalTime);
          window.currentResults.results[field] = data.image;
          // Pass isCustom flag to show badge
          setTimeout(() => updateThumbnail(cardIndex, data.image, true, data.isCustom || isCustomPrompt(cardIndex)), 300);
          
          // Save image to database for History page
          saveGeneratedImage(currentSessionId, field, cardIndex, data.image);
        } else {
          console.error('[' + index + '] Generation failed:', data.error);
          markCardComplete(cardIndex);
          updateProgressState(cardIndex, 'failed', totalTime);
          updateThumbnail(cardIndex, null, false);
        }
      } catch (err) {
        clearInterval(progressInterval);
        const totalTime = Math.round((Date.now() - requestStart) / 1000);
        console.error('[' + index + '] Fetch error after ' + totalTime + 's:', err);
        markCardComplete(cardIndex);
        updateProgressState(cardIndex, 'error', totalTime);
        updateThumbnail(cardIndex, null, false);
      }
    }
    
    function updateProgressState(cardIndex, state, time) {
      const progressBar = document.getElementById('progress-' + cardIndex);
      const statusEl = document.getElementById('status-' + cardIndex);
      
      if (!progressBar) return;
      
      switch(state) {
        case 'connecting':
          if (statusEl) statusEl.innerHTML = '<i class="fas fa-circle-notch fa-spin text-[10px] mr-1"></i>Generating';
          break;
        case 'downloading':
          progressBar.style.width = '96%';
          if (statusEl) statusEl.innerHTML = '<i class="fas fa-download text-[10px] mr-1"></i>Almost done';
          break;
        case 'complete':
          progressBar.style.width = '100%';
          progressBar.style.background = 'linear-gradient(90deg, #22c55e, #16a34a)';
          if (statusEl) statusEl.innerHTML = '<i class="fas fa-check text-[10px] mr-1"></i>Ready';
          break;
        case 'failed':
        case 'error':
          progressBar.style.width = '100%';
          progressBar.style.background = '#ef4444';
          if (statusEl) statusEl.innerHTML = '<i class="fas fa-times text-[10px] mr-1"></i>Failed';
          break;
      }
    }
    
    function markCardComplete(cardIndex) {
      const card = document.getElementById('card-' + cardIndex);
      if (card) {
        card.dataset.complete = 'true';
      }
    }
    
    function showProgressiveResults() {
      const section = document.getElementById('results-section');
      section.classList.remove('hidden');
      section.innerHTML = '';
      
      // Get initial product name from file
      const initialName = selectedFile ? selectedFile.name.replace(/\\.[^.]+$/, '') : 'Product';
      
      // Header with editable name
      const header = document.createElement('div');
      header.className = 'flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4';
      header.innerHTML = \`
        <div>
          <div class="flex items-center gap-2 group">
            <h2 id="session-name-display" class="text-2xl sm:text-3xl font-bold text-brand-dark cursor-pointer hover:text-brand-purple transition" onclick="startEditName()" title="Click to rename">
              \${initialName}
            </h2>
            <button onclick="startEditName()" class="text-brand-gray hover:text-brand-purple transition opacity-0 group-hover:opacity-100">
              <i class="fas fa-pencil text-sm"></i>
            </button>
          </div>
          <input type="text" id="session-name-input" class="hidden text-2xl sm:text-3xl font-bold text-brand-dark bg-transparent border-b-2 border-brand-purple outline-none w-full max-w-md"
                 onblur="saveSessionName()" onkeydown="if(event.key==='Enter')saveSessionName();if(event.key==='Escape')cancelEditName()">
          <p id="results-header-subtitle" class="text-brand-gray mt-1 text-sm">Generating 10 variations...</p>
        </div>
        <div class="flex items-center gap-3">
          <button onclick="window.location.reload()" class="btn-secondary px-4 py-2.5 rounded-xl font-medium text-brand-dark flex items-center gap-2 text-sm">
            <i class="fas fa-plus"></i>
            <span>New</span>
          </button>
          <button onclick="downloadAllImages()" class="btn-primary px-4 py-2.5 rounded-xl font-medium text-white flex items-center gap-2 text-sm">
            <i class="fas fa-download"></i>
            <span>Download All</span>
          </button>
        </div>
      \`;
      section.appendChild(header);
      
      // Thumbnail Grid - 5 cols desktop, 4 tablet, 2 mobile
      const grid = document.createElement('div');
      grid.id = 'results-grid';
      grid.className = 'grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4';
      
      // Original image (already loaded)
      const originalCard = createThumbCard(0, currentOriginalImage, true, variationDefs[0]);
      grid.appendChild(originalCard);
      
      // 10 loading placeholders
      for (let i = 1; i <= 10; i++) {
        const card = createThumbCard(i, null, false, variationDefs[i]);
        grid.appendChild(card);
      }
      
      section.appendChild(grid);
      
      // Initialize lightbox images with original
      lightboxImages = [{ src: currentOriginalImage, label: 'Original', filename: '00-original.jpg' }];
    }
    
    function createThumbCard(index, imgSrc, isLoaded, varDef) {
      const card = document.createElement('div');
      card.id = 'card-' + index;
      card.className = 'thumb-card card-3d rounded-xl sm:rounded-2xl overflow-hidden cursor-pointer';
      
      if (isLoaded && imgSrc) {
        card.innerHTML = \`
          <div class="aspect-square overflow-hidden bg-slate-100">
            <img src="\${imgSrc}" class="w-full h-full object-cover" loading="lazy">
          </div>
          <div class="p-2 sm:p-3 text-center bg-white border-t border-slate-100">
            <p class="text-xs text-brand-dark truncate font-medium flex items-center justify-center gap-1.5">
              <i class="\${varDef.icon} text-brand-purple text-[10px]"></i>
              \${varDef.label}
            </p>
          </div>
        \`;
        card.onclick = () => openLightbox(index);
      } else {
        card.classList.add('loading');
        card.innerHTML = \`
          <div class="aspect-square flex flex-col items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 p-4">
            <div class="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-white/80 shadow-inner flex items-center justify-center mb-4">
              <i class="\${varDef.icon} text-2xl text-brand-purple/60"></i>
            </div>
            <div class="w-full max-w-[85%] bg-slate-300 rounded-full h-2.5 overflow-hidden shadow-inner">
              <div id="progress-\${index}" class="h-full bg-gradient-to-r from-brand-blue to-brand-purple rounded-full transition-all duration-200 ease-linear" style="width: 0%"></div>
            </div>
            <p id="status-\${index}" class="text-xs text-brand-muted mt-3 flex items-center"><i class="fas fa-circle-notch fa-spin text-[10px] mr-1"></i>Generating</p>
          </div>
          <div class="p-2 sm:p-3 text-center bg-slate-50 border-t border-slate-200">
            <p class="text-xs text-brand-muted truncate flex items-center justify-center gap-1.5">
              <i class="\${varDef.icon} text-[10px]"></i>
              \${varDef.label}
            </p>
          </div>
        \`;
      }
      
      return card;
    }
    
    function updateThumbnail(index, imgSrc, success, isCustom = false) {
      const card = document.getElementById('card-' + index);
      if (!card) return;
      
      const varDef = variationDefs[index];
      card.classList.remove('loading');
      
      if (success && imgSrc) {
        card.classList.add('success');
        const customBadge = isCustom ? '<span class="absolute top-2 left-2 text-[9px] bg-amber-500 text-white px-1.5 py-0.5 rounded font-bold shadow">CUSTOM</span>' : '';
        card.innerHTML = \`
          <div class="aspect-square overflow-hidden bg-slate-100 relative group/img">
            <img id="img-\${index}" src="\${imgSrc}" class="w-full h-full object-cover animate-scaleIn" loading="lazy">
            \${customBadge}
            <button onclick="event.stopPropagation(); regenerateVariation(\${index})" 
                    class="absolute top-2 right-2 w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-white shadow-lg flex items-center justify-center text-brand-purple hover:bg-brand-purple hover:text-white transition-all border-2 border-brand-purple/30 hover:border-brand-purple"
                    title="Regenerate this image">
              <i class="fas fa-arrows-rotate text-sm"></i>
            </button>
            <div id="regen-loading-\${index}" class="hidden absolute inset-0 bg-white/90 flex flex-col items-center justify-center z-10">
              <div class="w-8 h-8 rounded-full border-3 border-brand-purple/30 border-t-brand-purple animate-spin mb-2"></div>
              <p class="text-xs text-brand-gray">Regenerating...</p>
            </div>
          </div>
          <div class="p-2 sm:p-3 text-center \${isCustom ? 'bg-amber-50 border-t border-amber-100' : 'bg-green-50 border-t border-green-100'}">
            <p class="text-xs text-brand-dark truncate font-medium flex items-center justify-center gap-1.5">
              <i class="\${varDef.icon} \${isCustom ? 'text-amber-600' : 'text-green-600'} text-[10px]"></i>
              \${varDef.label}
            </p>
          </div>
        \`;
        card.onclick = () => openLightbox(index);
      } else {
        card.classList.add('failed');
        card.innerHTML = \`
          <div class="aspect-square flex items-center justify-center bg-red-50 relative">
            <div class="text-center text-red-400 p-2">
              <i class="fas fa-exclamation-triangle text-xl sm:text-2xl mb-1"></i>
              <p class="text-xs">Failed</p>
            </div>
            <button onclick="event.stopPropagation(); regenerateVariation(\${index})" 
                    class="absolute top-2 right-2 w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-white shadow-lg flex items-center justify-center text-red-500 hover:bg-red-500 hover:text-white transition-all border-2 border-red-300 hover:border-red-500"
                    title="Retry this image">
              <i class="fas fa-arrows-rotate text-sm"></i>
            </button>
            <div id="regen-loading-\${index}" class="hidden absolute inset-0 bg-white/90 flex flex-col items-center justify-center z-10">
              <div class="w-8 h-8 rounded-full border-3 border-brand-purple/30 border-t-brand-purple animate-spin mb-2"></div>
              <p class="text-xs text-brand-gray">Regenerating...</p>
            </div>
          </div>
          <div class="p-2 sm:p-3 text-center bg-red-50 border-t border-red-100">
            <p class="text-xs text-red-500 truncate flex items-center justify-center gap-1.5">
              <i class="\${varDef.icon} text-[10px]"></i>
              \${varDef.label}
            </p>
          </div>
        \`;
      }
    }

    // Lightbox Functions
    function openLightbox(index) {
      // Build lightbox array in grid order (not completion order)
      lightboxImages = [];
      for (let i = 0; i < variationDefs.length; i++) {
        const v = variationDefs[i];
        const src = v.isOriginal ? window.currentResults?.originalImage : window.currentResults?.results?.[v.field];
        if (src) {
          lightboxImages.push({ src: src, label: v.label, filename: v.filename, gridIndex: i });
        }
      }
      
      // Find the clicked image in the ordered array
      const clickedItem = lightboxImages.find(img => img.gridIndex === index);
      currentLightboxIndex = clickedItem ? lightboxImages.indexOf(clickedItem) : 0;
      
      renderLightbox();
    }
    
    function renderLightbox() {
      if (lightboxImages.length === 0) return;
      
      const img = lightboxImages[currentLightboxIndex];
      if (!img) return;
      
      document.getElementById('lightbox-title').textContent = img.label + ' (' + (currentLightboxIndex + 1) + '/' + lightboxImages.length + ')';
      document.getElementById('lightbox-image').src = img.src;
      document.getElementById('lightbox').classList.remove('hidden');
      
      document.addEventListener('keydown', lightboxKeyHandler);
    }
    
    function closeLightbox() {
      document.getElementById('lightbox').classList.add('hidden');
      document.removeEventListener('keydown', lightboxKeyHandler);
    }
    
    function navigateLightbox(direction) {
      currentLightboxIndex = (currentLightboxIndex + direction + lightboxImages.length) % lightboxImages.length;
      renderLightbox();
    }
    
    function lightboxKeyHandler(e) {
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') navigateLightbox(-1);
      if (e.key === 'ArrowRight') navigateLightbox(1);
    }
    
    function downloadCurrentImage() {
      const img = lightboxImages[currentLightboxIndex];
      const link = document.createElement('a');
      link.href = img.src;
      link.download = 'shopshot-' + img.filename;
      link.click();
    }
    
    async function downloadAllImages() {
      if (!window.JSZip || !window.currentResults) return;
      
      const zip = new JSZip();
      const data = window.currentResults;
      
      function base64ToBlob(base64) {
        if (!base64) return null;
        try {
          const parts = base64.split(',');
          const byteString = atob(parts[1]);
          const mimeString = parts[0].split(':')[1].split(';')[0];
          const ab = new ArrayBuffer(byteString.length);
          const ia = new Uint8Array(ab);
          for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
          }
          return new Blob([ab], { type: mimeString });
        } catch (e) {
          return null;
        }
      }
      
      // Add all images
      if (data.originalImage) zip.file('00-original.jpg', base64ToBlob(data.originalImage));
      if (data.results.macro_texture) zip.file('01-texture-detail.jpg', base64ToBlob(data.results.macro_texture));
      if (data.results.label_branding) zip.file('02-label-branding.jpg', base64ToBlob(data.results.label_branding));
      if (data.results.construction_detail) zip.file('03-construction.jpg', base64ToBlob(data.results.construction_detail));
      if (data.results.color_finish) zip.file('04-color-finish.jpg', base64ToBlob(data.results.color_finish));
      if (data.results.scale_reference) zip.file('05-size-reference.jpg', base64ToBlob(data.results.scale_reference));
      if (data.results.hero_white) zip.file('06-hero-white.jpg', base64ToBlob(data.results.hero_white));
      if (data.results.inuse_action) zip.file('07-in-use.jpg', base64ToBlob(data.results.inuse_action));
      if (data.results.flatlay_styled) zip.file('08-flat-lay.jpg', base64ToBlob(data.results.flatlay_styled));
      if (data.results.environment_context) zip.file('09-environment.jpg', base64ToBlob(data.results.environment_context));
      if (data.results.multi_angle) zip.file('10-multi-angle.jpg', base64ToBlob(data.results.multi_angle));
      
      const blob = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'shopshot-images-' + Date.now() + '.zip';
      link.click();
    }

    // Error Handling
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
          <i class="fas fa-sparkles mr-2 text-brand-purple"></i>New
        </a>
        <a href="/history" class="px-4 py-2 rounded-lg text-sm font-medium text-brand-gray hover:bg-brand-purple/10 transition">
          <i class="fas fa-clock-rotate-left mr-2"></i>History
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
