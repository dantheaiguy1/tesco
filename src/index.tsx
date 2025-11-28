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
  // Email (Resend)
  RESEND_API_KEY: string;
  // Google OAuth
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
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
  email_verified: boolean;
  google_id: string | null;
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
      responseModalities: ['TEXT', 'IMAGE']
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
// EMAIL VERIFICATION (Resend)
// ============================================================================
function generateVerificationCode(): string {
  // Generate 6-digit code
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendVerificationEmail(apiKey: string, to: string, code: string, name?: string): Promise<boolean> {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        // Use Resend sandbox until shopshot.ai domain is verified in Resend
        from: 'ShopShot <onboarding@resend.dev>',
        to: [to],
        subject: 'Verify your ShopShot account',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #F3F4F6; padding: 40px 20px; margin: 0;">
            <div style="max-width: 480px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
              <div style="background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%); padding: 32px; text-align: center;">
                <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 700;">ShopShot</h1>
                <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 14px;">AI Product Photography</p>
              </div>
              <div style="padding: 40px 32px; text-align: center;">
                <h2 style="color: #1F2937; margin: 0 0 12px; font-size: 24px;">Verify your email</h2>
                <p style="color: #6B7280; margin: 0 0 32px; font-size: 15px; line-height: 1.5;">
                  ${name ? `Hi ${name}! ` : ''}Enter this code to complete your registration:
                </p>
                <div style="background: linear-gradient(135deg, #EEF2FF 0%, #E0E7FF 100%); border: 2px dashed #C7D2FE; border-radius: 12px; padding: 24px; margin-bottom: 32px;">
                  <span style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #4338CA;">${code}</span>
                </div>
                <p style="color: #9CA3AF; font-size: 13px; margin: 0;">
                  This code expires in 10 minutes.<br>
                  If you didn't create an account, you can ignore this email.
                </p>
              </div>
              <div style="background: #F9FAFB; padding: 20px 32px; text-align: center; border-top: 1px solid #E5E7EB;">
                <p style="color: #9CA3AF; font-size: 12px; margin: 0;">
                  &copy; 2024 ShopShot. All rights reserved.
                </p>
              </div>
            </div>
          </body>
          </html>
        `
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error('Resend error:', error);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Email send error:', error);
    return false;
  }
}

// ============================================================================
// PASSWORD RESET EMAIL
// ============================================================================
async function sendPasswordResetEmail(apiKey: string, to: string, resetLink: string, name?: string): Promise<boolean> {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'ShopShot <onboarding@resend.dev>',
        to: [to],
        subject: 'Reset your ShopShot password',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #F3F4F6; padding: 40px 20px; margin: 0;">
            <div style="max-width: 480px; margin: 0 auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
              <div style="background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%); padding: 32px; text-align: center;">
                <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 700;">ShopShot</h1>
                <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 14px;">AI Product Photography</p>
              </div>
              <div style="padding: 40px 32px; text-align: center;">
                <h2 style="color: #1F2937; margin: 0 0 12px; font-size: 24px;">Reset your password</h2>
                <p style="color: #6B7280; margin: 0 0 32px; font-size: 15px; line-height: 1.5;">
                  ${name ? `Hi ${name}! ` : ''}Click the button below to reset your password:
                </p>
                <a href="${resetLink}" style="display: inline-block; background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 15px; margin-bottom: 32px;">
                  Reset Password
                </a>
                <p style="color: #9CA3AF; font-size: 13px; margin: 24px 0 0;">
                  This link expires in 1 hour.<br>
                  If you didn't request a password reset, you can ignore this email.
                </p>
                <p style="color: #D1D5DB; font-size: 11px; margin: 16px 0 0; word-break: break-all;">
                  Or copy this link: ${resetLink}
                </p>
              </div>
              <div style="background: #F9FAFB; padding: 20px 32px; text-align: center; border-top: 1px solid #E5E7EB;">
                <p style="color: #9CA3AF; font-size: 12px; margin: 0;">
                  &copy; 2024 ShopShot. All rights reserved.
                </p>
              </div>
            </div>
          </body>
          </html>
        `
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error('Resend error:', error);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Password reset email error:', error);
    return false;
  }
}

// ============================================================================
// ERROR LOGGING HELPER
// ============================================================================
async function logError(
  db: D1Database,
  errorType: string,
  errorMessage: string,
  options: {
    userId?: string;
    endpoint?: string;
    stackTrace?: string;
    severity?: 'info' | 'warning' | 'critical';
  } = {}
): Promise<void> {
  try {
    await db.prepare(`
      INSERT INTO error_logs (error_type, error_message, user_id, endpoint, stack_trace, severity)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      errorType,
      errorMessage,
      options.userId || null,
      options.endpoint || null,
      options.stackTrace || null,
      options.severity || 'warning'
    ).run();
  } catch (e) {
    console.error('Failed to log error:', e);
  }
}

// ============================================================================
// GOOGLE OAUTH HELPERS
// ============================================================================
function getGoogleAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: state,
    access_type: 'offline',
    prompt: 'consent'
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function exchangeGoogleCode(
  code: string, 
  clientId: string, 
  clientSecret: string, 
  redirectUri: string
): Promise<{ access_token: string; id_token: string } | null> {
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });
    
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function getGoogleUserInfo(accessToken: string): Promise<{
  id: string;
  email: string;
  name: string;
  picture: string;
} | null> {
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
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
    stripe_customer_id: session.stripe_customer_id,
    role: session.role || 'user',
    is_banned: session.is_banned || 0
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
  `).bind(transactionId, userId, -amount, newBalance, creditType, type, description, sessionId || null, null).run(); // Don't store image_data to avoid SQLITE_TOOBIG error
  
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
    
    // Add email verification and Google OAuth columns
    try {
      await db.prepare('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0').run();
    } catch (e) { /* Column exists */ }
    try {
      await db.prepare('ALTER TABLE users ADD COLUMN email_verification_code TEXT').run();
    } catch (e) { /* Column exists */ }
    try {
      await db.prepare('ALTER TABLE users ADD COLUMN email_verification_expires DATETIME').run();
    } catch (e) { /* Column exists */ }
    try {
      await db.prepare('ALTER TABLE users ADD COLUMN google_id TEXT').run();
    } catch (e) { /* Column exists */ }
    try {
      await db.prepare('ALTER TABLE users ADD COLUMN password_hash_nullable TEXT').run();
      // For Google OAuth users who don't have a password
    } catch (e) { /* Column exists */ }
    
    // Add role column for admin access
    try {
      await db.prepare("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'").run();
    } catch (e) { /* Column exists */ }
    
    // Add is_banned column for user management
    try {
      await db.prepare('ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0').run();
    } catch (e) { /* Column exists */ }
    
    // Add password reset columns
    try {
      await db.prepare('ALTER TABLE users ADD COLUMN password_reset_token TEXT').run();
    } catch (e) { /* Column exists */ }
    try {
      await db.prepare('ALTER TABLE users ADD COLUMN password_reset_expires DATETIME').run();
    } catch (e) { /* Column exists */ }
    
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
    
    // Error logs table (for admin dashboard)
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS error_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        error_type TEXT NOT NULL,
        error_message TEXT,
        user_id TEXT,
        endpoint TEXT,
        stack_trace TEXT,
        severity TEXT DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical'))
      )
    `).run()
    
    // Admin actions audit log
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS admin_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        target_user_id TEXT,
        details TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (admin_id) REFERENCES users(id)
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
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_error_logs_timestamp ON error_logs(timestamp DESC)').run()
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_error_logs_user ON error_logs(user_id)').run()
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_admin_actions_admin ON admin_actions(admin_id)').run()
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)').run()
    
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

// Forgot password page
app.get('/forgot-password', (c) => {
  const user = c.get('user')
  if (user) return c.redirect('/')
  return c.html(getForgotPasswordPage())
})

// Reset password page
app.get('/reset-password', (c) => {
  const user = c.get('user')
  if (user) return c.redirect('/')
  const token = c.req.query('token')
  if (!token) return c.redirect('/forgot-password')
  return c.html(getResetPasswordPage(token))
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

// ============================================================================
// ADMIN DASHBOARD ROUTES
// ============================================================================

// Admin dashboard page
app.get('/admin', (c) => {
  const user = c.get('user') as any
  if (!user) return c.redirect('/login?redirect=/admin')
  if (user.role !== 'admin') return c.redirect('/?error=unauthorized')
  return c.html(getAdminDashboardPage(user))
})

// Admin API: Get dashboard data
app.get('/api/admin/dashboard', async (c) => {
  const user = c.get('user') as any
  if (!user) return c.json({ success: false, error: 'Not authenticated' }, 401)
  if (user.role !== 'admin') return c.json({ success: false, error: 'Not authorized' }, 403)
  
  const db = c.env.TESCO_DB
  
  try {
    // KPIs
    const totalUsers = await db.prepare('SELECT COUNT(*) as count FROM users').first() as any
    const activeMembers = await db.prepare("SELECT COUNT(*) as count FROM users WHERE subscription_status = 'active'").first() as any
    const mrr = await db.prepare(`
      SELECT SUM(
        CASE 
          WHEN subscription_plan = 'standard' THEN 39.99
          WHEN subscription_plan = 'pro' THEN 59.99
          ELSE 0
        END
      ) as mrr FROM users WHERE subscription_status = 'active'
    `).first() as any
    
    const creditsConsumed = await db.prepare(`
      SELECT SUM(ABS(amount)) as consumed FROM credit_transactions 
      WHERE amount < 0 AND created_at > datetime('now', '-30 days')
    `).first() as any
    
    // Recent signups (last 30 days, grouped by day)
    const dailySignups = await db.prepare(`
      SELECT date(created_at) as date, COUNT(*) as count
      FROM users 
      WHERE created_at > datetime('now', '-30 days')
      GROUP BY date(created_at)
      ORDER BY date DESC
    `).all() as any
    
    // Recent cancellations (last 30 days, grouped by day)
    const dailyCancellations = await db.prepare(`
      SELECT date(updated_at) as date, COUNT(*) as count
      FROM users 
      WHERE subscription_status = 'canceled' AND updated_at > datetime('now', '-30 days')
      GROUP BY date(updated_at)
      ORDER BY date DESC
    `).all() as any
    
    // Recent signups list (last 7 days with details)
    const recentSignups = await db.prepare(`
      SELECT id, name, email, created_at, subscription_plan FROM users 
      WHERE created_at > datetime('now', '-7 days')
      ORDER BY created_at DESC
      LIMIT 100
    `).all() as any
    
    // Recent cancellations list (last 7 days with details)
    const recentCancellations = await db.prepare(`
      SELECT id, name, email, updated_at, subscription_plan FROM users 
      WHERE subscription_status = 'canceled' AND updated_at > datetime('now', '-7 days')
      ORDER BY updated_at DESC
      LIMIT 100
    `).all() as any
    
    // Revenue by plan
    const planBreakdown = await db.prepare(`
      SELECT 
        subscription_plan as plan,
        COUNT(*) as count,
        SUM(CASE 
          WHEN subscription_plan = 'standard' THEN 39.99
          WHEN subscription_plan = 'pro' THEN 59.99
          ELSE 0
        END) as revenue
      FROM users 
      WHERE subscription_status = 'active' OR subscription_plan = 'free'
      GROUP BY subscription_plan
    `).all() as any
    
    // Recent errors
    const recentErrors = await db.prepare(`
      SELECT e.*, u.email as user_email FROM error_logs e
      LEFT JOIN users u ON e.user_id = u.id
      WHERE e.timestamp > datetime('now', '-24 hours')
      ORDER BY e.timestamp DESC
      LIMIT 50
    `).all() as any
    
    // Recent transactions
    const recentTransactions = await db.prepare(`
      SELECT ct.*, u.email as user_email FROM credit_transactions ct
      LEFT JOIN users u ON ct.user_id = u.id
      ORDER BY ct.created_at DESC
      LIMIT 20
    `).all() as any
    
    // Daily revenue for chart (last 30 days)
    const dailyRevenue = await db.prepare(`
      SELECT date(created_at) as date, 
        SUM(CASE WHEN amount > 0 AND type IN ('topup', 'subscription') THEN amount * 0.04 ELSE 0 END) as revenue,
        COUNT(*) as transactions
      FROM credit_transactions 
      WHERE created_at > datetime('now', '-30 days')
      GROUP BY date(created_at)
      ORDER BY date ASC
    `).all() as any
    
    return c.json({
      success: true,
      kpis: {
        totalUsers: totalUsers?.count || 0,
        activeMembers: activeMembers?.count || 0,
        mrr: mrr?.mrr || 0,
        creditsConsumed: creditsConsumed?.consumed || 0
      },
      dailySignups: dailySignups?.results || [],
      dailyCancellations: dailyCancellations?.results || [],
      recentSignups: recentSignups?.results || [],
      recentCancellations: recentCancellations?.results || [],
      planBreakdown: planBreakdown?.results || [],
      recentErrors: recentErrors?.results || [],
      recentTransactions: recentTransactions?.results || [],
      dailyRevenue: dailyRevenue?.results || []
    })
  } catch (error) {
    console.error('Admin dashboard error:', error)
    return c.json({ success: false, error: 'Failed to load dashboard data' }, 500)
  }
})

// Admin API: Get user details
app.get('/api/admin/users/:id', async (c) => {
  const user = c.get('user') as any
  if (!user) return c.json({ success: false, error: 'Not authenticated' }, 401)
  if (user.role !== 'admin') return c.json({ success: false, error: 'Not authorized' }, 403)
  
  const db = c.env.TESCO_DB
  const userId = c.req.param('id')
  
  try {
    const targetUser = await db.prepare(`
      SELECT id, email, name, cheaper_credits, better_credits, subscription_status, 
             subscription_plan, created_at, updated_at, role, is_banned, google_id
      FROM users WHERE id = ?
    `).bind(userId).first()
    
    if (!targetUser) {
      return c.json({ success: false, error: 'User not found' }, 404)
    }
    
    const transactions = await db.prepare(`
      SELECT * FROM credit_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
    `).bind(userId).all() as any
    
    const sessions = await db.prepare(`
      SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20
    `).bind(userId).all() as any
    
    return c.json({
      success: true,
      user: targetUser,
      transactions: transactions?.results || [],
      sessions: sessions?.results || []
    })
  } catch (error) {
    console.error('Admin user details error:', error)
    return c.json({ success: false, error: 'Failed to load user details' }, 500)
  }
})

// Admin API: Search users
app.get('/api/admin/users', async (c) => {
  const user = c.get('user') as any
  if (!user) return c.json({ success: false, error: 'Not authenticated' }, 401)
  if (user.role !== 'admin') return c.json({ success: false, error: 'Not authorized' }, 403)
  
  const db = c.env.TESCO_DB
  const search = c.req.query('search') || ''
  const limit = parseInt(c.req.query('limit') || '50')
  
  try {
    let users
    if (search) {
      users = await db.prepare(`
        SELECT id, email, name, cheaper_credits, better_credits, subscription_status, 
               subscription_plan, created_at, role, is_banned
        FROM users 
        WHERE email LIKE ? OR name LIKE ?
        ORDER BY created_at DESC
        LIMIT ?
      `).bind(`%${search}%`, `%${search}%`, limit).all() as any
    } else {
      users = await db.prepare(`
        SELECT id, email, name, cheaper_credits, better_credits, subscription_status, 
               subscription_plan, created_at, role, is_banned
        FROM users 
        ORDER BY created_at DESC
        LIMIT ?
      `).bind(limit).all() as any
    }
    
    return c.json({ success: true, users: users?.results || [] })
  } catch (error) {
    console.error('Admin user search error:', error)
    return c.json({ success: false, error: 'Failed to search users' }, 500)
  }
})

// Admin API: Add credits to user
app.post('/api/admin/users/:id/credits', async (c) => {
  const user = c.get('user') as any
  if (!user) return c.json({ success: false, error: 'Not authenticated' }, 401)
  if (user.role !== 'admin') return c.json({ success: false, error: 'Not authorized' }, 403)
  
  const db = c.env.TESCO_DB
  const userId = c.req.param('id')
  const { amount, creditType, reason } = await c.req.json()
  
  if (!amount || !creditType) {
    return c.json({ success: false, error: 'Amount and credit type required' }, 400)
  }
  
  try {
    const targetUser = await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first() as any
    if (!targetUser) {
      return c.json({ success: false, error: 'User not found' }, 404)
    }
    
    const column = creditType === 'better' ? 'better_credits' : 'cheaper_credits'
    const newBalance = (targetUser[column] || 0) + parseInt(amount)
    
    await db.prepare(`UPDATE users SET ${column} = ? WHERE id = ?`).bind(newBalance, userId).run()
    
    await db.prepare(`
      INSERT INTO credit_transactions (id, user_id, amount, balance_after, credit_type, type, description)
      VALUES (?, ?, ?, ?, ?, 'refund', ?)
    `).bind(generateId(), userId, parseInt(amount), newBalance, creditType, reason || 'Admin adjustment').run()
    
    // Log admin action
    await db.prepare(`
      INSERT INTO admin_actions (admin_id, action_type, target_user_id, details)
      VALUES (?, 'add_credits', ?, ?)
    `).bind(user.id, userId, JSON.stringify({ amount, creditType, reason })).run()
    
    return c.json({ success: true, newBalance })
  } catch (error) {
    console.error('Admin add credits error:', error)
    return c.json({ success: false, error: 'Failed to add credits' }, 500)
  }
})

// Admin API: Ban/unban user
app.post('/api/admin/users/:id/ban', async (c) => {
  const user = c.get('user') as any
  if (!user) return c.json({ success: false, error: 'Not authenticated' }, 401)
  if (user.role !== 'admin') return c.json({ success: false, error: 'Not authorized' }, 403)
  
  const db = c.env.TESCO_DB
  const userId = c.req.param('id')
  const { banned, reason } = await c.req.json()
  
  try {
    await db.prepare('UPDATE users SET is_banned = ? WHERE id = ?').bind(banned ? 1 : 0, userId).run()
    
    // Invalidate user sessions if banning
    if (banned) {
      await db.prepare('DELETE FROM user_sessions WHERE user_id = ?').bind(userId).run()
    }
    
    // Log admin action
    await db.prepare(`
      INSERT INTO admin_actions (admin_id, action_type, target_user_id, details)
      VALUES (?, ?, ?, ?)
    `).bind(user.id, banned ? 'ban_user' : 'unban_user', userId, JSON.stringify({ reason })).run()
    
    return c.json({ success: true })
  } catch (error) {
    console.error('Admin ban user error:', error)
    return c.json({ success: false, error: 'Failed to update user' }, 500)
  }
})

// Admin API: Update user role
app.post('/api/admin/users/:id/role', async (c) => {
  const user = c.get('user') as any
  if (!user) return c.json({ success: false, error: 'Not authenticated' }, 401)
  if (user.role !== 'admin') return c.json({ success: false, error: 'Not authorized' }, 403)
  
  const db = c.env.TESCO_DB
  const userId = c.req.param('id')
  const { role } = await c.req.json()
  
  if (!['user', 'admin'].includes(role)) {
    return c.json({ success: false, error: 'Invalid role' }, 400)
  }
  
  try {
    await db.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, userId).run()
    
    // Log admin action
    await db.prepare(`
      INSERT INTO admin_actions (admin_id, action_type, target_user_id, details)
      VALUES (?, 'change_role', ?, ?)
    `).bind(user.id, userId, JSON.stringify({ role })).run()
    
    return c.json({ success: true })
  } catch (error) {
    console.error('Admin change role error:', error)
    return c.json({ success: false, error: 'Failed to update role' }, 500)
  }
})

// Admin API: Export users CSV
app.get('/api/admin/export/users', async (c) => {
  const user = c.get('user') as any
  if (!user) return c.json({ success: false, error: 'Not authenticated' }, 401)
  if (user.role !== 'admin') return c.json({ success: false, error: 'Not authorized' }, 403)
  
  const db = c.env.TESCO_DB
  
  try {
    const users = await db.prepare(`
      SELECT email, name, cheaper_credits, better_credits, subscription_status, 
             subscription_plan, created_at
      FROM users 
      ORDER BY created_at DESC
    `).all() as any
    
    const csvRows = ['Email,Name,Cheaper Credits,Better Credits,Status,Plan,Created']
    for (const u of users?.results || []) {
      csvRows.push(`"${u.email}","${u.name || ''}",${u.cheaper_credits},${u.better_credits},"${u.subscription_status}","${u.subscription_plan}","${u.created_at}"`)
    }
    
    return new Response(csvRows.join('\n'), {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="shopshot_users.csv"'
      }
    })
  } catch (error) {
    console.error('Admin export error:', error)
    return c.json({ success: false, error: 'Failed to export users' }, 500)
  }
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
    
    const { email, password, confirmPassword, name } = await c.req.json();
    
    if (!email || !password) {
      return c.json({ success: false, error: 'Email and password required' }, 400);
    }
    
    // Validate password confirmation
    if (password !== confirmPassword) {
      return c.json({ success: false, error: 'Passwords do not match' }, 400);
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return c.json({ success: false, error: 'Invalid email format' }, 400);
    }
    
    // Check password strength
    if (password.length < 8) {
      return c.json({ success: false, error: 'Password must be at least 8 characters' }, 400);
    }
    
    // Check for password complexity
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    if (!hasUpperCase || !hasLowerCase || !hasNumber) {
      return c.json({ success: false, error: 'Password must contain uppercase, lowercase, and a number' }, 400);
    }
    
    // Check if user exists
    const existingUser = await db.prepare('SELECT id, email_verified FROM users WHERE email = ?').bind(email.toLowerCase()).first() as any;
    if (existingUser) {
      // If user exists but not verified, allow re-registration (resend code)
      if (!existingUser.email_verified) {
        // Generate new verification code
        const verificationCode = generateVerificationCode();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
        
        await db.prepare(`
          UPDATE users SET email_verification_code = ?, email_verification_expires = ?, password_hash = ?
          WHERE email = ?
        `).bind(verificationCode, expiresAt.toISOString(), await hashPassword(password), email.toLowerCase()).run();
        
        // Send verification email
        if (c.env.RESEND_API_KEY) {
          await sendVerificationEmail(c.env.RESEND_API_KEY, email, verificationCode, name);
        }
        
        return c.json({ 
          success: true, 
          needsVerification: true,
          message: 'Verification code sent to your email'
        });
      }
      return c.json({ success: false, error: 'Email already registered' }, 400);
    }
    
    // Generate verification code
    const verificationCode = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    
    // Create user with dual credits (but not verified yet)
    const userId = generateId();
    const passwordHash = await hashPassword(password);
    
    await db.prepare(`
      INSERT INTO users (id, email, password_hash, name, cheaper_credits, better_credits, email_verified, email_verification_code, email_verification_expires)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).bind(userId, email.toLowerCase(), passwordHash, name || null, CREDITS.SIGNUP_CHEAPER, CREDITS.SIGNUP_BETTER, verificationCode, expiresAt.toISOString()).run();
    
    // Send verification email
    if (c.env.RESEND_API_KEY) {
      const emailSent = await sendVerificationEmail(c.env.RESEND_API_KEY, email, verificationCode, name);
      if (!emailSent) {
        console.error('Failed to send verification email');
      }
    }
    
    return c.json({ 
      success: true, 
      needsVerification: true,
      userId,
      message: 'Verification code sent to your email'
    });
  } catch (error) {
    console.error('Registration error:', error);
    return c.json({ success: false, error: 'Registration failed' }, 500);
  }
});

