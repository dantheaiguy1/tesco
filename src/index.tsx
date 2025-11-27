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
  cheaper_credits: number;    // Flash/Nano Banana credits
  better_credits: number;     // Pro/Nano Banana Pro credits
  subscription_status: 'free' | 'active' | 'canceled' | 'past_due';
  subscription_plan: 'free' | 'standard' | 'pro';
  stripe_customer_id: string | null;
}

type Variables = {
  user?: User;
}

// ============================================================================
// DUAL CREDIT SYSTEM CONFIGURATION
// ============================================================================
// Two types of credits:
// - CHEAPER: For Flash model (Nano Banana) - £0.031/credit API cost
// - BETTER: For Pro model (Nano Banana Pro) - £0.107/credit API cost

const CREDITS = {
  // Signup bonus (free tier)
  SIGNUP_CHEAPER: 10,         // Free cheaper credits on registration
  SIGNUP_BETTER: 5,           // Free better credits on registration
  
  // Per-image costs (always 1 credit of the appropriate type)
  PER_IMAGE: 1,
  
  // Subscription allocations
  STANDARD_CHEAPER: 500,      // Standard plan: 500 cheaper credits/month
  STANDARD_BETTER: 45,        // Standard plan: 45 better credits/month
  PRO_CHEAPER: 300,           // Pro plan: 300 cheaper credits/month
  PRO_BETTER: 175,            // Pro plan: 175 better credits/month
  
  // Credit pack amounts (for top-ups) - 100% margin pricing
  PACKS: {
    CHEAPER: {
      PACK_25: 400,           // £25 = 400 cheaper credits
      PACK_50: 800,           // £50 = 800 cheaper credits
      PACK_75: 1200,          // £75 = 1200 cheaper credits
      PACK_100: 1600,         // £100 = 1600 cheaper credits
    },
    BETTER: {
      PACK_25: 115,           // £25 = 115 better credits
      PACK_50: 230,           // £50 = 230 better credits
      PACK_75: 350,           // £75 = 350 better credits
      PACK_100: 465,          // £100 = 465 better credits
    }
  }
}

const PRICING = {
  // Subscriptions (monthly)
  STANDARD: 39.99,            // £39.99/month - 500 cheaper + 45 better
  PRO: 59.99,                 // £59.99/month - 300 cheaper + 175 better
  
  // Credit packs
  PACK_25: 25.00,
  PACK_50: 50.00,
  PACK_75: 75.00,
  PACK_100: 100.00,
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
  nano: { name: 'Pro', speed: '~10-30s per image', quality: 'Best (Beta)', totalTime: '~2-5 minutes' },
  flash: { name: 'Standard', speed: '~2-3s per image', quality: 'Amazing', totalTime: '~25 seconds' }
};

// Default model - flash is faster and more reliable
const DEFAULT_MODEL = 'flash';

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
  // Handle both literal \n sequences and actual newline characters
  const pemContents = privateKey
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\\n/g, '')  // literal backslash-n from JSON-style strings
    .replace(/\n/g, '')   // actual newline characters
    .replace(/\r/g, '')   // carriage returns
    .replace(/\s/g, '');  // any remaining whitespace
  
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
  console.log('[getAccessToken] Creating JWT...');
  const jwt = await createJWT(clientEmail, privateKey);
  console.log('[getAccessToken] JWT created, length:', jwt.length);
  
  console.log('[getAccessToken] Fetching token from Google...');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });
  console.log('[getAccessToken] Response status:', response.status);

  if (!response.ok) {
    const error = await response.text();
    console.log('[getAccessToken] Error:', error);
    throw new Error(`Failed to get access token: ${error}`);
  }

  const data = await response.json() as { access_token: string };
  console.log('[getAccessToken] Token received, length:', data.access_token?.length);
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
      
      // Add timeout controller - model-specific timeout
      // Pro model (nano) needs longer timeout as it's slower
      const timeoutMs = modelKey === 'nano' ? 90000 : 60000;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: requestBody,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

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
      
      // Check if it was a timeout/abort
      if (err instanceof Error && err.name === 'AbortError') {
        lastError = 'Request timed out (60s). The model may be overloaded.';
        // Don't retry on timeout - just fail fast
        return { success: false, error: `Request timed out. Try the "Cheaper" option which uses a faster model. [Model: ${vertexModel}]` };
      }
      // Continue to retry for other errors
    }
  }
  
  // All retries exhausted
  return { success: false, error: `Generation failed after ${maxRetries} attempts. ${lastError} [Model: ${vertexModel}]` };
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
    cheaper_credits: session.cheaper_credits || 0,
    better_credits: session.better_credits || 0,
    subscription_status: session.subscription_status,
    subscription_plan: session.subscription_plan,
    stripe_customer_id: session.stripe_customer_id
  };
}

async function deleteUserSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare('DELETE FROM user_sessions WHERE id = ?').bind(sessionId).run();
}

// ============================================================================
// DUAL CREDIT MANAGEMENT
// ============================================================================
type CreditType = 'cheaper' | 'better';

