ALTER TABLE watch_party_rooms DROP CONSTRAINT IF EXISTS watch_party_rooms_service_check;
UPDATE watch_party_rooms SET service = CASE WHEN service = 'local' THEN 'local' ELSE 'screen' END;
ALTER TABLE watch_party_rooms ADD CONSTRAINT watch_party_rooms_service_check CHECK (service IN ('screen', 'local'));

ALTER TABLE watch_party_rooms DROP CONSTRAINT IF EXISTS watch_party_rooms_privacy_check;
UPDATE watch_party_rooms SET privacy = 'following' WHERE privacy = 'friends';
ALTER TABLE watch_party_rooms ADD CONSTRAINT watch_party_rooms_privacy_check CHECK (privacy IN ('public', 'invite', 'followers', 'following'));

CREATE TABLE IF NOT EXISTS watch_party_access (
  room_id UUID NOT NULL REFERENCES watch_party_rooms(id) ON DELETE CASCADE,
  user_id VARCHAR(128) NOT NULL,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('selected', 'admitted', 'blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id, kind)
);

CREATE INDEX IF NOT EXISTS watch_party_access_room_kind_idx ON watch_party_access (room_id, kind);
