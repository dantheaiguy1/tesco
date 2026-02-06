// ============================================================================
// REFERRAL SYSTEM - Backend routes and database logic
// ============================================================================

import { Hono } from 'hono'

// Generate a short unique referral code
export function generateReferralCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

// Ensure referral tables exist
export async function ensureReferralTables(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_user_id TEXT NOT NULL,
      referred_email TEXT,
      referred_user_id TEXT,
      referral_code TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'completed', 'expired')),
      referrer_credits_awarded INTEGER DEFAULT 0,
      referred_credits_awarded INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT
    )
  `).run()

  // Add referral_code to users table if not exists
  try {
    await db.prepare('ALTER TABLE users ADD COLUMN referral_code TEXT').run()
  } catch (e) {
    // Column already exists
  }
  try {
    await db.prepare('ALTER TABLE users ADD COLUMN referred_by TEXT').run()
  } catch (e) {
    // Column already exists
  }
}

// Get or create referral code for a user
export async function getUserReferralCode(db: D1Database, userId: string): Promise<string> {
  const user = await db.prepare('SELECT referral_code FROM users WHERE id = ?').bind(userId).first() as any
  
  if (user?.referral_code) {
    return user.referral_code
  }
  
  // Generate and save a new code
  const code = generateReferralCode()
  await db.prepare('UPDATE users SET referral_code = ? WHERE id = ?').bind(code, userId).run()
  return code
}

// Process a referral when a new user signs up with a referral code
export async function processReferral(
  db: D1Database,
  referralCode: string,
  newUserId: string,
  newUserEmail: string,
  cheaperCredits: number,
  betterCredits: number,
  generateId: () => string
): Promise<{ success: boolean; referrerName?: string; error?: string }> {
  try {
    // Find the referrer
    const referrer = await db.prepare(
      'SELECT id, email, name, cheaper_credits, better_credits FROM users WHERE referral_code = ?'
    ).bind(referralCode).first() as any

    if (!referrer) {
      return { success: false, error: 'Invalid referral code' }
    }

    // Prevent self-referral
    if (referrer.id === newUserId) {
      return { success: false, error: 'Cannot use your own referral code' }
    }

    // Check if this user was already referred
    const existingReferral = await db.prepare(
      'SELECT id FROM referrals WHERE referred_user_id = ? AND status = ?'
    ).bind(newUserId, 'completed').first()

    if (existingReferral) {
      return { success: false, error: 'Already referred' }
    }

    // Award credits to referrer
    await db.prepare(
      'UPDATE users SET cheaper_credits = cheaper_credits + ?, better_credits = better_credits + ? WHERE id = ?'
    ).bind(cheaperCredits, betterCredits, referrer.id).run()

    // Log referrer credit transaction
    await db.prepare(`
      INSERT INTO credit_transactions (id, user_id, amount, balance_after, credit_type, type, description)
      VALUES (?, ?, ?, ?, 'cheaper', 'referral_bonus', ?)
    `).bind(
      generateId(),
      referrer.id,
      cheaperCredits,
      referrer.cheaper_credits + cheaperCredits,
      'Referral bonus - ' + newUserEmail + ' signed up'
    ).run()

    await db.prepare(`
      INSERT INTO credit_transactions (id, user_id, amount, balance_after, credit_type, type, description)
      VALUES (?, ?, ?, ?, 'better', 'referral_bonus', ?)
    `).bind(
      generateId(),
      referrer.id,
      betterCredits,
      referrer.better_credits + betterCredits,
      'Referral bonus - ' + newUserEmail + ' signed up'
    ).run()

    // Award credits to referred user (they already get signup bonus, this is extra)
    await db.prepare(
      'UPDATE users SET cheaper_credits = cheaper_credits + ?, better_credits = better_credits + ? WHERE id = ?'
    ).bind(cheaperCredits, betterCredits, newUserId).run()

    // Log referred user credit transaction
    await db.prepare(`
      INSERT INTO credit_transactions (id, user_id, amount, balance_after, credit_type, type, description)
      VALUES (?, ?, ?, ?, 'cheaper', 'referral_bonus', ?)
    `).bind(
      generateId(),
      newUserId,
      cheaperCredits,
      cheaperCredits, // We don't know their current balance, will be approximate
      'Referral welcome bonus from ' + (referrer.name || referrer.email)
    ).run()

    await db.prepare(`
      INSERT INTO credit_transactions (id, user_id, amount, balance_after, credit_type, type, description)
      VALUES (?, ?, ?, ?, 'better', 'referral_bonus', ?)
    `).bind(
      generateId(),
      newUserId,
      betterCredits,
      betterCredits,
      'Referral welcome bonus from ' + (referrer.name || referrer.email)
    ).run()

    // Record the referral
    await db.prepare(`
      INSERT INTO referrals (referrer_user_id, referred_email, referred_user_id, referral_code, status, referrer_credits_awarded, referred_credits_awarded, completed_at)
      VALUES (?, ?, ?, ?, 'completed', ?, ?, datetime('now'))
    `).bind(
      referrer.id,
      newUserEmail,
      newUserId,
      referralCode,
      cheaperCredits + betterCredits,
      cheaperCredits + betterCredits
    ).run()

    // Update referred_by on the new user
    await db.prepare('UPDATE users SET referred_by = ? WHERE id = ?').bind(referrer.id, newUserId).run()

    return { success: true, referrerName: referrer.name || referrer.email.split('@')[0] }
  } catch (error: any) {
    console.error('[Referral] Error processing referral:', error)
    return { success: false, error: error.message || 'Failed to process referral' }
  }
}

// Get referral stats for a user
export async function getReferralStats(db: D1Database, userId: string): Promise<{
  referralCode: string;
  totalReferrals: number;
  totalCreditsEarned: number;
  recentReferrals: any[];
}> {
  const code = await getUserReferralCode(db, userId)
  
  const stats = await db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(referrer_credits_awarded) as total_credits
    FROM referrals 
    WHERE referrer_user_id = ? AND status = 'completed'
  `).bind(userId).first() as any

  const recent = await db.prepare(`
    SELECT referred_email, completed_at, referrer_credits_awarded
    FROM referrals
    WHERE referrer_user_id = ? AND status = 'completed'
    ORDER BY completed_at DESC
    LIMIT 10
  `).bind(userId).all() as any

  return {
    referralCode: code,
    totalReferrals: stats?.total || 0,
    totalCreditsEarned: stats?.total_credits || 0,
    recentReferrals: recent?.results || []
  }
}
