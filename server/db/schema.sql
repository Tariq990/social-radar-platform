-- PostgreSQL Schema for MR SCRAP Social Radar
-- Production Database Migration Script

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(255) PRIMARY KEY,
  email VARCHAR(320),
  name VARCHAR(255),
  tier VARCHAR(50) DEFAULT 'free',
  password_hash TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ALTER COLUMN email TYPE VARCHAR(320);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_ci ON users(LOWER(email)) WHERE email IS NOT NULL;

-- 2. Application Sessions
CREATE TABLE IF NOT EXISTS app_sessions (
  id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  revoked_at TIMESTAMP WITH TIME ZONE
);

-- 3. Devices Table
CREATE TABLE IF NOT EXISTS devices (
  id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_token TEXT NOT NULL,
  platform VARCHAR(50) NOT NULL, -- 'web', 'android', 'ios'
  last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Sources Table (Monitored Social Accounts / Pages)
CREATE TABLE IF NOT EXISTS sources (
  id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL, -- 'facebook', 'instagram'
  external_id VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  name VARCHAR(255) NOT NULL,
  handle VARCHAR(255),
  avatar_url TEXT,
  bio TEXT,
  visibility_type VARCHAR(50) DEFAULT 'public', -- 'public', 'authenticated'
  connector_type VARCHAR(50) DEFAULT 'public_cloud', -- 'public_cloud', 'device_session', 'official_meta'
  connector_status VARCHAR(50) DEFAULT 'connected', -- 'connected', 'error', 'needs_attention', 'needs_relogin'
  is_paused BOOLEAN DEFAULT FALSE,
  last_checked_at TIMESTAMP WITH TIME ZONE,
  last_successful_check TIMESTAMP WITH TIME ZONE,
  consecutive_failures INT DEFAULT 0,
  last_error TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT uq_user_source UNIQUE(user_id, platform, external_id)
);

-- 5. Rules Table (Natural Language & Filter Rules)
CREATE TABLE IF NOT EXISTS rules (
  id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  natural_language TEXT NOT NULL,
  include_terms JSONB DEFAULT '[]'::jsonb,
  exclude_terms JSONB DEFAULT '[]'::jsonb,
  min_confidence NUMERIC(3,2) DEFAULT 0.80,
  alert_mode VARCHAR(50) DEFAULT 'instant', -- 'instant', 'digest', 'silent'
  enabled BOOLEAN DEFAULT TRUE,
  collection_id VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Rule Sources Mapping (Many-to-Many)
CREATE TABLE IF NOT EXISTS rule_sources (
  id VARCHAR(255) PRIMARY KEY,
  rule_id VARCHAR(255) NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  source_id VARCHAR(255) NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT uq_rule_source UNIQUE(rule_id, source_id)
);

-- 7. Posts Table (Normalized & Deduplicated Feed Content)
-- fingerprint values are source-scoped in application code (`sourceId:contentFingerprint`) so
-- this single-column UNIQUE constraint remains atomic and safe across multiple users/sources.
CREATE TABLE IF NOT EXISTS posts (
  id VARCHAR(255) PRIMARY KEY,
  source_id VARCHAR(255) NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL,
  external_id VARCHAR(255),
  canonical_url TEXT NOT NULL,
  author_name VARCHAR(255),
  author_avatar TEXT,
  text TEXT NOT NULL,
  media JSONB DEFAULT '[]'::jsonb,
  published_at TIMESTAMP WITH TIME ZONE,
  fingerprint VARCHAR(255) NOT NULL UNIQUE,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE posts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Migrate fingerprints created by the earlier prototype. Existing rows used a global content
-- fingerprint. Prefix with source_id so future processing is tenant/source-safe while keeping
-- one atomic UNIQUE target for ON CONFLICT(fingerprint).
UPDATE posts
SET fingerprint = LEFT(source_id || ':' || fingerprint, 255)
WHERE fingerprint NOT LIKE (source_id || ':%');

CREATE UNIQUE INDEX IF NOT EXISTS uq_posts_fingerprint ON posts(fingerprint);

-- 8. Matches Table (AI / Rule Matches)
CREATE TABLE IF NOT EXISTS matches (
  id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id VARCHAR(255) NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  rule_id VARCHAR(255) NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  source_id VARCHAR(255) NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  confidence NUMERIC(3,2) NOT NULL,
  category VARCHAR(100) NOT NULL,
  reason TEXT NOT NULL,
  extracted JSONB DEFAULT '{}'::jsonb,
  feedback VARCHAR(50) DEFAULT 'unrated', -- 'unrated', 'relevant', 'not_relevant'
  is_read BOOLEAN DEFAULT FALSE,
  is_saved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT uq_match_rule_post UNIQUE(rule_id, post_id)
);

-- 9. Notifications Table (Prepared and Sent Notifications)
CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id VARCHAR(255) NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  channel VARCHAR(50) NOT NULL, -- 'web_push', 'fcm', 'in_app'
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'sent', 'failed'
  payload JSONB NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE,
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 10. Connector Events Table (Audit / Health Logging)
CREATE TABLE IF NOT EXISTS connector_events (
  id VARCHAR(255) PRIMARY KEY,
  source_id VARCHAR(255) NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL, -- 'fetch', 'resolve', 'health_check', 'rate_limit'
  status VARCHAR(50) NOT NULL, -- 'success', 'warning', 'error'
  message TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 11. Performance, integrity & Monitoring Indexes
CREATE UNIQUE INDEX IF NOT EXISTS uq_devices_token_hash ON devices(device_token);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_app_sessions_user ON app_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_app_sessions_expires ON app_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sources_user ON sources(user_id);
CREATE INDEX IF NOT EXISTS idx_sources_active ON sources(is_paused, connector_status);
CREATE INDEX IF NOT EXISTS idx_rules_user ON rules(user_id);
CREATE INDEX IF NOT EXISTS idx_rule_sources_rule ON rule_sources(rule_id);
CREATE INDEX IF NOT EXISTS idx_rule_sources_source ON rule_sources(source_id);
CREATE INDEX IF NOT EXISTS idx_posts_source ON posts(source_id);
CREATE INDEX IF NOT EXISTS idx_posts_fingerprint ON posts(fingerprint);
CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_user ON matches(user_id);
CREATE INDEX IF NOT EXISTS idx_matches_source ON matches(source_id);
CREATE INDEX IF NOT EXISTS idx_matches_created ON matches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_connector_events_source ON connector_events(source_id, created_at DESC);