// Verify email with code
app.post('/api/auth/verify-email', async (c) => {
  try {
    const db = c.env.TESCO_DB;
    await ensureDatabase(db);
    
    const { email, code } = await c.req.json();
    
    if (!email || !code) {
      return c.json({ success: false, error: 'Email and code required' }, 400);
    }
    
    const user = await db.prepare(`
      SELECT id, email_verification_code, email_verification_expires, email_verified, name
      FROM users WHERE email = ?
    `).bind(email.toLowerCase()).first() as any;
    
    if (!user) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }
    
    if (user.email_verified) {
      return c.json({ success: false, error: 'Email already verified' }, 400);
    }
    
    // Check if code expired
    if (new Date(user.email_verification_expires) < new Date()) {
      return c.json({ success: false, error: 'Verification code expired. Please register again.' }, 400);
    }
    
    // Check code
    if (user.email_verification_code !== code) {
      return c.json({ success: false, error: 'Invalid verification code' }, 400);
    }
    
    // Mark as verified
    await db.prepare(`
      UPDATE users SET email_verified = 1, email_verification_code = NULL, email_verification_expires = NULL
      WHERE id = ?
    `).bind(user.id).run();
    
    // Log signup bonus for cheaper credits
    await db.prepare(`
      INSERT INTO credit_transactions (id, user_id, amount, balance_after, credit_type, type, description)
      VALUES (?, ?, ?, ?, 'cheaper', 'signup_bonus', 'Welcome bonus - Recommended credits')
    `).bind(generateId(), user.id, CREDITS.SIGNUP_CHEAPER, CREDITS.SIGNUP_CHEAPER).run();
    
    // Log signup bonus for better credits
    await db.prepare(`
      INSERT INTO credit_transactions (id, user_id, amount, balance_after, credit_type, type, description)
      VALUES (?, ?, ?, ?, 'better', 'signup_bonus', 'Welcome bonus - Premium credits')
    `).bind(generateId(), user.id, CREDITS.SIGNUP_BETTER, CREDITS.SIGNUP_BETTER).run();
    
    // Create session
    const sessionId = await createUserSession(db, user.id);
    
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
        id: user.id,
        email: email.toLowerCase(),
        name: user.name || null,
        cheaper_credits: CREDITS.SIGNUP_CHEAPER,
        better_credits: CREDITS.SIGNUP_BETTER,
        subscription_status: 'free',
        subscription_plan: 'free',
        email_verified: true
      }
    });
  } catch (error) {
    console.error('Email verification error:', error);
    return c.json({ success: false, error: 'Verification failed' }, 500);
  }
});

// Resend verification code
app.post('/api/auth/resend-verification', async (c) => {
  try {
    const db = c.env.TESCO_DB;
    await ensureDatabase(db);
    
    const { email } = await c.req.json();
    
    if (!email) {
      return c.json({ success: false, error: 'Email required' }, 400);
    }
    
    const user = await db.prepare(`
      SELECT id, name, email_verified FROM users WHERE email = ?
    `).bind(email.toLowerCase()).first() as any;
    
    if (!user) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }
    
    if (user.email_verified) {
      return c.json({ success: false, error: 'Email already verified' }, 400);
    }
    
    // Generate new code
    const verificationCode = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    
    await db.prepare(`
      UPDATE users SET email_verification_code = ?, email_verification_expires = ?
      WHERE id = ?
    `).bind(verificationCode, expiresAt.toISOString(), user.id).run();
    
    // Send email
    if (c.env.RESEND_API_KEY) {
      await sendVerificationEmail(c.env.RESEND_API_KEY, email, verificationCode, user.name);
    }
    
    return c.json({ success: true, message: 'Verification code sent' });
  } catch (error) {
    console.error('Resend verification error:', error);
    return c.json({ success: false, error: 'Failed to resend code' }, 500);
  }
});

// Request password reset
app.post('/api/auth/forgot-password', async (c) => {
  try {
    const db = c.env.TESCO_DB;
    await ensureDatabase(db);
    
    const { email } = await c.req.json();
    
    if (!email) {
      return c.json({ success: false, error: 'Email required' }, 400);
    }
    
    const user = await db.prepare(`
      SELECT id, email, name, google_id, password_hash FROM users WHERE email = ?
    `).bind(email.toLowerCase()).first() as any;
    
    // Always return success to prevent email enumeration
    if (!user) {
      return c.json({ success: true, message: 'If that email exists, a reset link has been sent' });
    }
    
    // Check if this is a Google-only account
    if (user.google_id && !user.password_hash) {
      return c.json({ success: true, message: 'If that email exists, a reset link has been sent' });
    }
    
    // Generate reset token (32 random chars)
    const resetToken = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    
    await db.prepare(`
      UPDATE users SET password_reset_token = ?, password_reset_expires = ? WHERE id = ?
    `).bind(resetToken, expiresAt.toISOString(), user.id).run();
    
    // Send reset email
    if (c.env.RESEND_API_KEY) {
      const origin = new URL(c.req.url).origin;
      const resetLink = `${origin}/reset-password?token=${resetToken}`;
      await sendPasswordResetEmail(c.env.RESEND_API_KEY, email, resetLink, user.name);
    }
    
    return c.json({ success: true, message: 'If that email exists, a reset link has been sent' });
  } catch (error) {
    console.error('Forgot password error:', error);
    return c.json({ success: false, error: 'Failed to process request' }, 500);
  }
});