async function deductCredits(
  db: D1Database, 
  userId: string, 
  amount: number,
  creditType: CreditType,
  type: string, 
  description: string,
  sessionId?: string,
  imageData?: string
): Promise<{ success: boolean; newBalance?: number; error?: string; transactionId?: string }> {
  const column = creditType === 'better' ? 'better_credits' : 'cheaper_credits';
  
  // Get current balance
  const user = await db.prepare(`SELECT ${column} as balance FROM users WHERE id = ?`).bind(userId).first() as any;
  if (!user) return { success: false, error: 'User not found' };
  
  if (user.balance < amount) {
    return { success: false, error: `Insufficient ${creditType} credits` };
  }
  
  const newBalance = user.balance - amount;
  const transactionId = generateId();
  
  // Update balance and log transaction
  await db.prepare(`UPDATE users SET ${column} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(newBalance, userId).run();
  
  await db.prepare(`
    INSERT INTO credit_transactions (id, user_id, amount, balance_after, credit_type, type, description, session_id, image_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(transactionId, userId, -amount, newBalance, creditType, type, description, sessionId || null, imageData || null).run();
  
  return { success: true, newBalance, transactionId };
}

async function addCredits(
  db: D1Database, 
  userId: string, 
  amount: number,
  creditType: CreditType,
  type: string, 
  description: string,
  stripePaymentId?: string
): Promise<{ success: boolean; newBalance?: number; error?: string }> {
  const column = creditType === 'better' ? 'better_credits' : 'cheaper_credits';
  
  const user = await db.prepare(`SELECT ${column} as balance FROM users WHERE id = ?`).bind(userId).first() as any;
  if (!user) return { success: false, error: 'User not found' };
  
  const newBalance = user.balance + amount;
  const transactionId = generateId();
  
  await db.prepare(`UPDATE users SET ${column} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(newBalance, userId).run();
  
  await db.prepare(`
    INSERT INTO credit_transactions (id, user_id, amount, balance_after, credit_type, type, description, stripe_payment_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(transactionId, userId, amount, newBalance, creditType, type, description, stripePaymentId || null).run();
  
  return { success: true, newBalance };
}

async function getCreditBalances(db: D1Database, userId: string): Promise<{ cheaper: number; better: number }> {
  const user = await db.prepare('SELECT cheaper_credits, better_credits FROM users WHERE id = ?').bind(userId).first() as any;
  return { 
    cheaper: user?.cheaper_credits || 0, 
    better: user?.better_credits || 0 
  };
}

// Helper to determine credit type from model
function getCreditTypeForModel(modelKey: string): CreditType {
  return modelKey === 'nano' ? 'better' : 'cheaper';
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
    
    // Migration: Add user_id column if it doesn't exist
    try {
      await db.prepare('ALTER TABLE sessions ADD COLUMN user_id TEXT').run();
    } catch (e) { /* Column already exists */ }
    
    // Migration: Add credits columns if they don't exist
    try {
      await db.prepare('ALTER TABLE sessions ADD COLUMN credits_charged INTEGER DEFAULT 0').run();
    } catch (e) { /* Column already exists */ }
    try {
      await db.prepare('ALTER TABLE sessions ADD COLUMN credits_refunded INTEGER DEFAULT 0').run();
    } catch (e) { /* Column already exists */ }
    try {
      await db.prepare('ALTER TABLE sessions ADD COLUMN generation_count INTEGER DEFAULT 0').run();
    } catch (e) { /* Column already exists */ }
    
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
    
    // Users table (dual credit system)
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT,
        cheaper_credits INTEGER NOT NULL DEFAULT 10,
        better_credits INTEGER NOT NULL DEFAULT 5,
        subscription_status TEXT NOT NULL DEFAULT 'free' CHECK (subscription_status IN ('free', 'active', 'canceled', 'past_due')),
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        subscription_plan TEXT NOT NULL DEFAULT 'free' CHECK (subscription_plan IN ('free', 'standard', 'pro')),
        billing_period_start DATETIME,
        billing_period_end DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run()
    
    // Migration: Add dual credit columns if they don't exist (for existing databases)
    try {
      await db.prepare('ALTER TABLE users ADD COLUMN cheaper_credits INTEGER NOT NULL DEFAULT 10').run();
    } catch (e) { /* Column exists */ }
    try {
      await db.prepare('ALTER TABLE users ADD COLUMN better_credits INTEGER NOT NULL DEFAULT 5').run();
    } catch (e) { /* Column exists */ }
    // Migrate old credits_balance to cheaper_credits if needed
    try {
      await db.prepare('UPDATE users SET cheaper_credits = credits_balance WHERE cheaper_credits = 10 AND credits_balance != 10').run();
    } catch (e) { /* Migration done */ }
    
    // Credit transactions table (dual credit system)
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS credit_transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        balance_after INTEGER NOT NULL,
        credit_type TEXT NOT NULL DEFAULT 'cheaper' CHECK (credit_type IN ('cheaper', 'better')),
        type TEXT NOT NULL CHECK (type IN ('signup_bonus', 'subscription', 'topup', 'generation', 'regeneration', 'refund')),
        description TEXT,
        session_id TEXT,
        stripe_payment_id TEXT,
        image_data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `).run()
    
    // Add columns if they don't exist (for existing databases)
    try {
      await db.prepare('ALTER TABLE credit_transactions ADD COLUMN image_data TEXT').run();
    } catch (e) { /* Column exists */ }
    try {
      await db.prepare('ALTER TABLE credit_transactions ADD COLUMN credit_type TEXT NOT NULL DEFAULT \'cheaper\'').run();
    } catch (e) { /* Column exists */ }
    
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

// Helper to require sufficient credits (uses total credits for backward compatibility)
async function requireCredits(c: any, amount: number): Promise<User | Response> {
  const user = c.get('user');
  if (!user) {
    return c.json({ success: false, error: 'Authentication required' }, 401);
  }
  const totalCredits = (user.cheaper_credits || 0) + (user.better_credits || 0);
  if (totalCredits < amount) {
    return c.json({ 
      success: false, 
      error: 'Insufficient credits',
      required: amount,
      current: totalCredits,
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
// Marketing homepage for logged-out users, app for logged-in
app.get('/', (c) => {
  const user = c.get('user')
  if (user) {
    // Logged in - show the app
    return c.html(getHomePage(user))
  }
  // Logged out - show marketing page
  return c.html(getMarketingPage())
})

// Direct app access (redirects to login if not authenticated)
app.get('/app', (c) => {
  const user = c.get('user')
  if (!user) {
    return c.redirect('/get-started?redirect=/app')
  }
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

// Get Started page (conversion-focused signup + login + value prop)
app.get('/get-started', (c) => {
  const user = c.get('user')
  if (user) return c.redirect('/')
  return c.html(getGetStartedPage())
})

// Logout page (GET for easy access)
app.get('/logout', async (c) => {
  deleteCookie(c, 'session', { path: '/' })
  return c.redirect('/login')
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
    if (!db) {
      return c.json({ success: false, error: 'Database not configured' }, 500)
    }
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
  } catch (error: any) {
    console.error('Error fetching sessions:', error)
    return c.json({ success: false, error: 'Failed to fetch sessions', details: error?.message || String(error) }, 500)
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
    
    // Create user with dual credits
    const userId = generateId();
    const passwordHash = await hashPassword(password);
    
    await db.prepare(`
      INSERT INTO users (id, email, password_hash, name, cheaper_credits, better_credits)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(userId, email.toLowerCase(), passwordHash, name || null, CREDITS.SIGNUP_CHEAPER, CREDITS.SIGNUP_BETTER).run();
    
    // Log signup bonus for cheaper credits
    await db.prepare(`
      INSERT INTO credit_transactions (id, user_id, amount, balance_after, credit_type, type, description)
      VALUES (?, ?, ?, ?, 'cheaper', 'signup_bonus', 'Welcome bonus - Recommended credits')
    `).bind(generateId(), userId, CREDITS.SIGNUP_CHEAPER, CREDITS.SIGNUP_CHEAPER).run();
    
    // Log signup bonus for better credits
    await db.prepare(`
      INSERT INTO credit_transactions (id, user_id, amount, balance_after, credit_type, type, description)
      VALUES (?, ?, ?, ?, 'better', 'signup_bonus', 'Welcome bonus - Premium credits')
    `).bind(generateId(), userId, CREDITS.SIGNUP_BETTER, CREDITS.SIGNUP_BETTER).run();
    
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
        cheaper_credits: CREDITS.SIGNUP_CHEAPER,
        better_credits: CREDITS.SIGNUP_BETTER,
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
      SELECT id, email, password_hash, name, cheaper_credits, better_credits, subscription_status, subscription_plan, stripe_customer_id
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
        cheaper_credits: user.cheaper_credits,
        better_credits: user.better_credits,
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

// Get credit balance (dual credits)
app.get('/api/credits/balance', async (c) => {
  const authResult = requireAuth(c);
  if (authResult instanceof Response) return authResult;
  const user = authResult;
  
  return c.json({ 
    success: true, 
    cheaper_credits: user.cheaper_credits,
    better_credits: user.better_credits,
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
  
  const { type, creditType, amount } = await c.req.json(); // 'subscription', 'topup', or 'pack'
  const db = c.env.TESCO_DB;
  
  if (!['subscription', 'topup', 'pack'].includes(type)) {
    return c.json({ success: false, error: 'Invalid checkout type' }, 400);
  }
  
  // Determine price ID based on type
  let priceId: string;
  let mode: 'subscription' | 'payment';
  
  if (type === 'subscription') {
    priceId = c.env.STRIPE_PRICE_ID_SUBSCRIPTION;
    mode = 'subscription';
  } else {
    // For 'topup' or 'pack', use the topup price ID
    priceId = c.env.STRIPE_PRICE_ID_TOPUP;
    mode = 'payment';
  }
  
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
          const planType = session.metadata?.plan_type || 'pro'; // 'standard' or 'pro'
          const creditPackType = session.metadata?.credit_type || 'cheaper'; // 'cheaper' or 'better'
          const packAmount = session.metadata?.pack_amount || '25'; // '25', '50', '75', '100'
          
          if (checkoutType === 'subscription') {
            // Add both types of credits for subscription
            const cheaperCredits = planType === 'pro' ? CREDITS.PRO_CHEAPER : CREDITS.STANDARD_CHEAPER;
            const betterCredits = planType === 'pro' ? CREDITS.PRO_BETTER : CREDITS.STANDARD_BETTER;
            
            await addCredits(db, userId, cheaperCredits, 'cheaper', 'subscription',
              `${planType === 'pro' ? 'Pro' : 'Standard'} subscription started - Standard credits`,
              session.id);
            await addCredits(db, userId, betterCredits, 'better', 'subscription',
              `${planType === 'pro' ? 'Pro' : 'Standard'} subscription started - Pro credits`,
              session.id);
            
            await db.prepare(`
              UPDATE users SET 
                subscription_status = 'active', 
                subscription_plan = ?,
                stripe_subscription_id = ?,
                updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `).bind(planType, session.subscription, userId).run();
          } else if (checkoutType === 'topup') {
            // Add credits for credit pack purchase
            const packKey = `PACK_${packAmount}` as keyof typeof CREDITS.PACKS.CHEAPER;
            const credits = creditPackType === 'better' 
              ? CREDITS.PACKS.BETTER[packKey]
              : CREDITS.PACKS.CHEAPER[packKey];
            
            await addCredits(db, userId, credits, creditPackType as 'cheaper' | 'better', 'topup',
              `£${packAmount} Credit Pack purchase - ${creditPackType === 'better' ? 'Pro' : 'Standard'} credits`,
              session.id);
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
            // Get user's subscription plan to determine credit amounts
            const user = await db.prepare('SELECT subscription_plan FROM users WHERE id = ?').bind(userId).first() as any;
            const planType = user?.subscription_plan || 'pro';
            
            const cheaperCredits = planType === 'pro' ? CREDITS.PRO_CHEAPER : CREDITS.STANDARD_CHEAPER;
            const betterCredits = planType === 'pro' ? CREDITS.PRO_BETTER : CREDITS.STANDARD_BETTER;
            
            await addCredits(db, userId, cheaperCredits, 'cheaper', 'subscription',
              'Monthly subscription renewal - Standard credits', invoice.id);
            await addCredits(db, userId, betterCredits, 'better', 'subscription',
              'Monthly subscription renewal - Pro credits', invoice.id);
            
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
    hasStripe: !!c.env.STRIPE_SECRET_KEY,
    stripeKeyLength: c.env.STRIPE_SECRET_KEY?.length || 0,
    envKeys: Object.keys(c.env).filter(k => !k.includes('KEY') && !k.includes('SECRET'))
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
    
    // Check authentication
    const user = c.get('user')
    if (!user) {
      return c.json({ success: false, error: 'Authentication required', needsAuth: true }, 401)
    }
    
    const formData = await c.req.formData()
    const file = formData.get('image') as File
    const thumbnail = formData.get('thumbnail') as string | null
    const model = (formData.get('model') as string) || DEFAULT_MODEL
    
    // Determine credit type and check balance
    const creditType = getCreditTypeForModel(model)
    const userCredits = creditType === 'better' ? user.better_credits : user.cheaper_credits
    const creditTypeName = creditType === 'better' ? 'Pro' : 'Standard'
    
    if (userCredits < CREDITS.PER_IMAGE) {
      return c.json({ 
        success: false, 
        error: `Insufficient ${creditTypeName} credits. You need at least 1 ${creditTypeName} credit to start.`,
        required: CREDITS.PER_IMAGE,
        current: userCredits,
        creditType,
        needsUpgrade: true
      }, 402)
    }
    
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
      creditType,
      cheaper_credits: user.cheaper_credits,
      better_credits: user.better_credits,
      credits_required: CREDITS.PER_IMAGE
    })
  } catch (error: any) {
    console.error('Upload error:', error)
    return c.json({ success: false, error: 'Failed to process upload', details: error?.message || String(error) }, 500)
  }
})

// ============================================================================
// ANONYMOUS UPLOAD FLOW - Progressive Disclosure for Conversion
// ============================================================================
// REMOVED: Anonymous upload, preview generation, and claim-session endpoints
// All users must sign up/login before uploading or generating images

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
    
    const body = await c.req.json()
    const { url, model: requestModel } = body
    const model = requestModel || DEFAULT_MODEL
    
    // Check credits based on selected model
    const creditType = getCreditTypeForModel(model)
    const userCredits = creditType === 'better' ? user.better_credits : user.cheaper_credits
    const creditTypeName = creditType === 'better' ? 'Pro' : 'Standard'
    
    if (userCredits < CREDITS.PER_IMAGE) {
      return c.json({ 
        success: false, 
        error: `Insufficient ${creditTypeName} credits. You need at least 1 ${creditTypeName} credit to start.`,
        required: CREDITS.PER_IMAGE,
        current: userCredits,
        creditType,
        needsUpgrade: true
      }, 402)
    }
    
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
      creditType,
      cheaper_credits: user.cheaper_credits,
      better_credits: user.better_credits,
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
    
    // Determine credit type based on model
    const creditType = getCreditTypeForModel(modelKey)
    const userCredits = creditType === 'better' ? user.better_credits : user.cheaper_credits
    const creditTypeName = creditType === 'better' ? 'Pro' : 'Standard'
    
    // Check if user has enough credits for the selected model
    if (userCredits < CREDITS.PER_IMAGE) {
      return c.json({ 
        success: false, 
        error: `Insufficient ${creditTypeName} credits`,
        required: CREDITS.PER_IMAGE,
        current: userCredits,
        creditType,
        needsUpgrade: true,
        field: variationDefinitions[variationIndex]?.field
      }, 402)
    }
    
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
    console.log(`[${variation.field}] Generating with ${modelInfo.name} (${modelKey}) using ${creditTypeName} credits...`)
    
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
    
    // SUCCESS: Deduct 1 credit for this image (and store the generated image)
    const creditResult = await deductCredits(
      db,
      user.id,
      CREDITS.PER_IMAGE,
      creditType,
      'generation',
      `Image: ${variation.label} (${creditTypeName})`,
      sessionId,
      result.image // Store the generated image with the transaction
    )
    
    // Update session stats
    await db.prepare('UPDATE sessions SET generation_count = generation_count + 1, credits_charged = credits_charged + 1 WHERE id = ?')
      .bind(sessionId).run()
    
    console.log(`[${variation.field}] Success! ${creditTypeName} credit deducted. New balance: ${creditResult.newBalance}${isCustom ? ' (Custom Prompt)' : ''} [${modelInfo.name}]`)
    return c.json({ 
      success: true, 
      field: variation.field, 
      label: variation.label,
      image: result.image,
      elapsed,
      isCustom,
      model: modelKey,
      modelName: modelInfo.name,
      creditType,
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
  
  // Check authentication
  const user = c.get('user')
  if (!user) {
    return c.json({ success: false, error: 'Authentication required', needsAuth: true }, 401)
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
    
    // Determine credit type based on model
    const creditType = getCreditTypeForModel(modelKey)
    const userCredits = creditType === 'better' ? user.better_credits : user.cheaper_credits
    const creditTypeName = creditType === 'better' ? 'Pro' : 'Standard'
    
    // Check credits for selected model
    if (userCredits < CREDITS.PER_IMAGE) {
      return c.json({ 
        success: false, 
        error: `Insufficient ${creditTypeName} credits for regeneration`,
        required: CREDITS.PER_IMAGE,
        current: userCredits,
        creditType,
        needsUpgrade: true
      }, 402)
    }
    
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
    
    // Deduct 1 credit for regeneration (and store the generated image)
    const creditResult = await deductCredits(
      db, 
      user.id, 
      CREDITS.PER_IMAGE,
      creditType,
      'regeneration',
      `Regenerate ${variation.label}: ${productName} (${creditTypeName})`,
      sessionId,
      result.image // Store the generated image with the transaction
    )
    
    return c.json({ 
      success: true, 
      field: variation.field, 
      label: variation.label,
      image: result.image,
      elapsed,
      model: modelKey,
      modelName: modelInfo.name,
      creditType,
      credits_charged: CREDITS.PER_IMAGE,
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

// User menu HTML for header (now minimal)
function getUserMenuHTML(user: User | undefined): string {
  // Header is now minimal - auth is in sidebar
  return '';
}

// Sidebar user section HTML
function getSidebarUserHTML(user: User | undefined): string {
  if (user) {
    return `
      <div class="sidebar-user-section">
        <div class="sidebar-user-info" onclick="toggleSidebarUserMenu()">
          <div class="sidebar-user-avatar">${(user.name || user.email)[0].toUpperCase()}</div>
          <div class="sidebar-user-details">
            <div class="sidebar-user-name">${user.name || 'User'}</div>
            <div class="sidebar-user-email">${user.email}</div>
          </div>
        </div>
        <div class="sidebar-user-menu" id="sidebarUserMenu">
          <a href="/dashboard" class="sidebar-menu-item">📊 Dashboard</a>
          <a href="/pricing" class="sidebar-menu-item">💰 Buy Credits</a>
          <a href="/account" class="sidebar-menu-item">⚙️ Account</a>
          <a href="/logout" class="sidebar-menu-item logout">🚪 Logout</a>
        </div>
      </div>
    `;
  } else {
    return `
      <div class="sidebar-user-section">
        <div class="sidebar-auth-buttons">
          <a href="/login" class="sidebar-auth-btn sidebar-login-btn">Log In</a>
          <a href="/register" class="sidebar-auth-btn sidebar-signup-btn">Sign Up Free</a>
        </div>
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

// ============================================================================
// MARKETING HOMEPAGE - Sells the app to new visitors
// ============================================================================
function getMarketingPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ShopShot - Turn Any Product Photo Into Professional Shots in Seconds</title>
  <meta name="description" content="AI-powered product photography. Upload any photo, get 10 professional variations in 36 seconds. Perfect for eBay, Etsy, Amazon sellers.">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'><stop offset='0%25' style='stop-color:%233B82F6'/><stop offset='100%25' style='stop-color:%238B5CF6'/></linearGradient></defs><rect width='100' height='100' rx='22' fill='url(%23g)'/><circle cx='50' cy='50' r='28' fill='none' stroke='white' stroke-width='6'/><circle cx='50' cy='50' r='12' fill='white'/></svg>">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { font-family: 'Inter', system-ui, sans-serif; box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      background: #FAFBFC;
      color: #1F2937;
      overflow-x: hidden;
    }
    
    /* Navigation */
    .nav {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 100;
      padding: 16px 32px;
      background: rgba(255,255,255,0.9);
      backdrop-filter: blur(20px);
      border-bottom: 1px solid rgba(229,231,235,0.5);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .nav-logo {
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
    }
    .nav-logo-icon {
      width: 40px;
      height: 40px;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .nav-logo-icon svg { width: 22px; height: 22px; }
    .nav-logo-text { font-size: 24px; font-weight: 800; color: #1F2937; }
    .nav-links { display: flex; align-items: center; gap: 32px; }
    .nav-link { color: #6B7280; text-decoration: none; font-size: 15px; font-weight: 500; transition: color 0.2s; }
    .nav-link:hover { color: #1F2937; }
    .nav-cta {
      padding: 10px 20px;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      color: white;
      text-decoration: none;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      transition: all 0.2s;
    }
    .nav-cta:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(139, 92, 246, 0.3); }
    
    /* Hero Section */
    .hero {
      position: relative;
      padding: 160px 32px 100px;
      text-align: center;
      overflow: hidden;
      min-height: 90vh;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .hero::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-image: url('https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=1920&q=80');
      background-size: cover;
      background-position: center;
      z-index: 0;
    }
    .hero::after {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: linear-gradient(180deg, 
        rgba(255,255,255,0.93) 0%, 
        rgba(255,255,255,0.88) 50%,
        rgba(255,255,255,0.95) 100%);
      z-index: 1;
    }
    .hero > * {
      position: relative;
      z-index: 2;
    }
    .hero-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      background: rgba(255,255,255,0.95);
      border: 1px solid #C7D2FE;
      border-radius: 100px;
      font-size: 13px;
      font-weight: 600;
      color: #4338CA;
      margin-bottom: 28px;
      box-shadow: 0 4px 20px rgba(99, 102, 241, 0.15);
    }
    .hero-badge svg { width: 16px; height: 16px; }
    .hero h1 {
      font-size: clamp(42px, 6vw, 68px);
      font-weight: 900;
      line-height: 1.08;
      max-width: 950px;
      margin: 0 auto 24px;
      color: #1F2937;
    }
    .hero-highlight {
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .hero p {
      font-size: 21px;
      color: #4B5563;
      max-width: 650px;
      margin: 0 auto 44px;
      line-height: 1.7;
    }
    .hero-ctas {
      display: flex;
      justify-content: center;
      gap: 16px;
      margin-bottom: 48px;
    }
    .btn-primary {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 16px 32px;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      color: white;
      text-decoration: none;
      border-radius: 14px;
      font-size: 16px;
      font-weight: 600;
      transition: all 0.2s;
      box-shadow: 0 4px 20px rgba(99, 102, 241, 0.3);
    }
    .btn-primary:hover { transform: translateY(-3px); box-shadow: 0 8px 30px rgba(99, 102, 241, 0.4); }
    .btn-secondary {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 16px 32px;
      background: white;
      color: #374151;
      text-decoration: none;
      border-radius: 14px;
      font-size: 16px;
      font-weight: 600;
      border: 1px solid #E5E7EB;
      transition: all 0.2s;
    }
    .btn-secondary:hover { border-color: #8B5CF6; color: #7C3AED; }
    
    /* Demo Showcase */
    .hero-showcase {
      max-width: 1100px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 32px;
      padding: 20px;
    }
    @media (max-width: 900px) { 
      .hero-showcase { flex-direction: column; gap: 24px; }
    }
    .showcase-before {
      background: white;
      border-radius: 20px;
      padding: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.12);
      text-align: center;
      flex: 0 0 280px;
    }
    .showcase-before-img {
      width: 240px;
      height: 240px;
      background: linear-gradient(135deg, #F3F4F6 0%, #E5E7EB 100%);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 80px;
      margin-bottom: 12px;
    }
    .showcase-before-label {
      font-size: 14px;
      font-weight: 600;
      color: #6B7280;
    }
    .showcase-arrow {
      font-size: 48px;
      color: #8B5CF6;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.1); opacity: 0.8; }
    }
    @media (max-width: 900px) { 
      .showcase-arrow { transform: rotate(90deg); }
    }
    .showcase-after {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
      flex: 0 0 400px;
    }
    @media (max-width: 900px) { 
      .showcase-after { flex: 0 0 auto; }
    }
    .showcase-result {
      background: white;
      border-radius: 16px;
      padding: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.1);
      text-align: center;
      transition: all 0.3s;
    }
    .showcase-result:hover {
      transform: translateY(-4px);
      box-shadow: 0 15px 50px rgba(0,0,0,0.15);
    }
    .showcase-result-img {
      width: 100%;
      aspect-ratio: 1;
      background: linear-gradient(135deg, #EEF2FF 0%, #E0E7FF 100%);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 48px;
      margin-bottom: 8px;
    }
    .showcase-result-label {
      font-size: 11px;
      font-weight: 600;
      color: #6B7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    /* Stats Bar */
    .stats-bar {
      display: flex;
      justify-content: center;
      gap: 64px;
      padding: 48px 32px;
      background: white;
      border-top: 1px solid #E5E7EB;
      border-bottom: 1px solid #E5E7EB;
    }
    .stat-item { text-align: center; }
    .stat-value { font-size: 42px; font-weight: 800; color: #1F2937; }
    .stat-value span { 
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .stat-label { font-size: 14px; color: #6B7280; margin-top: 4px; }
    
    /* Section Styles */
    .section {
      padding: 100px 32px;
    }
    .section-dark {
      background: linear-gradient(135deg, #1F2937 0%, #111827 100%);
      color: white;
    }
    .section-header {
      text-align: center;
      max-width: 700px;
      margin: 0 auto 64px;
    }
    .section-badge {
      display: inline-block;
      padding: 6px 14px;
      background: rgba(99, 102, 241, 0.1);
      border-radius: 100px;
      font-size: 12px;
      font-weight: 600;
      color: #6366F1;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 16px;
    }
    .section-dark .section-badge { background: rgba(255,255,255,0.1); color: #A5B4FC; }
    .section-title {
      font-size: 40px;
      font-weight: 800;
      margin-bottom: 16px;
    }
    .section-subtitle {
      font-size: 18px;
      color: #6B7280;
      line-height: 1.6;
    }
    .section-dark .section-subtitle { color: #9CA3AF; }
    
    /* Features Grid */
    .features-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 32px;
      max-width: 1200px;
      margin: 0 auto;
    }
    @media (max-width: 900px) { .features-grid { grid-template-columns: 1fr; } }
    .feature-card {
      background: white;
      border: 1px solid #E5E7EB;
      border-radius: 20px;
      padding: 32px;
      transition: all 0.3s;
    }
    .feature-card:hover {
      transform: translateY(-8px);
      box-shadow: 0 20px 40px rgba(0,0,0,0.08);
      border-color: #C7D2FE;
    }
    .feature-icon {
      width: 56px;
      height: 56px;
      background: linear-gradient(135deg, #EEF2FF 0%, #E0E7FF 100%);
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      margin-bottom: 20px;
    }
    .feature-card h3 { font-size: 20px; font-weight: 700; margin-bottom: 10px; }
    .feature-card p { font-size: 15px; color: #6B7280; line-height: 1.6; }
    
    /* How It Works */
    .steps {
      display: flex;
      justify-content: center;
      gap: 48px;
      max-width: 1000px;
      margin: 0 auto;
    }
    @media (max-width: 768px) { .steps { flex-direction: column; align-items: center; } }
    .step {
      flex: 1;
      max-width: 280px;
      text-align: center;
    }
    .step-number {
      width: 64px;
      height: 64px;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      font-weight: 800;
      color: white;
      margin: 0 auto 20px;
    }
    .step h3 { font-size: 20px; font-weight: 700; margin-bottom: 10px; color: white; }
    .step p { font-size: 15px; color: #9CA3AF; line-height: 1.6; }
    
    /* Use Cases */
    .use-cases {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 24px;
      max-width: 1100px;
      margin: 0 auto;
    }
    @media (max-width: 900px) { .use-cases { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 500px) { .use-cases { grid-template-columns: 1fr; } }
    .use-case {
      background: white;
      border: 1px solid #E5E7EB;
      border-radius: 16px;
      padding: 28px 20px;
      text-align: center;
      transition: all 0.3s;
    }
    .use-case:hover { transform: translateY(-4px); box-shadow: 0 12px 30px rgba(0,0,0,0.08); }
    .use-case-icon {
      width: 48px;
      height: 48px;
      background: linear-gradient(135deg, #F3E8FF 0%, #E9D5FF 100%);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      margin: 0 auto 14px;
    }
    .use-case h4 { font-size: 15px; font-weight: 600; color: #1F2937; }
    
    /* Before/After */
    .before-after {
      display: flex;
      justify-content: center;
      gap: 48px;
      max-width: 900px;
      margin: 0 auto;
      align-items: center;
    }
    @media (max-width: 768px) { .before-after { flex-direction: column; gap: 32px; } }
    .ba-item {
      flex: 1;
      background: white;
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 10px 40px rgba(0,0,0,0.1);
    }
    .ba-image {
      height: 280px;
      background: #F3F4F6;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 64px;
    }
    .ba-label {
      padding: 20px;
      text-align: center;
      font-size: 16px;
      font-weight: 600;
    }
    .ba-arrow {
      font-size: 48px;
      color: #8B5CF6;
    }
    
    /* Pricing Preview */
    .pricing-preview {
      display: flex;
      justify-content: center;
      gap: 32px;
      max-width: 900px;
      margin: 0 auto;
    }
    @media (max-width: 768px) { .pricing-preview { flex-direction: column; align-items: center; } }
    .pricing-card {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 20px;
      padding: 36px;
      width: 280px;
      text-align: center;
      transition: all 0.3s;
    }
    .pricing-card:hover { background: rgba(255,255,255,0.08); transform: translateY(-4px); }
    .pricing-card.featured {
      background: rgba(139, 92, 246, 0.15);
      border-color: rgba(139, 92, 246, 0.3);
      transform: scale(1.05);
    }
    .pricing-card h3 { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
    .pricing-card .price { font-size: 48px; font-weight: 800; margin-bottom: 8px; }
    .pricing-card .price span { font-size: 18px; font-weight: 500; opacity: 0.7; }
    .pricing-card .credits { font-size: 14px; opacity: 0.7; margin-bottom: 24px; }
    .pricing-card .btn-primary { width: 100%; justify-content: center; }
    
    /* Final CTA */
    .final-cta {
      text-align: center;
      padding: 100px 32px;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      color: white;
    }
    .final-cta h2 { font-size: 44px; font-weight: 800; margin-bottom: 16px; }
    .final-cta p { font-size: 20px; opacity: 0.9; margin-bottom: 40px; max-width: 600px; margin-left: auto; margin-right: auto; }
    .final-cta .btn-primary {
      background: white;
      color: #7C3AED;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
    }
    .final-cta .btn-primary:hover { box-shadow: 0 8px 30px rgba(0,0,0,0.3); }
    
    /* Footer */
    .footer {
      padding: 48px 32px;
      background: #111827;
      color: #9CA3AF;
      text-align: center;
    }
    .footer-logo { display: flex; align-items: center; justify-content: center; gap: 10px; margin-bottom: 16px; }
    .footer-logo-icon {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .footer-logo-text { font-size: 20px; font-weight: 700; color: white; }
    .footer p { font-size: 14px; }
    .footer-links { margin-top: 16px; display: flex; justify-content: center; gap: 24px; }
    .footer-links a { color: #9CA3AF; text-decoration: none; font-size: 14px; }
    .footer-links a:hover { color: white; }
  </style>
</head>
<body>
  <!-- Navigation -->
  <nav class="nav">
    <a href="/" class="nav-logo">
      <div class="nav-logo-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      </div>
      <span class="nav-logo-text">ShopShot</span>
    </a>
    <div class="nav-links">
      <a href="#features" class="nav-link">Features</a>
      <a href="#how-it-works" class="nav-link">How It Works</a>
      <a href="#pricing" class="nav-link">Pricing</a>
      <a href="/login" class="nav-link">Log In</a>
      <a href="/app" class="nav-cta">Try Free</a>
    </div>
  </nav>

  <!-- Hero Section -->
  <section class="hero">
    <div class="hero-badge">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
      AI-Powered Product Photography
    </div>
    <h1>Turn Any Product Photo Into <span class="hero-highlight">10 Professional Shots</span> in Seconds</h1>
    <p>Upload a single photo. Get hero shots, lifestyle images, flat-lays, and more. No photography skills needed. Perfect for online sellers.</p>
    <div class="hero-ctas">
      <a href="/app" class="btn-primary">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        Start Free - 15 Credits
      </a>
      <a href="#how-it-works" class="btn-secondary">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor"/></svg>
        See How It Works
      </a>
    </div>
    
    <!-- Before/After Showcase -->
    <div class="hero-showcase">
      <div class="showcase-before">
        <div class="showcase-before-img">📱</div>
        <div class="showcase-before-label">Your phone snap</div>
      </div>
      <div class="showcase-arrow">→</div>
      <div class="showcase-after">
        <div class="showcase-result">
          <div class="showcase-result-img">🌟</div>
          <div class="showcase-result-label">Hero Shot</div>
        </div>
        <div class="showcase-result">
          <div class="showcase-result-img">🏠</div>
          <div class="showcase-result-label">Lifestyle</div>
        </div>
        <div class="showcase-result">
          <div class="showcase-result-img">📐</div>
          <div class="showcase-result-label">Flat Lay</div>
        </div>
        <div class="showcase-result">
          <div class="showcase-result-img">🔍</div>
          <div class="showcase-result-label">Detail</div>
        </div>
      </div>
    </div>
  </section>

  <!-- Stats Bar -->
  <div class="stats-bar">
    <div class="stat-item">
      <div class="stat-value"><span>10</span></div>
      <div class="stat-label">Variations per upload</div>
    </div>
    <div class="stat-item">
      <div class="stat-value"><span>36</span>s</div>
      <div class="stat-label">Average generation time</div>
    </div>
    <div class="stat-item">
      <div class="stat-value"><span>15</span></div>
      <div class="stat-label">Free credits on signup</div>
    </div>
  </div>

  <!-- Features Section -->
  <section class="section" id="features">
    <div class="section-header">
      <div class="section-badge">Features</div>
      <h2 class="section-title">Everything You Need for Better Product Photos</h2>
      <p class="section-subtitle">Professional results without the professional price tag. Our AI handles the hard work.</p>
    </div>
    
    <div class="features-grid">
      <div class="feature-card">
        <div class="feature-icon">📸</div>
        <h3>10 Unique Variations</h3>
        <p>Hero shots, lifestyle contexts, flat-lays, macro details, and more from a single upload.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">⚡</div>
        <h3>Lightning Fast</h3>
        <p>Get all 10 professional variations in about 36 seconds. Faster than making a cup of coffee.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">🎯</div>
        <h3>Works With Any Photo</h3>
        <p>Crumpled background? Bad lighting? No problem. Our AI extracts and enhances your product.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">🖼️</div>
        <h3>High Resolution</h3>
        <p>Download print-ready images perfect for marketplaces, websites, and social media.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">🔄</div>
        <h3>Regenerate Anytime</h3>
        <p>Not happy with a result? Regenerate individual images or the entire set with one click.</p>
      </div>
      <div class="feature-card">
        <div class="feature-icon">📦</div>
        <h3>Bulk Download</h3>
        <p>Download all variations as a ZIP file. Ready to upload to your store in seconds.</p>
      </div>
    </div>
  </section>

  <!-- How It Works -->
  <section class="section section-dark" id="how-it-works">
    <div class="section-header">
      <div class="section-badge">How It Works</div>
      <h2 class="section-title">Three Simple Steps</h2>
      <p class="section-subtitle">From phone snap to professional product photography in under a minute.</p>
    </div>
    
    <div class="steps">
      <div class="step">
        <div class="step-number">1</div>
        <h3>Upload Any Photo</h3>
        <p>Take a quick snap with your phone or upload an existing image. Any quality works.</p>
      </div>
      <div class="step">
        <div class="step-number">2</div>
        <h3>AI Does the Magic</h3>
        <p>Our AI extracts your product and generates 10 professional variations automatically.</p>
      </div>
      <div class="step">
        <div class="step-number">3</div>
        <h3>Download & Sell</h3>
        <p>Download your images and upload them to eBay, Etsy, Amazon, or anywhere you sell.</p>
      </div>
    </div>
  </section>

  <!-- Use Cases -->
  <section class="section">
    <div class="section-header">
      <div class="section-badge">Use Cases</div>
      <h2 class="section-title">Perfect for Every Seller</h2>
      <p class="section-subtitle">Whether you're selling one item or thousands, ShopShot scales with you.</p>
    </div>
    
    <div class="use-cases">
      <div class="use-case">
        <div class="use-case-icon">🛒</div>
        <h4>eBay Sellers</h4>
      </div>
      <div class="use-case">
        <div class="use-case-icon">🎨</div>
        <h4>Etsy Shops</h4>
      </div>
      <div class="use-case">
        <div class="use-case-icon">📦</div>
        <h4>Amazon FBA</h4>
      </div>
      <div class="use-case">
        <div class="use-case-icon">👗</div>
        <h4>Depop & Vinted</h4>
      </div>
      <div class="use-case">
        <div class="use-case-icon">📱</div>
        <h4>Social Commerce</h4>
      </div>
    </div>
  </section>

  <!-- Pricing Preview -->
  <section class="section section-dark" id="pricing">
    <div class="section-header">
      <div class="section-badge">Pricing</div>
      <h2 class="section-title">Simple, Honest Pricing</h2>
      <p class="section-subtitle">Start free. Upgrade when you're ready. No hidden fees.</p>
    </div>
    
    <div class="pricing-preview">
      <div class="pricing-card">
        <h3>Free</h3>
        <div class="price">£0</div>
        <div class="credits">${CREDITS.SIGNUP_CHEAPER + CREDITS.SIGNUP_BETTER} credits on signup</div>
        <a href="/register?plan=free" class="btn-primary">Get Started</a>
      </div>
      <div class="pricing-card featured">
        <h3>Standard</h3>
        <div class="price">£${PRICING.STANDARD}<span>/mo</span></div>
        <div class="credits">${CREDITS.STANDARD_CHEAPER + CREDITS.STANDARD_BETTER} credits/month</div>
        <a href="/register?plan=standard" class="btn-primary">Get Standard</a>
      </div>
      <div class="pricing-card">
        <h3>Pro</h3>
        <div class="price">£${PRICING.PRO}<span>/mo</span></div>
        <div class="credits">${CREDITS.PRO_CHEAPER + CREDITS.PRO_BETTER} credits/month</div>
        <a href="/register?plan=pro" class="btn-primary">Get Pro</a>
      </div>
    </div>
  </section>

  <!-- Final CTA -->
  <section class="final-cta">
    <h2>Ready to Transform Your Product Photos?</h2>
    <p>Join thousands of sellers using ShopShot to create scroll-stopping product images.</p>
    <a href="/app" class="btn-primary">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      Start Free - No Credit Card
    </a>
  </section>

  <!-- Footer -->
  <footer class="footer">
    <div class="footer-logo">
      <div class="footer-logo-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" width="18" height="18">
          <circle cx="12" cy="12" r="10"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      </div>
      <span class="footer-logo-text">ShopShot</span>
    </div>
    <p>AI-powered product photography for online sellers.</p>
    <div class="footer-links">
      <a href="/get-started">Pricing</a>
      <a href="/login">Log In</a>
      <a href="mailto:support@shopshot.ai">Support</a>
    </div>
    <p style="margin-top: 24px; opacity: 0.6;">© 2024 ShopShot. All rights reserved.</p>
  </footer>

  <script>
    // Smooth scroll for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  </script>
</body>
</html>`
}

function getHomePage(user?: User) {
  const isLoggedIn = !!user;
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
    
    /* Guest mode (logged out) - hide sidebar, center content */
    body.guest-mode .sidebar { display: none; }
    body.guest-mode .main-content { margin-left: 0; }
    body.guest-mode .upload-container { max-width: 520px; }
    body.guest-mode .header { display: none; }
    
    /* Guest header with login/signup */
    .guest-header {
      display: ${isLoggedIn ? 'none' : 'flex'};
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 100;
      padding: 16px 24px;
      background: rgba(255,255,255,0.8);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid rgba(229,231,235,0.5);
      justify-content: space-between;
      align-items: center;
    }
    body.guest-mode .main-content { padding-top: 80px; }
    .guest-logo {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .guest-logo-icon {
      width: 36px;
      height: 36px;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .guest-logo-icon svg { width: 20px; height: 20px; color: white; }
    .guest-logo-text { font-size: 20px; font-weight: 700; color: #1F2937; }
    .guest-auth-btns { display: flex; gap: 10px; }
    .guest-login-btn {
      padding: 10px 20px;
      font-size: 14px;
      font-weight: 500;
      color: #374151;
      border: 1px solid #E5E7EB;
      border-radius: 8px;
      text-decoration: none;
      transition: all 0.2s;
    }
    .guest-login-btn:hover { background: #F9FAFB; }
    .guest-signup-btn {
      padding: 10px 20px;
      font-size: 14px;
      font-weight: 600;
      color: white;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      border-radius: 8px;
      text-decoration: none;
      transition: all 0.2s;
    }
    .guest-signup-btn:hover { opacity: 0.9; transform: translateY(-1px); }
    
    /* Free credits banner for guests */
    .free-credits-banner-inline {
      display: ${isLoggedIn ? 'none' : 'flex'};
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px 20px;
      background: linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%);
      border: 1px solid #6EE7B7;
      border-radius: 10px;
      margin-bottom: 20px;
    }
    .free-credits-banner-inline span {
      font-size: 14px;
      color: #065F46;
      font-weight: 500;
    }
    .free-credits-banner-inline strong {
      font-weight: 700;
    }
    
    /* Sidebar - ElevenLabs style */
    .sidebar {
      position: fixed;
      left: 0;
      top: 0;
      bottom: 0;
      width: 200px;
      background: white;
      border-right: 1px solid #E5E7EB;
      z-index: 30;
      display: flex;
      flex-direction: column;
    }
    .sidebar-logo {
      padding: 16px;
      display: flex;
      align-items: center;
      gap: 10px;
      border-bottom: 1px solid #E5E7EB;
    }
    .sidebar-logo-icon {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .sidebar-logo-icon svg { width: 18px; height: 18px; color: white; }
    .sidebar-logo-text { font-size: 18px; font-weight: 700; color: #1F2937; }
    .sidebar-header {
      padding: 12px;
    }
    .new-btn {
      width: 100%;
      height: 40px;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: all 0.2s;
    }
    .new-btn:hover { opacity: 0.9; transform: translateY(-1px); }
    .sidebar-section-label {
      font-size: 10px;
      font-weight: 600;
      color: #9CA3AF;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 12px 12px 6px;
    }
    
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
    
    /* User section in sidebar */
    .sidebar-user-section {
      padding: 12px;
      border-top: 1px solid #E5E7EB;
    }
    .sidebar-auth-buttons {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .sidebar-auth-btn {
      display: block;
      padding: 10px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      text-decoration: none;
      text-align: center;
      transition: all 0.2s;
    }
    .sidebar-login-btn {
      color: #374151;
      border: 1px solid #E5E7EB;
      background: white;
    }
    .sidebar-login-btn:hover { background: #F9FAFB; }
    .sidebar-signup-btn {
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      color: white;
      border: none;
    }
    .sidebar-signup-btn:hover { opacity: 0.9; }
    .sidebar-user-info {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .sidebar-user-info:hover { background: #F3F4F6; }
    .sidebar-user-avatar {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 600;
      font-size: 13px;
      flex-shrink: 0;
    }
    .sidebar-user-details { flex: 1; min-width: 0; }
    .sidebar-user-name {
      font-size: 13px;
      font-weight: 600;
      color: #1F2937;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sidebar-user-email {
      font-size: 11px;
      color: #9CA3AF;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sidebar-user-menu {
      display: none;
      flex-direction: column;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid #E5E7EB;
    }
    .sidebar-user-menu.show { display: flex; }
    .sidebar-menu-item {
      display: block;
      padding: 8px 12px;
      font-size: 12px;
      color: #374151;
      text-decoration: none;
      border-radius: 6px;
      transition: background 0.15s;
    }
    .sidebar-menu-item:hover { background: #F3F4F6; }
    .sidebar-menu-item.logout { color: #DC2626; }
    .sidebar-menu-item.logout:hover { background: #FEF2F2; }
    
    /* Credits section in sidebar */
    .credits-indicator {
      margin: 0 12px 12px;
      padding: 12px;
      background: #F9FAFB;
      border: 1px solid #E5E7EB;
      border-radius: 10px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .credits-indicator:hover {
      border-color: #9CA3AF;
      box-shadow: 0 2px 8px rgba(0,0,0,0.05);
    }
    .credits-indicator.empty {
      border-color: #FCA5A5;
      background: #FEF2F2;
    }
    .credits-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .credits-title {
      font-size: 10px;
      font-weight: 600;
      color: #6B7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .credits-add {
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      color: white;
      border: none;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 9px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .credits-add:hover { opacity: 0.9; }
    .credits-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }
    .credit-item {
      background: white;
      border-radius: 6px;
      padding: 6px;
      text-align: center;
    }
    .credit-item.standard { background: linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%); }
    .credit-item.pro { background: linear-gradient(135deg, #F3E8FF 0%, #E9D5FF 100%); }
    .credit-item-label {
      font-size: 8px;
      color: #6B7280;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .credit-item-value {
      font-size: 14px;
      font-weight: 800;
    }
    .credit-item-value.standard { color: #059669; }
    .credit-item-value.pro { color: #6D28D9; }
    .credit-item-icon {
      font-size: 9px;
    }
    
    /* Main content */
    .main-content {
      margin-left: 200px;
      min-height: 100vh;
      background: radial-gradient(circle at 50% 30%, rgba(225, 245, 254, 1) 0%, rgba(243, 232, 255, 1) 50%, rgba(237, 233, 254, 1) 100%);
      position: relative;
      overflow: hidden;
    }
    
    /* 3D Decorative Shapes */
    .deco-shape {
      position: absolute;
      pointer-events: none;
      z-index: 0;
      opacity: 0.6;
    }
    .deco-cube {
      width: 80px;
      height: 80px;
      background: linear-gradient(135deg, #60A5FA 0%, #3B82F6 100%);
      border-radius: 16px;
      top: 12%;
      left: 6%;
      transform: rotate(-15deg);
      box-shadow: 
        0 12px 36px rgba(59, 130, 246, 0.25),
        inset 0 -4px 8px rgba(0,0,0,0.1),
        inset 0 4px 8px rgba(255,255,255,0.4);
    }
    .deco-triangle {
      width: 0;
      height: 0;
      border-left: 28px solid transparent;
      border-right: 28px solid transparent;
      border-bottom: 48px solid #A78BFA;
      top: 20%;
      right: 10%;
      transform: rotate(15deg);
      filter: drop-shadow(0 10px 20px rgba(167, 139, 250, 0.35));
    }
    .deco-iso-cube {
      width: 100px;
      height: 100px;
      top: 55%;
      right: 4%;
      background: linear-gradient(135deg, #93C5FD 0%, #60A5FA 50%, #3B82F6 100%);
      clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
      box-shadow: 0 16px 40px rgba(59, 130, 246, 0.3);
    }
    
    /* Header - minimal, no auth buttons */
    .header {
      height: 50px;
      background: transparent;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding: 0 24px;
    }
    .logo { display: none; }
    .hamburger { display: none; }
    
    /* Upload area - centered, compact premium */
    .upload-container {
      max-width: 560px;
      margin: 0 auto;
      padding: 40px 24px;
      position: relative;
      z-index: 1;
    }
    .upload-header {
      margin-bottom: 20px;
      text-align: center;
    }
    .upload-header h1 {
      font-size: 32px;
      font-weight: 700;
      color: #1F2937;
      margin-bottom: 6px;
      letter-spacing: -0.01em;
    }
    .upload-header p {
      font-size: 14px;
      color: #6B7280;
    }
    
    /* Upload zone - glassmorphism */
    .upload-zone {
      width: 100%;
      min-height: 180px;
      background: rgba(255, 255, 255, 0.7);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 2px dashed rgba(147, 197, 253, 0.5);
      border-radius: 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.3s ease;
      box-shadow: 0 6px 24px rgba(59, 130, 246, 0.1);
      padding: 24px;
    }
    .upload-zone:hover {
      border-color: rgba(59, 130, 246, 0.8);
      background: rgba(255, 255, 255, 0.85);
      box-shadow: 0 8px 32px rgba(59, 130, 246, 0.2);
      transform: translateY(-2px);
    }
    .upload-zone.dragover {
      border-color: #3B82F6;
      background: rgba(239, 246, 255, 0.9);
      transform: scale(1.01);
    }
    .upload-icon {
      width: 56px;
      height: 56px;
      margin-bottom: 12px;
      background: linear-gradient(135deg, #60A5FA 0%, #3B82F6 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 
        0 8px 24px rgba(59, 130, 246, 0.3),
        inset 0 -2px 6px rgba(0,0,0,0.1),
        inset 0 2px 6px rgba(255,255,255,0.5);
    }
    .upload-icon svg {
      width: 24px;
      height: 24px;
      color: white;
    }
    .upload-primary {
      font-size: 15px;
      font-weight: 600;
      color: #1F2937;
      margin-bottom: 4px;
    }
    .upload-secondary {
      font-size: 12px;
      color: #6B7280;
    }
    .upload-formats {
      font-size: 11px;
      color: #9CA3AF;
      margin-top: 10px;
    }
    
    /* Image preview */
    .image-preview {
      text-align: center;
      padding: 24px;
      background: rgba(255, 255, 255, 0.9);
      border-radius: 16px;
      border: 1px solid rgba(147, 197, 253, 0.3);
    }
    .image-preview img {
      max-width: 320px;
      max-height: 240px;
      border-radius: 12px;
      margin-bottom: 16px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.1);
    }
    .change-image {
      font-size: 14px;
      color: #6366F1;
      cursor: pointer;
      font-weight: 500;
    }
    .change-image:hover { text-decoration: underline; }
    
    /* Quality selector - compact button style */
    .quality-section {
      margin-top: 20px;
    }
    .quality-label {
      font-size: 12px;
      font-weight: 600;
      color: #6B7280;
      margin-bottom: 10px;
      text-align: center;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .quality-options {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .quality-btn {
      position: relative;
      padding: 16px 20px;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s ease;
      text-align: center;
      overflow: hidden;
    }
    /* Standard button - blue gradient */
    .quality-btn[data-model="flash"] {
      background: linear-gradient(135deg, #60A5FA 0%, #3B82F6 100%);
      box-shadow: 0 4px 16px rgba(59, 130, 246, 0.3);
    }
    .quality-btn[data-model="flash"]:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 24px rgba(59, 130, 246, 0.4);
    }
    /* Pro button - gold/orange gradient */
    .quality-btn[data-model="nano"] {
      background: linear-gradient(135deg, #FBBF24 0%, #F59E0B 50%, #F97316 100%);
      box-shadow: 0 4px 16px rgba(245, 158, 11, 0.3);
    }
    .quality-btn[data-model="nano"]:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 24px rgba(245, 158, 11, 0.4);
    }
    /* Active state - ring indicator */
    .quality-btn.active {
      outline: 2px solid rgba(255,255,255,0.9);
      outline-offset: 2px;
    }
    .quality-btn .q-label,
    .quality-btn .q-detail { color: white; }
    .q-label {
      font-size: 15px;
      font-weight: 700;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .q-detail {
      font-size: 11px;
      opacity: 0.9;
      line-height: 1.4;
    }
    .q-credits {
      display: none;
    }
    .q-price {
      display: none;
    }
    .q-price-period {
      display: none;
    }
    .model-credit-info {
      margin-top: 12px;
      padding: 10px 16px;
      background: rgba(255, 255, 255, 0.8);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(147, 197, 253, 0.4);
      border-radius: 8px;
      font-size: 12px;
      color: #374151;
      text-align: center;
    }
    .model-credit-info.standard {
      background: rgba(236, 253, 245, 0.8);
      border-color: rgba(110, 231, 183, 0.5);
      color: #065F46;
    }
    .model-credit-info.pro {
      background: rgba(254, 243, 199, 0.8);
      border-color: rgba(251, 191, 36, 0.5);
      color: #92400E;
    }
    .nano-warning {
      margin-top: 8px;
      padding: 10px 16px;
      background: rgba(254, 243, 199, 0.9);
      border: 1px solid #F59E0B;
      border-radius: 8px;
      font-size: 11px;
      color: #92400E;
      text-align: center;
      display: none;
      line-height: 1.5;
    }
    .nano-warning.show { display: block; animation: pulse 2s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.85; } }
    
    /* Advanced mode link */
    .advanced-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      margin-top: 12px;
      font-size: 12px;
      color: #6366F1;
      cursor: pointer;
      width: 100%;
      text-align: center;
    }
    .advanced-link:hover { text-decoration: underline; }
    
    /* Generate button - purple gradient */
    .generate-btn {
      display: block;
      width: 100%;
      margin: 16px auto 0;
      padding: 14px 32px;
      background: linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%);
      color: white;
      border: none;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(139, 92, 246, 0.35);
      transition: all 0.2s ease;
    }
    .generate-btn:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 6px 24px rgba(139, 92, 246, 0.45);
    }
    .generate-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }
    
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
    
    /* Locked cards (anonymous preview) */
    .image-card.locked {
      cursor: pointer;
    }
    .image-card.locked:hover {
      transform: scale(1.02);
    }
    .locked-placeholder {
      width: 100%;
      aspect-ratio: 1;
      background: linear-gradient(135deg, #F3F4F6 0%, #E5E7EB 100%);
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      border: 2px dashed #D1D5DB;
    }
    .lock-icon {
      font-size: 24px;
      opacity: 0.6;
    }
    .lock-text {
      font-size: 11px;
      color: #6B7280;
      font-weight: 500;
    }
    
    /* Preview badge */
    .preview-badge {
      position: absolute;
      top: 8px;
      left: 8px;
      background: linear-gradient(135deg, #10B981 0%, #059669 100%);
      color: white;
      font-size: 10px;
      font-weight: 600;
      padding: 4px 8px;
      border-radius: 4px;
      text-transform: uppercase;
    }
    
    /* Signup Gate Modal */
    .signup-gate-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      backdrop-filter: blur(4px);
      z-index: 200;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .signup-gate-overlay.show { display: flex; }
    .signup-gate-modal {
      background: white;
      border-radius: 20px;
      padding: 32px;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 25px 50px rgba(0,0,0,0.25);
      text-align: center;
      animation: modalSlideUp 0.3s ease-out;
    }
    @keyframes modalSlideUp {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    .signup-gate-modal h2 {
      font-size: 24px;
      font-weight: 700;
      color: #1F2937;
      margin: 0 0 8px 0;
    }
    .signup-gate-modal .subtitle {
      font-size: 14px;
      color: #6B7280;
      margin-bottom: 24px;
    }
    .signup-gate-modal .preview-count {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%);
      border: 1px solid #6EE7B7;
      padding: 12px 20px;
      border-radius: 12px;
      margin-bottom: 20px;
    }
    .signup-gate-modal .preview-count span {
      font-size: 14px;
      font-weight: 600;
      color: #065F46;
    }
    .signup-gate-modal .benefit-list {
      text-align: left;
      margin: 20px 0;
    }
    .signup-gate-modal .benefit-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 0;
      font-size: 14px;
      color: #374151;
    }
    .signup-gate-modal .benefit-item .check {
      width: 20px;
      height: 20px;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 12px;
      flex-shrink: 0;
    }
    .signup-gate-btn {
      width: 100%;
      padding: 14px;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      color: white;
      border: none;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      margin-top: 16px;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .signup-gate-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(59, 130, 246, 0.3);
    }
    .signup-gate-login {
      margin-top: 16px;
      font-size: 13px;
      color: #6B7280;
    }
    .signup-gate-login a {
      color: #3B82F6;
      text-decoration: none;
      font-weight: 500;
    }
    .signup-gate-close {
      position: absolute;
      top: 16px;
      right: 16px;
      width: 32px;
      height: 32px;
      background: #F3F4F6;
      border: none;
      border-radius: 50%;
      cursor: pointer;
      font-size: 16px;
      color: #6B7280;
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
        width: 260px;
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
      .header {
        justify-content: flex-start;
        background: white;
        border-bottom: 1px solid #E5E7EB;
      }
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
      }
      .upload-container {
        padding: 24px 16px;
        max-width: 100%;
      }
      .upload-header h1 {
        font-size: 24px;
      }
      .upload-header p {
        font-size: 13px;
      }
      .upload-zone {
        min-height: 140px;
        padding: 20px;
      }
      .upload-icon {
        width: 44px;
        height: 44px;
      }
      .upload-icon svg {
        width: 20px;
        height: 20px;
      }
      .quality-options {
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .quality-btn {
        padding: 12px 14px;
      }
      .q-label {
        font-size: 13px;
      }
      .q-detail {
        font-size: 10px;
      }
      .generate-btn {
        width: 100%;
        padding: 12px 24px;
        font-size: 14px;
      }
      /* Hide 3D decorations on mobile */
      .deco-shape {
        display: none;
      }
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
    .paywall-credits { display: flex; justify-content: center; gap: 8px; margin-bottom: 16px; }
    .credits-stat { padding: 12px 20px; background: #F3F4F6; border-radius: 8px; }
    .credits-stat-label { font-size: 11px; color: #9CA3AF; text-transform: uppercase; }
    .credits-stat-value { font-size: 20px; font-weight: 700; color: #1F2937; }
    .paywall-credit-info { background: #F0F9FF; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px; font-size: 12px; color: #1E40AF; line-height: 1.8; }
    .paywall-credit-info p { margin: 0; }
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
<body class="${isLoggedIn ? '' : 'guest-mode'}">
  <!-- Guest Header (logged out users only) -->
  <header class="guest-header">
    <div class="guest-logo">
      <div class="guest-logo-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      </div>
      <span class="guest-logo-text">ShopShot</span>
    </div>
    <div class="guest-auth-btns">
      <a href="/login" class="guest-login-btn">Log in</a>
      <a href="/register" class="guest-signup-btn">Sign up free</a>
    </div>
  </header>

  <!-- Sidebar overlay (mobile) -->
  <div id="sidebar-overlay" class="sidebar-overlay" onclick="toggleSidebar()"></div>
  
  <!-- Sidebar - ElevenLabs style -->
  <aside id="sidebar" class="sidebar">
    <!-- Logo -->
    <div class="sidebar-logo">
      <div class="sidebar-logo-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      </div>
      <span class="sidebar-logo-text">ShopShot</span>
    </div>
    
    <!-- Generate New Button -->
    <div class="sidebar-header">
      <button class="new-btn" onclick="resetToUpload()">
        ✨ Generate New
      </button>
    </div>
    
    <!-- History Section -->
    <div class="sidebar-section-label">History</div>
    <div id="session-list" class="session-list">
      <div style="text-align:center; padding:16px 8px; color:#9CA3AF; font-size:12px;">
        No sessions yet
      </div>
    </div>
    
    <!-- User Section -->
    ${getSidebarUserHTML(user)}
    
    <!-- Credits Section -->
    <div id="credits-indicator" class="credits-indicator" onclick="window.location.href='/pricing'">
      <div class="credits-header">
        <span class="credits-title">Credits</span>
        <button class="credits-add" onclick="event.stopPropagation(); window.location.href='/pricing'">+ Add</button>
      </div>
      <div class="credits-grid">
        <div class="credit-item standard">
          <div class="credit-item-label"><span class="credit-item-icon">⚡</span> Std</div>
          <div id="cheaper-credits-display" class="credit-item-value standard">--</div>
        </div>
        <div class="credit-item pro">
          <div class="credit-item-label"><span class="credit-item-icon">✨</span> Pro</div>
          <div id="better-credits-display" class="credit-item-value pro">--</div>
        </div>
      </div>
    </div>
  </aside>

  <!-- Main Content -->
  <div class="main-content">
    <!-- Mobile Header (only shows hamburger on mobile) -->
    <header class="header">
      <button class="hamburger" onclick="toggleSidebar()">☰</button>
    </header>
    
    <!-- Paywall Modal -->
    <div id="paywall-modal" class="paywall-overlay" onclick="if(event.target === this) closePaywall()">
      <div class="paywall-modal">
        <div class="paywall-icon">🚫</div>
        <h2 class="paywall-title">Out of Credits!</h2>
        <p class="paywall-text" id="paywall-text">You've run out of credits. Get more to continue generating images.</p>
        <div class="paywall-credits">
          <div class="credits-stat">
            <div class="credits-stat-label"><span id="paywall-credit-type">Standard</span> Credits Needed</div>
            <div class="credits-stat-value" id="paywall-required">1</div>
          </div>
          <div class="credits-stat">
            <div class="credits-stat-label">Your <span id="paywall-credit-type2">Standard</span> Balance</div>
            <div class="credits-stat-value" id="paywall-current" style="color:#DC2626">0</div>
          </div>
        </div>
        <div class="paywall-credit-info">
          <p><strong>Standard Credits</strong> → Amazing quality, fast & reliable</p>
          <p><strong>Pro Credits</strong> → Best quality possible (beta model, may be slow)</p>
        </div>
        <div class="paywall-btns">
          <a href="/pricing" class="paywall-btn paywall-btn-primary" style="background:linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)">
            💳 Get More Credits
          </a>
          <button onclick="closePaywall()" class="paywall-btn paywall-btn-secondary">Continue Without Credits</button>
        </div>
        <p style="font-size:12px; color:#9CA3AF; margin-top:16px;">Your existing images are safe and won't be deleted.</p>
      </div>
    </div>

    <!-- Signup Gate Modal (for anonymous users after preview) -->
    <div id="signup-gate-modal" class="signup-gate-overlay" onclick="if(event.target === this) closeSignupGate()">
      <div class="signup-gate-modal" style="position: relative;">
        <button class="signup-gate-close" onclick="closeSignupGate()">✕</button>
        <h2>Unlock All 10 Variations!</h2>
        <p class="subtitle">You've seen 3 previews - sign up free to get the rest</p>
        
        <div class="preview-count">
          <span>🎉</span>
          <span>Get <strong>15 free credits</strong> when you sign up!</span>
        </div>
        
        <div class="benefit-list">
          <div class="benefit-item">
            <div class="check">✓</div>
            <span>All 10 professional product variations</span>
          </div>
          <div class="benefit-item">
            <div class="check">✓</div>
            <span>Download high-resolution images</span>
          </div>
          <div class="benefit-item">
            <div class="check">✓</div>
            <span>Save to your history forever</span>
          </div>
          <div class="benefit-item">
            <div class="check">✓</div>
            <span>Access Standard & Pro quality modes</span>
          </div>
        </div>
        
        <button class="signup-gate-btn" onclick="window.location.href='/register?redirect=' + encodeURIComponent('/results/' + currentSessionId + '?continue=1')">
          🚀 Sign Up Free & Get All 10
        </button>
        
        <p class="signup-gate-login">
          Already have an account? <a href="/login?redirect=${encodeURIComponent('/')}">Log in</a>
        </p>
      </div>
    </div>

    <!-- 3D Decorative Shapes -->
    <div class="deco-shape deco-cube"></div>
    <div class="deco-shape deco-triangle"></div>
    <div class="deco-shape deco-iso-cube"></div>

    <!-- Upload Screen -->
    <div id="upload-screen" class="upload-container">
      <!-- Free credits banner for guests -->
      <div class="free-credits-banner-inline">
        <span>🎁</span>
        <span>Sign up now and get <strong>15 free credits</strong> to start!</span>
      </div>
      
      <div class="upload-header">
        <h1>Upload Your Product Photo</h1>
        <p>Even crumpled product photos work - 10 variations in 36 seconds</p>
      </div>

      <!-- Upload Zone -->
      <div id="upload-zone" class="upload-zone" onclick="document.getElementById('file-input').click()"
           ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)" ondrop="handleDrop(event)">
        <input type="file" id="file-input" accept="image/*" style="display:none" onchange="handleFileSelect(event)">
        <div id="upload-prompt">
          <div class="upload-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <div class="upload-primary">Drag & Drop or Click to Upload</div>
          <div class="upload-secondary">Even crumpled product photos work - 10 variations in 36 seconds</div>
          <div class="upload-formats">JPG, PNG, WebP up to 10MB</div>
        </div>
        <div id="upload-preview" class="image-preview" style="display:none">
          <img id="preview-image" src="" alt="Preview">
          <div class="change-image" onclick="event.stopPropagation(); resetUpload()">Change image</div>
        </div>
      </div>

      <!-- Quality Selector -->
      <div class="quality-section">
        <div class="quality-label">Select Quality</div>
        <div class="quality-options">
          <button class="quality-btn active" data-model="flash" onclick="selectModel('flash')">
            <div class="q-label">⚡ Standard</div>
            <div class="q-detail">Fast & reliable</div>
          </button>
          <button class="quality-btn" data-model="nano" onclick="selectModel('nano')">
            <div class="q-label">✨ Pro</div>
            <div class="q-detail">Best quality (Beta)</div>
          </button>
        </div>
        <div id="model-credit-info" class="model-credit-info">
          <span id="selected-credit-type">Standard</span> credits will be used. 
          You have: <strong id="available-credit-count">--</strong> credits
        </div>
        <div id="nano-warning" class="nano-warning">
          ⚠️ <strong>Pro</strong> is in beta and may be slower (60-90s). 
          Use <strong>Standard</strong> for faster results (~8s per image).
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
    let selectedModel = 'flash'; // Default to flash (faster, more reliable)
    let sidebarOpen = false;
    let sessions = [];
    let lightboxImages = [];
    let currentLightboxIndex = 0;
    let customPrompts = {};
    let currentUser = ${user ? JSON.stringify({ id: user.id, email: user.email, name: user.name, cheaper_credits: user.cheaper_credits, better_credits: user.better_credits }) : 'null'};

    // User Menu Functions
    function toggleUserMenu() {
      const menu = document.getElementById('userDropdown');
      if (menu) menu.classList.toggle('show');
    }
    
    function toggleSidebarUserMenu() {
      const menu = document.getElementById('sidebarUserMenu');
      if (menu) menu.classList.toggle('show');
    }
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      const dropdown = document.getElementById('userDropdown');
      const userBtn = e.target.closest('.user-btn');
      if (dropdown && !userBtn) dropdown.classList.remove('show');
      
      const sidebarMenu = document.getElementById('sidebarUserMenu');
      const sidebarUserInfo = e.target.closest('.sidebar-user-info');
      if (sidebarMenu && !sidebarUserInfo) sidebarMenu.classList.remove('show');
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
      if (curEl) curEl.textContent = (currentUser?.cheaper_credits || 0) + (currentUser?.better_credits || 0);
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
    
    // Show paywall modal with specific required/current values
    function showPaywallModal(required = 1, current = 0, creditType = 'standard') {
      const modal = document.getElementById('paywall-modal');
      const reqEl = document.getElementById('paywall-required');
      const curEl = document.getElementById('paywall-current');
      const textEl = document.getElementById('paywall-text');
      
      if (reqEl) reqEl.textContent = required;
      if (curEl) curEl.textContent = current;
      
      const typeName = creditType === 'better' ? 'Pro' : 'Standard';
      
      // Update credit type labels in the modal
      const typeEl1 = document.getElementById('paywall-credit-type');
      const typeEl2 = document.getElementById('paywall-credit-type2');
      if (typeEl1) typeEl1.textContent = typeName;
      if (typeEl2) typeEl2.textContent = typeName;
      
      if (textEl) {
        if (current === 0) {
          textEl.textContent = "You've run out of " + typeName + " credits! Get more to continue generating images.";
        } else {
          textEl.textContent = 'You need ' + required + ' ' + typeName + ' credit(s) but only have ' + current + '.';
        }
      }
      
      // Update credits indicator
      updateCreditsDisplay();
      
      if (modal) modal.classList.add('show');
    }
    
    // Check if user has enough credits for the selected model
    function hasCredits(required = 10) {
      if (!currentUser) return false;
      const isProModel = selectedModel === 'nano';
      const availableCredits = isProModel ? (currentUser.better_credits || 0) : (currentUser.cheaper_credits || 0);
      return availableCredits >= required;
    }
    
    // Get current balance based on selected model
    function getCurrentBalance() {
      if (!currentUser) return 0;
      const isProModel = selectedModel === 'nano';
      return isProModel ? (currentUser.better_credits || 0) : (currentUser.cheaper_credits || 0);
    }
    
    // Update credits indicator style based on balance
    function updateCreditsIndicatorStyle(cheaper, better) {
      const indicator = document.getElementById('credits-indicator');
      if (!indicator) return;
      indicator.classList.remove('empty');
      if ((cheaper || 0) === 0 && (better || 0) === 0) {
        indicator.classList.add('empty');
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
      // Skip for anonymous users - sidebar is hidden anyway
      if (!currentUser) return;
      
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
      
      // Update credit info display
      const creditInfo = document.getElementById('model-credit-info');
      const creditTypeEl = document.getElementById('selected-credit-type');
      const creditCountEl = document.getElementById('available-credit-count');
      
      if (model === 'nano') {
        // Pro credits
        if (creditInfo) { creditInfo.classList.remove('standard'); creditInfo.classList.add('pro'); }
        if (creditTypeEl) creditTypeEl.textContent = 'Pro';
        if (creditCountEl) creditCountEl.textContent = window.currentBetterCredits || '--';
      } else {
        // Standard credits
        if (creditInfo) { creditInfo.classList.remove('pro'); creditInfo.classList.add('standard'); }
        if (creditTypeEl) creditTypeEl.textContent = 'Standard';
        if (creditCountEl) creditCountEl.textContent = window.currentCheaperCredits || '--';
      }
      
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

    // Track anonymous session state
    // Removed: isAnonymousSession and anonymousPreviewsGenerated (auth required for all generation)

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

      // SECURITY: Redirect to signup if not logged in
      // Store image in localStorage so user can continue after signup
      if (!currentUser) {
        try {
          // Store image data and filename for restoration after signup
          localStorage.setItem('shopshot_pending_image', currentOriginalImage);
          localStorage.setItem('shopshot_pending_filename', selectedFile.name);
          localStorage.setItem('shopshot_pending_model', selectedModel);
        } catch (e) {
          console.warn('Could not store image in localStorage:', e);
        }
        window.location.href = '/get-started?redirect=' + encodeURIComponent(window.location.pathname);
        return;
      }

      try {
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
          currentSessionId = data.sessionId;
          loadSessions();
        } else if (data.needsAuth) {
          // Server says not authenticated - redirect to signup
          window.location.href = '/get-started?redirect=' + encodeURIComponent(window.location.pathname);
        } else if (data.needsUpgrade) {
          showPaywallModal(data.required, data.current);
        } else {
          showError(data.error || 'Upload failed');
        }
      } catch (e) { 
        console.error('Upload failed:', e);
        showError('Upload failed. Please try again.');
      }
    }

    // Generation - requires authentication
    async function generateVariations() {
      if (!currentSessionId || !currentOriginalImage) {
        showError('Please upload an image first');
        return;
      }

      // SECURITY: Verify auth with server before generation
      try {
        const authCheck = await fetch('/api/auth/me', { credentials: 'include' });
        const authData = await authCheck.json();
        
        if (!authData.user) {
          // Not authenticated - redirect to signup
          window.location.href = '/get-started?redirect=' + encodeURIComponent(window.location.pathname);
          return;
        }
        
        // Update currentUser from server
        currentUser = authData.user;
      } catch (e) {
        // Auth check failed - redirect to signup
        window.location.href = '/get-started?redirect=' + encodeURIComponent(window.location.pathname);
        return;
      }

      // Authenticated - proceed with full generation
      await generateFullVariations();
    }

    // Full generation for authenticated users
    async function generateFullVariations() {
      document.getElementById('upload-screen').style.display = 'none';
      document.getElementById('results-screen').style.display = 'block';
      document.getElementById('product-name-edit').value = selectedFile?.name?.replace(/\\.[^.]+$/, '') || 'Product';

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

      const startTime = Date.now();
      
      if (selectedModel === 'nano') {
        const batchSize = 3;
        for (let b = 1; b < variationDefs.length; b += batchSize) {
          const batch = [];
          for (let i = b; i < Math.min(b + batchSize, variationDefs.length); i++) {
            batch.push(generateSingle(i, startTime));
          }
          await Promise.allSettled(batch);
        }
      } else {
        const promises = [];
        for (let i = 1; i < variationDefs.length; i++) {
          promises.push(generateSingle(i, startTime));
        }
        await Promise.allSettled(promises);
      }
      
      try {
        const completeRes = await fetch('/api/sessions/' + currentSessionId + '/complete', {
          method: 'POST'
        });
        const completeData = await completeRes.json();
        if (completeData.success) {
          console.log('Generation complete. Credits charged:', completeData.credits_charged, 'New balance:', completeData.new_balance);
        }
        loadSessions();
        updateCreditsDisplay();
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
        
        if (data.needsAuth) {
          // Not logged in - shouldn't happen but handle gracefully
          console.log('[Generate] Auth required - showing signup gate');
          showSignupGate();
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
          // Update credits display after each successful generation
          updateCreditsDisplay();
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
          window.location.href = '/get-started?redirect=' + encodeURIComponent(window.location.pathname);
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
          // Restore previous image if it exists, with retry overlay
          if (lightboxImages[index] && lightboxImages[index].src) {
            card.innerHTML = '<div style="position:relative">' +
              '<img src="' + lightboxImages[index].src + '" style="opacity:0.6" onclick="openLightbox(' + index + ')">' +
              '<div class="card-overlay" style="opacity:1">' +
                '<button onclick="event.stopPropagation(); regenerate(' + index + ')">🔄 Retry</button>' +
              '</div>' +
            '</div>' +
            '<div class="card-label">' + v.label + '</div>';
          } else {
            card.innerHTML = '<div class="card-error" style="cursor:pointer" onclick="regenerate(' + index + ')">⚠️ Retry</div>' +
              '<div class="card-label">' + v.label + '</div>';
          }
          showError(data.error || 'Regeneration failed');
        }
      } catch (e) {
        clearInterval(interval);
        console.error('Regeneration failed:', e);
        // Restore previous image if it exists
        if (lightboxImages[index] && lightboxImages[index].src) {
          card.innerHTML = '<div style="position:relative">' +
            '<img src="' + lightboxImages[index].src + '" style="opacity:0.6" onclick="openLightbox(' + index + ')">' +
            '<div class="card-overlay" style="opacity:1">' +
              '<button onclick="event.stopPropagation(); regenerate(' + index + ')">🔄 Retry</button>' +
            '</div>' +
          '</div>' +
          '<div class="card-label">' + v.label + '</div>';
        } else {
          card.innerHTML = '<div class="card-error" style="cursor:pointer" onclick="regenerate(' + index + ')">⚠️ Retry</div>' +
            '<div class="card-label">' + v.label + '</div>';
        }
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
    
    function showNotification(msg) {
      // Create success toast if it doesn't exist
      let toast = document.getElementById('success-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'success-toast';
        toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,#059669,#10B981);color:white;padding:16px 24px;border-radius:12px;font-size:14px;font-weight:500;z-index:9999;opacity:0;transition:opacity 0.3s;box-shadow:0 4px 20px rgba(0,0,0,0.15);';
        document.body.appendChild(toast);
      }
      toast.textContent = msg;
      toast.style.opacity = '1';
      setTimeout(() => toast.style.opacity = '0', 5000);
    }

    // Fetch and update credits display
    async function updateCreditsDisplay() {
      // Skip for anonymous users - no need to fetch credits
      if (!currentUser) {
        const creditCountEl = document.getElementById('available-credit-count');
        if (creditCountEl) creditCountEl.textContent = '--';
        return;
      }
      
      try {
        const res = await fetch('/api/credits/balance');
        const data = await res.json();
        const indicator = document.getElementById('credits-indicator');
        const cheaperDisplay = document.getElementById('cheaper-credits-display');
        const betterDisplay = document.getElementById('better-credits-display');
        
        if (data.success) {
          const cheaperCredits = data.cheaper_credits || 0;
          const betterCredits = data.better_credits || 0;
          
          if (cheaperDisplay) cheaperDisplay.textContent = cheaperCredits;
          if (betterDisplay) betterDisplay.textContent = betterCredits;
          
          // Update indicator style based on total balance
          const totalBalance = cheaperCredits + betterCredits;
          if (indicator) {
            indicator.classList.remove('empty');
            if (totalBalance === 0) {
              indicator.classList.add('empty');
            }
          }
          
          // Store current credits for paywall checks
          window.currentCheaperCredits = cheaperCredits;
          window.currentBetterCredits = betterCredits;
          
          // Update the model-specific credit display
          const creditCountEl = document.getElementById('available-credit-count');
          if (creditCountEl) {
            creditCountEl.textContent = selectedModel === 'nano' ? betterCredits : cheaperCredits;
          }
        } else {
          // Not logged in - show login prompt
          if (cheaperDisplay) cheaperDisplay.textContent = '0';
          if (betterDisplay) betterDisplay.textContent = '0';
          if (indicator) {
            indicator.classList.add('empty');
            indicator.onclick = () => window.location.href = '/login';
          }
        }
      } catch (e) {
        console.error('Failed to fetch credits:', e);
      }
    }

    // Init
    document.addEventListener('DOMContentLoaded', () => {
      // Only load sessions and credits for logged-in users
      if (currentUser) {
        loadSessions();
        updateCreditsDisplay();
      }
      
      // Check if user just signed up and has a pending image to restore
      if (currentUser) {
        const pendingImage = localStorage.getItem('shopshot_pending_image');
        const pendingFilename = localStorage.getItem('shopshot_pending_filename');
        const pendingModel = localStorage.getItem('shopshot_pending_model');
        
        if (pendingImage) {
          // Restore the image
          currentOriginalImage = pendingImage;
          selectedModel = pendingModel || 'flash';
          
          // Update model selector UI
          document.querySelectorAll('.quality-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.model === selectedModel) btn.classList.add('active');
          });
          
          // Show the image preview
          const preview = document.getElementById('image-preview');
          const uploadZone = document.getElementById('upload-zone');
          if (preview && uploadZone) {
            preview.innerHTML = '<img src="' + pendingImage + '" style="max-width:100%; max-height:300px; border-radius:8px;">';
            preview.style.display = 'block';
            uploadZone.classList.add('has-preview');
          }
          
          // Enable generate button
          const genBtn = document.getElementById('generate-btn');
          if (genBtn) genBtn.disabled = false;
          
          // Create a mock file object for the filename
          selectedFile = { name: pendingFilename || 'product.jpg' };
          
          // Clear the stored data
          localStorage.removeItem('shopshot_pending_image');
          localStorage.removeItem('shopshot_pending_filename');
          localStorage.removeItem('shopshot_pending_model');
          
          // Show a welcome message
          showNotification('Welcome! Your image is ready - click Generate to create your product photos!');
        }
      }
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
    
    // Check for continue param (post-signup generation)
    async function checkAndContinue() {
      const params = new URLSearchParams(window.location.search);
      if (params.get('continue') === '1') {
        // Clean URL
        window.history.replaceState({}, '', '/results/' + sessionId);
        
        // Claim the session and generate remaining
        try {
          const claimRes = await fetch('/api/claim-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId })
          });
          const claimData = await claimRes.json();
          
          if (claimData.success) {
            // Show message and trigger remaining generation
            document.getElementById('loading').innerHTML = '<div class="text-center"><div class="w-12 h-12 rounded-full border-4 border-brand-purple/30 border-t-brand-purple animate-spin mx-auto mb-4"></div><p class="text-brand-gray">Generating remaining variations...</p><p class="text-sm text-brand-gray mt-2">3 previews complete, 7 more on the way!</p></div>';
            // Will need to redirect to home with session state to complete generation
            // For now, just load what we have
            await loadSession();
          } else {
            await loadSession();
          }
        } catch (e) {
          console.error('Continue failed:', e);
          await loadSession();
        }
      } else {
        await loadSession();
      }
    }
    
    checkAndContinue();
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
      
      <p class="auth-footer" id="register-link">
        Don't have an account? <a href="/register">Sign up free</a>
      </p>
    </div>
  </div>

  <script>
    // Get redirect param from URL
    const urlParams = new URLSearchParams(window.location.search);
    const redirectTo = urlParams.get('redirect');
    
    // Update register link to preserve redirect
    if (redirectTo) {
      const registerLink = document.querySelector('#register-link a');
      if (registerLink) {
        registerLink.href = '/register?redirect=' + encodeURIComponent(redirectTo);
      }
    }
    
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
          // Redirect to original page or home
          window.location.href = redirectTo || '/';
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
    .plan-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      background: linear-gradient(135deg, #EEF2FF 0%, #E0E7FF 100%);
      border: 1px solid #C7D2FE;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
      color: #4338CA;
      margin-top: 12px;
    }
    .plan-badge.standard {
      background: linear-gradient(135deg, #DBEAFE 0%, #BFDBFE 100%);
      border-color: #93C5FD;
      color: #1D4ED8;
    }
    .plan-badge.pro {
      background: linear-gradient(135deg, #F3E8FF 0%, #E9D5FF 100%);
      border-color: #C4B5FD;
      color: #7C3AED;
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
      
      <h1 class="auth-title" id="page-title">Create Account</h1>
      <p class="auth-subtitle" id="page-subtitle">Start generating professional product photos</p>
      <div style="text-align:center;" id="badge-container">
        <span class="bonus-badge">🎁 Get ${CREDITS.SIGNUP_CHEAPER + CREDITS.SIGNUP_BETTER} free credits on signup!</span>
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
      
      <p class="auth-footer" id="login-link">
        Already have an account? <a href="/login">Log in</a>
      </p>
    </div>
  </div>

  <script>
    // Get params from URL
    const urlParams = new URLSearchParams(window.location.search);
    const redirectTo = urlParams.get('redirect');
    const selectedPlan = urlParams.get('plan'); // 'free', 'standard', or 'pro'
    
    // Update page based on selected plan
    const title = document.getElementById('page-title');
    const subtitle = document.getElementById('page-subtitle');
    const badge = document.getElementById('badge-container');
    const btn = document.getElementById('submit-btn');
    
    if (selectedPlan === 'standard') {
      title.textContent = 'Get Standard Plan';
      subtitle.textContent = 'Create account to start your subscription';
      badge.innerHTML = '<span class="plan-badge standard">⚡ Standard Plan - £${PRICING.STANDARD}/month</span>';
      btn.textContent = 'Create Account & Subscribe';
    } else if (selectedPlan === 'pro') {
      title.textContent = 'Get Pro Plan';
      subtitle.textContent = 'Create account to start your subscription';
      badge.innerHTML = '<span class="plan-badge pro">🚀 Pro Plan - £${PRICING.PRO}/month</span>';
      btn.textContent = 'Create Account & Subscribe';
    }
    
    // Update login link to preserve params
    const loginLink = document.querySelector('#login-link a');
    if (loginLink) {
      let loginUrl = '/login';
      const params = [];
      if (redirectTo) params.push('redirect=' + encodeURIComponent(redirectTo));
      if (selectedPlan) params.push('plan=' + selectedPlan);
      if (params.length) loginUrl += '?' + params.join('&');
      loginLink.href = loginUrl;
    }
    
    async function handleRegister(e) {
      e.preventDefault();
      const btn = document.getElementById('submit-btn');
      const errEl = document.getElementById('error-msg');
      
      btn.disabled = true;
      btn.textContent = selectedPlan && selectedPlan !== 'free' ? 'Creating account...' : 'Creating account...';
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
          // If paid plan selected, trigger Stripe checkout
          if (selectedPlan === 'standard' || selectedPlan === 'pro') {
            btn.textContent = 'Redirecting to payment...';
            
            const checkoutRes = await fetch('/api/billing/create-checkout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ type: 'subscription', plan: selectedPlan })
            });
            
            const checkoutData = await checkoutRes.json();
            
            if (checkoutData.success && checkoutData.url) {
              window.location.href = checkoutData.url;
            } else {
              // Checkout failed, but account created - go to pricing page
              window.location.href = '/pricing?signup=success&checkout=failed';
            }
          } else {
            // Free plan - just redirect
            window.location.href = redirectTo || '/?welcome=1';
          }
        } else {
          errEl.textContent = data.error || 'Registration failed';
          errEl.classList.add('show');
          btn.disabled = false;
          btn.textContent = selectedPlan && selectedPlan !== 'free' ? 'Create Account & Subscribe' : 'Create Account';
        }
      } catch (err) {
        errEl.textContent = 'Something went wrong. Please try again.';
        errEl.classList.add('show');
        btn.disabled = false;
        btn.textContent = selectedPlan && selectedPlan !== 'free' ? 'Create Account & Subscribe' : 'Create Account';
      }
    }
  </script>
</body>
</html>`
}

// ============================================================================
// GET STARTED PAGE (75% Pricing Left, 25% Login Right - Light Theme)
// ============================================================================
function getGetStartedPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Get Started - ShopShot</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'><stop offset='0%25' style='stop-color:%233B82F6'/><stop offset='100%25' style='stop-color:%238B5CF6'/></linearGradient></defs><rect width='100' height='100' rx='22' fill='url(%23g)'/><circle cx='50' cy='50' r='28' fill='none' stroke='white' stroke-width='6'/><circle cx='50' cy='50' r='12' fill='white'/></svg>">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { font-family: 'Inter', system-ui, sans-serif; box-sizing: border-box; margin: 0; padding: 0; }
    
    body { 
      min-height: 100vh;
      background: radial-gradient(circle at 50% 30%, rgba(225, 245, 254, 1) 0%, rgba(243, 232, 255, 1) 50%, rgba(237, 233, 254, 1) 100%);
    }
    
    /* Header */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 32px;
      background: rgba(255,255,255,0.9);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid rgba(229,231,235,0.5);
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
    }
    .logo-icon {
      width: 36px;
      height: 36px;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .logo-icon svg { width: 20px; height: 20px; color: white; }
    .logo-text { font-size: 22px; font-weight: 700; color: #1F2937; }
    
    /* Main Layout - 75% / 25% split */
    .main-layout {
      display: flex;
      min-height: calc(100vh - 65px);
    }
    
    /* Left Side - Pricing (75%) */
    .pricing-section {
      flex: 3;
      padding: 40px 48px;
      overflow-y: auto;
    }
    
    /* Right Side - Auth (25%) */
    .auth-section {
      flex: 1;
      min-width: 320px;
      max-width: 360px;
      background: white;
      border-left: 1px solid #E5E7EB;
      padding: 32px 28px;
      display: flex;
      flex-direction: column;
      box-shadow: -4px 0 20px rgba(0,0,0,0.03);
    }
    
    @media (max-width: 1100px) {
      .main-layout { flex-direction: column-reverse; }
      .pricing-section { padding: 32px 24px; }
      .auth-section { 
        max-width: 100%; 
        min-width: auto;
        border-left: none; 
        border-bottom: 1px solid #E5E7EB;
        box-shadow: none;
      }
    }
    
    /* Pricing Header */
    .pricing-header {
      margin-bottom: 32px;
    }
    .pricing-header h1 {
      font-size: 28px;
      font-weight: 800;
      color: #1F2937;
      margin-bottom: 6px;
    }
    .pricing-header p {
      font-size: 15px;
      color: #6B7280;
    }
    
    /* Pricing Grid */
    .pricing-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
      margin-bottom: 36px;
    }
    @media (max-width: 900px) {
      .pricing-grid { grid-template-columns: 1fr; }
    }
    
    .pricing-card {
      background: white;
      border: 1px solid #E5E7EB;
      border-radius: 16px;
      padding: 24px;
      position: relative;
      transition: all 0.2s;
    }
    .pricing-card:hover {
      border-color: #8B5CF6;
      box-shadow: 0 8px 30px rgba(139, 92, 246, 0.12);
    }
    .pricing-card.featured {
      border: 2px solid #8B5CF6;
      box-shadow: 0 8px 30px rgba(139, 92, 246, 0.15);
    }
    .pricing-card.featured::before {
      content: 'Most Popular';
      position: absolute;
      top: -12px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, #8B5CF6 0%, #3B82F6 100%);
      color: white;
      padding: 5px 14px;
      border-radius: 100px;
      font-size: 11px;
      font-weight: 600;
    }
    
    .pricing-card h3 {
      font-size: 17px;
      font-weight: 700;
      color: #1F2937;
      margin-bottom: 4px;
    }
    .pricing-card .price {
      font-size: 32px;
      font-weight: 800;
      color: #1F2937;
      margin-bottom: 4px;
    }
    .pricing-card .price span { 
      font-size: 14px; 
      font-weight: 500; 
      color: #9CA3AF; 
    }
    .pricing-card .price-note { 
      font-size: 12px; 
      color: #9CA3AF; 
      margin-bottom: 16px; 
    }
    
    .pricing-card .credits {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
    }
    .credit-badge {
      flex: 1;
      padding: 8px;
      background: #F9FAFB;
      border-radius: 8px;
      text-align: center;
    }
    .credit-badge .count { 
      font-size: 20px; 
      font-weight: 700; 
    }
    .credit-badge .label { 
      font-size: 9px; 
      color: #6B7280; 
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .credit-badge.standard .count { color: #3B82F6; }
    .credit-badge.pro .count { color: #8B5CF6; }
    
    .pricing-card ul {
      list-style: none;
      margin-bottom: 16px;
    }
    .pricing-card li {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #4B5563;
      margin-bottom: 8px;
    }
    .pricing-card li::before {
      content: '';
      width: 16px;
      height: 16px;
      background: #10B981;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='white'%3E%3Cpath fill-rule='evenodd' d='M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z' clip-rule='evenodd'/%3E%3C/svg%3E");
      background-size: 10px;
      background-repeat: no-repeat;
      background-position: center;
    }
    
    .pricing-btn {
      width: 100%;
      padding: 11px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      text-align: center;
      text-decoration: none;
      display: block;
    }
    .pricing-btn.primary {
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      border: none;
      color: white;
    }
    .pricing-btn.primary:hover { 
      transform: translateY(-2px); 
      box-shadow: 0 6px 20px rgba(139, 92, 246, 0.3); 
    }
    .pricing-btn.secondary {
      background: white;
      border: 1px solid #E5E7EB;
      color: #374151;
    }
    .pricing-btn.secondary:hover { 
      border-color: #8B5CF6; 
      color: #8B5CF6;
    }
    
    /* Features Row */
    .features-row {
      display: flex;
      gap: 24px;
      padding-top: 28px;
      border-top: 1px solid #E5E7EB;
    }
    @media (max-width: 768px) {
      .features-row { flex-direction: column; gap: 16px; }
    }
    .feature-item {
      flex: 1;
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }
    .feature-icon {
      width: 36px;
      height: 36px;
      background: linear-gradient(135deg, #EEF2FF 0%, #F3E8FF 100%);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      flex-shrink: 0;
    }
    .feature-text h4 { 
      font-size: 13px; 
      font-weight: 600; 
      color: #1F2937; 
      margin-bottom: 2px;
    }
    .feature-text p { 
      font-size: 11px; 
      color: #6B7280; 
      line-height: 1.4;
    }
    
    /* Auth Section Styles */
    .auth-header {
      margin-bottom: 20px;
    }
    .auth-header h2 {
      font-size: 20px;
      font-weight: 700;
      color: #1F2937;
      margin-bottom: 4px;
    }
    .auth-header p {
      font-size: 13px;
      color: #6B7280;
    }
    
    .free-banner {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      background: linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%);
      border: 1px solid #6EE7B7;
      border-radius: 10px;
      margin-bottom: 20px;
    }
    .free-banner span { font-size: 18px; }
    .free-banner p { 
      font-size: 13px; 
      font-weight: 600; 
      color: #065F46; 
      margin: 0;
    }
    
    .auth-tabs {
      display: flex;
      background: #F3F4F6;
      border-radius: 10px;
      padding: 4px;
      margin-bottom: 20px;
    }
    .auth-tab {
      flex: 1;
      padding: 10px 14px;
      border: none;
      background: transparent;
      color: #6B7280;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      border-radius: 8px;
      transition: all 0.2s;
    }
    .auth-tab.active {
      background: white;
      color: #1F2937;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    
    .auth-form { display: none; }
    .auth-form.active { display: block; }
    
    .form-group { margin-bottom: 14px; }
    .form-label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: #374151;
      margin-bottom: 5px;
    }
    .form-input {
      width: 100%;
      padding: 11px 13px;
      background: #F9FAFB;
      border: 1px solid #E5E7EB;
      border-radius: 10px;
      font-size: 14px;
      color: #1F2937;
      transition: all 0.2s;
    }
    .form-input::placeholder { color: #9CA3AF; }
    .form-input:focus {
      outline: none;
      border-color: #8B5CF6;
      background: white;
      box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
    }
    
    .submit-btn {
      width: 100%;
      padding: 13px;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      border: none;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      color: white;
      cursor: pointer;
      transition: all 0.2s;
      margin-top: 6px;
    }
    .submit-btn:hover { 
      transform: translateY(-1px); 
      box-shadow: 0 6px 20px rgba(139, 92, 246, 0.3); 
    }
    .submit-btn:disabled { 
      opacity: 0.6; 
      cursor: not-allowed; 
      transform: none; 
    }
    
    .error-msg {
      background: #FEF2F2;
      border: 1px solid #FECACA;
      color: #DC2626;
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 12px;
      margin-bottom: 14px;
      display: none;
    }
    .error-msg.show { display: block; }
    
    .auth-footer {
      text-align: center;
      margin-top: 14px;
      font-size: 11px;
      color: #9CA3AF;
      line-height: 1.5;
    }
    .auth-footer a { color: #8B5CF6; text-decoration: none; }
    .auth-footer a:hover { text-decoration: underline; }
    
    .auth-spacer { flex: 1; }
    
    .auth-help {
      padding-top: 16px;
      border-top: 1px solid #E5E7EB;
      margin-top: 16px;
    }
    .auth-help p {
      font-size: 12px;
      color: #6B7280;
      text-align: center;
    }
    .auth-help a { color: #8B5CF6; text-decoration: none; }
    
    .signup-prompt {
      text-align: center;
      padding: 20px;
      background: linear-gradient(135deg, #F0FDF4 0%, #DCFCE7 100%);
      border: 1px solid #BBF7D0;
      border-radius: 12px;
      margin-bottom: 16px;
    }
    .signup-prompt p {
      font-size: 13px;
      color: #166534;
      margin-bottom: 8px;
    }
    .signup-link {
      display: inline-block;
      padding: 10px 24px;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      color: white;
      text-decoration: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      transition: all 0.2s;
    }
    .signup-link:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
    }
  </style>
</head>
<body>
  <!-- Header -->
  <header class="header">
    <a href="/" class="logo">
      <div class="logo-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      </div>
      <span class="logo-text">ShopShot</span>
    </a>
  </header>
  
  <!-- Main Layout -->
  <div class="main-layout">
    <!-- Left: Pricing (75%) -->
    <section class="pricing-section">
      <div class="pricing-header">
        <h1>Simple, Transparent Pricing</h1>
        <p>Start free with 15 credits. Upgrade anytime for more.</p>
      </div>
      
      <div class="pricing-grid">
        <!-- Free Plan -->
        <div class="pricing-card">
          <h3>Free</h3>
          <div class="price">£0</div>
          <div class="price-note">One-time signup bonus</div>
          <div class="credits">
            <div class="credit-badge standard">
              <div class="count">${CREDITS.SIGNUP_CHEAPER}</div>
              <div class="label">Standard</div>
            </div>
            <div class="credit-badge pro">
              <div class="count">${CREDITS.SIGNUP_BETTER}</div>
              <div class="label">Pro</div>
            </div>
          </div>
          <ul>
            <li>10 variations per generation</li>
            <li>High-resolution downloads</li>
            <li>All variation types</li>
          </ul>
          <a href="/register?plan=free" class="pricing-btn secondary">
            Sign Up Free
          </a>
        </div>
        
        <!-- Standard Plan -->
        <div class="pricing-card featured">
          <h3>Standard</h3>
          <div class="price">£${PRICING.STANDARD}<span>/mo</span></div>
          <div class="price-note">Best for regular sellers</div>
          <div class="credits">
            <div class="credit-badge standard">
              <div class="count">${CREDITS.STANDARD_CHEAPER}</div>
              <div class="label">Standard</div>
            </div>
            <div class="credit-badge pro">
              <div class="count">${CREDITS.STANDARD_BETTER}</div>
              <div class="label">Pro</div>
            </div>
          </div>
          <ul>
            <li>Everything in Free</li>
            <li>Priority generation</li>
            <li>Monthly credit refresh</li>
            <li>Cancel anytime</li>
          </ul>
          <a href="/register?plan=standard" class="pricing-btn primary">
            Get Started
          </a>
        </div>
        
        <!-- Pro Plan -->
        <div class="pricing-card">
          <h3>Pro</h3>
          <div class="price">£${PRICING.PRO}<span>/mo</span></div>
          <div class="price-note">For power users</div>
          <div class="credits">
            <div class="credit-badge standard">
              <div class="count">${CREDITS.PRO_CHEAPER}</div>
              <div class="label">Standard</div>
            </div>
            <div class="credit-badge pro">
              <div class="count">${CREDITS.PRO_BETTER}</div>
              <div class="label">Pro</div>
            </div>
          </div>
          <ul>
            <li>Everything in Standard</li>
            <li>More Pro credits</li>
            <li>Best quality AI model</li>
            <li>Priority support</li>
          </ul>
          <a href="/register?plan=pro" class="pricing-btn secondary">
            Get Started
          </a>
        </div>
      </div>
      
      <!-- Features Row -->
      <div class="features-row">
        <div class="feature-item">
          <div class="feature-icon">📸</div>
          <div class="feature-text">
            <h4>10 Professional Variations</h4>
            <p>Hero shots, lifestyle, flat-lay, macro details from one upload</p>
          </div>
        </div>
        <div class="feature-item">
          <div class="feature-icon">⚡</div>
          <div class="feature-text">
            <h4>Ready in 36 Seconds</h4>
            <p>AI-powered generation, faster than making coffee</p>
          </div>
        </div>
        <div class="feature-item">
          <div class="feature-icon">🎯</div>
          <div class="feature-text">
            <h4>Works With Any Photo</h4>
            <p>Even crumpled or low-quality images work great</p>
          </div>
        </div>
      </div>
    </section>
    
    <!-- Right: Login (25%) -->
    <section class="auth-section">
      <div class="auth-header">
        <h2>Welcome Back</h2>
        <p>Log in to your account</p>
      </div>
      
      <div id="error-msg" class="error-msg"></div>
      
      <!-- Login Form -->
      <form id="login-form" onsubmit="handleLogin(event)">
        <div class="form-group">
          <label class="form-label">Email</label>
          <input type="email" id="login-email" class="form-input" placeholder="you@example.com" required>
        </div>
        <div class="form-group">
          <label class="form-label">Password</label>
          <input type="password" id="login-password" class="form-input" placeholder="Your password" required>
        </div>
        <button type="submit" id="login-btn" class="submit-btn">
          Log In
        </button>
        <p class="auth-footer">
          <a href="#">Forgot your password?</a>
        </p>
      </form>
      
      <div class="auth-spacer"></div>
      
      <div class="signup-prompt">
        <p>Don't have an account?</p>
        <a href="/register?plan=free" class="signup-link">Sign up free</a>
      </div>
      
      <div class="auth-help">
        <p>Questions? <a href="mailto:support@shopshot.ai">Contact support</a></p>
      </div>
    </section>
  </div>

  <script>
    const urlParams = new URLSearchParams(window.location.search);
    const redirectTo = urlParams.get('redirect') || '/';
    
    async function handleLogin(e) {
      e.preventDefault();
      const btn = document.getElementById('login-btn');
      const errEl = document.getElementById('error-msg');
      
      btn.disabled = true;
      btn.textContent = 'Logging in...';
      errEl.classList.remove('show');
      
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: document.getElementById('login-email').value,
            password: document.getElementById('login-password').value
          })
        });
        
        const data = await res.json();
        
        if (data.success) {
          window.location.href = redirectTo;
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
// PRICING PAGE
// ============================================================================
function getPricingPage(user?: User) {
  const userPlan = user?.subscription_plan || 'free';
  const isStandard = userPlan === 'standard';
  const isPro = userPlan === 'pro';
  
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
    * { font-family: 'Inter', system-ui, sans-serif; box-sizing: border-box; }
    body { background: linear-gradient(135deg, #F0F9FF 0%, #E0E7FF 100%); min-height: 100vh; }
    
    .pricing-container { max-width: 1200px; margin: 0 auto; padding: 48px 24px; }
    
    .back-link { display: inline-flex; align-items: center; gap: 4px; color: #6B7280; text-decoration: none; margin-bottom: 24px; font-size: 14px; }
    .back-link:hover { color: #374151; }
    
    .pricing-header { text-align: center; margin-bottom: 48px; }
    .pricing-title { font-size: 42px; font-weight: 800; color: #1F2937; margin-bottom: 12px; background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .pricing-subtitle { font-size: 18px; color: #6B7280; max-width: 600px; margin: 0 auto 24px; }
    
    .current-balance { display: inline-flex; align-items: center; gap: 16px; padding: 16px 24px; background: white; border-radius: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
    .balance-item { text-align: center; padding: 0 16px; }
    .balance-item:not(:last-child) { border-right: 1px solid #E5E7EB; }
    .balance-label { font-size: 12px; color: #6B7280; margin-bottom: 4px; }
    .balance-value { font-size: 24px; font-weight: 700; }
    .balance-value.cheaper { color: #059669; }
    .balance-value.better { color: #7C3AED; }
    
    .section-title { font-size: 28px; font-weight: 700; color: #1F2937; margin: 48px 0 24px; text-align: center; }
    .section-subtitle { font-size: 14px; color: #6B7280; text-align: center; margin: -16px 0 32px; }
    
    /* Subscription Plans Grid */
    .plans-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-bottom: 64px; }
    @media (max-width: 900px) { .plans-grid { grid-template-columns: 1fr; } }
    
    .plan-card {
      background: white;
      border-radius: 20px;
      padding: 32px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.05);
      position: relative;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .plan-card:hover { transform: translateY(-4px); box-shadow: 0 8px 30px rgba(0,0,0,0.1); }
    .plan-card.featured { border: 3px solid #7C3AED; }
    .plan-card.current { border: 3px solid #10B981; }
    
    .badge { position: absolute; top: -12px; left: 50%; transform: translateX(-50%); padding: 6px 16px; border-radius: 20px; font-size: 12px; font-weight: 600; white-space: nowrap; }
    .badge.popular { background: linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%); color: white; }
    .badge.best { background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%); color: white; }
    .badge.current { background: #10B981; color: white; }
    
    .plan-name { font-size: 24px; font-weight: 700; color: #1F2937; margin-bottom: 8px; margin-top: 8px; }
    .plan-price { font-size: 48px; font-weight: 800; color: #1F2937; line-height: 1; }
    .plan-price span { font-size: 18px; font-weight: 500; color: #6B7280; }
    .plan-period { font-size: 14px; color: #6B7280; margin-bottom: 24px; }
    
    .plan-credits { background: #F9FAFB; border-radius: 12px; padding: 16px; margin-bottom: 24px; }
    .credit-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; }
    .credit-row:not(:last-child) { border-bottom: 1px solid #E5E7EB; }
    .credit-type { display: flex; align-items: center; gap: 8px; }
    .credit-dot { width: 10px; height: 10px; border-radius: 50%; }
    .credit-dot.cheaper { background: #10B981; }
    .credit-dot.better { background: #7C3AED; }
    .credit-label { font-size: 14px; color: #4B5563; }
    .credit-amount { font-size: 18px; font-weight: 700; color: #1F2937; }
    
    .plan-features { list-style: none; padding: 0; margin: 0 0 24px; }
    .plan-features li { padding: 10px 0; color: #4B5563; font-size: 14px; display: flex; align-items: flex-start; gap: 10px; }
    .plan-features li::before { content: '✓'; color: #10B981; font-weight: bold; font-size: 16px; flex-shrink: 0; }
    
    .plan-btn {
      width: 100%;
      padding: 16px;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      border: none;
    }
    .plan-btn-primary { background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%); color: white; }
    .plan-btn-pro { background: linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%); color: white; }
    .plan-btn-secondary { background: white; color: #374151; border: 2px solid #E5E7EB; }
    .plan-btn:hover:not(:disabled) { opacity: 0.9; transform: translateY(-2px); }
    .plan-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
    
    /* Credit Packs Section */
    .packs-section { background: white; border-radius: 24px; padding: 48px; margin-bottom: 48px; }
    
    .packs-tabs { display: flex; justify-content: center; gap: 8px; margin-bottom: 32px; }
    .pack-tab {
      padding: 12px 24px;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      border: 2px solid #E5E7EB;
      background: white;
      color: #4B5563;
      transition: all 0.2s;
    }
    .pack-tab:hover { border-color: #9CA3AF; }
    .pack-tab.active.cheaper { background: #ECFDF5; border-color: #10B981; color: #059669; }
    .pack-tab.active.better { background: #F3E8FF; border-color: #7C3AED; color: #6D28D9; }
    
    .packs-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
    @media (max-width: 800px) { .packs-grid { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 500px) { .packs-grid { grid-template-columns: 1fr; } }
    
    .pack-card {
      background: #F9FAFB;
      border-radius: 16px;
      padding: 24px;
      text-align: center;
      transition: all 0.2s;
      cursor: pointer;
      border: 2px solid transparent;
    }
    .pack-card:hover { background: white; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
    .pack-card.cheaper:hover { border-color: #10B981; }
    .pack-card.better:hover { border-color: #7C3AED; }
    
    .pack-price { font-size: 32px; font-weight: 800; color: #1F2937; margin-bottom: 8px; }
    .pack-credits { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
    .pack-credits.cheaper { color: #059669; }
    .pack-credits.better { color: #7C3AED; }
    .pack-per { font-size: 13px; color: #9CA3AF; }
    .pack-btn {
      margin-top: 16px;
      width: 100%;
      padding: 12px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
    }
    .pack-btn.cheaper { background: #10B981; color: white; }
    .pack-btn.cheaper:hover { background: #059669; }
    .pack-btn.better { background: #7C3AED; color: white; }
    .pack-btn.better:hover { background: #6D28D9; }
    .pack-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    
    .hidden { display: none !important; }
    
    /* How It Works */
    .how-it-works { background: #1F2937; border-radius: 24px; padding: 48px; color: white; margin-bottom: 48px; }
    .how-title { font-size: 24px; font-weight: 700; margin-bottom: 32px; text-align: center; }
    .how-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 32px; }
    @media (max-width: 700px) { .how-grid { grid-template-columns: 1fr; } }
    
    .how-card { display: flex; gap: 16px; }
    .how-icon { width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 24px; flex-shrink: 0; }
    .how-icon.green { background: rgba(16, 185, 129, 0.2); }
    .how-icon.purple { background: rgba(124, 58, 237, 0.2); }
    .how-text h3 { font-size: 16px; font-weight: 600; margin-bottom: 4px; }
    .how-text p { font-size: 14px; color: #9CA3AF; line-height: 1.5; }
    
    /* Comparison Table */
    .compare-table { width: 100%; border-collapse: collapse; margin-top: 24px; }
    .compare-table th, .compare-table td { padding: 16px; text-align: left; border-bottom: 1px solid #E5E7EB; }
    .compare-table th { font-weight: 600; color: #1F2937; background: #F9FAFB; }
    .compare-table td { color: #4B5563; }
    .compare-table tr:last-child td { border-bottom: none; }
    .model-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; }
    .model-badge.cheaper { background: #ECFDF5; color: #059669; }
    .model-badge.better { background: #F3E8FF; color: #6D28D9; }
  </style>
</head>
<body>
  <div class="pricing-container">
    <a href="/" class="back-link">← Back to ShopShot</a>
    
    <div class="pricing-header">
      <h1 class="pricing-title">Simple, Transparent Pricing</h1>
      <p class="pricing-subtitle">Choose your plan and start creating stunning product photos. Two credit types give you flexibility between speed and quality.</p>
      
      ${user ? `
      <div class="current-balance">
        <div class="balance-item">
          <div class="balance-label">Standard Credits</div>
          <div class="balance-value cheaper">${user.cheaper_credits}</div>
        </div>
        <div class="balance-item">
          <div class="balance-label">Pro Credits</div>
          <div class="balance-value better">${user.better_credits}</div>
        </div>
        <div class="balance-item">
          <div class="balance-label">Current Plan</div>
          <div class="balance-value" style="font-size:16px;color:#374151;">${userPlan === 'pro' ? 'Pro' : userPlan === 'standard' ? 'Standard' : 'Free'}</div>
        </div>
      </div>
      ` : ''}
    </div>
    
    <!-- Subscription Plans -->
    <h2 class="section-title">Monthly Subscriptions</h2>
    <p class="section-subtitle">Get fresh credits every month. Cancel anytime.</p>
    
    <div class="plans-grid">
      <!-- Free Tier -->
      <div class="plan-card ${!isStandard && !isPro && user ? 'current' : ''}">
        ${!isStandard && !isPro && user ? '<div class="badge current">Current Plan</div>' : ''}
        <div class="plan-name">Free</div>
        <div class="plan-price">£0</div>
        <div class="plan-period">to get started</div>
        
        <div class="plan-credits">
          <div class="credit-row">
            <div class="credit-type">
              <div class="credit-dot cheaper"></div>
              <span class="credit-label">Standard Credits</span>
            </div>
            <span class="credit-amount">${CREDITS.SIGNUP_CHEAPER}</span>
          </div>
          <div class="credit-row">
            <div class="credit-type">
              <div class="credit-dot better"></div>
              <span class="credit-label">Pro Credits</span>
            </div>
            <span class="credit-amount">${CREDITS.SIGNUP_BETTER}</span>
          </div>
        </div>
        
        <ul class="plan-features">
          <li>Both AI models available</li>
          <li>Download in high quality</li>
          <li>No credit card required</li>
          <li>Try before you buy</li>
        </ul>
        
        ${user 
          ? '<button class="plan-btn plan-btn-secondary" disabled>Your Starting Plan</button>' 
          : '<a href="/register" class="plan-btn plan-btn-secondary" style="text-decoration:none;display:block;text-align:center;">Sign Up Free</a>'}
      </div>
      
      <!-- Standard Plan -->
      <div class="plan-card featured ${isStandard ? 'current' : ''}">
        ${isStandard ? '<div class="badge current">Current Plan</div>' : '<div class="badge popular">Most Popular</div>'}
        <div class="plan-name">Standard</div>
        <div class="plan-price">£${PRICING.STANDARD}<span>/mo</span></div>
        <div class="plan-period">billed monthly</div>
        
        <div class="plan-credits">
          <div class="credit-row">
            <div class="credit-type">
              <div class="credit-dot cheaper"></div>
              <span class="credit-label">Standard Credits</span>
            </div>
            <span class="credit-amount">${CREDITS.STANDARD_CHEAPER}</span>
          </div>
          <div class="credit-row">
            <div class="credit-type">
              <div class="credit-dot better"></div>
              <span class="credit-label">Pro Credits</span>
            </div>
            <span class="credit-amount">${CREDITS.STANDARD_BETTER}</span>
          </div>
        </div>
        
        <ul class="plan-features">
          <li>~50 full product shoots/month</li>
          <li>Access to both AI models</li>
          <li>Priority generation queue</li>
          <li>Credits roll over (up to 2x)</li>
          <li>Cancel anytime</li>
        </ul>
        
        <button class="plan-btn plan-btn-primary" onclick="startCheckout('standard')" ${!user ? 'disabled title="Please sign up first"' : isStandard ? 'disabled' : ''}>
          ${isStandard ? 'Current Plan' : 'Get Standard'}
        </button>
      </div>
      
      <!-- Pro Plan -->
      <div class="plan-card ${isPro ? 'current' : ''}">
        ${isPro ? '<div class="badge current">Current Plan</div>' : '<div class="badge best">Best Value</div>'}
        <div class="plan-name">Pro</div>
        <div class="plan-price">£${PRICING.PRO}<span>/mo</span></div>
        <div class="plan-period">billed monthly</div>
        
        <div class="plan-credits">
          <div class="credit-row">
            <div class="credit-type">
              <div class="credit-dot cheaper"></div>
              <span class="credit-label">Standard Credits</span>
            </div>
            <span class="credit-amount">${CREDITS.PRO_CHEAPER}</span>
          </div>
          <div class="credit-row">
            <div class="credit-type">
              <div class="credit-dot better"></div>
              <span class="credit-label">Pro Credits</span>
            </div>
            <span class="credit-amount">${CREDITS.PRO_BETTER}</span>
          </div>
        </div>
        
        <ul class="plan-features">
          <li>~47 full product shoots/month</li>
          <li><strong>4x more Pro credits</strong></li>
          <li>Best quality image generation</li>
          <li>Priority support</li>
          <li>Cancel anytime</li>
        </ul>
        
        <button class="plan-btn plan-btn-pro" onclick="startCheckout('pro')" ${!user ? 'disabled title="Please sign up first"' : isPro ? 'disabled' : ''}>
          ${isPro ? 'Current Plan' : 'Get Pro'}
        </button>
      </div>
    </div>
    
    <!-- Credit Packs Section -->
    <div class="packs-section">
      <h2 class="section-title" style="margin-top:0;">Top-Up Credit Packs</h2>
      <p class="section-subtitle" style="margin-bottom:24px;">Need more credits? Buy one-time packs that never expire.</p>
      
      <div class="packs-tabs">
        <button class="pack-tab cheaper active" onclick="switchPackTab('cheaper')">
          Standard Credits (Fast)
        </button>
        <button class="pack-tab better" onclick="switchPackTab('better')">
          Pro Credits (Best Quality)
        </button>
      </div>
      
      <!-- Cheaper/Standard Packs -->
      <div id="packs-cheaper" class="packs-grid">
        <div class="pack-card cheaper" onclick="!${!user} && startPackCheckout('cheaper', 25)">
          <div class="pack-price">£25</div>
          <div class="pack-credits cheaper">${CREDITS.PACKS.CHEAPER.PACK_25} credits</div>
          <div class="pack-per">£0.063 per credit</div>
          <button class="pack-btn cheaper" ${!user ? 'disabled' : ''}>Buy Now</button>
        </div>
        <div class="pack-card cheaper" onclick="!${!user} && startPackCheckout('cheaper', 50)">
          <div class="pack-price">£50</div>
          <div class="pack-credits cheaper">${CREDITS.PACKS.CHEAPER.PACK_50} credits</div>
          <div class="pack-per">£0.063 per credit</div>
          <button class="pack-btn cheaper" ${!user ? 'disabled' : ''}>Buy Now</button>
        </div>
        <div class="pack-card cheaper" onclick="!${!user} && startPackCheckout('cheaper', 75)">
          <div class="pack-price">£75</div>
          <div class="pack-credits cheaper">${CREDITS.PACKS.CHEAPER.PACK_75} credits</div>
          <div class="pack-per">£0.063 per credit</div>
          <button class="pack-btn cheaper" ${!user ? 'disabled' : ''}>Buy Now</button>
        </div>
        <div class="pack-card cheaper" onclick="!${!user} && startPackCheckout('cheaper', 100)">
          <div class="pack-price">£100</div>
          <div class="pack-credits cheaper">${CREDITS.PACKS.CHEAPER.PACK_100} credits</div>
          <div class="pack-per">£0.063 per credit</div>
          <button class="pack-btn cheaper" ${!user ? 'disabled' : ''}>Buy Now</button>
        </div>
      </div>
      
      <!-- Better/Pro Packs -->
      <div id="packs-better" class="packs-grid hidden">
        <div class="pack-card better" onclick="!${!user} && startPackCheckout('better', 25)">
          <div class="pack-price">£25</div>
          <div class="pack-credits better">${CREDITS.PACKS.BETTER.PACK_25} credits</div>
          <div class="pack-per">£0.22 per credit</div>
          <button class="pack-btn better" ${!user ? 'disabled' : ''}>Buy Now</button>
        </div>
        <div class="pack-card better" onclick="!${!user} && startPackCheckout('better', 50)">
          <div class="pack-price">£50</div>
          <div class="pack-credits better">${CREDITS.PACKS.BETTER.PACK_50} credits</div>
          <div class="pack-per">£0.22 per credit</div>
          <button class="pack-btn better" ${!user ? 'disabled' : ''}>Buy Now</button>
        </div>
        <div class="pack-card better" onclick="!${!user} && startPackCheckout('better', 75)">
          <div class="pack-price">£75</div>
          <div class="pack-credits better">${CREDITS.PACKS.BETTER.PACK_75} credits</div>
          <div class="pack-per">£0.22 per credit</div>
          <button class="pack-btn better" ${!user ? 'disabled' : ''}>Buy Now</button>
        </div>
        <div class="pack-card better" onclick="!${!user} && startPackCheckout('better', 100)">
          <div class="pack-price">£100</div>
          <div class="pack-credits better">${CREDITS.PACKS.BETTER.PACK_100} credits</div>
          <div class="pack-per">£0.22 per credit</div>
          <button class="pack-btn better" ${!user ? 'disabled' : ''}>Buy Now</button>
        </div>
      </div>
      
      ${!user ? '<p style="text-align:center;color:#6B7280;margin-top:24px;font-size:14px;">Please <a href="/register" style="color:#3B82F6;">sign up</a> or <a href="/login" style="color:#3B82F6;">log in</a> to purchase credit packs.</p>' : ''}
    </div>
    
    <!-- How It Works -->
    <div class="how-it-works">
      <h2 class="how-title">How Credits Work</h2>
      <div class="how-grid">
        <div class="how-card">
          <div class="how-icon green">⚡</div>
          <div class="how-text">
            <h3>Standard Credits</h3>
            <p>Fast, reliable image generation. Amazing quality at high speed. 1 credit = 1 image.</p>
          </div>
        </div>
        <div class="how-card">
          <div class="how-icon purple">✨</div>
          <div class="how-text">
            <h3>Pro Credits</h3>
            <p>Best quality possible using our beta model. Premium results but may be slower or occasionally timeout. 1 credit = 1 image.</p>
          </div>
        </div>
        <div class="how-card">
          <div class="how-icon green">📸</div>
          <div class="how-text">
            <h3>Full Product Shoot</h3>
            <p>Upload one product image, get 10 professional variations. Uses 10 credits of either type based on your model choice.</p>
          </div>
        </div>
        <div class="how-card">
          <div class="how-icon purple">🔄</div>
          <div class="how-text">
            <h3>Single Regeneration</h3>
            <p>Don't like one image? Regenerate just that shot for 1 credit. Keep what works, redo what doesn't.</p>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Comparison Table -->
    <div style="background:white;border-radius:24px;padding:48px;margin-bottom:48px;">
      <h2 class="section-title" style="margin-top:0;">Model Comparison</h2>
      <table class="compare-table">
        <thead>
          <tr>
            <th>Feature</th>
            <th><span class="model-badge cheaper">Standard</span></th>
            <th><span class="model-badge better">Pro (Beta)</span></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>AI Model</td>
            <td>Fast & Reliable</td>
            <td>Best Quality (Beta)</td>
          </tr>
          <tr>
            <td>Generation Speed</td>
            <td>~2-3 seconds per image</td>
            <td>~3-4 seconds per image</td>
          </tr>
          <tr>
            <td>Image Quality</td>
            <td>Great (Professional)</td>
            <td>Best (Premium)</td>
          </tr>
          <tr>
            <td>Best For</td>
            <td>High-volume listings, quick iterations</td>
            <td>Hero images, marketing materials</td>
          </tr>
          <tr>
            <td>Cost per Image</td>
            <td>1 Standard credit</td>
            <td>1 Pro credit</td>
          </tr>
        </tbody>
      </table>
    </div>
    
    <!-- FAQ -->
    <div style="text-align:center;padding:32px 0;">
      <p style="color:#6B7280;font-size:14px;margin-bottom:8px;">Questions? <a href="mailto:support@shopshot.ai" style="color:#3B82F6;">Contact Support</a></p>
      <p style="color:#9CA3AF;font-size:13px;">All plans include a 7-day money-back guarantee. No questions asked.</p>
    </div>
  </div>

  <script>
    function switchPackTab(type) {
      document.querySelectorAll('.pack-tab').forEach(t => t.classList.remove('active'));
      document.querySelector('.pack-tab.' + type).classList.add('active');
      document.getElementById('packs-cheaper').classList.toggle('hidden', type !== 'cheaper');
      document.getElementById('packs-better').classList.toggle('hidden', type !== 'better');
    }
    
    async function startCheckout(plan) {
      ${!user ? 'window.location.href = "/register"; return;' : ''}
      try {
        const btn = event.target;
        btn.disabled = true;
        btn.textContent = 'Loading...';
        
        const res = await fetch('/api/billing/create-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'subscription', plan })
        });
        
        const data = await res.json();
        if (data.success && data.url) {
          window.location.href = data.url;
        } else {
          alert(data.error || 'Failed to start checkout');
          btn.disabled = false;
          btn.textContent = plan === 'pro' ? 'Get Pro' : 'Get Standard';
        }
      } catch (err) {
        alert('Something went wrong');
        location.reload();
      }
    }
    
    async function startPackCheckout(creditType, amount) {
      ${!user ? 'window.location.href = "/register"; return;' : ''}
      try {
        const res = await fetch('/api/billing/create-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'pack', creditType, amount })
        });
        
        const data = await res.json();
        if (data.success && data.url) {
          window.location.href = data.url;
        } else {
          alert(data.error || 'Failed to start checkout');
        }
      } catch (err) {
        alert('Something went wrong');
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
  const planName = user.subscription_plan === 'pro' ? 'Pro' : user.subscription_plan === 'standard' ? 'Standard' : 'Free';
  const totalCredits = user.cheaper_credits + user.better_credits;
  
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
    * { font-family: 'Inter', system-ui, sans-serif; box-sizing: border-box; }
    body { background: #F9FAFB; min-height: 100vh; }
    .dashboard { max-width: 1000px; margin: 0 auto; padding: 32px 24px; }
    .dash-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 32px; flex-wrap: wrap; gap: 16px; }
    .dash-title { font-size: 28px; font-weight: 700; color: #1F2937; }
    .dash-nav { display: flex; gap: 12px; }
    .dash-nav a { padding: 8px 16px; background: white; border: 1px solid #E5E7EB; border-radius: 8px; color: #374151; text-decoration: none; font-size: 13px; font-weight: 500; transition: all 0.2s; }
    .dash-nav a:hover { background: #F3F4F6; }
    
    /* Credits Overview */
    .credits-overview { background: white; border-radius: 16px; padding: 24px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    .credits-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
    .credits-title { font-size: 18px; font-weight: 600; color: #1F2937; }
    .credits-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    @media (max-width: 600px) { .credits-grid { grid-template-columns: 1fr; } }
    
    .credit-card { background: #F9FAFB; border-radius: 12px; padding: 20px; text-align: center; border: 2px solid transparent; transition: all 0.2s; }
    .credit-card:hover { border-color: #E5E7EB; }
    .credit-card.standard { background: linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%); }
    .credit-card.pro { background: linear-gradient(135deg, #F3E8FF 0%, #E9D5FF 100%); }
    .credit-card.total { background: linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%); }
    
    .credit-icon { width: 48px; height: 48px; border-radius: 12px; margin: 0 auto 12px; display: flex; align-items: center; justify-content: center; font-size: 24px; }
    .credit-icon.standard { background: #10B981; }
    .credit-icon.pro { background: #7C3AED; }
    .credit-icon.total { background: #3B82F6; }
    
    .credit-label { font-size: 13px; color: #6B7280; margin-bottom: 4px; }
    .credit-value { font-size: 32px; font-weight: 800; }
    .credit-value.standard { color: #059669; }
    .credit-value.pro { color: #6D28D9; }
    .credit-value.total { color: #2563EB; }
    .credit-sub { font-size: 12px; color: #9CA3AF; margin-top: 4px; }
    
    /* Stats Grid */
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 32px; }
    .stat-card { background: white; border-radius: 12px; padding: 20px; border: 1px solid #E5E7EB; }
    .stat-label { font-size: 13px; color: #6B7280; margin-bottom: 4px; }
    .stat-value { font-size: 24px; font-weight: 700; color: #1F2937; }
    .stat-sub { font-size: 12px; color: #9CA3AF; margin-top: 4px; }
    .stat-badge { display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
    .stat-badge.free { background: #F3F4F6; color: #6B7280; }
    .stat-badge.standard { background: #ECFDF5; color: #059669; }
    .stat-badge.pro { background: #F3E8FF; color: #6D28D9; }
    
    .action-btn {
      display: inline-block;
      padding: 12px 24px;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.2s;
    }
    .action-btn:hover { opacity: 0.9; transform: translateY(-1px); }
    
    .section-title { font-size: 18px; font-weight: 600; color: #1F2937; margin-bottom: 16px; }
    
    /* History List */
    .history-list { background: white; border-radius: 12px; border: 1px solid #E5E7EB; overflow: hidden; }
    .history-item { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid #F3F4F6; transition: background 0.2s; }
    .history-item:last-child { border-bottom: none; }
    .history-info { display: flex; align-items: center; gap: 12px; }
    .history-icon { width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; }
    .history-icon.positive { background: #DCFCE7; }
    .history-icon.negative.standard { background: #ECFDF5; }
    .history-icon.negative.pro { background: #F3E8FF; }
    .history-icon.negative { background: #FEE2E2; }
    .history-text { font-size: 14px; color: #374151; }
    .history-date { font-size: 12px; color: #9CA3AF; }
    .history-meta { display: flex; align-items: center; gap: 8px; }
    .history-amount { font-size: 14px; font-weight: 600; }
    .history-amount.positive { color: #059669; }
    .history-amount.negative { color: #DC2626; }
    .credit-type-badge { padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; text-transform: uppercase; }
    .credit-type-badge.standard { background: #ECFDF5; color: #059669; }
    .credit-type-badge.pro { background: #F3E8FF; color: #6D28D9; }
    .empty-state { padding: 48px; text-align: center; color: #9CA3AF; }
    
    .history-item.clickable { cursor: pointer; }
    .history-item.clickable:hover { background: #F9FAFB; }
    .history-thumb { width: 40px; height: 40px; border-radius: 8px; object-fit: cover; }
    .view-hint { font-size: 11px; color: #3B82F6; margin-left: 8px; }
    
    /* Modal */
    .image-modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.85);
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }
    .image-modal-overlay.show { display: flex; }
    .image-modal-content {
      background: white;
      border-radius: 16px;
      max-width: 90vw;
      max-height: 90vh;
      overflow: hidden;
      position: relative;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .image-modal-content img {
      max-width: 100%;
      max-height: 70vh;
      display: block;
    }
    .image-modal-close {
      position: absolute;
      top: 12px;
      right: 12px;
      background: rgba(0,0,0,0.6);
      color: white;
      border: none;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      cursor: pointer;
      font-size: 20px;
      line-height: 1;
      transition: background 0.2s;
    }
    .image-modal-close:hover { background: rgba(0,0,0,0.8); }
    .modal-download-btn {
      display: block;
      text-align: center;
      padding: 14px;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      color: white;
      text-decoration: none;
      font-weight: 600;
      transition: opacity 0.2s;
    }
    .modal-download-btn:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="dashboard">
    <div class="dash-header">
      <h1 class="dash-title">Dashboard</h1>
      <div class="dash-nav">
        <a href="/">← Back to Generator</a>
        <a href="/account">Account</a>
        <a href="/pricing">Get Credits</a>
      </div>
    </div>
    
    <!-- Credits Overview -->
    <div class="credits-overview">
      <div class="credits-header">
        <h2 class="credits-title">Your Credits</h2>
        <a href="/pricing" class="action-btn">+ Get More Credits</a>
      </div>
      <div class="credits-grid">
        <div class="credit-card standard">
          <div class="credit-icon standard">⚡</div>
          <div class="credit-label">Standard Credits</div>
          <div class="credit-value standard">${user.cheaper_credits}</div>
          <div class="credit-sub">Fast & Reliable</div>
        </div>
        <div class="credit-card pro">
          <div class="credit-icon pro">✨</div>
          <div class="credit-label">Pro Credits</div>
          <div class="credit-value pro">${user.better_credits}</div>
          <div class="credit-sub">Best Quality (Beta)</div>
        </div>
        <div class="credit-card total">
          <div class="credit-icon total">📸</div>
          <div class="credit-label">Total Credits</div>
          <div class="credit-value total">${totalCredits}</div>
          <div class="credit-sub">~${Math.floor(totalCredits / 10)} shoots remaining</div>
        </div>
      </div>
    </div>
    
    <!-- Stats Grid -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Current Plan</div>
        <div class="stat-badge ${user.subscription_plan}">${planName}</div>
        <div class="stat-sub" style="margin-top:8px;">${user.subscription_status === 'active' ? 'Active subscription' : 'No active subscription'}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Standard Shoots</div>
        <div class="stat-value">${Math.floor(user.cheaper_credits / 10)}</div>
        <div class="stat-sub">10 images per shoot</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Pro Shoots</div>
        <div class="stat-value">${Math.floor(user.better_credits / 10)}</div>
        <div class="stat-sub">Premium quality</div>
      </div>
    </div>
    
    <h2 class="section-title">Credit History</h2>
    <p style="font-size:13px;color:#6B7280;margin-bottom:16px;">Click on any generated image to view it in full size</p>
    <div class="history-list" id="history-list">
      <div class="empty-state">Loading...</div>
    </div>
  </div>
  
  <!-- Image Lightbox Modal -->
  <div id="image-modal" class="image-modal-overlay" onclick="if(event.target === this) closeImageModal()">
    <div class="image-modal-content">
      <button class="image-modal-close" onclick="closeImageModal()">&times;</button>
      <img id="modal-image" src="" alt="Generated Image">
      <div id="modal-label" style="text-align:center;padding:16px;color:#374151;font-weight:500;"></div>
      <a id="modal-download" class="modal-download-btn" download="shopshot-image.png">Download Image</a>
    </div>
  </div>

  <script>
    let historyTransactions = [];
    
    function openImageModal(transactionId) {
      const t = historyTransactions.find(x => x.id === transactionId);
      if (!t || !t.image_data) return;
      
      const modal = document.getElementById('image-modal');
      const img = document.getElementById('modal-image');
      const label = document.getElementById('modal-label');
      const download = document.getElementById('modal-download');
      
      img.src = t.image_data;
      label.textContent = t.description || 'Generated Image';
      download.href = t.image_data;
      download.download = (t.description || 'shopshot-image').replace(/[^a-z0-9]/gi, '-') + '.png';
      
      modal.classList.add('show');
    }
    
    function closeImageModal() {
      document.getElementById('image-modal').classList.remove('show');
    }
    
    async function loadHistory() {
      try {
        const res = await fetch('/api/credits/history');
        const data = await res.json();
        const list = document.getElementById('history-list');
        
        if (!data.success || !data.transactions?.length) {
          list.innerHTML = '<div class="empty-state">No credit transactions yet. Start generating images!</div>';
          return;
        }
        
        historyTransactions = data.transactions;
        
        list.innerHTML = data.transactions.map(t => {
          const isPositive = t.amount > 0;
          const icon = isPositive ? '➕' : '🖼️';
          const date = new Date(t.created_at).toLocaleDateString();
          const hasImage = t.image_data && t.image_data.length > 100;
          const clickable = hasImage ? 'clickable' : '';
          const onClick = hasImage ? \`onclick="openImageModal('\${t.id}')"\` : '';
          const thumb = hasImage ? \`<img class="history-thumb" src="\${t.image_data}" alt="Thumbnail">\` : '';
          const viewHint = hasImage ? '<span class="view-hint">View Image</span>' : '';
          
          // Determine credit type from description or type
          const creditType = t.credit_type || (t.description?.includes('Pro') ? 'pro' : 'standard');
          const creditBadge = !isPositive ? \`<span class="credit-type-badge \${creditType}">\${creditType}</span>\` : '';
          const iconClass = !isPositive ? \`negative \${creditType}\` : 'positive';
          
          return \`
            <div class="history-item \${clickable}" \${onClick}>
              <div class="history-info">
                \${thumb || \`<div class="history-icon \${iconClass}">\${icon}</div>\`}
                <div>
                  <div class="history-text">\${t.description || t.type}\${viewHint}</div>
                  <div class="history-date">\${date}</div>
                </div>
              </div>
              <div class="history-meta">
                \${creditBadge}
                <div class="history-amount \${isPositive ? 'positive' : 'negative'}">
                  \${isPositive ? '+' : ''}\${t.amount}
                </div>
              </div>
            </div>
          \`;
        }).join('');
      } catch (e) {
        console.error('Load history failed:', e);
        document.getElementById('history-list').innerHTML = '<div class="empty-state">Failed to load history</div>';
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
  const planName = user.subscription_plan === 'pro' ? 'Pro' : user.subscription_plan === 'standard' ? 'Standard' : 'Free';
  const planBadgeClass = user.subscription_plan === 'pro' ? 'pro' : user.subscription_plan === 'standard' ? 'standard' : 'free';
  
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
    * { font-family: 'Inter', system-ui, sans-serif; box-sizing: border-box; }
    body { background: #F9FAFB; min-height: 100vh; }
    .account { max-width: 700px; margin: 0 auto; padding: 32px 24px; }
    .account-header { margin-bottom: 32px; }
    .account-title { font-size: 28px; font-weight: 700; color: #1F2937; margin-bottom: 8px; }
    .account-nav { display: flex; gap: 12px; margin-top: 16px; flex-wrap: wrap; }
    .account-nav a { padding: 8px 16px; background: white; border: 1px solid #E5E7EB; border-radius: 8px; color: #374151; text-decoration: none; font-size: 13px; transition: all 0.2s; }
    .account-nav a:hover { background: #F3F4F6; }
    
    .section { background: white; border-radius: 16px; border: 1px solid #E5E7EB; padding: 24px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.03); }
    .section-title { font-size: 16px; font-weight: 600; color: #1F2937; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
    .section-icon { width: 24px; height: 24px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 14px; }
    
    .info-row { display: flex; justify-content: space-between; align-items: center; padding: 14px 0; border-bottom: 1px solid #F3F4F6; }
    .info-row:last-child { border-bottom: none; }
    .info-label { color: #6B7280; font-size: 14px; }
    .info-value { color: #1F2937; font-size: 14px; font-weight: 500; }
    
    .plan-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
    .plan-badge.free { background: #F3F4F6; color: #6B7280; }
    .plan-badge.standard { background: #ECFDF5; color: #059669; }
    .plan-badge.pro { background: #F3E8FF; color: #6D28D9; }
    
    .status-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
    .status-badge.active { background: #DCFCE7; color: #166534; }
    .status-badge.free { background: #F3F4F6; color: #6B7280; }
    .status-badge.canceled { background: #FEF3C7; color: #92400E; }
    .status-badge.past_due { background: #FEE2E2; color: #DC2626; }
    
    /* Credits Display */
    .credits-section { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-top: 16px; }
    @media (max-width: 500px) { .credits-section { grid-template-columns: 1fr; } }
    
    .credit-box { background: #F9FAFB; border-radius: 12px; padding: 16px; text-align: center; }
    .credit-box.standard { background: linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%); }
    .credit-box.pro { background: linear-gradient(135deg, #F3E8FF 0%, #E9D5FF 100%); }
    
    .credit-box-label { font-size: 12px; color: #6B7280; margin-bottom: 4px; }
    .credit-box-value { font-size: 28px; font-weight: 800; }
    .credit-box-value.standard { color: #059669; }
    .credit-box-value.pro { color: #6D28D9; }
    .credit-box-sub { font-size: 11px; color: #9CA3AF; margin-top: 4px; }
    
    .btn { padding: 12px 20px; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; text-decoration: none; display: inline-flex; align-items: center; gap: 6px; }
    .btn-primary { background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%); color: white; border: none; }
    .btn-secondary { background: white; color: #374151; border: 1px solid #E5E7EB; }
    .btn-danger { background: #FEF2F2; color: #DC2626; border: 1px solid #FECACA; }
    .btn:hover { opacity: 0.9; transform: translateY(-1px); }
    
    .btn-group { margin-top: 20px; display: flex; gap: 12px; flex-wrap: wrap; }
  </style>
</head>
<body>
  <div class="account">
    <div class="account-header">
      <h1 class="account-title">Account Settings</h1>
      <div class="account-nav">
        <a href="/">← Back to Generator</a>
        <a href="/dashboard">Dashboard</a>
        <a href="/pricing">Pricing</a>
      </div>
    </div>
    
    <div class="section">
      <h2 class="section-title">
        <span class="section-icon" style="background:#EFF6FF;">👤</span>
        Profile
      </h2>
      <div class="info-row">
        <span class="info-label">Email</span>
        <span class="info-value">${user.email}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Name</span>
        <span class="info-value">${user.name || 'Not set'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Member Since</span>
        <span class="info-value">Recently joined</span>
      </div>
    </div>
    
    <div class="section">
      <h2 class="section-title">
        <span class="section-icon" style="background:#F3E8FF;">💳</span>
        Subscription & Credits
      </h2>
      <div class="info-row">
        <span class="info-label">Current Plan</span>
        <span class="plan-badge ${planBadgeClass}">${planName}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Status</span>
        <span class="status-badge ${user.subscription_status}">${user.subscription_status === 'active' ? 'Active' : user.subscription_status === 'free' ? 'Free Tier' : user.subscription_status}</span>
      </div>
      
      <div class="credits-section">
        <div class="credit-box standard">
          <div class="credit-box-label">Standard Credits</div>
          <div class="credit-box-value standard">${user.cheaper_credits}</div>
          <div class="credit-box-sub">⚡ Fast & Reliable</div>
        </div>
        <div class="credit-box pro">
          <div class="credit-box-label">Pro Credits</div>
          <div class="credit-box-value pro">${user.better_credits}</div>
          <div class="credit-box-sub">✨ Best Quality (Beta)</div>
        </div>
      </div>
      
      <div class="btn-group">
        <a href="/pricing" class="btn btn-primary">+ Get More Credits</a>
        ${user.stripe_customer_id ? '<button class="btn btn-secondary" onclick="openBillingPortal()">Manage Billing</button>' : ''}
        ${user.subscription_plan !== 'free' && user.subscription_plan !== 'pro' ? '<a href="/pricing" class="btn btn-secondary">Upgrade to Pro</a>' : ''}
      </div>
    </div>
    
    <div class="section">
      <h2 class="section-title">
        <span class="section-icon" style="background:#ECFDF5;">📊</span>
        Quick Stats
      </h2>
      <div class="info-row">
        <span class="info-label">Standard Shoots Remaining</span>
        <span class="info-value">${Math.floor(user.cheaper_credits / 10)} shoots</span>
      </div>
      <div class="info-row">
        <span class="info-label">Pro Shoots Remaining</span>
        <span class="info-value">${Math.floor(user.better_credits / 10)} shoots</span>
      </div>
      <div class="info-row">
        <span class="info-label">Total Images Available</span>
        <span class="info-value">${user.cheaper_credits + user.better_credits} images</span>
      </div>
    </div>
    
    <div class="section">
      <h2 class="section-title">
        <span class="section-icon" style="background:#FEE2E2;">⚙️</span>
        Account Actions
      </h2>
      <div class="btn-group" style="margin-top:0;">
        <button class="btn btn-secondary" onclick="logout()">Log Out</button>
      </div>
      <p style="font-size:12px;color:#9CA3AF;margin-top:16px;">Need help? Contact <a href="mailto:support@shopshot.ai" style="color:#3B82F6;">support@shopshot.ai</a></p>
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
