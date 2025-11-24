-- Sessions table for tracking generation history
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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
