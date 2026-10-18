-- One-off: run ONCE against production, before the first `npm run db:migrate:prod`.
--
--   npx wrangler d1 execute TESCO_DB --remote --file=scripts/baseline-d1-migrations.sql
--
-- Why this exists
-- ---------------
-- Production has never been migrated with `wrangler d1 migrations apply`. There
-- is no d1_migrations table, and the schema was built at runtime by
-- ensureDatabase() in src/index.tsx. Run as-is, `migrations apply` would try to
-- replay 0001 onwards against a populated database and stop at 0002, whose
-- `ALTER TABLE sessions ADD COLUMN user_id` fails because the column exists.
--
-- Checked against production on 18 Oct 2026:
--   0001-0005  reflected in the live schema (tables and ALTER-added columns
--              present), EXCEPT nine indexes declared in 0002/0005 that were
--              never created, and sessions.model_used, which no code uses.
--              0007 recreates the missing indexes.
--   0006       NOT applied (users.subscription_interval etc. absent).
--
-- So this marks 0001-0005 as applied and leaves 0006 onwards for wrangler.
-- It is idempotent: safe to run twice.

CREATE TABLE IF NOT EXISTS d1_migrations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0001_initial_schema.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0002_multi_user_saas.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0003_add_image_data_column.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0004_brand_colors.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0005_social_posts.sql');
