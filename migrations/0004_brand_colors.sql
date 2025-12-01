-- Migration: Brand Color Palette Feature
-- Created: 2024-12-01
-- Purpose: Allow users to save brand colors for lifestyle shot generation

-- ============================================
-- 1. USER BRAND SETTINGS TABLE
-- ============================================
-- Stores persistent brand color preferences per user
-- One row per user (UNIQUE constraint on user_id)

CREATE TABLE IF NOT EXISTS user_brand_settings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  color_1 TEXT,
  color_2 TEXT,
  color_3 TEXT,
  color_4 TEXT,
  color_5 TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_user_brand_settings_user_id ON user_brand_settings(user_id);

-- ============================================
-- 2. ADD BRAND COLORS TO SESSIONS TABLE
-- ============================================
-- Per-session brand color overrides
-- NULL = no brand colors specified (use defaults or none)
-- Empty array [] = user explicitly cleared brand colors
-- Populated array = use these colors instead of saved defaults

ALTER TABLE sessions ADD COLUMN brand_colors TEXT;
