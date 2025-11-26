-- Seed test users for ShopShot
-- Note: Password hashes are generated using PBKDF2 with SHA-256
-- These are example hashes - will be created via API in testing

-- Admin user (username: admin, password: admin1)
-- Customer user (username: customer, password: customer1)

-- The actual users will be created via the /api/auth/register endpoint
-- This file documents the expected test users:

-- Admin:
--   email: admin@shopshot.test
--   password: admin1
--   credits: 1000 (for testing)
--   subscription: pro

-- Customer:
--   email: customer@shopshot.test  
--   password: customer1
--   credits: 10 (default signup bonus)
--   subscription: free
