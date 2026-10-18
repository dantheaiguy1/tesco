-- October 2026: currency, free-credit drip, lifecycle emails, R2 image keys,
-- anonymous background removal, plus repair of schema drift found in production.
--
-- Run order matters. Apply migrations BEFORE deploying the build that uses
-- them: ensureDatabase() adds the same columns at runtime for local dev, and
-- SQLite has no ADD COLUMN IF NOT EXISTS, so a deploy-then-migrate order would
-- make this migration fail on duplicate columns. The deploy workflow enforces
-- migrate-then-deploy.

-- ---------------------------------------------------------------------------
-- Drift repair. These indexes are declared in 0002 and 0005 but were never
-- created in production (checked 18 Oct 2026). IF NOT EXISTS makes this safe
-- wherever they already exist.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id ON credit_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_created_at ON credit_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_type ON credit_transactions(type);
CREATE INDEX IF NOT EXISTS idx_stripe_events_type ON stripe_events(type);
CREATE INDEX IF NOT EXISTS idx_stripe_events_processed ON stripe_events(processed);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_social_posts_created_by ON social_posts(created_by);

-- ---------------------------------------------------------------------------
-- Plan column. Production's users table was created before Starter existed and
-- carries CHECK (subscription_plan IN ('free', 'standard', 'pro')). The first
-- Starter purchase would fail that check in the webhook - after the credits
-- were granted - so Stripe would retry and grant them again on every retry.
--
-- SQLite cannot alter a CHECK constraint, and the usual table rebuild is not
-- safe here: six tables reference users(id) ON DELETE CASCADE, and with foreign
-- keys enforced, dropping the old table cascade-deletes every child row even
-- with PRAGMA defer_foreign_keys (verified against local D1, 18 Oct 2026).
--
-- So `plan` is a new, unconstrained column and is now authoritative.
-- subscription_plan is kept in step where its constraint allows.
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN plan TEXT;
UPDATE users SET plan = subscription_plan WHERE plan IS NULL;

-- ---------------------------------------------------------------------------
-- Currency. The currency a user signed up in (from CF-IPCountry), then the
-- currency they actually subscribed in once they buy. Pages show prices in it.
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN currency TEXT;

-- ---------------------------------------------------------------------------
-- Free weekly drip: CREDITS.DRIP_CHEAPER Standard credits on each of the first
-- CREDITS.DRIP_WEEKS Mondays after signup, granted on the next request.
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN drip_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_drip_at DATETIME;

-- Existing accounts are long past their first four weeks. Mark them fully
-- dripped so the change does not hand every dormant account 16 credits.
UPDATE users SET drip_count = 4;

-- ---------------------------------------------------------------------------
-- Lifecycle emails, following the existing email_*_sent flag pattern.
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN email_day2_sent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN email_day7_sent INTEGER NOT NULL DEFAULT 0;

-- Existing accounts are far past day 2 and day 7. Mark them sent so the first
-- scheduled run does not mail every historic signup at once.
UPDATE users SET email_day2_sent = 1, email_day7_sent = 1;

-- ---------------------------------------------------------------------------
-- Anonymous usage is now shared by the homepage preview and the free
-- background remover, rate limited separately.
-- ---------------------------------------------------------------------------
ALTER TABLE anonymous_generations ADD COLUMN kind TEXT NOT NULL DEFAULT 'preview';
CREATE INDEX IF NOT EXISTS idx_anon_gen_kind_ip ON anonymous_generations (kind, ip_hash, created_at);

-- ---------------------------------------------------------------------------
-- R2 image storage. New images are written to the shopshot-images bucket and
-- only the object key is stored. image_data stays for rows not yet migrated by
-- scripts/migrate-images-to-r2.ts.
-- ---------------------------------------------------------------------------
ALTER TABLE generated_images ADD COLUMN image_key TEXT;
ALTER TABLE credit_transactions ADD COLUMN image_key TEXT;

-- ---------------------------------------------------------------------------
-- Analytics: record the visitor's network so datacenter traffic can be
-- filtered later. The user-agent rules catch about half the bot traffic; most
-- of the remainder arrives from hosting networks with a browser user agent.
-- ---------------------------------------------------------------------------
ALTER TABLE analytics_events ADD COLUMN as_org TEXT;

-- analytics_events had no index at all (120k rows): every admin chart and the
-- nightly bot cleanup scanned the whole table.
CREATE INDEX IF NOT EXISTS idx_analytics_events_type_created ON analytics_events (event_type, created_at);
