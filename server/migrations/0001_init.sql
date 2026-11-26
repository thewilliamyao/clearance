-- The shared index: what Recorders filed on shift 5, as 40x30 two-tone prints.
-- Nothing else is kept: no photo, no location, nothing that identifies the unit or the person
-- who sent it.

CREATE TABLE entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,                   -- the shift 5 request it was filed for (sadness, alone, ...)
  bits TEXT NOT NULL,                    -- 150 bytes in base64: 40x30, row by row, high bit first, 1 = paper
  day TEXT NOT NULL,                     -- the day it arrived, YYYY-MM-DD (UTC), set by the server
  status TEXT NOT NULL DEFAULT 'live',   -- live | held (held until approved when HOLD_NEW is on)
  key_hash TEXT NOT NULL                 -- SHA-256 of the key the sender got back, so they can withdraw it
);
CREATE INDEX entries_by_label ON entries (status, label, id);

-- Upload counters for the rate limit. A key is an HMAC of (address, hour) or 'day:YYYY-MM-DD';
-- no address is stored, and each row is deleted once its window is over.
CREATE TABLE rate (
  k TEXT PRIMARY KEY,
  n INTEGER NOT NULL,
  until INTEGER NOT NULL                 -- unix seconds
);
CREATE INDEX rate_by_until ON rate (until);
