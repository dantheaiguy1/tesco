import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'

type Bindings = {
  TESCO_DB: D1Database;
  GEMINI_API_KEY: string;
  // Vertex AI Service Account credentials
  VERTEX_PROJECT_ID: string;
  VERTEX_CLIENT_EMAIL: string;
  VERTEX_PRIVATE_KEY: string;
  // Stripe Configuration
  STRIPE_SECRET_KEY: string;
  STRIPE_PUBLISHABLE_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PRICE_ID_SUBSCRIPTION: string;
  STRIPE_PRICE_ID_TOPUP: string;
  // Session
  SESSION_SECRET: string;
}

// User type for authenticated requests
type User = {
  id: string;
  email: string;
  name: string | null;
  credits_balance: number;
  subscription_status: 'free' | 'active' | 'canceled' | 'past_due';
  subscription_plan: 'free' | 'pro';
  stripe_customer_id: string | null;
}

type Variables = {
  user?: User;
}

// ============================================================================
// CREDIT SYSTEM CONFIGURATION
// ============================================================================
const CREDITS = {
  SIGNUP_BONUS: 10,           // Free credits on registration
  PER_IMAGE: 1,               // Cost per successful image generation
  SINGLE_REGENERATION: 1,     // Cost for single variation regeneration
  SUBSCRIPTION_MONTHLY: 300,  // Credits added on Pro subscription
  TOPUP_PACK: 300,            // Credits in one-time purchase
}

const PRICING = {
  SUBSCRIPTION: 39.99,        // £39.99/month
  TOPUP: 39.99,               // £39.99 one-time
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
// BETTER: Nano Banana Pro (gemini-3-pro-image-preview) - Best quality, but preview model
//         may have rate limits during high demand. Users can switch to CHEAPER if needed.
// CHEAPER: Nano Banana (gemini-2.5-flash-image) - Stable, reliable, fast
const MODELS: Record<string, string> = {
  nano: 'gemini-3-pro-image-preview',   // BETTER - Nano Banana Pro (best quality)
  flash: 'gemini-2.5-flash-image'       // CHEAPER - Nano Banana (fast & reliable)
};

const MODEL_INFO: Record<string, { name: string; speed: string; quality: string; totalTime: string }> = {
  nano: { name: 'Nano Banana Pro', speed: '~3-4s per image', quality: 'Best', totalTime: '~36 seconds' },
  flash: { name: 'Nano Banana', speed: '~2-3s per image', quality: 'Great', totalTime: '~25 seconds' }
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
  const accessToken = await getAccessToken(clientEmail, privateKey);
  
  // Get the actual model name from the key
  const vertexModel = MODELS[modelKey] || MODELS[DEFAULT_MODEL];
  
  // Vertex AI endpoint - plain aiplatform.googleapis.com works for global location
  const endpoint = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${VERTEX_REGION}/publishers/google/models/${vertexModel}:generateContent`;
  
  const requestBody = JSON.stringify({
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
  });
  
  // Retry with exponential backoff for rate limiting (429 errors)
  const maxRetries = 5;
  let lastError = '';
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        // Exponential backoff: 2s, 4s, 8s, 16s
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[Vertex AI] Retry ${attempt}/${maxRetries} after ${delay}ms delay...`);
        await new Promise(r => setTimeout(r, delay));
      }
      
      console.log(`[Vertex AI] Model: ${modelKey} -> ${vertexModel}, Attempt: ${attempt + 1}/${maxRetries}`);
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: requestBody
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Vertex AI ERROR] Status: ${response.status}, Model: ${modelKey}/${vertexModel}`);
        
        // Check if it's a rate limit error (429)
        if (response.status === 429) {
          lastError = 'Rate limited - retrying...';
          continue; // Retry
        }
        
        // For other errors, don't retry
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
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[Vertex AI] Attempt ${attempt + 1} failed:`, lastError);
      // Continue to retry
    }
  }
  
  // All retries exhausted
  return { success: false, error: `Rate limit exceeded after ${maxRetries} retries. Try again in a few minutes. [Model: ${vertexModel}]` };
}

// ============================================================================
// PASSWORD HASHING (PBKDF2 - Web Crypto API compatible)
// ============================================================================
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );
  const hashArray = new Uint8Array(hash);
  const combined = new Uint8Array(salt.length + hashArray.length);
  combined.set(salt);
  combined.set(hashArray, salt.length);
  return btoa(String.fromCharCode(...combined));
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const combined = Uint8Array.from(atob(storedHash), c => c.charCodeAt(0));
    const salt = combined.slice(0, 16);
    const storedHashBytes = combined.slice(16);
    
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const hash = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      256
    );
    const hashArray = new Uint8Array(hash);
    
    if (hashArray.length !== storedHashBytes.length) return false;
    for (let i = 0; i < hashArray.length; i++) {
      if (hashArray[i] !== storedHashBytes[i]) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================
function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function createUserSession(db: D1Database, userId: string): Promise<string> {
  const sessionId = generateSessionToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  
  await db.prepare(`
    INSERT INTO user_sessions (id, user_id, expires_at) VALUES (?, ?, ?)
  `).bind(sessionId, userId, expiresAt.toISOString()).run();
  
  return sessionId;
}

async function getUserFromSession(db: D1Database, sessionId: string): Promise<User | null> {
  const session = await db.prepare(`
    SELECT us.user_id, us.expires_at, u.* 
    FROM user_sessions us
    JOIN users u ON u.id = us.user_id
    WHERE us.id = ?
  `).bind(sessionId).first() as any;
  
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) {
    // Session expired, delete it
    await db.prepare('DELETE FROM user_sessions WHERE id = ?').bind(sessionId).run();
    return null;
  }
  
  return {
    id: session.user_id,
    email: session.email,
    name: session.name,
    credits_balance: session.credits_balance,
    subscription_status: session.subscription_status,
    subscription_plan: session.subscription_plan,
    stripe_customer_id: session.stripe_customer_id
  };
}

async function deleteUserSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare('DELETE FROM user_sessions WHERE id = ?').bind(sessionId).run();
}

