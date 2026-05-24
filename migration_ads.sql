-- Migration: Ad/Banner management system
-- Run this against the RepostLaira PostgreSQL database

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS ads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title VARCHAR(255) NOT NULL,
  image_url VARCHAR(500),
  target_url VARCHAR(500),
  placement VARCHAR(50) NOT NULL CHECK (placement IN ('hero_top', 'between_results', 'footer', 'popup')),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  start_date DATE,
  end_date DATE,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookups of active ads by placement
CREATE INDEX IF NOT EXISTS idx_ads_placement_status ON ads (placement, status);
CREATE INDEX IF NOT EXISTS idx_ads_status ON ads (status);
