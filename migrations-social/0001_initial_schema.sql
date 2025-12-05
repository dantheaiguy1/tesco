-- ShopShot Social Media Command Centre - Initial Schema
-- Created: December 5, 2025

-- Voice Profiles (brand voice settings)
CREATE TABLE IF NOT EXISTS voice_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_type TEXT UNIQUE NOT NULL DEFAULT 'shopshot',
  voice_name TEXT NOT NULL,
  voice_description TEXT NOT NULL,
  tone TEXT NOT NULL,
  style TEXT NOT NULL,
  example_captions TEXT, -- JSON array
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Platform Connections (GetLate account IDs)
CREATE TABLE IF NOT EXISTS platform_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_type TEXT NOT NULL DEFAULT 'shopshot',
  platform TEXT NOT NULL CHECK(platform IN ('instagram', 'youtube', 'twitter')),
  social_network_key TEXT, -- GetLate account ID
  is_connected INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(account_type, platform)
);

-- Content Pillars (content themes/categories)
CREATE TABLE IF NOT EXISTS content_pillars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  short_code TEXT NOT NULL,
  description TEXT,
  color TEXT NOT NULL, -- hex color
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Content Roadmap (6-month content calendar)
CREATE TABLE IF NOT EXISTS content_roadmap (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  time_slot TEXT NOT NULL CHECK(time_slot IN ('morning', 'noon', 'evening')),
  pillar_id INTEGER,
  topic TEXT NOT NULL,
  cta TEXT,
  platforms TEXT NOT NULL, -- JSON array of platforms
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned', 'created', 'scheduled', 'published')),
  post_id INTEGER, -- linked to posts table when created
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pillar_id) REFERENCES content_pillars(id),
  UNIQUE(date, time_slot)
);

-- Posts (actual content)
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_type TEXT NOT NULL DEFAULT 'shopshot',
  date TEXT NOT NULL,
  scheduled_time TEXT NOT NULL,
  time_slot TEXT CHECK(time_slot IN ('morning', 'noon', 'evening')),
  media_type TEXT NOT NULL CHECK(media_type IN ('image', 'video')),
  media_url TEXT,
  caption TEXT,
  platforms TEXT NOT NULL, -- JSON array
  pillar_id INTEGER,
  topic TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'scheduled', 'published', 'failed')),
  publish_results TEXT, -- JSON object with platform results
  roadmap_id INTEGER, -- linked to content_roadmap
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  published_at DATETIME,
  FOREIGN KEY (pillar_id) REFERENCES content_pillars(id),
  FOREIGN KEY (roadmap_id) REFERENCES content_roadmap(id)
);

-- Media Library
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_type TEXT NOT NULL DEFAULT 'shopshot',
  filename TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK(media_type IN ('image', 'video')),
  file_size INTEGER,
  url TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  pillar_id INTEGER,
  tags TEXT, -- JSON array
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pillar_id) REFERENCES content_pillars(id)
);

-- Publish Queue (individual platform publish status)
CREATE TABLE IF NOT EXISTS publish_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'publishing', 'published', 'failed')),
  platform_post_id TEXT,
  late_post_id TEXT,
  error_message TEXT,
  published_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

-- Brand Knowledge Base
CREATE TABLE IF NOT EXISTS brand_knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL,
  priority INTEGER DEFAULT 1, -- 1 = always include in AI prompts
  source TEXT DEFAULT 'manual',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- AI Generation History (for debugging/reference)
CREATE TABLE IF NOT EXISTS ai_generations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('caption', 'image', 'enhance')),
  platform TEXT,
  prompt TEXT,
  result TEXT,
  model TEXT,
  tokens_used INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_posts_date ON posts(date);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_roadmap_date ON content_roadmap(date);
CREATE INDEX IF NOT EXISTS idx_media_type ON media(media_type);
CREATE INDEX IF NOT EXISTS idx_publish_queue_status ON publish_queue(status);