// ============================================================================
// CREDIT MANAGEMENT
// ============================================================================
async function deductCredits(
  db: D1Database, 
  userId: string, 
  amount: number, 
  type: string, 
  description: string,
  sessionId?: string
): Promise<{ success: boolean; newBalance?: number; error?: string }> {
  // Get current balance
  const user = await db.prepare('SELECT credits_balance FROM users WHERE id = ?').bind(userId).first() as any;
  if (!user) return { success: false, error: 'User not found' };
  
  if (user.credits_balance < amount) {
    return { success: false, error: 'Insufficient credits' };
  }
  
  const newBalance = user.credits_balance - amount;
  const transactionId = generateId();
  
  // Update balance and log transaction
  await db.prepare('UPDATE users SET credits_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(newBalance, userId).run();
  
  await db.prepare(`
    INSERT INTO credit_transactions (id, user_id, amount, balance_after, type, description, session_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(transactionId, userId, -amount, newBalance, type, description, sessionId || null).run();
  
  return { success: true, newBalance };
}

async function addCredits(
  db: D1Database, 
  userId: string, 
  amount: number, 
  type: string, 
  description: string,
  stripePaymentId?: string
): Promise<{ success: boolean; newBalance?: number; error?: string }> {
  const user = await db.prepare('SELECT credits_balance FROM users WHERE id = ?').bind(userId).first() as any;
  if (!user) return { success: false, error: 'User not found' };
  
  const newBalance = user.credits_balance + amount;
  const transactionId = generateId();
  
  await db.prepare('UPDATE users SET credits_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(newBalance, userId).run();
  
  await db.prepare(`
    INSERT INTO credit_transactions (id, user_id, amount, balance_after, type, description, stripe_payment_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(transactionId, userId, amount, newBalance, type, description, stripePaymentId || null).run();
  
  return { success: true, newBalance };
}

async function getCreditBalance(db: D1Database, userId: string): Promise<number> {
  const user = await db.prepare('SELECT credits_balance FROM users WHERE id = ?').bind(userId).first() as any;
  return user?.credits_balance || 0;
}

// ============================================================================
// STRIPE API HELPERS
// ============================================================================
async function stripeRequest(
  secretKey: string, 
  endpoint: string, 
  method: string = 'GET', 
  body?: Record<string, any>
): Promise<any> {
  const url = `https://api.stripe.com/v1${endpoint}`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${secretKey}`,
  };
  
  let requestBody: string | undefined;
  if (body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    requestBody = new URLSearchParams(
      Object.entries(body).flatMap(([key, value]) => {
        if (typeof value === 'object' && value !== null) {
          return Object.entries(value).map(([k, v]) => [`${key}[${k}]`, String(v)]);
        }
        return [[key, String(value)]];
      })
    ).toString();
  }
  
  const response = await fetch(url, { method, headers, body: requestBody });
  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error?.message || `Stripe error: ${response.status}`);
  }
  
  return data;
}

async function verifyStripeWebhook(
  payload: string, 
  signature: string, 
  secret: string
): Promise<any> {
  const parts = signature.split(',').reduce((acc: any, part) => {
    const [key, value] = part.split('=');
    acc[key] = value;
    return acc;
  }, {});
  
  const timestamp = parts['t'];
  const v1Signature = parts['v1'];
  
  if (!timestamp || !v1Signature) {
    throw new Error('Invalid signature format');
  }
  
  // Check timestamp is within 5 minutes
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - parseInt(timestamp)) > 300) {
    throw new Error('Webhook timestamp too old');
  }
  
  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const expectedSignature = Array.from(new Uint8Array(signatureBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  
  if (expectedSignature !== v1Signature) {
    throw new Error('Invalid webhook signature');
  }
  
  return JSON.parse(payload);
}

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>()

app.use('*', cors())

// Auto-migrate database on first request
async function ensureDatabase(db: D1Database) {
  try {
    // Sessions table
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
        user_id TEXT,
        credits_charged INTEGER DEFAULT 0,
        credits_refunded INTEGER DEFAULT 0,
        generation_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run()
    
    // Generated images table
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
    
    // Users table
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT,
        credits_balance INTEGER NOT NULL DEFAULT 10,
        subscription_status TEXT NOT NULL DEFAULT 'free' CHECK (subscription_status IN ('free', 'active', 'canceled', 'past_due')),
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        subscription_plan TEXT NOT NULL DEFAULT 'free' CHECK (subscription_plan IN ('free', 'pro')),
        billing_period_start DATETIME,
        billing_period_end DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run()
    
    // Credit transactions table
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS credit_transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        balance_after INTEGER NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('signup_bonus', 'subscription', 'topup', 'generation', 'regeneration', 'refund')),
        description TEXT,
        session_id TEXT,
        stripe_payment_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `).run()
    
    // User sessions table (auth)
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `).run()
    
    // Stripe events table (idempotency)
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS stripe_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        user_id TEXT,
        processed INTEGER NOT NULL DEFAULT 0,
        data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run()
    
    // Create indexes
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at DESC)').run()
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)').run()
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)').run()
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_generated_images_session ON generated_images(session_id)').run()
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)').run()
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id)').run()
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_credit_transactions_user ON credit_transactions(user_id)').run()
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id)').run()
    
    // Migration: Add new columns to sessions if they don't exist
    try { await db.prepare('ALTER TABLE sessions ADD COLUMN model TEXT DEFAULT \'nano\'').run() } catch (e) {}
    try { await db.prepare('ALTER TABLE sessions ADD COLUMN user_id TEXT').run() } catch (e) {}
    try { await db.prepare('ALTER TABLE sessions ADD COLUMN credits_charged INTEGER DEFAULT 0').run() } catch (e) {}
    try { await db.prepare('ALTER TABLE sessions ADD COLUMN credits_refunded INTEGER DEFAULT 0').run() } catch (e) {}
    try { await db.prepare('ALTER TABLE sessions ADD COLUMN generation_count INTEGER DEFAULT 0').run() } catch (e) {}
    try { await db.prepare('ALTER TABLE generated_images ADD COLUMN model TEXT DEFAULT \'nano\'').run() } catch (e) {}
  } catch (err) {
    console.log('Database already initialized or error:', err)
  }
}

// ============================================================================
// AUTHENTICATION MIDDLEWARE
// ============================================================================
// Middleware to optionally load user from session cookie (all routes)
app.use('*', async (c, next) => {
  const sessionId = getCookie(c, 'session');
  if (sessionId) {
    const db = c.env.TESCO_DB;
    const user = await getUserFromSession(db, sessionId);
    if (user) {
      c.set('user', user);
    }
  }
  await next();
});

// Helper to require authentication
function requireAuth(c: any): User | Response {
  const user = c.get('user');
  if (!user) {
    return c.json({ success: false, error: 'Authentication required' }, 401);
  }
  return user;
}

// Helper to require sufficient credits
async function requireCredits(c: any, amount: number): Promise<User | Response> {
  const user = c.get('user');
  if (!user) {
    return c.json({ success: false, error: 'Authentication required' }, 401);
  }
  if (user.credits_balance < amount) {
    return c.json({ 
      success: false, 
      error: 'Insufficient credits',
      required: amount,
      current: user.credits_balance,
      needsUpgrade: true
    }, 402);
  }
  return user;
}

// Generate unique ID
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}

// Test endpoint to check Vertex AI connectivity
app.get('/api/test-vertex', async (c) => {
  const projectId = c.env.VERTEX_PROJECT_ID;
  const clientEmail = c.env.VERTEX_CLIENT_EMAIL;
  const privateKey = c.env.VERTEX_PRIVATE_KEY;
  
  if (!projectId || !clientEmail || !privateKey) {
    return c.json({ error: 'Missing Vertex AI credentials' });
  }
  
  try {
    const accessToken = await getAccessToken(clientEmail, privateKey);
    const model = 'gemini-3-pro-image-preview';
    const endpoint = `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${VERTEX_REGION}/publishers/google/models/${model}:generateContent`;
    
    // Simple text-only test (no image)
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: 'Generate a simple test image of a red apple on white background' }]
        }],
        generationConfig: {
          responseModalities: ['IMAGE', 'TEXT']
        }
      })
    });
    
    const responseText = await response.text();
    return c.json({
      status: response.status,
      ok: response.ok,
      endpoint: endpoint,
      model: model,
      response: responseText.substring(0, 2000)
    });
  } catch (err) {
    return c.json({ error: String(err) });
  }
});

// Test with actual image input (like real generation)
app.get('/api/test-vertex-image', async (c) => {
  const projectId = c.env.VERTEX_PROJECT_ID;
  const clientEmail = c.env.VERTEX_CLIENT_EMAIL;
  const privateKey = c.env.VERTEX_PRIVATE_KEY;
  
  try {
    // Test with the actual generateImageWithVertex function
    const result = await generateImageWithVertex(
      projectId,
      clientEmail,
      privateKey,
      // Tiny 1x1 red PNG in base64
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
      'image/png',
      'Create a professional product photo of this item on a white background',
      'nano'  // Test nano model specifically
    );
    
    return c.json({
      success: result.success,
      error: result.error,
      hasImage: !!result.image,
      imagePreview: result.image ? result.image.substring(0, 100) + '...' : null
    });
  } catch (err) {
    return c.json({ error: String(err) });
  }
});

// Homepage
app.get('/', (c) => {
  const user = c.get('user')
  return c.html(getHomePage(user))
})

// History page - redirect to home (now uses sidebar)
app.get('/history', (c) => {
  return c.redirect('/')
})

// Results page
app.get('/results/:id', (c) => {
  const user = c.get('user')
  return c.html(getResultsPage(c.req.param('id'), user))
})

// Login page
app.get('/login', (c) => {
  const user = c.get('user')
  if (user) return c.redirect('/')
  return c.html(getLoginPage())
})

// Register page
app.get('/register', (c) => {
  const user = c.get('user')
  if (user) return c.redirect('/')
  return c.html(getRegisterPage())
})

// Dashboard page
app.get('/dashboard', (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/login')
  return c.html(getDashboardPage(user))
})

// Pricing page
app.get('/pricing', (c) => {
  const user = c.get('user')
  return c.html(getPricingPage(user))
})

// Account page
app.get('/account', (c) => {
  const user = c.get('user')
  if (!user) return c.redirect('/login')
  return c.html(getAccountPage(user))
})

// API: Get all sessions (filtered by authenticated user)
app.get('/api/sessions', async (c) => {
  try {
    const db = c.env.TESCO_DB
    await ensureDatabase(db)
    
    const user = c.get('user')
    
    // If authenticated, return user's sessions; otherwise return empty (guest mode)
    if (user) {
      const result = await db.prepare(
        'SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC'
      ).bind(user.id).all()
      return c.json({ success: true, sessions: result.results })
    } else {
      // Guest mode - no sessions
      return c.json({ success: true, sessions: [] })
    }
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
    const user = c.get('user')
    
    // Build query based on auth status
    let session
    if (user) {
      session = await db.prepare(
        'SELECT * FROM sessions WHERE id = ? AND user_id = ?'
      ).bind(id, user.id).first()
    } else {
      // Allow viewing session without auth for share links
      session = await db.prepare(
        'SELECT * FROM sessions WHERE id = ?'
      ).bind(id).first()
    }
    
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

// ============================================================================
// AUTHENTICATION ROUTES
// ============================================================================

// Register new user
app.post('/api/auth/register', async (c) => {
  try {
    const db = c.env.TESCO_DB;
    await ensureDatabase(db);
    
    const { email, password, name } = await c.req.json();
    
    if (!email || !password) {
      return c.json({ success: false, error: 'Email and password required' }, 400);
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return c.json({ success: false, error: 'Invalid email format' }, 400);
    }
    
    // Check password strength
    if (password.length < 6) {
      return c.json({ success: false, error: 'Password must be at least 6 characters' }, 400);
    }
    
    // Check if user exists
    const existingUser = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email.toLowerCase()).first();
    if (existingUser) {
      return c.json({ success: false, error: 'Email already registered' }, 400);
    }
    
    // Create user
    const userId = generateId();
    const passwordHash = await hashPassword(password);
    
    await db.prepare(`
      INSERT INTO users (id, email, password_hash, name, credits_balance)
      VALUES (?, ?, ?, ?, ?)
    `).bind(userId, email.toLowerCase(), passwordHash, name || null, CREDITS.SIGNUP_BONUS).run();
    
    // Log signup bonus
    await db.prepare(`
      INSERT INTO credit_transactions (id, user_id, amount, balance_after, type, description)
      VALUES (?, ?, ?, ?, 'signup_bonus', 'Welcome bonus credits')
    `).bind(generateId(), userId, CREDITS.SIGNUP_BONUS, CREDITS.SIGNUP_BONUS).run();
    
    // Create session
    const sessionId = await createUserSession(db, userId);
    
    // Set cookie
    setCookie(c, 'session', sessionId, {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: '/'
    });
    
    return c.json({ 
      success: true, 
      user: {
        id: userId,
        email: email.toLowerCase(),
        name: name || null,
        credits_balance: CREDITS.SIGNUP_BONUS,
        subscription_status: 'free',
        subscription_plan: 'free'
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    return c.json({ success: false, error: 'Registration failed' }, 500);
  }
});

// Login
app.post('/api/auth/login', async (c) => {
  try {
    const db = c.env.TESCO_DB;
    await ensureDatabase(db);
    
    const { email, password } = await c.req.json();
    
    if (!email || !password) {
      return c.json({ success: false, error: 'Email and password required' }, 400);
    }
    
    const user = await db.prepare(`
      SELECT id, email, password_hash, name, credits_balance, subscription_status, subscription_plan, stripe_customer_id
      FROM users WHERE email = ?
    `).bind(email.toLowerCase()).first() as any;
    
    if (!user) {
      return c.json({ success: false, error: 'Invalid email or password' }, 401);
    }
    
    const validPassword = await verifyPassword(password, user.password_hash);
    if (!validPassword) {
      return c.json({ success: false, error: 'Invalid email or password' }, 401);
    }
    
    // Create session
    const sessionId = await createUserSession(db, user.id);
    
    // Set cookie
    setCookie(c, 'session', sessionId, {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      maxAge: 30 * 24 * 60 * 60,
      path: '/'
    });
    
    return c.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        credits_balance: user.credits_balance,
        subscription_status: user.subscription_status,
        subscription_plan: user.subscription_plan
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return c.json({ success: false, error: 'Login failed' }, 500);
  }
});

// Logout
app.post('/api/auth/logout', async (c) => {
  const sessionId = getCookie(c, 'session');
  if (sessionId) {
    await deleteUserSession(c.env.TESCO_DB, sessionId);
  }
  deleteCookie(c, 'session', { path: '/' });
  return c.json({ success: true });
});

// Get current user
app.get('/api/auth/me', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ success: false, user: null });
  }
  return c.json({ success: true, user });
});

// ============================================================================
// CREDIT MANAGEMENT ROUTES
// ============================================================================

// Get credit balance
app.get('/api/credits/balance', async (c) => {
  const authResult = requireAuth(c);
  if (authResult instanceof Response) return authResult;
  const user = authResult;
  
  return c.json({ 
    success: true, 
    balance: user.credits_balance,
    subscription_status: user.subscription_status,
    subscription_plan: user.subscription_plan
  });
});

// Get credit history
app.get('/api/credits/history', async (c) => {
  const authResult = requireAuth(c);
  if (authResult instanceof Response) return authResult;
  const user = authResult;
  
  const db = c.env.TESCO_DB;
  const transactions = await db.prepare(`
    SELECT * FROM credit_transactions 
    WHERE user_id = ? 
    ORDER BY created_at DESC 
    LIMIT 50
  `).bind(user.id).all();
  
  return c.json({ success: true, transactions: transactions.results });
});

// ============================================================================
// STRIPE BILLING ROUTES
// ============================================================================

// Create checkout session (subscription or top-up)
app.post('/api/billing/create-checkout', async (c) => {
  const authResult = requireAuth(c);
  if (authResult instanceof Response) return authResult;
  const user = authResult;
  
  const { type } = await c.req.json(); // 'subscription' or 'topup'
  const db = c.env.TESCO_DB;
  
  if (!['subscription', 'topup'].includes(type)) {
    return c.json({ success: false, error: 'Invalid checkout type' }, 400);
  }
  
  const priceId = type === 'subscription' 
    ? c.env.STRIPE_PRICE_ID_SUBSCRIPTION 
    : c.env.STRIPE_PRICE_ID_TOPUP;
  
  const mode = type === 'subscription' ? 'subscription' : 'payment';
  
  // Get or create Stripe customer
  let stripeCustomerId = user.stripe_customer_id;
  if (!stripeCustomerId) {
    const customer = await stripeRequest(c.env.STRIPE_SECRET_KEY, '/customers', 'POST', {
      email: user.email,
      name: user.name || undefined,
      metadata: { user_id: user.id }
    });
    stripeCustomerId = customer.id;
    await db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?')
      .bind(stripeCustomerId, user.id).run();
  }
  
  // Get the current URL for success/cancel redirects
  const origin = new URL(c.req.url).origin;
  
  const session = await stripeRequest(c.env.STRIPE_SECRET_KEY, '/checkout/sessions', 'POST', {
    customer: stripeCustomerId,
    mode: mode,
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': 1,
    success_url: `${origin}/dashboard?checkout=success&type=${type}`,
    cancel_url: `${origin}/pricing?checkout=canceled`,
    client_reference_id: user.id,
    'metadata[user_id]': user.id,
    'metadata[type]': type
  });
  
  return c.json({ success: true, url: session.url, sessionId: session.id });
});

// Stripe webhook handler
app.post('/api/billing/webhook', async (c) => {
  const signature = c.req.header('stripe-signature');
  if (!signature) {
    return c.json({ error: 'Missing signature' }, 400);
  }
  
  const payload = await c.req.text();
  
  let event;
  try {
    event = await verifyStripeWebhook(payload, signature, c.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook verification failed:', err);
    return c.json({ error: 'Invalid signature' }, 400);
  }
  
  const db = c.env.TESCO_DB;
  
  // Check if event already processed (idempotency)
  const existingEvent = await db.prepare('SELECT id FROM stripe_events WHERE id = ?').bind(event.id).first();
  if (existingEvent) {
    return c.json({ received: true, already_processed: true });
  }
  
  // Store event for idempotency
  await db.prepare(`
    INSERT INTO stripe_events (id, type, data) VALUES (?, ?, ?)
  `).bind(event.id, event.type, JSON.stringify(event.data)).run();
  
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.client_reference_id || session.metadata?.user_id;
        const checkoutType = session.metadata?.type;
        
        if (userId && checkoutType) {
          // Add credits
          await addCredits(db, userId, CREDITS.SUBSCRIPTION_MONTHLY, checkoutType, 
            checkoutType === 'subscription' ? 'Pro subscription started' : '300 Credit Pack purchase',
            session.id);
          
          // Update subscription status if subscription
          if (checkoutType === 'subscription') {
            await db.prepare(`
              UPDATE users SET 
                subscription_status = 'active', 
                subscription_plan = 'pro',
                stripe_subscription_id = ?,
                updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `).bind(session.subscription, userId).run();
          }
          
          // Update stripe_events with user_id
          await db.prepare('UPDATE stripe_events SET user_id = ?, processed = 1 WHERE id = ?')
            .bind(userId, event.id).run();
        }
        break;
      }
      
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        // Only process renewal payments (not initial subscription)
        if (invoice.billing_reason === 'subscription_cycle') {
          const customer = await stripeRequest(
            c.env.STRIPE_SECRET_KEY, 
            `/customers/${invoice.customer}`
          );
          const userId = customer.metadata?.user_id;
          
          if (userId) {
            await addCredits(db, userId, CREDITS.SUBSCRIPTION_MONTHLY, 'subscription',
              'Monthly subscription renewal', invoice.id);
            
            await db.prepare('UPDATE stripe_events SET user_id = ?, processed = 1 WHERE id = ?')
              .bind(userId, event.id).run();
          }
        }
        break;
      }
      
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const user = await db.prepare(`
          SELECT id FROM users WHERE stripe_subscription_id = ?
        `).bind(subscription.id).first() as any;
        
        if (user) {
          await db.prepare(`
            UPDATE users SET 
              subscription_status = 'canceled',
              stripe_subscription_id = NULL,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).bind(user.id).run();
          
          await db.prepare('UPDATE stripe_events SET user_id = ?, processed = 1 WHERE id = ?')
            .bind(user.id, event.id).run();
        }
        break;
      }
      
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customer = await stripeRequest(
          c.env.STRIPE_SECRET_KEY, 
          `/customers/${invoice.customer}`
        );
        const userId = customer.metadata?.user_id;
        
        if (userId) {
          await db.prepare(`
            UPDATE users SET subscription_status = 'past_due', updated_at = CURRENT_TIMESTAMP WHERE id = ?
          `).bind(userId).run();
          
          await db.prepare('UPDATE stripe_events SET user_id = ?, processed = 1 WHERE id = ?')
            .bind(userId, event.id).run();
        }
        break;
      }
    }
    
    await db.prepare('UPDATE stripe_events SET processed = 1 WHERE id = ?').bind(event.id).run();
  } catch (err) {
    console.error('Webhook processing error:', err);
    // Don't fail the webhook, just log the error
  }
  
  return c.json({ received: true });
});

