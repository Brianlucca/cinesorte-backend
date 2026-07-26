CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS watch_party_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(8) NOT NULL UNIQUE,
  name VARCHAR(48) NOT NULL,
  service VARCHAR(20) NOT NULL CHECK (service IN ('youtube', 'prime', 'local')),
  privacy VARCHAR(20) NOT NULL CHECK (privacy IN ('invite', 'friends')),
  allow_guest_control BOOLEAN NOT NULL DEFAULT FALSE,
  host_id VARCHAR(128) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  playback JSONB NOT NULL DEFAULT '{"status":"idle","position":0}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS watch_party_rooms_host_updated_idx
  ON watch_party_rooms (host_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS watch_party_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES watch_party_rooms(id) ON DELETE CASCADE,
  video_id VARCHAR(32) NOT NULL,
  title VARCHAR(120) NOT NULL,
  thumbnail TEXT,
  added_by VARCHAR(128) NOT NULL,
  position INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, position)
);