// Reset password with token
app.post('/api/auth/reset-password', async (c) => {
  try {
    const db = c.env.TESCO_DB;
    await ensureDatabase(db);
    
    const { token, password } = await c.req.json();
    
    if (!token || !password) {
      return c.json({ success: false, error: 'Token and password required' }, 400);
    }
    
    if (password.length < 8) {
      return c.json({ success: false, error: 'Password must be at least 8 characters' }, 400);
    }
    
    // Find user with this token
    const user = await db.prepare(`
      SELECT id, email, password_reset_expires FROM users WHERE password_reset_token = ?
    `).bind(token).first() as any;
    
    if (!user) {
      return c.json({ success: false, error: 'Invalid or expired reset link' }, 400);
    }
    
    // Check if token has expired
    if (new Date(user.password_reset_expires) < new Date()) {
      return c.json({ success: false, error: 'Reset link has expired. Please request a new one.' }, 400);
    }
    
    // Hash new password and update
    const passwordHash = await hashPassword(password);
    await db.prepare(`
      UPDATE users SET password_hash = ?, password_reset_token = NULL, password_reset_expires = NULL WHERE id = ?
    `).bind(passwordHash, user.id).run();
    
    // Invalidate all existing sessions for security
    await db.prepare('DELETE FROM user_sessions WHERE user_id = ?').bind(user.id).run();
    
    return c.json({ success: true, message: 'Password has been reset. Please log in.' });
  } catch (error) {
    console.error('Reset password error:', error);
    return c.json({ success: false, error: 'Failed to reset password' }, 500);
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
      SELECT id, email, password_hash, name, cheaper_credits, better_credits, subscription_status, subscription_plan, stripe_customer_id, email_verified, google_id
      FROM users WHERE email = ?
    `).bind(email.toLowerCase()).first() as any;
    
    if (!user) {
      return c.json({ success: false, error: 'Invalid email or password' }, 401);
    }
    
    // Check if this is a Google-only account
    if (user.google_id && !user.password_hash) {
      return c.json({ success: false, error: 'Please sign in with Google' }, 401);
    }
    
    const validPassword = await verifyPassword(password, user.password_hash);
    if (!validPassword) {
      return c.json({ success: false, error: 'Invalid email or password' }, 401);
    }
    
    // Check if email is verified
    if (!user.email_verified && !user.google_id) {
      return c.json({ 
        success: false, 
        error: 'Please verify your email first',
        needsVerification: true,
        email: user.email
      }, 401);
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
        subscription_plan: user.subscription_plan,
        email_verified: !!user.email_verified
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
// GOOGLE OAUTH ROUTES
// ============================================================================

// Initiate Google OAuth
app.get('/api/auth/google', async (c) => {
  const clientId = c.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return c.json({ success: false, error: 'Google OAuth not configured' }, 500);
  }
  
  // Get redirect URL from query params - default to /app not /
  const redirectTo = c.req.query('redirect') || '/app';
  const plan = c.req.query('plan') || '';
  
  // Create state with redirect info
  const state = btoa(JSON.stringify({ redirect: redirectTo, plan }));
  
  const baseUrl = new URL(c.req.url).origin;
  const redirectUri = `${baseUrl}/api/auth/google/callback`;
  
  const authUrl = getGoogleAuthUrl(clientId, redirectUri, state);
  return c.redirect(authUrl);
});

// Google OAuth callback
app.get('/api/auth/google/callback', async (c) => {
  const db = c.env.TESCO_DB;
  await ensureDatabase(db);
  
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');
  
  if (error) {
    return c.redirect('/login?error=google_denied');
  }
  
  if (!code) {
    return c.redirect('/login?error=no_code');
  }
  
  // Parse state
  let redirectTo = '/';
  let plan = '';
  try {
    const stateData = JSON.parse(atob(state || ''));
    redirectTo = stateData.redirect || '/';
    plan = stateData.plan || '';
  } catch {}
  
  const clientId = c.env.GOOGLE_CLIENT_ID;
  const clientSecret = c.env.GOOGLE_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    return c.redirect('/login?error=oauth_not_configured');
  }
  
  const baseUrl = new URL(c.req.url).origin;
  const redirectUri = `${baseUrl}/api/auth/google/callback`;
  
  // Exchange code for tokens
  const tokens = await exchangeGoogleCode(code, clientId, clientSecret, redirectUri);
  if (!tokens) {
    return c.redirect('/login?error=token_exchange_failed');
  }
  
  // Get user info
  const googleUser = await getGoogleUserInfo(tokens.access_token);
  if (!googleUser || !googleUser.email) {
    return c.redirect('/login?error=no_user_info');
  }
  
  // Check if user exists
  let user = await db.prepare(`
    SELECT id, email, google_id, email_verified FROM users WHERE email = ? OR google_id = ?
  `).bind(googleUser.email.toLowerCase(), googleUser.id).first() as any;
  
  if (user) {
    // User exists - update Google ID if needed and log them in
    if (!user.google_id) {
      await db.prepare(`
        UPDATE users SET google_id = ?, email_verified = 1 WHERE id = ?
      `).bind(googleUser.id, user.id).run();
    }
  } else {
    // Create new user
    const userId = generateId();
    
    await db.prepare(`
      INSERT INTO users (id, email, password_hash, name, cheaper_credits, better_credits, email_verified, google_id)
      VALUES (?, ?, '', ?, ?, ?, 1, ?)
    `).bind(userId, googleUser.email.toLowerCase(), googleUser.name || null, CREDITS.SIGNUP_CHEAPER, CREDITS.SIGNUP_BETTER, googleUser.id).run();
    
    // Log signup bonus
    await db.prepare(`
      INSERT INTO credit_transactions (id, user_id, amount, balance_after, credit_type, type, description)
      VALUES (?, ?, ?, ?, 'cheaper', 'signup_bonus', 'Welcome bonus - Recommended credits')
    `).bind(generateId(), userId, CREDITS.SIGNUP_CHEAPER, CREDITS.SIGNUP_CHEAPER).run();
    
    await db.prepare(`
      INSERT INTO credit_transactions (id, user_id, amount, balance_after, credit_type, type, description)
      VALUES (?, ?, ?, ?, 'better', 'signup_bonus', 'Welcome bonus - Premium credits')
    `).bind(generateId(), userId, CREDITS.SIGNUP_BETTER, CREDITS.SIGNUP_BETTER).run();
    
    user = { id: userId };
  }
  
  // Create session
  const sessionId = await createUserSession(db, user.id);
  
  // Set cookie - use Lax for OAuth compatibility (Strict blocks cross-site redirects)
  setCookie(c, 'session', sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 30 * 24 * 60 * 60,
    path: '/'
  });
  
  // If plan selected, redirect to Stripe checkout
  if (plan === 'standard' || plan === 'pro') {
    return c.redirect(`/pricing?plan=${plan}&checkout=1`);
  }
  
  // Default redirect to app (not homepage)
  const finalRedirect = redirectTo && redirectTo !== '/' ? redirectTo : '/app';
  return c.redirect(finalRedirect + '?welcome=1');
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
    await logError(c.env.TESCO_DB, 'stripe_webhook', 'Webhook signature verification failed', {
      endpoint: '/api/billing/webhook',
      severity: 'critical'
    });
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
    await logError(db, 'stripe_webhook', `Webhook processing error: ${err}`, {
      endpoint: '/api/billing/webhook',
      severity: 'critical'
    });
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
    hasResend: !!c.env.RESEND_API_KEY,
    hasGoogleOAuth: !!c.env.GOOGLE_CLIENT_ID && !!c.env.GOOGLE_CLIENT_SECRET,
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
    
    /* Mobile Menu */
    .mobile-menu-btn {
      display: none;
      background: none;
      border: none;
      padding: 8px;
      cursor: pointer;
      color: #374151;
      border-radius: 8px;
      transition: background 0.2s;
    }
    .mobile-menu-btn:hover { background: rgba(0,0,0,0.05); }
    @media (max-width: 768px) {
      .mobile-menu-btn { display: flex; }
      .nav-links {
        position: fixed;
        top: 56px;
        left: 0;
        right: 0;
        background: white;
        flex-direction: column;
        padding: 16px;
        gap: 0;
        box-shadow: 0 10px 40px rgba(0,0,0,0.1);
        transform: translateY(-100%);
        opacity: 0;
        pointer-events: none;
        transition: all 0.3s ease;
        border-bottom: 1px solid #E5E7EB;
      }
      .nav-links.active {
        transform: translateY(0);
        opacity: 1;
        pointer-events: auto;
      }
      .nav-link {
        display: block !important;
        padding: 14px 16px;
        font-size: 16px;
        border-radius: 10px;
        transition: background 0.2s;
      }
      .nav-link:hover { background: #F3F4F6; }
      .nav-cta {
        margin-top: 8px;
        text-align: center;
        padding: 14px 20px;
        font-size: 16px;
      }
    }
    
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
      background-image: url('https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=1920&q=80');
      background-size: cover;
      background-position: center;
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
    .hero-content {
      background: rgba(255,255,255,0.2);
      backdrop-filter: blur(12px);
      padding: 48px 64px;
      border-radius: 24px;
      max-width: 900px;
      margin: 0 auto;
      box-shadow: 0 25px 80px rgba(0,0,0,0.15);
    }
    /* Mobile Navigation & Hero */
    @media (max-width: 768px) {
      .nav { padding: 12px 16px; }
      .nav-logo-icon { width: 32px; height: 32px; border-radius: 8px; }
      .nav-logo-icon svg { width: 18px; height: 18px; }
      .nav-logo-text { font-size: 18px; }
      .nav-links { gap: 8px; }
      .nav-link { font-size: 12px; display: none; } /* Hide text links on mobile */
      .nav-cta { padding: 8px 14px; font-size: 12px; border-radius: 8px; }
      
      .hero { 
        padding: 100px 16px 60px; 
        min-height: auto;
      }
      .hero-content { 
        padding: 28px 20px; 
        margin: 0 8px; 
        border-radius: 20px;
      }
      .hero h1 { font-size: 28px; margin-bottom: 16px; }
      .hero p { font-size: 15px; margin-bottom: 24px; line-height: 1.5; }
      .hero-ctas { 
        flex-direction: column; 
        gap: 12px;
        margin-bottom: 0;
      }
      .btn-primary, .btn-secondary { 
        width: 100%; 
        justify-content: center; 
        padding: 14px 24px;
        font-size: 15px;
        border-radius: 12px;
      }
      
      .ticker-section { padding: 24px 0 16px; }
      .ticker-hint { font-size: 12px; padding: 6px 12px; }
      .ticker-item { width: 100px; height: 100px; border-radius: 12px; }
      
      .stats-bar { 
        flex-direction: row; 
        gap: 16px; 
        padding: 20px 12px;
        justify-content: space-around;
      }
      .stat-item { flex: 1; }
      .stat-value { font-size: 28px; }
      .stat-label { font-size: 10px; }
      
      .section { padding: 40px 16px; }
      .section-title { font-size: 28px; }
      .section-subtitle { font-size: 15px; }
      
      .promo-video-container { margin-bottom: 32px; padding: 0 8px; }
      .play-button { width: 60px; height: 60px; }
      .play-button svg { width: 24px; height: 24px; }
      .play-text { font-size: 14px; }
      
      .features-grid { gap: 16px; }
      .feature-card { padding: 24px; border-radius: 16px; }
      .feature-icon { width: 48px; height: 48px; font-size: 24px; }
      .feature-card h3 { font-size: 18px; }
      .feature-card p { font-size: 14px; }
      
      .steps { gap: 32px; }
      .step-number { width: 52px; height: 52px; font-size: 24px; }
      .step h3 { font-size: 18px; }
      .step p { font-size: 14px; }
      
      .use-cases { gap: 12px; }
      .use-case { padding: 20px 16px; border-radius: 12px; }
      .use-case-icon { width: 40px; height: 40px; font-size: 20px; }
      .use-case h4 { font-size: 13px; }
      
      .pricing-grid-section { padding: 40px 16px; }
      .pricing-grid { gap: 16px; }
      .pricing-card { padding: 24px 20px; border-radius: 20px; }
      .pricing-card h3 { font-size: 20px; }
      .pricing-card .price { font-size: 36px; }
      .pricing-card .price span { font-size: 14px; }
      .credits-row { gap: 8px; }
      .credit-badge { padding: 8px 12px; min-width: 70px; }
      .credit-badge .count { font-size: 18px; }
      .credit-badge .label { font-size: 10px; }
      .pricing-card ul { margin: 16px 0; }
      .pricing-card ul li { font-size: 13px; padding: 6px 0; }
      .pricing-btn { padding: 12px 20px; font-size: 14px; }
      
      .final-cta { padding: 60px 20px; }
      .final-cta h2 { font-size: 28px; }
      .final-cta p { font-size: 16px; margin-bottom: 28px; }
      
      .footer { padding: 32px 16px; }
      .footer-logo-text { font-size: 18px; }
      .footer-links { flex-wrap: wrap; gap: 16px; }
    }
    
    /* Extra small screens */
    @media (max-width: 380px) {
      .hero h1 { font-size: 24px; }
      .hero p { font-size: 14px; }
      .btn-primary, .btn-secondary { padding: 12px 20px; font-size: 14px; }
      .ticker-item { width: 80px; height: 80px; }
      .pricing-card .price { font-size: 32px; }
    }
    
    .hero h1 {
      font-size: clamp(36px, 5vw, 56px);
      font-weight: 900;
      line-height: 1.1;
      margin: 0 auto 20px;
      color: #1F2937;
    }
    .hero-highlight {
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .hero p {
      font-size: 18px;
      color: #4B5563;
      max-width: 600px;
      margin: 0 auto 32px;
      line-height: 1.6;
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
      border: 1px solid #E5E7EB;
      cursor: pointer;
      font-weight: 600;
      border: 1px solid #E5E7EB;
      transition: all 0.2s;
    }
    .btn-secondary:hover { border-color: #8B5CF6; color: #7C3AED; }
    
    /* Animated Ticker Tape */
    .ticker-section {
      padding: 40px 0 20px;
      background: transparent;
    }
    .ticker-hint {
      text-align: center;
      font-size: 14px;
      font-weight: 500;
      color: #1F2937;
      margin-bottom: 20px;
      padding: 8px 16px;
      background: rgba(255,255,255,0.95);
      display: inline-block;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      border: 1px solid #E5E7EB;
    }
    .ticker-hint-wrapper {
      text-align: center;
    }
    .ticker-container {
      overflow: hidden;
      width: 100%;
      position: relative;
    }
    .ticker-wrapper {
      display: flex;
      animation: ticker-scroll 40s linear infinite;
      gap: 20px;
      padding: 10px 0;
    }
    .ticker-wrapper:hover {
      animation-play-state: paused;
    }
    @keyframes ticker-scroll {
      0% { transform: translateX(0); }
      100% { transform: translateX(-50%); }
    }
    .ticker-item {
      flex-shrink: 0;
      width: 140px;
      height: 140px;
      border-radius: 16px;
      overflow: hidden;
      cursor: pointer;
      transition: all 0.3s;
      box-shadow: 0 8px 30px rgba(0,0,0,0.12);
      border: 3px solid white;
    }
    .ticker-item:hover {
      transform: scale(1.08);
      box-shadow: 0 12px 40px rgba(99, 102, 241, 0.3);
      border-color: #8B5CF6;
    }
    .ticker-item img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    
    /* Lightbox Modal */
    .lightbox-overlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.9);
      z-index: 10000;
      justify-content: center;
      align-items: center;
      padding: 20px;
    }
    .lightbox-overlay.active {
      display: flex;
    }
    .lightbox-content {
      max-width: 95vw;
      max-height: 90vh;
      position: relative;
    }
    .lightbox-content img {
      max-width: 100%;
      max-height: 85vh;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }
    .lightbox-close {
      position: absolute;
      top: -40px;
      right: 0;
      background: white;
      border: none;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      font-size: 24px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #374151;
    }
    .lightbox-close:hover {
      background: #F3F4F6;
    }
    .lightbox-nav {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      background: white;
      border: none;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      font-size: 24px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #374151;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
    }
    .lightbox-nav:hover {
      background: #F3F4F6;
    }
    .lightbox-prev { left: -60px; }
    .lightbox-next { right: -60px; }
    @media (max-width: 768px) {
      .lightbox-prev { left: 10px; }
      .lightbox-next { right: 10px; }
      .ticker-item { width: 120px; height: 120px; }
    }
    
    /* Stats Bar */
    .stats-bar {
      display: flex;
      justify-content: center;
      gap: 64px;
      padding: 32px 32px;
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
    
    /* Promo Video Section */
    .promo-video-container {
      max-width: 900px;
      margin: 0 auto 48px;
      padding: 0 24px;
    }
    .promo-video-wrapper {
      position: relative;
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 25px 60px rgba(0,0,0,0.15);
      aspect-ratio: 16/9;
      background: #1F2937;
    }
    .promo-video-placeholder {
      position: relative;
      width: 100%;
      height: 100%;
      cursor: pointer;
      transition: transform 0.3s, box-shadow 0.3s;
      border-radius: 20px;
    }
    .promo-video-placeholder .video-thumbnail {
      width: 100%;
      height: 100%;
      object-fit: cover;
      filter: brightness(0.7);
    }
    .video-play-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      z-index: 2;
    }
    .play-button {
      width: 80px;
      height: 80px;
      background: linear-gradient(135deg, #3B82F6 0%, #8B5CF6 100%);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 10px 40px rgba(99, 102, 241, 0.4);
      transition: all 0.3s;
    }
    .promo-video-placeholder:hover .play-button {
      transform: scale(1.1);
      box-shadow: 0 15px 50px rgba(99, 102, 241, 0.5);
    }
    .play-button svg {
      margin-left: 4px;
    }
    .play-text {
      font-size: 16px;
      font-weight: 600;
      color: white;
      text-shadow: 0 2px 10px rgba(0,0,0,0.3);
    }
    .promo-video-embed {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
    }
    .promo-video-embed iframe {
      border-radius: 20px;
    }
    .promo-video-caption {
      text-align: center;
      margin-top: 16px;
      font-size: 14px;
      color: #6B7280;
    }
    @media (max-width: 768px) {
      .promo-video-container { padding: 0 16px; }
      .play-button { width: 60px; height: 60px; }
      .play-button svg { width: 24px; height: 24px; }
    }
    
    /* Section Styles */
    .section {
      padding: 60px 32px;
    }
    .section-dark {
      background: linear-gradient(135deg, #1F2937 0%, #111827 100%);
      color: white;
    }
    .section-header {
      text-align: center;
      max-width: 700px;
      margin: 0 auto 40px;
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
    
    /* Pricing Grid - Full Version */
    .pricing-grid-section {
      background: #F9FAFB;
      padding: 80px 32px;
    }
    .pricing-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 24px;
      max-width: 1000px;
      margin: 0 auto;
    }
    @media (max-width: 900px) { .pricing-grid { grid-template-columns: 1fr; max-width: 400px; } }
    .pricing-card {
      background: white;
      border: 1px solid #E5E7EB;
      border-radius: 20px;
      padding: 32px;
      position: relative;
      transition: all 0.3s;
    }
    .pricing-card:hover { border-color: #8B5CF6; box-shadow: 0 12px 40px rgba(139, 92, 246, 0.15); transform: translateY(-4px); }
    .pricing-card.featured {
      border: 2px solid #8B5CF6;
      box-shadow: 0 12px 40px rgba(139, 92, 246, 0.2);
    }
    .pricing-card.featured::before {
      content: 'Most Popular';
      position: absolute;
      top: -12px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, #8B5CF6 0%, #3B82F6 100%);
      color: white;
      padding: 6px 16px;
      border-radius: 100px;
      font-size: 12px;
      font-weight: 600;
    }
    .pricing-card h3 { font-size: 20px; font-weight: 700; color: #1F2937; margin-bottom: 4px; }
    .pricing-card .price { font-size: 42px; font-weight: 800; color: #1F2937; margin-bottom: 4px; }
    .pricing-card .price span { font-size: 16px; font-weight: 500; color: #9CA3AF; }
    .pricing-card .price-note { font-size: 13px; color: #9CA3AF; margin-bottom: 20px; }
    .pricing-card .credits-row {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
    }
    .credit-badge {
      flex: 1;
      padding: 10px;
      background: #F9FAFB;
      border-radius: 10px;
      text-align: center;
    }
    .credit-badge .count { font-size: 22px; font-weight: 700; }
    .credit-badge .label { font-size: 10px; color: #6B7280; text-transform: uppercase; letter-spacing: 0.5px; }
    .credit-badge.standard .count { color: #3B82F6; }
    .credit-badge.pro .count { color: #8B5CF6; }
    .pricing-card ul { list-style: none; margin-bottom: 20px; padding: 0; }
    .pricing-card li {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 14px;
      color: #4B5563;
      margin-bottom: 10px;
    }
    .pricing-card li::before {
      content: '';
      width: 18px;
      height: 18px;
      background: #10B981;
      border-radius: 50%;
      flex-shrink: 0;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='white'%3E%3Cpath fill-rule='evenodd' d='M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z' clip-rule='evenodd'/%3E%3C/svg%3E");
      background-size: 11px;
      background-repeat: no-repeat;
      background-position: center;
    }
    .pricing-btn {
      width: 100%;
      padding: 14px;
      border-radius: 12px;
      font-size: 15px;
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
    .pricing-btn.primary:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(139, 92, 246, 0.35); }
    .pricing-btn.secondary {
      background: white;
      border: 1px solid #E5E7EB;
      color: #374151;
    }
    .pricing-btn.secondary:hover { border-color: #8B5CF6; color: #8B5CF6; }
    
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
    
    <!-- Mobile Menu Button -->
    <button class="mobile-menu-btn" onclick="toggleMobileMenu()" aria-label="Toggle menu">
      <svg class="menu-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
      </svg>
      <svg class="close-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:none;">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
    
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
    <div class="hero-content">
      <h1>Turn Any Product Photo Into <span class="hero-highlight">10 Professional Shots</span> in Seconds</h1>
      <p>Upload a single photo. Get hero shots, lifestyle images, flat-lays, and more. No photography skills needed. Perfect for online sellers.</p>
      <div class="hero-ctas">
        <a href="/app" class="btn-primary">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          Start Free - 15 Credits
        </a>
        <button onclick="scrollToVideo()" class="btn-secondary">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor"/></svg>
          See How It Works
        </button>
      </div>
    </div>
    
  </section>
  
  <!-- Animated Ticker Tape -->
  <section class="ticker-section">
    <div class="ticker-hint-wrapper">
      <div class="ticker-hint">Click any image to see all 10 AI variations</div>
    </div>
    <div class="ticker-container">
      <div class="ticker-wrapper" id="ticker-wrapper">
        <div class="ticker-item" data-index="0"><img src="/static/examples/example-1-thumb.jpg" alt="Vacuum cleaner"></div>
        <div class="ticker-item" data-index="1"><img src="/static/examples/example-2-thumb.jpg" alt="Skincare serum"></div>
        <div class="ticker-item" data-index="2"><img src="/static/examples/example-3-thumb.jpg" alt="White sneakers"></div>
        <div class="ticker-item" data-index="3"><img src="/static/examples/example-4-thumb.jpg" alt="Candle"></div>
        <div class="ticker-item" data-index="4"><img src="/static/examples/example-5-thumb.jpg" alt="Coffee bags"></div>
        <div class="ticker-item" data-index="5"><img src="/static/examples/example-6-thumb.jpg" alt="Smartwatch"></div>
        <div class="ticker-item" data-index="6"><img src="/static/examples/example-7-thumb.jpg" alt="Silver ring"></div>
        <!-- Duplicate for seamless loop -->
        <div class="ticker-item" data-index="0"><img src="/static/examples/example-1-thumb.jpg" alt="Vacuum cleaner"></div>
        <div class="ticker-item" data-index="1"><img src="/static/examples/example-2-thumb.jpg" alt="Skincare serum"></div>
        <div class="ticker-item" data-index="2"><img src="/static/examples/example-3-thumb.jpg" alt="White sneakers"></div>
        <div class="ticker-item" data-index="3"><img src="/static/examples/example-4-thumb.jpg" alt="Candle"></div>
        <div class="ticker-item" data-index="4"><img src="/static/examples/example-5-thumb.jpg" alt="Coffee bags"></div>
        <div class="ticker-item" data-index="5"><img src="/static/examples/example-6-thumb.jpg" alt="Smartwatch"></div>
        <div class="ticker-item" data-index="6"><img src="/static/examples/example-7-thumb.jpg" alt="Silver ring"></div>
      </div>
    </div>
  </section>
  
  <!-- Lightbox Modal -->
  <div class="lightbox-overlay" id="lightbox-overlay">
    <div class="lightbox-content">
      <button class="lightbox-close" onclick="closeLightbox()">&times;</button>
      <button class="lightbox-nav lightbox-prev" onclick="prevLightbox()">&#8249;</button>
      <img id="lightbox-img" src="" alt="Full generation grid">
      <button class="lightbox-nav lightbox-next" onclick="nextLightbox()">&#8250;</button>
    </div>
  </div>

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
    
    <!-- Promo Video Placeholder -->
    <div class="promo-video-container">
      <div class="promo-video-wrapper">
        <div class="promo-video-placeholder" id="promo-video-placeholder">
          <div class="video-play-overlay">
            <div class="play-button">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"/></svg>
            </div>
            <span class="play-text">Watch How It Works</span>
          </div>
          <img src="/static/examples/example-1-full.jpg" alt="ShopShot Demo Preview" class="video-thumbnail">
        </div>
        <!-- YouTube embed will replace placeholder when user clicks -->
        <div class="promo-video-embed" id="promo-video-embed" style="display: none;">
          <iframe 
            id="youtube-iframe"
            width="100%" 
            height="100%" 
            src="" 
            frameborder="0" 
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
            allowfullscreen>
          </iframe>
        </div>
      </div>
      <p class="promo-video-caption">See ShopShot transform a simple product photo into 10 professional shots</p>
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

  <!-- Full Pricing Grid -->
  <section class="pricing-grid-section" id="pricing">
    <div class="section-header" style="color: #1F2937;">
      <div class="section-badge" style="background: white; color: #4338CA;">Pricing</div>
      <h2 class="section-title" style="color: #1F2937;">Simple, Honest Pricing</h2>
      <p class="section-subtitle" style="color: #6B7280;">Start free. Upgrade when you're ready. No hidden fees.</p>
    </div>
    
    <div class="pricing-grid">
      <!-- Free Tier -->
      <div class="pricing-card">
        <h3>Free</h3>
        <div class="price">£0</div>
        <div class="price-note">One-time signup bonus</div>
        <div class="credits-row">
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
          <li>10 professional variations</li>
          <li>High-res downloads</li>
          <li>Session history</li>
        </ul>
        <a href="/register?plan=free" class="pricing-btn secondary">Get Started Free</a>
      </div>
      
      <!-- Standard Tier -->
      <div class="pricing-card featured">
        <h3>Standard</h3>
        <div class="price">£${PRICING.STANDARD}<span>/mo</span></div>
        <div class="price-note">Best for regular sellers</div>
        <div class="credits-row">
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
          <li>Bulk downloads (ZIP)</li>
          <li>Email support</li>
        </ul>
        <a href="/register?plan=standard" class="pricing-btn primary">Get Standard</a>
      </div>
      
      <!-- Pro Tier -->
      <div class="pricing-card">
        <h3>Pro</h3>
        <div class="price">£${PRICING.PRO}<span>/mo</span></div>
        <div class="price-note">For power sellers</div>
        <div class="credits-row">
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
          <li>Best quality AI model</li>
          <li>Advanced customization</li>
          <li>Priority support</li>
        </ul>
        <a href="/register?plan=pro" class="pricing-btn primary">Get Pro</a>
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
    // Scroll to video and play it
    function scrollToVideo() {
      const videoContainer = document.querySelector('.promo-video-container');
      const videoPlaceholder = document.getElementById('promo-video-placeholder');
      if (videoContainer) {
        videoContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // After scrolling, highlight the video briefly
        setTimeout(() => {
          videoPlaceholder.style.transform = 'scale(1.02)';
          videoPlaceholder.style.boxShadow = '0 0 0 4px rgba(139, 92, 246, 0.5)';
          setTimeout(() => {
            videoPlaceholder.style.transform = '';
            videoPlaceholder.style.boxShadow = '';
            // Trigger the video click
            videoPlaceholder.click();
          }, 400);
        }, 600);
      }
    }
    
    // Mobile menu toggle
    function toggleMobileMenu() {
      const navLinks = document.querySelector('.nav-links');
      const menuIcon = document.querySelector('.menu-icon');
      const closeIcon = document.querySelector('.close-icon');
      navLinks.classList.toggle('active');
      if (navLinks.classList.contains('active')) {
        menuIcon.style.display = 'none';
        closeIcon.style.display = 'block';
      } else {
        menuIcon.style.display = 'block';
        closeIcon.style.display = 'none';
      }
    }
    
    // Close mobile menu when clicking a link
    document.querySelectorAll('.nav-link, .nav-cta').forEach(link => {
      link.addEventListener('click', () => {
        const navLinks = document.querySelector('.nav-links');
        const menuIcon = document.querySelector('.menu-icon');
        const closeIcon = document.querySelector('.close-icon');
        if (navLinks.classList.contains('active')) {
          navLinks.classList.remove('active');
          menuIcon.style.display = 'block';
          closeIcon.style.display = 'none';
        }
      });
    });
    
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
    
    // Lightbox for ticker examples
    const exampleFullImages = [
      '/static/examples/example-1-full.jpg',
      '/static/examples/example-2-full.jpg',
      '/static/examples/example-3-full.jpg',
      '/static/examples/example-4-full.jpg',
      '/static/examples/example-5-full.jpg',
      '/static/examples/example-6-full.jpg',
      '/static/examples/example-7-thumb.jpg'  // Ring doesn't have full grid, use thumb
    ];
    let currentLightboxIndex = 0;
    
    document.querySelectorAll('.ticker-item').forEach(item => {
      item.addEventListener('click', function() {
        const index = parseInt(this.getAttribute('data-index'));
        openLightbox(index);
      });
    });
    
    function openLightbox(index) {
      currentLightboxIndex = index;
      document.getElementById('lightbox-img').src = exampleFullImages[index];
      document.getElementById('lightbox-overlay').classList.add('active');
      document.body.style.overflow = 'hidden';
    }
    
    function closeLightbox() {
      document.getElementById('lightbox-overlay').classList.remove('active');
      document.body.style.overflow = '';
    }
    
    function prevLightbox() {
      currentLightboxIndex = (currentLightboxIndex - 1 + exampleFullImages.length) % exampleFullImages.length;
      document.getElementById('lightbox-img').src = exampleFullImages[currentLightboxIndex];
    }
    
    function nextLightbox() {
      currentLightboxIndex = (currentLightboxIndex + 1) % exampleFullImages.length;
      document.getElementById('lightbox-img').src = exampleFullImages[currentLightboxIndex];
    }
    
    // Keyboard navigation
    document.addEventListener('keydown', function(e) {
      if (!document.getElementById('lightbox-overlay').classList.contains('active')) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') prevLightbox();
      if (e.key === 'ArrowRight') nextLightbox();
    });
    
    // Click overlay to close
    document.getElementById('lightbox-overlay').addEventListener('click', function(e) {
      if (e.target === this) closeLightbox();
    });
    
    // Promo video click handler
    // Replace YOUR_VIDEO_ID with actual YouTube video ID when available
    const videoPlaceholder = document.getElementById('promo-video-placeholder');
    const videoEmbed = document.getElementById('promo-video-embed');
    const youtubeIframe = document.getElementById('youtube-iframe');
    const YOUTUBE_VIDEO_ID = 'YOUR_VIDEO_ID'; // TODO: Replace with actual video ID
    
    if (videoPlaceholder) {
      videoPlaceholder.addEventListener('click', function() {
        if (YOUTUBE_VIDEO_ID === 'YOUR_VIDEO_ID') {
          // No video yet - show alert
          alert('Demo video coming soon! We are creating an awesome walkthrough.');
          return;
        }
        // Hide placeholder, show embed
        videoPlaceholder.style.display = 'none';
        videoEmbed.style.display = 'block';
        youtubeIframe.src = 'https://www.youtube.com/embed/' + YOUTUBE_VIDEO_ID + '?autoplay=1&rel=0';
      });
    }
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
// FORGOT PASSWORD PAGE
// ============================================================================
function getForgotPasswordPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Forgot Password - ShopShot</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'><stop offset='0%25' style='stop-color:%233B82F6'/><stop offset='100%25' style='stop-color:%238B5CF6'/></linearGradient></defs><rect width='100' height='100' rx='22' fill='url(%23g)'/><circle cx='50' cy='50' r='28' fill='none' stroke='white' stroke-width='6'/><circle cx='50' cy='50' r='12' fill='white'/></svg>">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { font-family: 'Inter', system-ui, sans-serif; }
    ${getAuthPageStyles()}
    .success-message {
      background: #ECFDF5;
      border: 1px solid #A7F3D0;
      color: #065F46;
      padding: 16px;
      border-radius: 12px;
      margin-bottom: 16px;
      font-size: 14px;
      display: none;
    }
    .success-message.show { display: block; }
  </style>
</head>
<body>
  <div class="auth-container">
    <div class="auth-card">
      <div class="auth-header">
        <a href="/" class="auth-logo">ShopShot</a>
        <h1 class="auth-title">Forgot your password?</h1>
        <p class="auth-subtitle">Enter your email and we'll send you a reset link</p>
      </div>
      
      <div class="success-message" id="success-msg"></div>
      <div class="auth-error" id="error-msg"></div>
      
      <form onsubmit="handleForgotPassword(event)" id="forgot-form">
        <div class="form-group">
          <label class="form-label">Email</label>
          <input type="email" id="email" class="form-input" placeholder="you@example.com" required autocomplete="email">
        </div>
        
        <button type="submit" class="auth-btn" id="submit-btn">Send Reset Link</button>
      </form>
      
      <p class="auth-footer">
        Remember your password? <a href="/login">Log in</a>
      </p>
    </div>
  </div>
  
  <script>
    async function handleForgotPassword(e) {
      e.preventDefault();
      const btn = document.getElementById('submit-btn');
      const errEl = document.getElementById('error-msg');
      const successEl = document.getElementById('success-msg');
      
      btn.disabled = true;
      btn.textContent = 'Sending...';
      errEl.classList.remove('show');
      successEl.classList.remove('show');
      
      try {
        const res = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: document.getElementById('email').value
          })
        });
        
        const data = await res.json();
        
        if (data.success) {
          successEl.textContent = 'If that email exists in our system, we\\'ve sent a password reset link. Check your inbox (and spam folder).';
          successEl.classList.add('show');
          document.getElementById('forgot-form').style.display = 'none';
        } else {
          errEl.textContent = data.error || 'Failed to send reset link';
          errEl.classList.add('show');
        }
      } catch (error) {
        errEl.textContent = 'An error occurred. Please try again.';
        errEl.classList.add('show');
      }
      
      btn.disabled = false;
      btn.textContent = 'Send Reset Link';
    }
  </script>
</body>
</html>`;
}

// ============================================================================
// RESET PASSWORD PAGE
// ============================================================================
function getResetPasswordPage(token: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Password - ShopShot</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'><stop offset='0%25' style='stop-color:%233B82F6'/><stop offset='100%25' style='stop-color:%238B5CF6'/></linearGradient></defs><rect width='100' height='100' rx='22' fill='url(%23g)'/><circle cx='50' cy='50' r='28' fill='none' stroke='white' stroke-width='6'/><circle cx='50' cy='50' r='12' fill='white'/></svg>">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { font-family: 'Inter', system-ui, sans-serif; }
    ${getAuthPageStyles()}
    .success-message {
      background: #ECFDF5;
      border: 1px solid #A7F3D0;
      color: #065F46;
      padding: 16px;
      border-radius: 12px;
      margin-bottom: 16px;
      font-size: 14px;
      display: none;
      text-align: center;
    }
    .success-message.show { display: block; }
    .password-requirements {
      background: #F9FAFB;
      border-radius: 8px;
      padding: 12px;
      margin-top: 8px;
      font-size: 12px;
    }
    .password-requirements div {
      color: #6B7280;
      margin: 4px 0;
    }
    .password-requirements .valid { color: #059669; }
    .password-requirements .invalid { color: #DC2626; }
  </style>
</head>
<body>
  <div class="auth-container">
    <div class="auth-card">
      <div class="auth-header">
        <a href="/" class="auth-logo">ShopShot</a>
        <h1 class="auth-title">Reset your password</h1>
        <p class="auth-subtitle">Enter your new password below</p>
      </div>
      
      <div class="success-message" id="success-msg">
        Password reset successfully! <a href="/login" style="color: #059669; font-weight: 600;">Log in now</a>
      </div>
      <div class="auth-error" id="error-msg"></div>
      
      <form onsubmit="handleResetPassword(event)" id="reset-form">
        <div class="form-group">
          <label class="form-label">New Password</label>
          <input type="password" id="password" class="form-input" placeholder="••••••••" required autocomplete="new-password" oninput="checkPassword()">
          <div class="password-requirements">
            <div id="req-length" class="invalid">✗ At least 8 characters</div>
            <div id="req-upper" class="invalid">✗ One uppercase letter</div>
            <div id="req-lower" class="invalid">✗ One lowercase letter</div>
            <div id="req-number" class="invalid">✗ One number</div>
          </div>
        </div>
        
        <div class="form-group">
          <label class="form-label">Confirm Password</label>
          <input type="password" id="confirm-password" class="form-input" placeholder="••••••••" required autocomplete="new-password" oninput="checkPassword()">
          <div id="match-msg" style="font-size: 12px; margin-top: 6px; display: none;"></div>
        </div>
        
        <button type="submit" class="auth-btn" id="submit-btn">Reset Password</button>
      </form>
      
      <p class="auth-footer">
        <a href="/login">Back to login</a>
      </p>
    </div>
  </div>
  
  <script>
    const token = '${token}';
    
    function checkPassword() {
      const password = document.getElementById('password').value;
      const confirm = document.getElementById('confirm-password').value;
      
      const reqs = {
        length: password.length >= 8,
        upper: /[A-Z]/.test(password),
        lower: /[a-z]/.test(password),
        number: /[0-9]/.test(password)
      };
      
      Object.keys(reqs).forEach(key => {
        const el = document.getElementById('req-' + key);
        el.className = reqs[key] ? 'valid' : 'invalid';
        el.textContent = (reqs[key] ? '✓ ' : '✗ ') + el.textContent.substring(2);
      });
      
      const matchMsg = document.getElementById('match-msg');
      if (confirm) {
        matchMsg.style.display = 'block';
        if (password === confirm) {
          matchMsg.textContent = '✓ Passwords match';
          matchMsg.style.color = '#059669';
        } else {
          matchMsg.textContent = '✗ Passwords do not match';
          matchMsg.style.color = '#DC2626';
        }
      } else {
        matchMsg.style.display = 'none';
      }
    }
    
    async function handleResetPassword(e) {
      e.preventDefault();
      const btn = document.getElementById('submit-btn');
      const errEl = document.getElementById('error-msg');
      const successEl = document.getElementById('success-msg');
      
      const password = document.getElementById('password').value;
      const confirm = document.getElementById('confirm-password').value;
      
      if (password !== confirm) {
        errEl.textContent = 'Passwords do not match';
        errEl.classList.add('show');
        return;
      }
      
      if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
        errEl.textContent = 'Password does not meet requirements';
        errEl.classList.add('show');
        return;
      }
      
      btn.disabled = true;
      btn.textContent = 'Resetting...';
      errEl.classList.remove('show');
      
      try {
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, password })
        });
        
        const data = await res.json();
        
        if (data.success) {
          successEl.classList.add('show');
          document.getElementById('reset-form').style.display = 'none';
        } else {
          errEl.textContent = data.error || 'Failed to reset password';
          errEl.classList.add('show');
        }
      } catch (error) {
        errEl.textContent = 'An error occurred. Please try again.';
        errEl.classList.add('show');
      }
      
      btn.disabled = false;
      btn.textContent = 'Reset Password';
    }
  </script>