// Customer billing portal
app.get('/api/billing/portal', async (c) => {
  const authResult = requireAuth(c);
  if (authResult instanceof Response) return authResult;
  const user = authResult;
  
  if (!user.stripe_customer_id) {
    return c.json({ success: false, error: 'No billing account found' }, 400);
  }
  
  const origin = new URL(c.req.url).origin;
  
  const session = await stripeRequest(c.env.STRIPE_SECRET_KEY, '/billing_portal/sessions', 'POST', {
    customer: user.stripe_customer_id,
    return_url: `${origin}/account`
  });
  
  return c.json({ success: true, url: session.url });
});

// ============================================================================
// GENERAL API ROUTES
// ============================================================================

// API: Health check
app.get('/api/health', async (c) => {
  return c.json({ 
    status: 'ok',
    hasGeminiKey: !!c.env.GEMINI_API_KEY,
    keyLength: c.env.GEMINI_API_KEY?.length || 0,
    hasDB: !!c.env.TESCO_DB,
    hasStripe: !!c.env.STRIPE_SECRET_KEY
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

// API: Create session from upload (requires auth + credits for full generation)
app.post('/api/upload', async (c) => {
  try {
    const db = c.env.TESCO_DB
    await ensureDatabase(db)
    
    // Check authentication and credits (10 credits for full generation)
    const user = c.get('user')
    if (!user) {
      return c.json({ success: false, error: 'Authentication required', needsAuth: true }, 401)
    }
    if (user.credits_balance < CREDITS.PER_IMAGE) {
      return c.json({ 
        success: false, 
        error: 'Insufficient credits. You need at least 1 credit to start.',
        required: CREDITS.PER_IMAGE,
        current: user.credits_balance,
        needsUpgrade: true
      }, 402)
    }
    
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
    await db.prepare(`
      INSERT INTO sessions (id, product_name, source_type, original_image, status, model, user_id)
      VALUES (?, ?, 'upload', ?, 'pending', ?, ?)
    `).bind(sessionId, productName, thumbnail || '', model, user.id).run()

    return c.json({ 
      success: true, 
      sessionId, 
      originalImage: dataUrl, 
      model,
      credits_balance: user.credits_balance,
      credits_required: CREDITS.PER_IMAGE
    })
  } catch (error) {
    console.error('Upload error:', error)
    return c.json({ success: false, error: 'Failed to process upload' }, 500)
  }
})

// API: Scrape URL (requires auth + credits)
app.post('/api/scrape', async (c) => {
  try {
    const db = c.env.TESCO_DB
    await ensureDatabase(db)
    
    // Check authentication and credits (need at least 1 to start)
    const user = c.get('user')
    if (!user) {
      return c.json({ success: false, error: 'Authentication required', needsAuth: true }, 401)
    }
    if (user.credits_balance < CREDITS.PER_IMAGE) {
      return c.json({ 
        success: false, 
        error: 'Insufficient credits. You need at least 1 credit to start.',
        required: CREDITS.PER_IMAGE,
        current: user.credits_balance,
        needsUpgrade: true
      }, 402)
    }
    
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

    // Create session with user_id
    const sessionId = generateId()
    
    await db.prepare(`
      INSERT INTO sessions (id, product_name, source_type, source_url, original_image, status, model, user_id)
      VALUES (?, ?, 'url', ?, '', 'pending', ?, ?)
    `).bind(sessionId, productName, url, model, user.id).run()

    return c.json({ 
      success: true, 
      sessionId, 
      originalImage: dataUrl, 
      productName, 
      model,
      credits_balance: user.credits_balance,
      credits_required: CREDITS.PER_IMAGE
    })
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
// Note: Credits are deducted when completing the full generation, not per-variation
app.post('/api/generate-single/:sessionId/:variationIndex', async (c) => {
  const sessionId = c.req.param('sessionId')
  const variationIndex = parseInt(c.req.param('variationIndex'))
  const db = c.env.TESCO_DB
  
  // Check authentication and credits
  const user = c.get('user')
  if (!user) {
    return c.json({ success: false, error: 'Authentication required', needsAuth: true }, 401)
  }
  
  // Check if user has at least 1 credit
  if (user.credits_balance < CREDITS.PER_IMAGE) {
    return c.json({ 
      success: false, 
      error: 'Insufficient credits',
      required: CREDITS.PER_IMAGE,
      current: user.credits_balance,
      needsUpgrade: true,
      field: variationDefinitions[variationIndex]?.field
    }, 402)
  }
  
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
      // NO credit deduction on failure
      return c.json({ success: false, error: result.error, field: variation.field }, 500)
    }
    
    // SUCCESS: Deduct 1 credit for this image
    const creditResult = await deductCredits(
      db,
      user.id,
      CREDITS.PER_IMAGE,
      'generation',
      `Image: ${variation.label}`,
      sessionId
    )
    
    // Update session stats
    await db.prepare('UPDATE sessions SET generation_count = generation_count + 1, credits_charged = credits_charged + 1 WHERE id = ?')
      .bind(sessionId).run()
    
    console.log(`[${variation.field}] Success! Credit deducted. New balance: ${creditResult.newBalance}${isCustom ? ' (Custom Prompt)' : ''} [${modelInfo.name}]`)
    return c.json({ 
      success: true, 
      field: variation.field, 
      label: variation.label,
      image: result.image,
      elapsed,
      isCustom,
      model: modelKey,
      modelName: modelInfo.name,
      credits_deducted: CREDITS.PER_IMAGE,
      credits_remaining: creditResult.newBalance
    })
    
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error(`Error:`, errorMsg)
    // NO credit deduction on error
    return c.json({ success: false, error: errorMsg, field: variationDefinitions[variationIndex]?.field || 'unknown' }, 500)
  }
})

// API: Mark session as complete (credits already deducted per-image)
app.post('/api/sessions/:id/complete', async (c) => {
  const sessionId = c.req.param('id')
  const db = c.env.TESCO_DB
  
  const user = c.get('user')
  if (!user) {
    return c.json({ success: false, error: 'Authentication required' }, 401)
  }
  
  try {
    // Get session
    const session = await db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
      .bind(sessionId, user.id).first() as any
    
    if (!session) {
      return c.json({ success: false, error: 'Session not found' }, 404)
    }
    
    // Just update status to completed (credits already deducted per-image)
    await db.prepare(`
      UPDATE sessions SET 
        status = 'completed',
        updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).bind(sessionId).run()
    
    return c.json({ 
      success: true, 
      credits_charged: session.credits_charged,
      status: 'completed'
    })
  } catch (error) {
    console.error('Complete generation error:', error)
    return c.json({ success: false, error: 'Failed to complete generation' }, 500)
  }
})

// API: Regenerate single variation (costs 1 credit)
app.post('/api/regenerate/:sessionId/:variationIndex', async (c) => {
  const sessionId = c.req.param('sessionId')
  const variationIndex = parseInt(c.req.param('variationIndex'))
  const db = c.env.TESCO_DB
  
  // Check authentication and credits
  const user = c.get('user')
  if (!user) {
    return c.json({ success: false, error: 'Authentication required', needsAuth: true }, 401)
  }
  if (user.credits_balance < CREDITS.SINGLE_REGENERATION) {
    return c.json({ 
      success: false, 
      error: 'Insufficient credits for regeneration',
      required: CREDITS.SINGLE_REGENERATION,
      current: user.credits_balance,
      needsUpgrade: true
    }, 402)
  }
  
  // Verify session belongs to user
  const session = await db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
    .bind(sessionId, user.id).first()
  if (!session) {
    return c.json({ success: false, error: 'Session not found' }, 404)
  }
  
  // Vertex AI credentials
  const projectId = c.env.VERTEX_PROJECT_ID
  const clientEmail = c.env.VERTEX_CLIENT_EMAIL
  const privateKey = c.env.VERTEX_PRIVATE_KEY
  
  try {
    const body = await c.req.json().catch(() => ({}))
    const originalImage = body.originalImage
    const productName = body.productName || 'product'
    const customPrompt = body.customPrompt
    const modelKey = body.model || DEFAULT_MODEL
    
    if (!originalImage || originalImage.length < 100) {
      return c.json({ success: false, error: 'No image provided' }, 400)
    }
    
    if (!projectId || !clientEmail || !privateKey) {
      return c.json({ success: false, error: 'Vertex AI credentials not configured' }, 500)
    }

    const prompts = getPrompts(productName)
    const variation = variationDefinitions[variationIndex]
    if (!variation) {
      return c.json({ success: false, error: 'Invalid variation index' }, 400)
    }
    
    const prompt = customPrompt || prompts[variation.field]
    const modelInfo = MODEL_INFO[modelKey] || MODEL_INFO[DEFAULT_MODEL]
    
    const startTime = Date.now()
    const mimeType = originalImage.split(';')[0].split(':')[1]
    const imageBase64 = originalImage.split(',')[1]
    
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
    
    if (!result.success) {
      return c.json({ success: false, error: result.error }, 500)
    }
    
    // Deduct 1 credit for regeneration
    const creditResult = await deductCredits(
      db, 
      user.id, 
      CREDITS.SINGLE_REGENERATION, 
      'regeneration',
      `Regenerate ${variation.label}: ${productName}`,
      sessionId
    )
    
    return c.json({ 
      success: true, 
      field: variation.field, 
      label: variation.label,
      image: result.image,
      elapsed,
      model: modelKey,
      modelName: modelInfo.name,
      credits_charged: CREDITS.SINGLE_REGENERATION,
      new_balance: creditResult.newBalance
    })
    
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    return c.json({ success: false, error: errorMsg }, 500)
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

// User menu HTML for header
function getUserMenuHTML(user: User | undefined): string {
  if (user) {
    return `
      <div class="user-menu">
        <div class="credits-badge" title="Credits remaining">
          <span class="credits-icon">💳</span>
          <span class="credits-count">${user.credits_balance}</span>
        </div>
        <div class="user-dropdown">
          <button class="user-btn" onclick="toggleUserMenu()">
            <span class="user-avatar">${(user.name || user.email)[0].toUpperCase()}</span>
            <span class="user-name">${user.name || user.email.split('@')[0]}</span>
            <span class="dropdown-arrow">▼</span>
          </button>
          <div class="dropdown-menu" id="userDropdown">
            <a href="/dashboard" class="dropdown-item">📊 Dashboard</a>
            <a href="/pricing" class="dropdown-item">💰 Buy Credits</a>
            <a href="/account" class="dropdown-item">⚙️ Account</a>
            <hr class="dropdown-divider">
            <button onclick="logout()" class="dropdown-item logout-btn">🚪 Logout</button>
          </div>
        </div>
      </div>
    `;
  } else {
    return `
      <div class="auth-buttons">
        <a href="/login" class="auth-btn login-btn">Log In</a>
        <a href="/register" class="auth-btn signup-btn">Sign Up Free</a>
      </div>
    `;
  }
}

// User menu styles
function getUserMenuStyles(): string {
  return `
    .user-menu { display: flex; align-items: center; gap: 12px; }
    .credits-badge {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 12px;
      background: linear-gradient(135deg, #F0FDF4 0%, #DCFCE7 100%);
      border: 1px solid #BBF7D0;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
      color: #166534;
    }
    .credits-icon { font-size: 14px; }
    .user-dropdown { position: relative; }
    .user-btn {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      background: white;
      border: 1px solid #E5E7EB;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .user-btn:hover { background: #F9FAFB; }
    .user-avatar {
      width: 28px;
      height: 28px;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 600;
      font-size: 12px;
    }
    .user-name { font-size: 13px; font-weight: 500; color: #374151; max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dropdown-arrow { font-size: 10px; color: #9CA3AF; }
    .dropdown-menu {
      display: none;
      position: absolute;
      top: 100%;
      right: 0;
      margin-top: 8px;
      min-width: 180px;
      background: white;
      border: 1px solid #E5E7EB;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      z-index: 100;
      overflow: hidden;
    }
    .dropdown-menu.show { display: block; }
    .dropdown-item {
      display: block;
      padding: 10px 16px;
      font-size: 13px;
      color: #374151;
      text-decoration: none;
      transition: background 0.15s;
      cursor: pointer;
      border: none;
      background: none;
      width: 100%;
      text-align: left;
    }
    .dropdown-item:hover { background: #F3F4F6; }
    .dropdown-divider { border: none; border-top: 1px solid #E5E7EB; margin: 4px 0; }
    .logout-btn { color: #DC2626; }
    .logout-btn:hover { background: #FEF2F2; }
    
    .auth-buttons { display: flex; gap: 8px; }
    .auth-btn {
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      text-decoration: none;
      transition: all 0.2s;
    }
    .login-btn { color: #374151; border: 1px solid #E5E7EB; background: white; }
    .login-btn:hover { background: #F9FAFB; }
    .signup-btn { 
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%); 
      color: white; 
      border: none;
    }
    .signup-btn:hover { opacity: 0.9; }
  `;
}

// Auth page shared styles
function getAuthPageStyles(): string {
  return `
    .auth-container {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #F0F9FF 0%, #E0E7FF 100%);
      padding: 24px;
    }
    .auth-card {
      width: 100%;
      max-width: 400px;
      background: white;
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.1);
    }
    .auth-logo {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-bottom: 24px;
    }
    .auth-logo-icon {
      width: 40px;
      height: 40px;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .auth-logo-text { font-size: 24px; font-weight: 700; color: #1F2937; }
    .auth-title { font-size: 24px; font-weight: 700; color: #1F2937; text-align: center; margin-bottom: 8px; }
    .auth-subtitle { font-size: 14px; color: #6B7280; text-align: center; margin-bottom: 24px; }
    .auth-form { display: flex; flex-direction: column; gap: 16px; }
    .form-group { display: flex; flex-direction: column; gap: 6px; }
    .form-label { font-size: 13px; font-weight: 500; color: #374151; }
    .form-input {
      padding: 12px 14px;
      border: 1px solid #E5E7EB;
      border-radius: 8px;
      font-size: 14px;
      transition: border-color 0.2s;
    }
    .form-input:focus { outline: none; border-color: #3B82F6; }
    .auth-btn {
      padding: 14px;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .auth-btn:hover { opacity: 0.9; }
    .auth-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .auth-error {
      padding: 12px;
      background: #FEF2F2;
      border: 1px solid #FECACA;
      border-radius: 8px;
      color: #DC2626;
      font-size: 13px;
      text-align: center;
      display: none;
    }
    .auth-error.show { display: block; }
    .auth-footer { margin-top: 20px; text-align: center; font-size: 13px; color: #6B7280; }
    .auth-footer a { color: #3B82F6; text-decoration: none; font-weight: 500; }
    .auth-footer a:hover { text-decoration: underline; }
    .auth-divider {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 20px 0;
      color: #9CA3AF;
      font-size: 12px;
    }
    .auth-divider::before, .auth-divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: #E5E7EB;
    }
  `;
}

function getHomePage(user?: User) {
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
    
    .credits-indicator {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      margin: 8px;
      background: linear-gradient(135deg, #F0FDF4 0%, #DCFCE7 100%);
      border: 1px solid #BBF7D0;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .credits-indicator:hover {
      background: linear-gradient(135deg, #DCFCE7 0%, #BBF7D0 100%);
      transform: translateY(-1px);
    }
    .credits-indicator.low {
      background: linear-gradient(135deg, #FEF3C7 0%, #FDE68A 100%);
      border-color: #FCD34D;
    }
    .credits-indicator.empty {
      background: linear-gradient(135deg, #FEE2E2 0%, #FECACA 100%);
      border-color: #FCA5A5;
    }
    .credits-left {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .credits-label {
      font-size: 10px;
      color: #6B7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .credits-value {
      font-size: 18px;
      font-weight: 700;
      color: #166534;
    }
    .credits-indicator.low .credits-value { color: #92400E; }
    .credits-indicator.empty .credits-value { color: #DC2626; }
    .credits-add {
      background: #10B981;
      color: white;
      border: none;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .credits-add:hover { background: #059669; }
    .credits-indicator.low .credits-add { background: #F59E0B; }
    .credits-indicator.low .credits-add:hover { background: #D97706; }
    .credits-indicator.empty .credits-add { background: #EF4444; }
    .credits-indicator.empty .credits-add:hover { background: #DC2626; }
    
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
    .nano-warning {
      margin-top: 12px;
      padding: 10px 14px;
      background: #FEF3C7;
      border: 1px solid #F59E0B;
      border-radius: 8px;
      font-size: 12px;
      color: #92400E;
      text-align: center;
      display: none;
    }
    .nano-warning.show { display: block; }
    
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
    
    /* Paywall Modal */
    .paywall-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      z-index: 200;
      display: none;
      align-items: center;
      justify-content: center;
    }
    .paywall-overlay.show { display: flex; }
    .paywall-modal {
      background: white;
      border-radius: 16px;
      padding: 32px;
      max-width: 420px;
      width: 90%;
      text-align: center;
    }
    .paywall-icon { font-size: 48px; margin-bottom: 16px; }
    .paywall-title { font-size: 22px; font-weight: 700; color: #1F2937; margin-bottom: 8px; }
    .paywall-text { font-size: 14px; color: #6B7280; margin-bottom: 24px; line-height: 1.5; }
    .paywall-credits { display: flex; justify-content: center; gap: 8px; margin-bottom: 24px; }
    .credits-stat { padding: 12px 20px; background: #F3F4F6; border-radius: 8px; }
    .credits-stat-label { font-size: 11px; color: #9CA3AF; text-transform: uppercase; }
    .credits-stat-value { font-size: 20px; font-weight: 700; color: #1F2937; }
    .paywall-btns { display: flex; flex-direction: column; gap: 12px; }
    .paywall-btn {
      padding: 14px 24px;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      text-decoration: none;
      display: block;
    }
    .paywall-btn-primary {
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      color: white;
      border: none;
    }
    .paywall-btn-secondary {
      background: white;
      color: #374151;
      border: 1px solid #E5E7EB;
    }
    .paywall-close { margin-top: 16px; font-size: 13px; color: #9CA3AF; cursor: pointer; }
    
    ${getUserMenuStyles()}
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
    <div id="credits-indicator" class="credits-indicator" onclick="window.location.href='/pricing'">
      <div class="credits-left">
        <span class="credits-label">Credits</span>
        <span id="credits-display" class="credits-value">--</span>
      </div>
      <button class="credits-add" onclick="event.stopPropagation(); window.location.href='/pricing'">+ Add</button>
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
      ${getUserMenuHTML(user)}
    </header>
    
    <!-- Paywall Modal -->
    <div id="paywall-modal" class="paywall-overlay">
      <div class="paywall-modal">
        <div class="paywall-icon">💳</div>
        <h2 class="paywall-title">Need More Credits</h2>
        <p class="paywall-text" id="paywall-text">You need credits to generate product photos.</p>
        <div class="paywall-credits">
          <div class="credits-stat">
            <div class="credits-stat-label">Required</div>
            <div class="credits-stat-value" id="paywall-required">10</div>
          </div>
          <div class="credits-stat">
            <div class="credits-stat-label">You Have</div>
            <div class="credits-stat-value" id="paywall-current">${user?.credits_balance || 0}</div>
          </div>
        </div>
        <div class="paywall-btns">
          <a href="/pricing" class="paywall-btn paywall-btn-primary">Get Credits</a>
          <button onclick="closePaywall()" class="paywall-btn paywall-btn-secondary">Maybe Later</button>
        </div>
      </div>
    </div>

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
            <div class="q-detail">Nano Banana · ~25s</div>
          </button>
          <button class="quality-btn active" data-model="nano" onclick="selectModel('nano')">
            <div class="q-label">Better</div>
            <div class="q-detail">Nano Banana Pro · ~36s</div>
          </button>
        </div>
        <div id="nano-warning" class="nano-warning">
          ⚠️ Nano Banana Pro is in high demand. If you see errors, try <strong>Cheaper</strong> and come back later.
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
    let currentUser = ${user ? JSON.stringify({ id: user.id, email: user.email, name: user.name, credits_balance: user.credits_balance }) : 'null'};

    // User Menu Functions
    function toggleUserMenu() {
      const menu = document.getElementById('userDropdown');
      if (menu) menu.classList.toggle('show');
    }
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      const dropdown = document.getElementById('userDropdown');
      const userBtn = e.target.closest('.user-btn');
      if (dropdown && !userBtn) dropdown.classList.remove('show');
    });
    
    async function logout() {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/login';
      } catch (e) {
        console.error('Logout failed:', e);
      }
    }
    
    // Paywall Functions
    function showPaywall(required = 10) {
      const modal = document.getElementById('paywall-modal');
      const reqEl = document.getElementById('paywall-required');
      const curEl = document.getElementById('paywall-current');
      const textEl = document.getElementById('paywall-text');
      
      if (reqEl) reqEl.textContent = required;
      if (curEl) curEl.textContent = currentUser?.credits_balance || 0;
      if (textEl) {
        if (!currentUser) {
          textEl.textContent = 'Sign up free to get 10 credits and start generating!';
        } else {
          textEl.textContent = 'You need ' + required + ' credits to generate product photos.';
        }
      }
      if (modal) modal.classList.add('show');
    }
    
    function closePaywall() {
      const modal = document.getElementById('paywall-modal');
      if (modal) modal.classList.remove('show');
    }
    
    // Check if user has enough credits
    function hasCredits(required = 10) {
      if (!currentUser) return false;
      return currentUser.credits_balance >= required;
    }
    
    // Update credits indicator style based on balance
    function updateCreditsIndicatorStyle(balance) {
      const indicator = document.getElementById('credits-indicator');
      if (!indicator) return;
      indicator.classList.remove('low', 'empty');
      if (balance === 0) {
        indicator.classList.add('empty');
      } else if (balance < 10) {
        indicator.classList.add('low');
      }
    }

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
      // Show warning for Nano Banana Pro (preview model with rate limits)
      const warning = document.getElementById('nano-warning');
      if (warning) {
        warning.classList.toggle('show', model === 'nano');
      }
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
        } else if (data.needsAuth) {
          // Redirect to login
          window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
        } else if (data.needsUpgrade) {
          // Show paywall modal
          showPaywallModal(data.required, data.current);
        } else {
          showError(data.error || 'Upload failed');
        }
      } catch (e) { 
        console.error('Upload failed:', e);
        showError('Upload failed. Please try again.');
      }
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

      // Generate variations
      const startTime = Date.now();
      
      // Nano Pro: run 3 at a time to balance speed vs rate limits
      // Flash: run all 10 in parallel (higher rate limits)
      if (selectedModel === 'nano') {
        // Batch of 3 for Nano Pro
        const batchSize = 3;
        for (let b = 1; b < variationDefs.length; b += batchSize) {
          const batch = [];
          for (let i = b; i < Math.min(b + batchSize, variationDefs.length); i++) {
            batch.push(generateSingle(i, startTime));
          }
          await Promise.allSettled(batch);
        }
      } else {
        // Parallel execution for Flash (faster model, higher rate limits)
        const promises = [];
        for (let i = 1; i < variationDefs.length; i++) {
          promises.push(generateSingle(i, startTime));
        }
        await Promise.allSettled(promises);
      }
      
      // Complete session and deduct credits
      try {
        const completeRes = await fetch('/api/sessions/' + currentSessionId + '/complete', {
          method: 'POST'
        });
        const completeData = await completeRes.json();
        if (completeData.success) {
          console.log('Generation complete. Credits charged:', completeData.credits_charged, 'New balance:', completeData.new_balance);
        }
        loadSessions();
        updateCreditsDisplay(); // Update the sidebar credits indicator
      } catch (e) {
        console.error('Failed to complete session:', e);
      }
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
        console.log('[Generate] Sending request for variation', index, 'with model:', selectedModel);
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
        console.log('[Generate] Response for variation', index, ':', data.success ? 'SUCCESS' : 'FAILED', data.error || '');
        const card = document.getElementById('card-' + index);
        
        if (data.success && data.image) {
          lightboxImages[index] = { src: data.image, label: v.label };
          card.innerHTML = '<img src="' + data.image + '" onclick="openLightbox(' + index + ')">' +
            '<div class="card-overlay">' +
              '<button onclick="event.stopPropagation(); regenerate(' + index + ')">🔄</button>' +
              '<button onclick="event.stopPropagation(); downloadImage(' + index + ')">⬇️</button>' +
            '</div>' +
            '<div class="card-label">' + v.label + '</div>';
          // Update credits display after each successful generation
          if (data.credits_remaining !== undefined) {
            document.getElementById('credits-display').textContent = data.credits_remaining;
            updateCreditsIndicatorStyle(data.credits_remaining);
          }
        } else if (data.needsUpgrade) {
          // Out of credits mid-generation
          card.innerHTML = '<div style="width:100%; aspect-ratio:1; background:#FEF3C7; border-radius:6px; display:flex; align-items:center; justify-content:center; color:#92400E; cursor:pointer" onclick="window.location.href=\\'/pricing\\'">💳 Need Credits</div>' +
            '<div class="card-label">' + v.label + '</div>';
          showPaywallModal(data.required, data.current);
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
        '<div class="card-progress"><div class="card-progress-bar" id="progress-' + index + '" style="width:0%"></div></div>' +
        '<div class="card-label">' + v.label + '</div>';
      
      // Animate progress
      let progress = 0;
      const progressBar = document.getElementById('progress-' + index);
      const interval = setInterval(() => {
        progress = Math.min(95, progress + 2);
        if (progressBar) progressBar.style.width = progress + '%';
      }, 500);

      try {
        // Use regenerate endpoint (costs 1 credit)
        const res = await fetch('/api/regenerate/' + currentSessionId + '/' + (index - 1), {
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
        
        if (data.needsAuth) {
          window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
          return;
        }
        
        if (data.needsUpgrade) {
          showPaywallModal(data.required, data.current);
          // Restore previous image
          if (lightboxImages[index]) {
            card.innerHTML = '<img src="' + lightboxImages[index].src + '" onclick="openLightbox(' + index + ')">' +
              '<div class="card-overlay">' +
                '<button onclick="event.stopPropagation(); regenerate(' + index + ')">🔄</button>' +
                '<button onclick="event.stopPropagation(); downloadImage(' + index + ')">⬇️</button>' +
              '</div>' +
              '<div class="card-label">' + v.label + '</div>';
          }
          return;
        }
        
        if (data.success && data.image) {
          lightboxImages[index] = { src: data.image, label: v.label };
          card.innerHTML = '<img src="' + data.image + '" onclick="openLightbox(' + index + ')">' +
            '<div class="card-overlay">' +
              '<button onclick="event.stopPropagation(); regenerate(' + index + ')">🔄</button>' +
              '<button onclick="event.stopPropagation(); downloadImage(' + index + ')">⬇️</button>' +
            '</div>' +
            '<div class="card-label">' + v.label + '</div>';
          updateCreditsDisplay(); // Update credits after regeneration
        } else {
          card.innerHTML = '<div class="card-error">❌</div>' +
            '<div class="card-label">' + v.label + '</div>';
          showError(data.error || 'Regeneration failed');
        }
      } catch (e) {
        clearInterval(interval);
        console.error('Regeneration failed:', e);
        card.innerHTML = '<div class="card-error">❌</div>' +
          '<div class="card-label">' + v.label + '</div>';
        showError('Regeneration failed. Please try again.');
      }
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

    // Fetch and update credits display
    async function updateCreditsDisplay() {
      try {
        const res = await fetch('/api/credits/balance');
        const data = await res.json();
        const indicator = document.getElementById('credits-indicator');
        const display = document.getElementById('credits-display');
        
        if (data.success) {
          const balance = data.balance;
          display.textContent = balance;
          
          // Update indicator style based on balance
          indicator.classList.remove('low', 'empty');
          if (balance === 0) {
            indicator.classList.add('empty');
          } else if (balance < 10) {
            indicator.classList.add('low');
          }
        } else {
          // Not logged in - show login prompt
          display.textContent = '0';
          indicator.classList.add('empty');
          indicator.onclick = () => window.location.href = '/login';
        }
      } catch (e) {
        console.error('Failed to fetch credits:', e);
      }
    }

    // Init
    document.addEventListener('DOMContentLoaded', () => {
      loadSessions();
      updateCreditsDisplay();
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
function getResultsPage(sessionId: string, user?: User) {
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

// ============================================================================
// LOGIN PAGE
// ============================================================================
function getLoginPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login - ShopShot</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'><stop offset='0%25' style='stop-color:%233B82F6'/><stop offset='100%25' style='stop-color:%238B5CF6'/></linearGradient></defs><rect width='100' height='100' rx='22' fill='url(%23g)'/><circle cx='50' cy='50' r='28' fill='none' stroke='white' stroke-width='6'/><circle cx='50' cy='50' r='12' fill='white'/></svg>">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { font-family: 'Inter', system-ui, sans-serif; }
    ${getAuthPageStyles()}
  </style>
</head>
<body>
  <div class="auth-container">
    <div class="auth-card">
      <div class="auth-logo">
        <div class="auth-logo-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" width="24" height="24">
            <circle cx="12" cy="12" r="10"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </div>
        <span class="auth-logo-text">ShopShot</span>
      </div>
      
      <h1 class="auth-title">Welcome Back</h1>
      <p class="auth-subtitle">Log in to continue generating product photos</p>
      
      <div id="error-msg" class="auth-error"></div>
      
      <form class="auth-form" onsubmit="handleLogin(event)">
        <div class="form-group">
          <label class="form-label">Email</label>
          <input type="email" id="email" class="form-input" placeholder="you@example.com" required>
        </div>
        <div class="form-group">
          <label class="form-label">Password</label>
          <input type="password" id="password" class="form-input" placeholder="Enter your password" required>
        </div>
        <button type="submit" id="submit-btn" class="auth-btn">Log In</button>
      </form>
      
      <p class="auth-footer">
        Don't have an account? <a href="/register">Sign up free</a>
      </p>
    </div>
  </div>

  <script>
    async function handleLogin(e) {
      e.preventDefault();
      const btn = document.getElementById('submit-btn');
      const errEl = document.getElementById('error-msg');
      
      btn.disabled = true;
      btn.textContent = 'Logging in...';
      errEl.classList.remove('show');
      
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: document.getElementById('email').value,
            password: document.getElementById('password').value
          })
        });
        
        const data = await res.json();
        
        if (data.success) {
          window.location.href = '/';
        } else {
          errEl.textContent = data.error || 'Login failed';
          errEl.classList.add('show');
          btn.disabled = false;
          btn.textContent = 'Log In';
        }
      } catch (err) {
        errEl.textContent = 'Something went wrong. Please try again.';
        errEl.classList.add('show');
        btn.disabled = false;
        btn.textContent = 'Log In';
      }
    }
  </script>
</body>
</html>`
}

// ============================================================================
// REGISTER PAGE
// ============================================================================
function getRegisterPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sign Up - ShopShot</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'><stop offset='0%25' style='stop-color:%233B82F6'/><stop offset='100%25' style='stop-color:%238B5CF6'/></linearGradient></defs><rect width='100' height='100' rx='22' fill='url(%23g)'/><circle cx='50' cy='50' r='28' fill='none' stroke='white' stroke-width='6'/><circle cx='50' cy='50' r='12' fill='white'/></svg>">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { font-family: 'Inter', system-ui, sans-serif; }
    ${getAuthPageStyles()}
    .bonus-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 6px 12px;
      background: linear-gradient(135deg, #F0FDF4 0%, #DCFCE7 100%);
      border: 1px solid #BBF7D0;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      color: #166534;
      margin-top: 12px;
    }
  </style>
</head>
<body>
  <div class="auth-container">
    <div class="auth-card">
      <div class="auth-logo">
        <div class="auth-logo-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" width="24" height="24">
            <circle cx="12" cy="12" r="10"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        </div>
        <span class="auth-logo-text">ShopShot</span>
      </div>
      
      <h1 class="auth-title">Create Account</h1>
      <p class="auth-subtitle">Start generating professional product photos</p>
      <div style="text-align:center;">
        <span class="bonus-badge">🎁 Get ${CREDITS.SIGNUP_BONUS} free credits on signup!</span>
      </div>
      
      <div id="error-msg" class="auth-error" style="margin-top:16px;"></div>
      
      <form class="auth-form" onsubmit="handleRegister(event)" style="margin-top:20px;">
        <div class="form-group">
          <label class="form-label">Name (optional)</label>
          <input type="text" id="name" class="form-input" placeholder="Your name">
        </div>
        <div class="form-group">
          <label class="form-label">Email</label>
          <input type="email" id="email" class="form-input" placeholder="you@example.com" required>
        </div>
        <div class="form-group">
          <label class="form-label">Password</label>
          <input type="password" id="password" class="form-input" placeholder="At least 6 characters" required minlength="6">
        </div>
        <button type="submit" id="submit-btn" class="auth-btn">Create Account</button>
      </form>
      
      <p class="auth-footer">
        Already have an account? <a href="/login">Log in</a>
      </p>
    </div>
  </div>

  <script>
    async function handleRegister(e) {
      e.preventDefault();
      const btn = document.getElementById('submit-btn');
      const errEl = document.getElementById('error-msg');
      
      btn.disabled = true;
      btn.textContent = 'Creating account...';
      errEl.classList.remove('show');
      
      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: document.getElementById('name').value || null,
            email: document.getElementById('email').value,
            password: document.getElementById('password').value
          })
        });
        
        const data = await res.json();
        
        if (data.success) {
          window.location.href = '/?welcome=1';
        } else {
          errEl.textContent = data.error || 'Registration failed';
          errEl.classList.add('show');
          btn.disabled = false;
          btn.textContent = 'Create Account';
        }
      } catch (err) {
        errEl.textContent = 'Something went wrong. Please try again.';
        errEl.classList.add('show');
        btn.disabled = false;
        btn.textContent = 'Create Account';
      }
    }
  </script>
</body>
</html>`
}

// ============================================================================
// PRICING PAGE
// ============================================================================
function getPricingPage(user?: User) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pricing - ShopShot</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'><stop offset='0%25' style='stop-color:%233B82F6'/><stop offset='100%25' style='stop-color:%238B5CF6'/></linearGradient></defs><rect width='100' height='100' rx='22' fill='url(%23g)'/><circle cx='50' cy='50' r='28' fill='none' stroke='white' stroke-width='6'/><circle cx='50' cy='50' r='12' fill='white'/></svg>">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { font-family: 'Inter', system-ui, sans-serif; }
    body { background: linear-gradient(135deg, #F0F9FF 0%, #E0E7FF 100%); min-height: 100vh; }
    .pricing-container { max-width: 900px; margin: 0 auto; padding: 48px 24px; }
    .pricing-header { text-align: center; margin-bottom: 48px; }
    .pricing-title { font-size: 36px; font-weight: 700; color: #1F2937; margin-bottom: 8px; }
    .pricing-subtitle { font-size: 16px; color: #6B7280; }
    .current-credits { display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px; background: #F3F4F6; border-radius: 20px; margin-top: 16px; }
    .pricing-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px; }
    .pricing-card {
      background: white;
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.05);
      position: relative;
    }
    .pricing-card.featured { border: 2px solid #3B82F6; }
    .featured-badge {
      position: absolute;
      top: -12px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      color: white;
      padding: 4px 16px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
    }
    .plan-name { font-size: 20px; font-weight: 700; color: #1F2937; margin-bottom: 8px; }
    .plan-price { font-size: 36px; font-weight: 700; color: #1F2937; margin-bottom: 4px; }
    .plan-period { font-size: 14px; color: #6B7280; margin-bottom: 16px; }
    .plan-credits { font-size: 16px; font-weight: 600; color: #3B82F6; margin-bottom: 20px; }
    .plan-features { list-style: none; padding: 0; margin-bottom: 24px; }
    .plan-features li { padding: 8px 0; color: #4B5563; font-size: 14px; display: flex; align-items: center; gap: 8px; }
    .plan-features li::before { content: '✓'; color: #10B981; font-weight: bold; }
    .plan-btn {
      width: 100%;
      padding: 14px;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      border: none;
    }
    .plan-btn-primary { background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%); color: white; }
    .plan-btn-secondary { background: white; color: #374151; border: 1px solid #E5E7EB; }
    .plan-btn:hover { opacity: 0.9; transform: translateY(-1px); }
    .plan-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
    .back-link { display: inline-flex; align-items: center; gap: 4px; color: #6B7280; text-decoration: none; margin-bottom: 24px; }
    .back-link:hover { color: #374151; }
  </style>
</head>
<body>
  <div class="pricing-container">
    <a href="/" class="back-link">← Back to ShopShot</a>
    
    <div class="pricing-header">
      <h1 class="pricing-title">Simple, Credit-Based Pricing</h1>
      <p class="pricing-subtitle">Pay only for what you use. No hidden fees.</p>
      ${user ? `<div class="current-credits">💳 You have <strong>${user.credits_balance}</strong> credits</div>` : ''}
    </div>
    
    <div class="pricing-grid">
      <!-- Free Tier -->
      <div class="pricing-card">
        <div class="plan-name">Free</div>
        <div class="plan-price">£0</div>
        <div class="plan-period">to get started</div>
        <div class="plan-credits">${CREDITS.SIGNUP_BONUS} credits on signup</div>
        <ul class="plan-features">
          <li>1 full product shoot (10 images)</li>
          <li>Both AI models available</li>
          <li>Download in high quality</li>
          <li>No credit card required</li>
        </ul>
        ${user ? '<button class="plan-btn plan-btn-secondary" disabled>Your Current Plan</button>' : '<a href="/register" class="plan-btn plan-btn-secondary" style="text-decoration:none;display:block;text-align:center;">Sign Up Free</a>'}
      </div>
      
      <!-- Pro Subscription -->
      <div class="pricing-card featured">
        <div class="featured-badge">Most Popular</div>
        <div class="plan-name">Pro Monthly</div>
        <div class="plan-price">£${PRICING.SUBSCRIPTION}</div>
        <div class="plan-period">per month</div>
        <div class="plan-credits">${CREDITS.SUBSCRIPTION_MONTHLY} credits/month</div>
        <ul class="plan-features">
          <li>30 full product shoots</li>
          <li>Credits roll over</li>
          <li>Priority generation</li>
          <li>Cancel anytime</li>
        </ul>
        <button class="plan-btn plan-btn-primary" onclick="startCheckout('subscription')" ${!user ? 'disabled title="Please sign up first"' : ''}>
          ${user?.subscription_status === 'active' ? 'Current Plan' : 'Subscribe Now'}
        </button>
      </div>
      
      <!-- Credit Pack -->
      <div class="pricing-card">
        <div class="plan-name">Credit Pack</div>
        <div class="plan-price">£${PRICING.TOPUP}</div>
        <div class="plan-period">one-time</div>
        <div class="plan-credits">${CREDITS.TOPUP_PACK} credits</div>
        <ul class="plan-features">
          <li>30 full product shoots</li>
          <li>Never expires</li>
          <li>Stack with subscription</li>
          <li>Use anytime</li>
        </ul>
        <button class="plan-btn plan-btn-secondary" onclick="startCheckout('topup')" ${!user ? 'disabled title="Please sign up first"' : ''}>
          Buy Credits
        </button>
      </div>
    </div>
    
    <div style="text-align:center;margin-top:48px;color:#6B7280;font-size:14px;">
      <p><strong>How credits work:</strong> 10 credits = 1 full product shoot (10 AI-generated images)</p>
      <p>1 credit = 1 single image regeneration</p>
    </div>
  </div>

  <script>
    async function startCheckout(type) {
      ${!user ? 'window.location.href = "/register"; return;' : ''}
      try {
        const btn = event.target;
        btn.disabled = true;
        btn.textContent = 'Loading...';
        
        const res = await fetch('/api/billing/create-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type })
        });
        
        const data = await res.json();
        if (data.success && data.url) {
          window.location.href = data.url;
        } else {
          alert(data.error || 'Failed to start checkout');
          btn.disabled = false;
          btn.textContent = type === 'subscription' ? 'Subscribe Now' : 'Buy Credits';
        }
      } catch (err) {
        alert('Something went wrong');
        location.reload();
      }
    }
  </script>
</body>
</html>`
}

// ============================================================================
// DASHBOARD PAGE
// ============================================================================
function getDashboardPage(user: User) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard - ShopShot</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'><stop offset='0%25' style='stop-color:%233B82F6'/><stop offset='100%25' style='stop-color:%238B5CF6'/></linearGradient></defs><rect width='100' height='100' rx='22' fill='url(%23g)'/><circle cx='50' cy='50' r='28' fill='none' stroke='white' stroke-width='6'/><circle cx='50' cy='50' r='12' fill='white'/></svg>">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { font-family: 'Inter', system-ui, sans-serif; }
    body { background: #F9FAFB; min-height: 100vh; }
    .dashboard { max-width: 900px; margin: 0 auto; padding: 32px 24px; }
    .dash-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; }
    .dash-title { font-size: 28px; font-weight: 700; color: #1F2937; }
    .dash-nav { display: flex; gap: 12px; }
    .dash-nav a { padding: 8px 16px; background: white; border: 1px solid #E5E7EB; border-radius: 8px; color: #374151; text-decoration: none; font-size: 13px; font-weight: 500; }
    .dash-nav a:hover { background: #F3F4F6; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 32px; }
    .stat-card { background: white; border-radius: 12px; padding: 20px; border: 1px solid #E5E7EB; }
    .stat-label { font-size: 13px; color: #6B7280; margin-bottom: 4px; }
    .stat-value { font-size: 28px; font-weight: 700; color: #1F2937; }
    .stat-sub { font-size: 12px; color: #9CA3AF; margin-top: 4px; }
    .section-title { font-size: 18px; font-weight: 600; color: #1F2937; margin-bottom: 16px; }
    .history-list { background: white; border-radius: 12px; border: 1px solid #E5E7EB; overflow: hidden; }
    .history-item { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid #F3F4F6; }
    .history-item:last-child { border-bottom: none; }
    .history-info { display: flex; align-items: center; gap: 12px; }
    .history-icon { width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 18px; }
    .history-icon.positive { background: #DCFCE7; }
    .history-icon.negative { background: #FEE2E2; }
    .history-text { font-size: 14px; color: #374151; }
    .history-date { font-size: 12px; color: #9CA3AF; }
    .history-amount { font-size: 14px; font-weight: 600; }
    .history-amount.positive { color: #059669; }
    .history-amount.negative { color: #DC2626; }
    .empty-state { padding: 48px; text-align: center; color: #9CA3AF; }
    .action-btn {
      padding: 12px 24px;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="dashboard">
    <div class="dash-header">
      <h1 class="dash-title">Dashboard</h1>
      <div class="dash-nav">
        <a href="/">← Back to Generator</a>
        <a href="/account">Account</a>
      </div>
    </div>
    
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Credits Balance</div>
        <div class="stat-value">${user.credits_balance}</div>
        <div class="stat-sub">${Math.floor(user.credits_balance / 10)} full shoots remaining</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Plan</div>
        <div class="stat-value">${user.subscription_plan === 'pro' ? 'Pro' : 'Free'}</div>
        <div class="stat-sub">${user.subscription_status === 'active' ? 'Active subscription' : 'No subscription'}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Quick Action</div>
        <a href="/pricing" class="action-btn" style="display:inline-block;margin-top:8px;">Get More Credits</a>
      </div>
    </div>
    
    <h2 class="section-title">Credit History</h2>
    <div class="history-list" id="history-list">
      <div class="empty-state">Loading...</div>
    </div>
  </div>

  <script>
    async function loadHistory() {
      try {
        const res = await fetch('/api/credits/history');
        const data = await res.json();
        const list = document.getElementById('history-list');
        
        if (!data.success || !data.transactions?.length) {
          list.innerHTML = '<div class="empty-state">No credit transactions yet</div>';
          return;
        }
        
        list.innerHTML = data.transactions.map(t => {
          const isPositive = t.amount > 0;
          const icon = isPositive ? '➕' : '➖';
          const date = new Date(t.created_at).toLocaleDateString();
          return \`
            <div class="history-item">
              <div class="history-info">
                <div class="history-icon \${isPositive ? 'positive' : 'negative'}">\${icon}</div>
                <div>
                  <div class="history-text">\${t.description || t.type}</div>
                  <div class="history-date">\${date}</div>
                </div>
              </div>
              <div class="history-amount \${isPositive ? 'positive' : 'negative'}">
                \${isPositive ? '+' : ''}\${t.amount}
              </div>
            </div>
          \`;
        }).join('');
      } catch (e) {
        console.error('Load history failed:', e);
      }
    }
    loadHistory();
  </script>
</body>
</html>`
}

// ============================================================================
// ACCOUNT PAGE
// ============================================================================
function getAccountPage(user: User) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Account - ShopShot</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'><stop offset='0%25' style='stop-color:%233B82F6'/><stop offset='100%25' style='stop-color:%238B5CF6'/></linearGradient></defs><rect width='100' height='100' rx='22' fill='url(%23g)'/><circle cx='50' cy='50' r='28' fill='none' stroke='white' stroke-width='6'/><circle cx='50' cy='50' r='12' fill='white'/></svg>">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { font-family: 'Inter', system-ui, sans-serif; }
    body { background: #F9FAFB; min-height: 100vh; }
    .account { max-width: 600px; margin: 0 auto; padding: 32px 24px; }
    .account-header { margin-bottom: 32px; }
    .account-title { font-size: 28px; font-weight: 700; color: #1F2937; margin-bottom: 8px; }
    .account-nav { display: flex; gap: 12px; margin-top: 16px; }
    .account-nav a { padding: 8px 16px; background: white; border: 1px solid #E5E7EB; border-radius: 8px; color: #374151; text-decoration: none; font-size: 13px; }
    .section { background: white; border-radius: 12px; border: 1px solid #E5E7EB; padding: 24px; margin-bottom: 24px; }
    .section-title { font-size: 16px; font-weight: 600; color: #1F2937; margin-bottom: 16px; }
    .info-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #F3F4F6; }
    .info-row:last-child { border-bottom: none; }
    .info-label { color: #6B7280; font-size: 14px; }
    .info-value { color: #1F2937; font-size: 14px; font-weight: 500; }
    .btn { padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
    .btn-primary { background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%); color: white; border: none; }
    .btn-secondary { background: white; color: #374151; border: 1px solid #E5E7EB; }
    .btn-danger { background: #FEF2F2; color: #DC2626; border: 1px solid #FECACA; }
    .btn:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="account">
    <div class="account-header">
      <h1 class="account-title">Account Settings</h1>
      <div class="account-nav">
        <a href="/">← Back to Generator</a>
        <a href="/dashboard">Dashboard</a>
      </div>
    </div>
    
    <div class="section">
      <h2 class="section-title">Profile</h2>
      <div class="info-row">
        <span class="info-label">Email</span>
        <span class="info-value">${user.email}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Name</span>
        <span class="info-value">${user.name || 'Not set'}</span>
      </div>
    </div>
    
    <div class="section">
      <h2 class="section-title">Subscription</h2>
      <div class="info-row">
        <span class="info-label">Plan</span>
        <span class="info-value">${user.subscription_plan === 'pro' ? 'Pro' : 'Free'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Status</span>
        <span class="info-value">${user.subscription_status}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Credits</span>
        <span class="info-value">${user.credits_balance}</span>
      </div>
      <div style="margin-top:16px;display:flex;gap:12px;">
        <a href="/pricing" class="btn btn-primary" style="text-decoration:none;">Get More Credits</a>
        ${user.stripe_customer_id ? '<button class="btn btn-secondary" onclick="openBillingPortal()">Manage Billing</button>' : ''}
      </div>
    </div>
    
    <div class="section">
      <h2 class="section-title">Account Actions</h2>
      <div style="display:flex;gap:12px;">
        <button class="btn btn-secondary" onclick="logout()">Log Out</button>
      </div>
    </div>
  </div>

  <script>
    async function logout() {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    }
    
    async function openBillingPortal() {
      try {
        const res = await fetch('/api/billing/portal');
        const data = await res.json();
        if (data.success && data.url) {
          window.location.href = data.url;
        } else {
          alert(data.error || 'Failed to open billing portal');
        }
      } catch (e) {
        alert('Something went wrong');
      }
    }
  </script>
</body>
</html>`
}

export default app
