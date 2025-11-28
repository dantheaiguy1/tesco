-- Migration: Add image_data column to credit_transactions
-- Created: 2025-11-28
-- Purpose: Store generated images with credit transactions for history viewing

-- Add image_data column if it doesn't exist
-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we use a workaround
-- This will fail silently if column exists (handled by app code)

ALTER TABLE credit_transactions ADD COLUMN image_data TEXT;
ALTER TABLE credit_transactions ADD COLUMN credit_type TEXT DEFAULT 'cheaper';
