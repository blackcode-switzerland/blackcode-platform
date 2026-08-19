-- Phase 5 hardening: SHA-256 for captured files.
--
-- ===========================================================================
-- THE HASH THAT PROVES A FILE SHOULD BE THE STRONG ONE
-- ===========================================================================
-- `md5_checksum` is what Google Drive reports about a file and stays: it is
-- the worker's cross-check against Drive's own inventory, and the legacy
-- idempotency key. But the hash the BOOKS cite as evidence (`piece_hash` on
-- an entry, rule receipt-002's hash-at-capture, art. 958f's integrity
-- doctrine) should not rest on MD5, which has been collision-broken for
-- twenty years. The worker now hashes the bytes it captured with SHA-256 and
-- hands that over; matching prefers it, and MD5 remains only as Drive's
-- cross-check and as the dedupe key for rows that predate this column.
--
-- The idempotency index moves to COALESCE(sha256, md5_checksum, ''): a retry
-- delivers the identical payload, so whichever checksum the delivery carried
-- converges on itself. Existing rows all have NULL sha256, so their key is
-- unchanged and no collision is possible.
ALTER TABLE books.piece_inbox ADD COLUMN IF NOT EXISTS sha256 varchar(64);--> statement-breakpoint

DROP INDEX IF EXISTS books.uq_books_piece_inbox_file_checksum;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_books_piece_inbox_file_checksum
  ON books.piece_inbox (workspace_id, drive_file_id, COALESCE(sha256, md5_checksum, ''));
