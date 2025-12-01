-- Social Posts table for Social Studio feature
-- Stores posts created and published to YouTube, Instagram, X/Twitter via Late API

CREATE TABLE IF NOT EXISTS social_posts (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  platform TEXT NOT NULL CHECK(platform IN ('youtube', 'instagram', 'twitter')),
  caption TEXT NOT NULL,
  image_url TEXT,
  image_base64 TEXT,
  post_id TEXT,
  post_url TEXT,
  status TEXT DEFAULT 'draft' CHECK(status IN ('published', 'failed', 'draft')),
  posted_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT REFERENCES users(id),
  prompt TEXT,
  error_message TEXT
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_social_posts_platform ON social_posts(platform);
CREATE INDEX IF NOT EXISTS idx_social_posts_posted_at ON social_posts(posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_posts_status ON social_posts(status);
CREATE INDEX IF NOT EXISTS idx_social_posts_created_by ON social_posts(created_by);
