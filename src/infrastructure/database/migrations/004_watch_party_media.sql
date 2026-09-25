ALTER TABLE watch_party_rooms
  ADD COLUMN IF NOT EXISTS media JSONB;