</body>
</html>`;
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
    .divider {
      display: flex;
      align-items: center;
      margin: 20px 0;
      color: #9CA3AF;
      font-size: 13px;
    }
    .divider::before, .divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: #E5E7EB;
    }
    .divider span { padding: 0 16px; }
    .google-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      width: 100%;
      padding: 14px 20px;
      background: white;
      border: 1px solid #E5E7EB;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 600;
      color: #374151;
      cursor: pointer;
      transition: all 0.2s;
    }
    .google-btn:hover { background: #F9FAFB; border-color: #D1D5DB; }
    .google-btn svg { width: 20px; height: 20px; }
    .info-msg {
      padding: 12px 16px;
      background: #FEF3C7;
      border: 1px solid #FCD34D;
      border-radius: 10px;
      color: #92400E;
      font-size: 14px;
      margin-bottom: 16px;
      text-align: center;
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
      
      <h1 class="auth-title">Welcome Back</h1>
      <p class="auth-subtitle">Log in to continue generating product photos</p>
      
      <!-- Google Sign In -->
      <button onclick="signInWithGoogle()" class="google-btn" style="margin-top: 20px;">
        <svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
        Continue with Google
      </button>
      
      <div class="divider"><span>or</span></div>
      
      <div id="info-msg" class="info-msg" style="display: none;"></div>
      <div id="error-msg" class="auth-error"></div>
      
      <form class="auth-form" onsubmit="handleLogin(event)">
        <div class="form-group">
          <label class="form-label">Email</label>
          <input type="email" id="email" class="form-input" placeholder="you@example.com" required autocomplete="email">
        </div>
        <div class="form-group">
          <label class="form-label">Password</label>
          <input type="password" id="password" class="form-input" placeholder="Enter your password" required autocomplete="current-password">
          <a href="/forgot-password" style="display: block; text-align: right; margin-top: 8px; font-size: 13px; color: #6B7280; text-decoration: none;">Forgot password?</a>
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
    const errorCode = urlParams.get('error');
    
    // Show error from Google OAuth
    if (errorCode) {
      const errEl = document.getElementById('error-msg');
      const errorMessages = {
        'google_denied': 'Google sign-in was cancelled',
        'no_code': 'Authentication failed - no code received',
        'oauth_not_configured': 'Google sign-in is not configured',
        'token_exchange_failed': 'Failed to authenticate with Google',
        'no_user_info': 'Could not retrieve your Google account info'
      };
      errEl.textContent = errorMessages[errorCode] || 'Authentication failed';
      errEl.classList.add('show');
    }
    
    // Update register link to preserve redirect
    if (redirectTo) {
      const registerLink = document.querySelector('#register-link a');
      if (registerLink) {
        registerLink.href = '/register?redirect=' + encodeURIComponent(redirectTo);
      }
    }
    
    // Google Sign In
    function signInWithGoogle() {
      let url = '/api/auth/google';
      // Always pass redirect - default to /app if not set
      const targetRedirect = redirectTo || '/app';
      url += '?redirect=' + encodeURIComponent(targetRedirect);
      window.location.href = url;
    }
    
    async function handleLogin(e) {
      e.preventDefault();
      const btn = document.getElementById('submit-btn');
      const errEl = document.getElementById('error-msg');
      const infoEl = document.getElementById('info-msg');
      
      btn.disabled = true;
      btn.textContent = 'Logging in...';
      errEl.classList.remove('show');
      infoEl.style.display = 'none';
      
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
          // Redirect to original page or app
          window.location.href = redirectTo || '/app';
        } else if (data.needsVerification) {
          // User needs to verify email first
          infoEl.textContent = 'Please verify your email first. Check your inbox for the verification code.';
          infoEl.style.display = 'block';
          btn.disabled = false;
          btn.textContent = 'Log In';
          // Optionally redirect to verification page
          setTimeout(() => {
            window.location.href = '/register?verify=' + encodeURIComponent(data.email);
          }, 2000);
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
    .divider {
      display: flex;
      align-items: center;
      margin: 20px 0;
      color: #9CA3AF;
      font-size: 13px;
    }
    .divider::before, .divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: #E5E7EB;
    }
    .divider span { padding: 0 16px; }
    .google-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      width: 100%;
      padding: 14px 20px;
      background: white;
      border: 1px solid #E5E7EB;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 600;
      color: #374151;
      cursor: pointer;
      transition: all 0.2s;
    }
    .google-btn:hover { background: #F9FAFB; border-color: #D1D5DB; }
    .google-btn svg { width: 20px; height: 20px; }
    .password-requirements {
      margin-top: 8px;
      font-size: 12px;
      color: #6B7280;
    }
    .password-requirements li {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 4px;
    }
    .password-requirements li.valid { color: #059669; }
    .password-requirements li.invalid { color: #9CA3AF; }
    .password-requirements .check { color: #059669; }
    .password-requirements .cross { color: #9CA3AF; }
    
    /* Verification code screen */
    .verification-screen { display: none; }
    .verification-screen.active { display: block; }
    .register-screen.hidden { display: none; }
    .code-inputs {
      display: flex;
      gap: 8px;
      justify-content: center;
      margin: 24px 0;
    }
    .code-input {
      width: 48px;
      height: 56px;
      text-align: center;
      font-size: 24px;
      font-weight: 700;
      border: 2px solid #E5E7EB;
      border-radius: 12px;
      outline: none;
      transition: all 0.2s;
    }
    .code-input:focus {
      border-color: #8B5CF6;
      box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
    }
    .resend-link {
      color: #6B7280;
      font-size: 14px;
      text-align: center;
      margin-top: 16px;
    }
    .resend-link a {
      color: #7C3AED;
      text-decoration: none;
      font-weight: 600;
    }
    .resend-link a:hover { text-decoration: underline; }
    .resend-link a.disabled {
      color: #9CA3AF;
      pointer-events: none;
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
      
      <!-- REGISTRATION FORM -->
      <div id="register-screen" class="register-screen">
        <h1 class="auth-title" id="page-title">Create Account</h1>
        <p class="auth-subtitle" id="page-subtitle">Start generating professional product photos</p>
        <div style="text-align:center;" id="badge-container">
          <span class="bonus-badge">🎁 Get ${CREDITS.SIGNUP_CHEAPER + CREDITS.SIGNUP_BETTER} free credits on signup!</span>
        </div>
        
        <!-- Google Sign In -->
        <button onclick="signInWithGoogle()" class="google-btn" style="margin-top: 20px;">
          <svg viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Continue with Google
        </button>
        
        <div class="divider"><span>or</span></div>
        
        <div id="error-msg" class="auth-error"></div>
        
        <form class="auth-form" onsubmit="handleRegister(event)">
          <div class="form-group">
            <label class="form-label">Name (optional)</label>
            <input type="text" id="name" class="form-input" placeholder="Your name" autocomplete="name">
          </div>
          <div class="form-group">
            <label class="form-label">Email</label>
            <input type="email" id="email" class="form-input" placeholder="you@example.com" required autocomplete="email">
          </div>
          <div class="form-group">
            <label class="form-label">Password</label>
            <input type="password" id="password" class="form-input" placeholder="Create a strong password" required minlength="8" autocomplete="new-password" oninput="checkPasswordStrength()">
            <ul class="password-requirements" id="password-requirements">
              <li id="req-length" class="invalid"><span class="cross">✗</span> At least 8 characters</li>
              <li id="req-upper" class="invalid"><span class="cross">✗</span> One uppercase letter</li>
              <li id="req-lower" class="invalid"><span class="cross">✗</span> One lowercase letter</li>
              <li id="req-number" class="invalid"><span class="cross">✗</span> One number</li>
            </ul>
          </div>
          <div class="form-group">
            <label class="form-label">Confirm Password</label>
            <input type="password" id="confirm-password" class="form-input" placeholder="Re-enter your password" required autocomplete="new-password" oninput="checkPasswordMatch()">
            <p id="password-match-msg" style="font-size: 12px; margin-top: 6px; display: none;"></p>
          </div>
          <button type="submit" id="submit-btn" class="auth-btn">Create Account</button>
        </form>
        
        <p class="auth-footer" id="login-link">
          Already have an account? <a href="/login">Log in</a>
        </p>
      </div>
      
      <!-- EMAIL VERIFICATION SCREEN -->
      <div id="verification-screen" class="verification-screen">
        <h1 class="auth-title">Check Your Email</h1>
        <p class="auth-subtitle">We sent a 6-digit code to<br><strong id="verification-email"></strong></p>
        
        <div id="verify-error-msg" class="auth-error"></div>
        
        <div class="code-inputs">
          <input type="text" maxlength="1" class="code-input" data-index="0" oninput="handleCodeInput(this)" onkeydown="handleCodeKeydown(event, this)" autofocus>
          <input type="text" maxlength="1" class="code-input" data-index="1" oninput="handleCodeInput(this)" onkeydown="handleCodeKeydown(event, this)">
          <input type="text" maxlength="1" class="code-input" data-index="2" oninput="handleCodeInput(this)" onkeydown="handleCodeKeydown(event, this)">
          <input type="text" maxlength="1" class="code-input" data-index="3" oninput="handleCodeInput(this)" onkeydown="handleCodeKeydown(event, this)">
          <input type="text" maxlength="1" class="code-input" data-index="4" oninput="handleCodeInput(this)" onkeydown="handleCodeKeydown(event, this)">
          <input type="text" maxlength="1" class="code-input" data-index="5" oninput="handleCodeInput(this)" onkeydown="handleCodeKeydown(event, this)">
        </div>
        
        <button onclick="verifyCode()" id="verify-btn" class="auth-btn">Verify Email</button>
        
        <p class="resend-link">
          Didn't receive the code? <a href="#" onclick="resendCode(event)" id="resend-link">Resend</a>
          <span id="resend-timer"></span>
        </p>
        
        <p class="auth-footer">
          <a href="#" onclick="backToRegister(event)">← Back to registration</a>
        </p>
      </div>
    </div>
  </div>

  <script>
    // Get params from URL
    const urlParams = new URLSearchParams(window.location.search);
    const redirectTo = urlParams.get('redirect');
    const selectedPlan = urlParams.get('plan');
    let userEmail = '';
    let resendCooldown = 0;
    
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
    
    // Google Sign In
    function signInWithGoogle() {
      let url = '/api/auth/google';
      const params = [];
      // Always pass redirect - default to /app if not set
      const targetRedirect = redirectTo || '/app';
      params.push('redirect=' + encodeURIComponent(targetRedirect));
      if (selectedPlan) params.push('plan=' + selectedPlan);
      url += '?' + params.join('&');
      window.location.href = url;
    }
    
    // Password strength checker
    function checkPasswordStrength() {
      const password = document.getElementById('password').value;
      const requirements = {
        length: password.length >= 8,
        upper: /[A-Z]/.test(password),
        lower: /[a-z]/.test(password),
        number: /[0-9]/.test(password)
      };
      
      Object.keys(requirements).forEach(key => {
        const el = document.getElementById('req-' + key);
        if (requirements[key]) {
          el.className = 'valid';
          el.innerHTML = '<span class="check">✓</span> ' + el.textContent.replace('✗ ', '').replace('✓ ', '');
        } else {
          el.className = 'invalid';
          el.innerHTML = '<span class="cross">✗</span> ' + el.textContent.replace('✗ ', '').replace('✓ ', '');
        }
      });
      
      checkPasswordMatch();
    }
    
    function checkPasswordMatch() {
      const password = document.getElementById('password').value;
      const confirm = document.getElementById('confirm-password').value;
      const msg = document.getElementById('password-match-msg');
      
      if (!confirm) {
        msg.style.display = 'none';
        return;
      }
      
      msg.style.display = 'block';
      if (password === confirm) {
        msg.textContent = '✓ Passwords match';
        msg.style.color = '#059669';
      } else {
        msg.textContent = '✗ Passwords do not match';
        msg.style.color = '#DC2626';
      }
    }
    
    async function handleRegister(e) {
      e.preventDefault();
      const btn = document.getElementById('submit-btn');
      const errEl = document.getElementById('error-msg');
      
      const password = document.getElementById('password').value;
      const confirmPassword = document.getElementById('confirm-password').value;
      
      // Client-side validation
      if (password !== confirmPassword) {
        errEl.textContent = 'Passwords do not match';
        errEl.classList.add('show');
        return;
      }
      
      if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
        errEl.textContent = 'Password does not meet requirements';
        errEl.classList.add('show');
        return;
      }
      
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
            password: password,
            confirmPassword: confirmPassword
          })
        });
        
        const data = await res.json();
        
        if (data.success && data.needsVerification) {
          // Show verification screen
          userEmail = document.getElementById('email').value;
          showVerificationScreen();
        } else if (data.success) {
          // Direct login (shouldn't happen with email verification)
          window.location.href = redirectTo || '/?welcome=1';
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
    
    function showVerificationScreen() {
      document.getElementById('register-screen').classList.add('hidden');
      document.getElementById('verification-screen').classList.add('active');
      document.getElementById('verification-email').textContent = userEmail;
      document.querySelector('.code-input').focus();
      startResendCooldown();
    }
    
    function backToRegister(e) {
      e.preventDefault();
      document.getElementById('register-screen').classList.remove('hidden');
      document.getElementById('verification-screen').classList.remove('active');
    }
    
    function handleCodeInput(input) {
      const value = input.value.replace(/[^0-9]/g, '');
      input.value = value;
      
      if (value && input.dataset.index < 5) {
        const next = document.querySelector('.code-input[data-index="' + (parseInt(input.dataset.index) + 1) + '"]');
        if (next) next.focus();
      }
      
      // Auto-submit if all filled
      const allInputs = document.querySelectorAll('.code-input');
      const code = Array.from(allInputs).map(i => i.value).join('');
      if (code.length === 6) {
        verifyCode();
      }
    }
    
    function handleCodeKeydown(e, input) {
      if (e.key === 'Backspace' && !input.value && input.dataset.index > 0) {
        const prev = document.querySelector('.code-input[data-index="' + (parseInt(input.dataset.index) - 1) + '"]');
        if (prev) {
          prev.focus();
          prev.value = '';
        }
      }
    }
    
    async function verifyCode() {
      const btn = document.getElementById('verify-btn');
      const errEl = document.getElementById('verify-error-msg');
      
      const allInputs = document.querySelectorAll('.code-input');
      const code = Array.from(allInputs).map(i => i.value).join('');
      
      if (code.length !== 6) {
        errEl.textContent = 'Please enter the 6-digit code';
        errEl.classList.add('show');
        return;
      }
      
      btn.disabled = true;
      btn.textContent = 'Verifying...';
      errEl.classList.remove('show');
      
      try {
        const res = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: userEmail, code })
        });
        
        const data = await res.json();
        
        if (data.success) {
          // If paid plan, go to checkout
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
              window.location.href = '/pricing?signup=success&checkout=failed';
            }
          } else {
            window.location.href = redirectTo || '/?welcome=1';
          }
        } else {
          errEl.textContent = data.error || 'Verification failed';
          errEl.classList.add('show');
          btn.disabled = false;
          btn.textContent = 'Verify Email';
          // Clear inputs
          allInputs.forEach(i => i.value = '');
          allInputs[0].focus();
        }
      } catch (err) {
        errEl.textContent = 'Something went wrong. Please try again.';
        errEl.classList.add('show');
        btn.disabled = false;
        btn.textContent = 'Verify Email';
      }
    }
    
    function startResendCooldown() {
      resendCooldown = 60;
      updateResendTimer();
    }
    
    function updateResendTimer() {
      const link = document.getElementById('resend-link');
      const timer = document.getElementById('resend-timer');
      
      if (resendCooldown > 0) {
        link.classList.add('disabled');
        timer.textContent = ' (' + resendCooldown + 's)';
        resendCooldown--;
        setTimeout(updateResendTimer, 1000);
      } else {
        link.classList.remove('disabled');
        timer.textContent = '';
      }
    }
    
    async function resendCode(e) {
      e.preventDefault();
      if (resendCooldown > 0) return;
      
      try {
        await fetch('/api/auth/resend-verification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: userEmail })
        });
        startResendCooldown();
      } catch (err) {
        console.error('Failed to resend code');
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
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 20px; }
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
// ADMIN DASHBOARD PAGE
// ============================================================================
function getAdminDashboardPage(user: any) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Dashboard - ShopShot</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'><stop offset='0%25' style='stop-color:%233B82F6'/><stop offset='100%25' style='stop-color:%238B5CF6'/></linearGradient></defs><rect width='100' height='100' rx='22' fill='url(%23g)'/><circle cx='50' cy='50' r='28' fill='none' stroke='white' stroke-width='6'/><circle cx='50' cy='50' r='12' fill='white'/></svg>">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * { font-family: 'Inter', system-ui, sans-serif; box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0F0F10; min-height: 100vh; color: #E5E7EB; }
    
    /* Header */
    .admin-header {
      background: linear-gradient(180deg, #18181B 0%, #0F0F10 100%);
      border-bottom: 1px solid #27272A;
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .admin-title {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 20px;
      font-weight: 700;
      color: white;
    }
    .admin-title span {
      background: linear-gradient(135deg, #3B82F6, #8B5CF6);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .header-actions {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .refresh-btn {
      background: #27272A;
      border: 1px solid #3F3F46;
      color: #A1A1AA;
      padding: 8px 16px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
    }
    .refresh-btn:hover { background: #3F3F46; color: white; }
    .refresh-btn.loading { opacity: 0.7; pointer-events: none; }
    .back-link {
      color: #A1A1AA;
      text-decoration: none;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .back-link:hover { color: white; }
    .last-updated {
      font-size: 12px;
      color: #71717A;
    }
    
    /* Main Layout */
    .admin-container {
      max-width: 1600px;
      margin: 0 auto;
      padding: 24px;
    }
    
    /* KPI Cards */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }
    @media (max-width: 1200px) { .kpi-grid { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 640px) { .kpi-grid { grid-template-columns: 1fr; } }
    
    .kpi-card {
      background: linear-gradient(145deg, #18181B 0%, #1F1F23 100%);
      border: 1px solid #27272A;
      border-radius: 16px;
      padding: 24px;
      position: relative;
      overflow: hidden;
    }
    .kpi-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(90deg, #3B82F6, #8B5CF6);
      opacity: 0.8;
    }
    .kpi-label {
      font-size: 13px;
      color: #71717A;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .kpi-value {
      font-size: 32px;
      font-weight: 800;
      color: white;
      margin-bottom: 8px;
    }
    .kpi-trend {
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .kpi-trend.up { color: #22C55E; }
    .kpi-trend.down { color: #EF4444; }
    .kpi-trend.neutral { color: #71717A; }
    
    /* Main Grid */
    .main-grid {
      display: grid;
      grid-template-columns: 1fr 2fr 1fr;
      gap: 24px;
    }
    @media (max-width: 1200px) { 
      .main-grid { 
        grid-template-columns: 1fr 1fr;
      }
      .main-grid > div:nth-child(3) {
        grid-column: span 2;
      }
    }
    @media (max-width: 768px) { 
      .main-grid { 
        grid-template-columns: 1fr;
      }
      .main-grid > div:nth-child(3) {
        grid-column: span 1;
      }
    }
    
    /* Panels */
    .panel {
      background: #18181B;
      border: 1px solid #27272A;
      border-radius: 16px;
      overflow: hidden;
    }
    .panel-header {
      padding: 16px 20px;
      border-bottom: 1px solid #27272A;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .panel-title {
      font-size: 14px;
      font-weight: 600;
      color: white;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .panel-title .icon {
      width: 24px;
      height: 24px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
    }
    .panel-badge {
      font-size: 11px;
      padding: 4px 8px;
      border-radius: 20px;
      background: #27272A;
      color: #A1A1AA;
    }
    .panel-content {
      padding: 16px 20px;
      max-height: 400px;
      overflow-y: auto;
    }
    .panel-content::-webkit-scrollbar { width: 6px; }
    .panel-content::-webkit-scrollbar-track { background: transparent; }
    .panel-content::-webkit-scrollbar-thumb { background: #3F3F46; border-radius: 3px; }
    
    /* Activity Feed */
    .activity-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 0;
      border-bottom: 1px solid #27272A;
      cursor: pointer;
      transition: background 0.2s;
      margin: 0 -20px;
      padding-left: 20px;
      padding-right: 20px;
    }
    .activity-item:hover { background: #1F1F23; }
    .activity-item:last-child { border-bottom: none; }
    .activity-icon {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      flex-shrink: 0;
    }
    .activity-icon.join { background: #22C55E20; color: #22C55E; }
    .activity-icon.churn { background: #EF444420; color: #EF4444; }
    .activity-icon.gen { background: #3B82F620; color: #3B82F6; }
    .activity-details { flex: 1; min-width: 0; }
    .activity-email {
      font-size: 13px;
      color: white;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .activity-meta {
      font-size: 11px;
      color: #71717A;
      margin-top: 2px;
    }
    .activity-time {
      font-size: 11px;
      color: #52525B;
      flex-shrink: 0;
    }
    
    /* Revenue Chart */
    .chart-container {
      padding: 20px;
      height: 300px;
    }
    
    /* Plan Breakdown Table */
    .breakdown-table {
      width: 100%;
      border-collapse: collapse;
    }
    .breakdown-table th {
      text-align: left;
      font-size: 11px;
      color: #71717A;
      font-weight: 500;
      padding: 8px 12px;
      border-bottom: 1px solid #27272A;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .breakdown-table td {
      padding: 12px;
      font-size: 13px;
      border-bottom: 1px solid #27272A;
    }
    .breakdown-table tr:last-child td { border-bottom: none; }
    .plan-badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
    }
    .plan-badge.free { background: #3F3F46; color: #A1A1AA; }
    .plan-badge.standard { background: #3B82F620; color: #60A5FA; }
    .plan-badge.pro { background: #8B5CF620; color: #A78BFA; }
    
    /* Error Log */
    .error-item {
      display: flex;
      gap: 12px;
      padding: 12px 0;
      border-bottom: 1px solid #27272A;
    }
    .error-item:last-child { border-bottom: none; }
    .error-severity {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
      margin-top: 6px;
    }
    .error-severity.critical { background: #EF4444; box-shadow: 0 0 8px #EF444480; }
    .error-severity.warning { background: #F59E0B; }
    .error-severity.info { background: #22C55E; }
    .error-details { flex: 1; min-width: 0; }
    .error-type {
      font-size: 12px;
      color: white;
      font-weight: 500;
    }
    .error-message {
      font-size: 11px;
      color: #71717A;
      margin-top: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .error-meta {
      font-size: 10px;
      color: #52525B;
      margin-top: 4px;
    }
    
    /* Quick Actions */
    .quick-actions {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .action-btn {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      background: #27272A;
      border: 1px solid #3F3F46;
      border-radius: 10px;
      color: white;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s;
      text-decoration: none;
    }
    .action-btn:hover { background: #3F3F46; border-color: #52525B; }
    .action-btn .icon {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
    }
    .action-btn .icon.credits { background: #22C55E20; color: #22C55E; }
    .action-btn .icon.ban { background: #EF444420; color: #EF4444; }
    .action-btn .icon.export { background: #3B82F620; color: #3B82F6; }
    .action-btn .icon.search { background: #8B5CF620; color: #A78BFA; }
    
    /* User Modal */
    .modal-overlay {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      z-index: 1000;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .modal-overlay.show { display: flex; }
    .modal {
      background: #18181B;
      border: 1px solid #27272A;
      border-radius: 16px;
      width: 100%;
      max-width: 700px;
      max-height: 90vh;
      overflow-y: auto;
    }
    .modal-header {
      padding: 20px 24px;
      border-bottom: 1px solid #27272A;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      background: #18181B;
      z-index: 10;
    }
    .modal-title {
      font-size: 16px;
      font-weight: 600;
      color: white;
    }
    .modal-close {
      background: none;
      border: none;
      color: #71717A;
      font-size: 20px;
      cursor: pointer;
      padding: 4px;
    }
    .modal-close:hover { color: white; }
    .modal-body { padding: 24px; }
    
    .user-info-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }
    .info-item {
      background: #27272A;
      padding: 16px;
      border-radius: 10px;
    }
    .info-label {
      font-size: 11px;
      color: #71717A;
      margin-bottom: 4px;
      text-transform: uppercase;
    }
    .info-value {
      font-size: 14px;
      color: white;
      font-weight: 500;
    }
    
    .modal-section {
      margin-bottom: 24px;
    }
    .modal-section-title {
      font-size: 13px;
      font-weight: 600;
      color: white;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .modal-actions {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    .modal-btn {
      padding: 10px 16px;
      border-radius: 8px;
      font-size: 13px;
      cursor: pointer;
      border: none;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
    }
    .modal-btn.primary {
      background: linear-gradient(135deg, #3B82F6, #8B5CF6);
      color: white;
    }
    .modal-btn.primary:hover { opacity: 0.9; }
    .modal-btn.danger {
      background: #EF444420;
      color: #EF4444;
      border: 1px solid #EF444440;
    }
    .modal-btn.danger:hover { background: #EF444430; }
    .modal-btn.secondary {
      background: #27272A;
      color: #A1A1AA;
      border: 1px solid #3F3F46;
    }
    .modal-btn.secondary:hover { background: #3F3F46; color: white; }
    
    /* Empty State */
    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: #71717A;
      font-size: 13px;
    }
    .empty-state .icon {
      font-size: 32px;
      margin-bottom: 12px;
      opacity: 0.5;
    }
    
    /* Input Fields */
    .input-group {
      margin-bottom: 16px;
    }
    .input-label {
      display: block;
      font-size: 12px;
      color: #A1A1AA;
      margin-bottom: 6px;
    }
    .input-field {
      width: 100%;
      padding: 10px 14px;
      background: #27272A;
      border: 1px solid #3F3F46;
      border-radius: 8px;
      color: white;
      font-size: 14px;
    }
    .input-field:focus {
      outline: none;
      border-color: #3B82F6;
    }
    .input-row {
      display: flex;
      gap: 12px;
    }
    .input-row > * { flex: 1; }
    
    /* Search */
    .search-box {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
    }
    .search-input {
      flex: 1;
      padding: 10px 14px;
      background: #27272A;
      border: 1px solid #3F3F46;
      border-radius: 8px;
      color: white;
      font-size: 14px;
    }
    .search-input:focus { outline: none; border-color: #3B82F6; }
    .search-btn {
      padding: 10px 20px;
      background: linear-gradient(135deg, #3B82F6, #8B5CF6);
      border: none;
      border-radius: 8px;
      color: white;
      font-size: 13px;
      cursor: pointer;
    }
    .search-btn:hover { opacity: 0.9; }
    
    /* Stats Row */
    .stats-row {
      display: flex;
      gap: 16px;
      margin-bottom: 24px;
    }
    @media (max-width: 768px) {
      .stats-row { flex-direction: column; }
    }
  </style>
</head>
<body>
  <header class="admin-header">
    <div class="admin-title">
      <span>ShopShot</span> Admin Dashboard
    </div>
    <div class="header-actions">
      <span class="last-updated" id="last-updated">Loading...</span>
      <button class="refresh-btn" onclick="refreshDashboard()" id="refresh-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
        </svg>
        Refresh
      </button>
      <a href="/app" class="back-link">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
        Back to App
      </a>
    </div>
  </header>
  
  <div class="admin-container">
    <!-- KPI Cards -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-label">Total Users</div>
        <div class="kpi-value" id="kpi-users">-</div>
        <div class="kpi-trend neutral" id="kpi-users-trend">Loading...</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Active Members</div>
        <div class="kpi-value" id="kpi-active">-</div>
        <div class="kpi-trend neutral" id="kpi-active-trend">Paid subscribers</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">MRR</div>
        <div class="kpi-value" id="kpi-mrr">-</div>
        <div class="kpi-trend neutral" id="kpi-mrr-trend">Monthly recurring</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Credits Used (30d)</div>
        <div class="kpi-value" id="kpi-credits">-</div>
        <div class="kpi-trend neutral" id="kpi-credits-trend">Total consumed</div>
      </div>
    </div>
    
    <!-- Signups & Cancellations Row -->
    <div class="stats-row" style="margin-bottom: 24px;">
      <!-- Daily Signups -->
      <div class="panel" style="flex: 1;">
        <div class="panel-header">
          <div class="panel-title">
            <span class="icon" style="background: #22C55E20; color: #22C55E;">✨</span>
            New Signups (30 days)
          </div>
          <span class="panel-badge" id="signups-total">0</span>
        </div>
        <div class="chart-container" style="height: 200px;">
          <canvas id="signups-chart"></canvas>
        </div>
        <div class="panel-content" style="max-height: 250px;">
          <div id="signups-list">
            <div class="empty-state"><div class="icon">📭</div>No recent signups</div>
          </div>
        </div>
      </div>
      
      <!-- Daily Cancellations -->
      <div class="panel" style="flex: 1;">
        <div class="panel-header">
          <div class="panel-title">
            <span class="icon" style="background: #EF444420; color: #EF4444;">👋</span>
            Cancellations (30 days)
          </div>
          <span class="panel-badge" id="cancellations-total">0</span>
        </div>
        <div class="chart-container" style="height: 200px;">
          <canvas id="cancellations-chart"></canvas>
        </div>
        <div class="panel-content" style="max-height: 250px;">
          <div id="cancellations-list">
            <div class="empty-state"><div class="icon">✨</div>No cancellations - great!</div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Main Grid -->
    <div class="main-grid">
      <!-- User Activity -->
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">
            <span class="icon" style="background: #22C55E20; color: #22C55E;">👥</span>
            Recent Activity (7 days)
          </div>
          <span class="panel-badge" id="activity-count">0</span>
        </div>
        <div class="panel-content" id="activity-feed">
          <div class="empty-state">
            <div class="icon">📭</div>
            No recent activity
          </div>
        </div>
      </div>
      
      <!-- Revenue Section -->
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">
            <span class="icon" style="background: #3B82F620; color: #3B82F6;">📈</span>
            Revenue Overview
          </div>
        </div>
        <div class="chart-container">
          <canvas id="revenue-chart"></canvas>
        </div>
        <div class="panel-content" style="padding-top: 0; max-height: none;">
          <table class="breakdown-table">
            <thead>
              <tr>
                <th>Plan</th>
                <th>Subscribers</th>
                <th>MRR</th>
              </tr>
            </thead>
            <tbody id="plan-breakdown">
              <tr>
                <td><span class="plan-badge free">Free</span></td>
                <td>-</td>
                <td>£0</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      
      <!-- Error Log + Quick Actions -->
      <div style="display: flex; flex-direction: column; gap: 24px;">
        <div class="panel" style="flex: 1;">
          <div class="panel-header">
            <div class="panel-title">
              <span class="icon" style="background: #EF444420; color: #EF4444;">🔴</span>
              Error Log (24h)
            </div>
            <span class="panel-badge" id="error-count">0</span>
          </div>
          <div class="panel-content" id="error-log">
            <div class="empty-state">
              <div class="icon">✨</div>
              No errors - all systems operational
            </div>
          </div>
        </div>
        
        <div class="panel">
          <div class="panel-header">
            <div class="panel-title">
              <span class="icon" style="background: #8B5CF620; color: #A78BFA;">⚡</span>
              Quick Actions
            </div>
          </div>
          <div class="panel-content quick-actions" style="max-height: none;">
            <button class="action-btn" onclick="openSearchModal()">
              <span class="icon search">🔍</span>
              Search Users
            </button>
            <button class="action-btn" onclick="openCreditsModal()">
              <span class="icon credits">💰</span>
              Add Credits
            </button>
            <a class="action-btn" href="/api/admin/export/users" download>
              <span class="icon export">📥</span>
              Export Users CSV
            </a>
          </div>
        </div>
      </div>
    </div>
  </div>
  
  <!-- User Modal -->
  <div class="modal-overlay" id="user-modal">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title" id="modal-title">User Details</div>
        <button class="modal-close" onclick="closeModal()">&times;</button>
      </div>
      <div class="modal-body" id="modal-body">
        Loading...
      </div>
    </div>
  </div>
  
  <!-- Search Modal -->
  <div class="modal-overlay" id="search-modal">
    <div class="modal">
      <div class="modal-header">
        <div class="modal-title">Search Users</div>
        <button class="modal-close" onclick="closeSearchModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="search-box">
          <input type="text" class="search-input" id="search-input" placeholder="Search by email or name..." onkeyup="handleSearchKeyup(event)">
          <button class="search-btn" onclick="searchUsers()">Search</button>
        </div>
        <div id="search-results"></div>
      </div>
    </div>
  </div>
  
  <!-- Add Credits Modal -->
  <div class="modal-overlay" id="credits-modal">
    <div class="modal" style="max-width: 500px;">
      <div class="modal-header">
        <div class="modal-title">Add Credits to User</div>
        <button class="modal-close" onclick="closeCreditsModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="input-group">
          <label class="input-label">User Email</label>
          <input type="email" class="input-field" id="credits-email" placeholder="user@example.com">
        </div>
        <div class="input-row">
          <div class="input-group">
            <label class="input-label">Amount</label>
            <input type="number" class="input-field" id="credits-amount" placeholder="10" min="1">
          </div>
          <div class="input-group">
            <label class="input-label">Credit Type</label>
            <select class="input-field" id="credits-type">
              <option value="cheaper">Standard (Cheaper)</option>
              <option value="better">Premium (Better)</option>
            </select>
          </div>
        </div>
        <div class="input-group">
          <label class="input-label">Reason (optional)</label>
          <input type="text" class="input-field" id="credits-reason" placeholder="Compensation, promo, etc.">
        </div>
        <div class="modal-actions" style="margin-top: 20px;">
          <button class="modal-btn primary" onclick="addCredits()">Add Credits</button>
          <button class="modal-btn secondary" onclick="closeCreditsModal()">Cancel</button>
        </div>
      </div>
    </div>
  </div>
  
  <script>
    let revenueChart = null;
    let dashboardData = null;
    let autoRefreshInterval = null;
    
    // Initialize
    document.addEventListener('DOMContentLoaded', () => {
      refreshDashboard();
      // Auto-refresh every 30 seconds
      autoRefreshInterval = setInterval(refreshDashboard, 30000);
    });
    
    async function refreshDashboard() {
      const btn = document.getElementById('refresh-btn');
      btn.classList.add('loading');
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg> Loading...';
      
      try {
        const res = await fetch('/api/admin/dashboard');
        const data = await res.json();
        
        if (data.success) {
          dashboardData = data;
          updateKPIs(data.kpis);
          updateSignupsChart(data.dailySignups, data.recentSignups);
          updateCancellationsChart(data.dailyCancellations, data.recentCancellations);
          updateActivityFeed(data.recentSignups, data.recentCancellations);
          updatePlanBreakdown(data.planBreakdown);
          updateErrorLog(data.recentErrors);
          updateRevenueChart(data.dailyRevenue);
          
          document.getElementById('last-updated').textContent = 'Updated: ' + new Date().toLocaleTimeString();
        } else {
          console.error('Dashboard error:', data.error);
        }
      } catch (error) {
        console.error('Failed to load dashboard:', error);
      }
      
      btn.classList.remove('loading');
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg> Refresh';
    }
    
    function updateKPIs(kpis) {
      document.getElementById('kpi-users').textContent = kpis.totalUsers.toLocaleString();
      document.getElementById('kpi-active').textContent = kpis.activeMembers.toLocaleString();
      document.getElementById('kpi-mrr').textContent = '£' + (kpis.mrr || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
      document.getElementById('kpi-credits').textContent = (kpis.creditsConsumed || 0).toLocaleString();
    }
    
    let signupsChart = null;
    let cancellationsChart = null;
    
    function updateSignupsChart(dailyData, recentList) {
      // Update total
      const total = (dailyData || []).reduce((sum, d) => sum + d.count, 0);
      document.getElementById('signups-total').textContent = total;
      
      // Build chart data for last 30 days
      const labels = [];
      const data = [];
      const dataMap = {};
      (dailyData || []).forEach(d => { dataMap[d.date] = d.count; });
      
      for (let i = 29; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        labels.push(date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
        data.push(dataMap[dateStr] || 0);
      }
      
      const ctx = document.getElementById('signups-chart').getContext('2d');
      if (signupsChart) signupsChart.destroy();
      
      signupsChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: 'Signups',
            data: data,
            backgroundColor: '#22C55E40',
            borderColor: '#22C55E',
            borderWidth: 1,
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false }, ticks: { color: '#71717A', maxTicksLimit: 7, font: { size: 10 } } },
            y: { grid: { color: '#27272A' }, ticks: { color: '#71717A', stepSize: 1 }, beginAtZero: true }
          }
        }
      });
      
      // Update list
      const listEl = document.getElementById('signups-list');
      if (!recentList || recentList.length === 0) {
        listEl.innerHTML = '<div class="empty-state"><div class="icon">📭</div>No recent signups</div>';
        return;
      }
      
      // Group by date
      const grouped = {};
      recentList.forEach(u => {
        const date = new Date(u.created_at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
        if (!grouped[date]) grouped[date] = [];
        grouped[date].push(u);
      });
      
      let html = '';
      Object.keys(grouped).forEach(date => {
        html += '<div style="font-size: 11px; color: #71717A; padding: 8px 0 4px; border-bottom: 1px solid #27272A; font-weight: 600;">' + date + ' (' + grouped[date].length + ')</div>';
        grouped[date].forEach(u => {
          html += '<div class="activity-item" onclick="openUserModal(\\'' + u.id + '\\')" style="padding: 8px 0;">' +
            '<div class="activity-icon join" style="width: 24px; height: 24px; font-size: 11px;">✨</div>' +
            '<div class="activity-details"><div class="activity-email" style="font-size: 12px;">' + u.email + '</div></div>' +
            '</div>';
        });
      });
      listEl.innerHTML = html;
    }
    
    function updateCancellationsChart(dailyData, recentList) {
      // Update total
      const total = (dailyData || []).reduce((sum, d) => sum + d.count, 0);
      document.getElementById('cancellations-total').textContent = total;
      
      // Build chart data for last 30 days
      const labels = [];
      const data = [];
      const dataMap = {};
      (dailyData || []).forEach(d => { dataMap[d.date] = d.count; });
      
      for (let i = 29; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        labels.push(date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
        data.push(dataMap[dateStr] || 0);
      }
      
      const ctx = document.getElementById('cancellations-chart').getContext('2d');
      if (cancellationsChart) cancellationsChart.destroy();
      
      cancellationsChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: 'Cancellations',
            data: data,
            backgroundColor: '#EF444440',
            borderColor: '#EF4444',
            borderWidth: 1,
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false }, ticks: { color: '#71717A', maxTicksLimit: 7, font: { size: 10 } } },
            y: { grid: { color: '#27272A' }, ticks: { color: '#71717A', stepSize: 1 }, beginAtZero: true }
          }
        }
      });
      
      // Update list
      const listEl = document.getElementById('cancellations-list');
      if (!recentList || recentList.length === 0) {
        listEl.innerHTML = '<div class="empty-state"><div class="icon">✨</div>No cancellations - great!</div>';
        return;
      }
      
      // Group by date
      const grouped = {};
      recentList.forEach(u => {
        const date = new Date(u.updated_at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
        if (!grouped[date]) grouped[date] = [];
        grouped[date].push(u);
      });
      
      let html = '';
      Object.keys(grouped).forEach(date => {
        html += '<div style="font-size: 11px; color: #71717A; padding: 8px 0 4px; border-bottom: 1px solid #27272A; font-weight: 600;">' + date + ' (' + grouped[date].length + ')</div>';
        grouped[date].forEach(u => {
          html += '<div class="activity-item" onclick="openUserModal(\\'' + u.id + '\\')" style="padding: 8px 0;">' +
            '<div class="activity-icon churn" style="width: 24px; height: 24px; font-size: 11px;">👋</div>' +
            '<div class="activity-details"><div class="activity-email" style="font-size: 12px;">' + u.email + '</div></div>' +
            '</div>';
        });
      });
      listEl.innerHTML = html;
    }
    
    function updateActivityFeed(joins, cancellations) {
      const feed = document.getElementById('activity-feed');
      const count = (joins?.length || 0) + (cancellations?.length || 0);
      document.getElementById('activity-count').textContent = count;
      
      if (count === 0) {
        feed.innerHTML = '<div class="empty-state"><div class="icon">📭</div>No recent activity</div>';
        return;
      }
      
      let html = '';
      
      // Combine and sort by time
      const activities = [
        ...(joins || []).map(u => ({ ...u, type: 'join' })),
        ...(cancellations || []).map(u => ({ ...u, type: 'churn' }))
      ].sort((a, b) => new Date(b.created_at || b.updated_at) - new Date(a.created_at || a.updated_at));
      
      activities.forEach(item => {
        const time = new Date(item.created_at || item.updated_at);
        const dateStr = time.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const icon = item.type === 'join' ? 'join' : 'churn';
        const iconEmoji = item.type === 'join' ? '✨' : '👋';
        const label = item.type === 'join' ? 'Signup' : 'Cancelled';
        
        html += \`
          <div class="activity-item" onclick="openUserModal('\${item.id}')">
            <div class="activity-icon \${icon}">\${iconEmoji}</div>
            <div class="activity-details">
              <div class="activity-email">\${item.email}</div>
              <div class="activity-meta">\${label} - \${item.subscription_plan || 'free'}</div>
            </div>
            <div class="activity-time">\${dateStr}<br>\${timeStr}</div>
          </div>
        \`;
      });
      
      feed.innerHTML = html;
    }
    
    function updatePlanBreakdown(breakdown) {
      const tbody = document.getElementById('plan-breakdown');
      
      // Ensure we have all plans
      const plans = { free: { count: 0, revenue: 0 }, standard: { count: 0, revenue: 0 }, pro: { count: 0, revenue: 0 } };
      (breakdown || []).forEach(p => {
        if (plans[p.plan]) {
          plans[p.plan] = { count: p.count, revenue: p.revenue || 0 };
        }
      });
      
      tbody.innerHTML = \`
        <tr>
          <td><span class="plan-badge free">Free</span></td>
          <td>\${plans.free.count}</td>
          <td>£0</td>
        </tr>
        <tr>
          <td><span class="plan-badge standard">Standard</span></td>
          <td>\${plans.standard.count}</td>
          <td>£\${(plans.standard.revenue || 0).toFixed(2)}</td>
        </tr>
        <tr>
          <td><span class="plan-badge pro">Pro</span></td>
          <td>\${plans.pro.count}</td>
          <td>£\${(plans.pro.revenue || 0).toFixed(2)}</td>
        </tr>
      \`;
    }
    
    function updateErrorLog(errors) {
      const log = document.getElementById('error-log');
      document.getElementById('error-count').textContent = errors?.length || 0;
      
      if (!errors || errors.length === 0) {
        log.innerHTML = '<div class="empty-state"><div class="icon">✨</div>No errors - all systems operational</div>';
        return;
      }
      
      let html = '';
      errors.forEach(err => {
        const time = new Date(err.timestamp);
        const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const severity = err.severity || 'warning';
        
        html += \`
          <div class="error-item">
            <div class="error-severity \${severity}"></div>
            <div class="error-details">
              <div class="error-type">\${err.error_type}</div>
              <div class="error-message">\${err.error_message || 'No message'}</div>
              <div class="error-meta">\${timeStr}\${err.user_email ? ' - ' + err.user_email : ''}\${err.endpoint ? ' - ' + err.endpoint : ''}</div>
            </div>
          </div>
        \`;
      });
      
      log.innerHTML = html;
    }
    
    function updateRevenueChart(dailyRevenue) {
      const ctx = document.getElementById('revenue-chart').getContext('2d');
      
      // Prepare data for last 30 days
      const labels = [];
      const data = [];
      const today = new Date();
      
      for (let i = 29; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        labels.push(date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
        
        const dayData = (dailyRevenue || []).find(d => d.date === dateStr);
        data.push(dayData?.revenue || 0);
      }
      
      if (revenueChart) {
        revenueChart.destroy();
      }
      
      revenueChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [{
            label: 'Revenue (£)',
            data: data,
            borderColor: '#8B5CF6',
            backgroundColor: 'rgba(139, 92, 246, 0.1)',
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 6,
            pointHoverBackgroundColor: '#8B5CF6'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false }
          },
          scales: {
            x: {
              grid: { color: '#27272A' },
              ticks: { color: '#71717A', maxTicksLimit: 7 }
            },
            y: {
              grid: { color: '#27272A' },
              ticks: { 
                color: '#71717A',
                callback: value => '£' + value
              },
              beginAtZero: true
            }
          }
        }
      });
    }
    
    // Modal Functions
    async function openUserModal(userId) {
      const modal = document.getElementById('user-modal');
      const body = document.getElementById('modal-body');
      const title = document.getElementById('modal-title');
      
      modal.classList.add('show');
      body.innerHTML = '<div class="empty-state">Loading user details...</div>';
      
      try {
        const res = await fetch('/api/admin/users/' + userId);
        const data = await res.json();
        
        if (data.success) {
          const u = data.user;
          title.textContent = u.name || u.email;
          
          body.innerHTML = \`
            <div class="user-info-grid">
              <div class="info-item">
                <div class="info-label">Email</div>
                <div class="info-value">\${u.email}</div>
              </div>
              <div class="info-item">
                <div class="info-label">Name</div>
                <div class="info-value">\${u.name || 'Not set'}</div>
              </div>
              <div class="info-item">
                <div class="info-label">Plan</div>
                <div class="info-value"><span class="plan-badge \${u.subscription_plan}">\${u.subscription_plan}</span></div>
              </div>
              <div class="info-item">
                <div class="info-label">Status</div>
                <div class="info-value">\${u.is_banned ? '🚫 Banned' : '✅ Active'}</div>
              </div>
              <div class="info-item">
                <div class="info-label">Standard Credits</div>
                <div class="info-value">\${u.cheaper_credits}</div>
              </div>
              <div class="info-item">
                <div class="info-label">Premium Credits</div>
                <div class="info-value">\${u.better_credits}</div>
              </div>
              <div class="info-item">
                <div class="info-label">Joined</div>
                <div class="info-value">\${new Date(u.created_at).toLocaleDateString()}</div>
              </div>
              <div class="info-item">
                <div class="info-label">Auth Method</div>
                <div class="info-value">\${u.google_id ? '🔵 Google' : '📧 Email'}</div>
              </div>
            </div>
            
            <div class="modal-section">
              <div class="modal-section-title">📋 Recent Transactions</div>
              \${renderTransactions(data.transactions)}
            </div>
            
            <div class="modal-actions">
              <button class="modal-btn primary" onclick="addCreditsForUser('\${u.id}', '\${u.email}')">
                💰 Add Credits
              </button>
              <button class="modal-btn \${u.is_banned ? 'secondary' : 'danger'}" onclick="toggleBan('\${u.id}', \${u.is_banned ? 'false' : 'true'})">
                \${u.is_banned ? '✅ Unban User' : '🚫 Ban User'}
              </button>
            </div>
          \`;
        } else {
          body.innerHTML = '<div class="empty-state">Failed to load user details</div>';
        }
      } catch (error) {
        body.innerHTML = '<div class="empty-state">Error loading user</div>';
      }
    }
    
    function renderTransactions(transactions) {
      if (!transactions || transactions.length === 0) {
        return '<div class="empty-state" style="padding: 20px 0;">No transactions</div>';
      }
      
      return '<div style="max-height: 200px; overflow-y: auto;">' + transactions.slice(0, 10).map(t => \`
        <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #27272A; font-size: 12px;">
          <span style="color: #A1A1AA;">\${t.type} (\${t.credit_type})</span>
          <span style="color: \${t.amount > 0 ? '#22C55E' : '#EF4444'};">\${t.amount > 0 ? '+' : ''}\${t.amount}</span>
        </div>
      \`).join('') + '</div>';
    }
    
    function closeModal() {
      document.getElementById('user-modal').classList.remove('show');
    }
    
    // Search Modal
    function openSearchModal() {
      document.getElementById('search-modal').classList.add('show');
      document.getElementById('search-input').focus();
    }
    
    function closeSearchModal() {
      document.getElementById('search-modal').classList.remove('show');
    }
    
    function handleSearchKeyup(e) {
      if (e.key === 'Enter') searchUsers();
    }
    
    async function searchUsers() {
      const query = document.getElementById('search-input').value;
      const results = document.getElementById('search-results');
      results.innerHTML = '<div class="empty-state">Searching...</div>';
      
      try {
        const res = await fetch('/api/admin/users?search=' + encodeURIComponent(query));
        const data = await res.json();
        
        if (data.success && data.users.length > 0) {
          results.innerHTML = data.users.map(u => \`
            <div class="activity-item" onclick="closeSearchModal(); openUserModal('\${u.id}')">
              <div class="activity-icon join">👤</div>
              <div class="activity-details">
                <div class="activity-email">\${u.email}</div>
                <div class="activity-meta">\${u.name || 'No name'} - <span class="plan-badge \${u.subscription_plan}" style="font-size: 10px;">\${u.subscription_plan}</span></div>
              </div>
            </div>
          \`).join('');
        } else {
          results.innerHTML = '<div class="empty-state">No users found</div>';
        }
      } catch (error) {
        results.innerHTML = '<div class="empty-state">Search failed</div>';
      }
    }
    
    // Credits Modal
    function openCreditsModal() {
      document.getElementById('credits-modal').classList.add('show');
      document.getElementById('credits-email').focus();
    }
    
    function closeCreditsModal() {
      document.getElementById('credits-modal').classList.remove('show');
    }
    
    function addCreditsForUser(userId, email) {
      closeModal();
      document.getElementById('credits-email').value = email;
      openCreditsModal();
    }
    
    async function addCredits() {
      const email = document.getElementById('credits-email').value;
      const amount = parseInt(document.getElementById('credits-amount').value);
      const creditType = document.getElementById('credits-type').value;
      const reason = document.getElementById('credits-reason').value;
      
      if (!email || !amount) {
        alert('Please enter email and amount');
        return;
      }
      
      // First find user by email
      const searchRes = await fetch('/api/admin/users?search=' + encodeURIComponent(email));
      const searchData = await searchRes.json();
      
      if (!searchData.success || searchData.users.length === 0) {
        alert('User not found');
        return;
      }
      
      const user = searchData.users.find(u => u.email.toLowerCase() === email.toLowerCase());
      if (!user) {
        alert('User not found with that exact email');
        return;
      }
      
      try {
        const res = await fetch('/api/admin/users/' + user.id + '/credits', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount, creditType, reason })
        });
        const data = await res.json();
        
        if (data.success) {
          alert('Credits added successfully! New balance: ' + data.newBalance);
          closeCreditsModal();
          refreshDashboard();
        } else {
          alert('Failed: ' + data.error);
        }
      } catch (error) {
        alert('Failed to add credits');
      }
    }
    
    async function toggleBan(userId, ban) {
      const reason = ban === 'true' ? prompt('Reason for ban (optional):') : '';
      
      try {
        const res = await fetch('/api/admin/users/' + userId + '/ban', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ banned: ban === 'true', reason })
        });
        const data = await res.json();
        
        if (data.success) {
          alert(ban === 'true' ? 'User banned' : 'User unbanned');
          closeModal();
          refreshDashboard();
        } else {
          alert('Failed: ' + data.error);
        }
      } catch (error) {
        alert('Failed to update user');
      }
    }
  </script>
  
  <style>
    .spin { animation: spin 1s linear infinite; }
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
  </style>
</body>
</html>`;
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
