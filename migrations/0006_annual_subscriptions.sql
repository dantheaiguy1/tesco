-- Annual subscriptions with monthly credit accrual.
--
-- Annual subscribers pay once but must not receive twelve months of credits
-- up front - that lets a single subscriber draw a year of API cost in one
-- weekend and then churn. Instead credits accrue one month at a time.
--
-- Cloudflare Pages has no cron trigger, so the accrual is lazy: on any
-- authenticated request we check whether a grant is due and, if so, apply it.
-- next_credit_grant_at is the guard that makes that idempotent.

ALTER TABLE users ADD COLUMN subscription_interval TEXT DEFAULT 'month';
ALTER TABLE users ADD COLUMN next_credit_grant_at DATETIME;
ALTER TABLE users ADD COLUMN subscription_period_end DATETIME;

CREATE INDEX IF NOT EXISTS idx_users_credit_accrual
  ON users (subscription_status, subscription_interval, next_credit_grant_at);

-- Anonymous try-before-signup.
-- A visitor may generate a small number of preview variations without an
-- account. That spends real API budget, so every anonymous session is recorded
-- and rate limited by IP before it can be claimed on registration.
CREATE TABLE IF NOT EXISTS anonymous_generations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  ip_country TEXT,
  images_generated INTEGER NOT NULL DEFAULT 0,
  claimed_by_user_id TEXT,
  claimed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_anon_gen_ip ON anonymous_generations (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_anon_gen_session ON anonymous_generations (session_id);
