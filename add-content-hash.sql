-- Add content_hash column to receipts table for duplicate detection
-- Execute this SQL in your PostgreSQL database

-- Add the content_hash column
ALTER TABLE receipts ADD COLUMN content_hash VARCHAR(64) NULL;

-- Add index for content_hash lookups
CREATE INDEX receipts_content_hash_idx ON receipts(content_hash);

-- Add unique composite index for user_id and content_hash to prevent exact duplicates per user
CREATE UNIQUE INDEX receipts_user_content_hash_unique_idx ON receipts(user_id, content_hash)
WHERE content_hash IS NOT NULL;

-- Update existing receipts with content hash (optional - can be done gradually)
-- This will generate hashes for existing receipts based on their current data
-- Comment out if you prefer to let the application generate hashes for new receipts only

/*
UPDATE receipts
SET content_hash = encode(
    sha256(
        CONCAT_WS('|',
            LOWER(TRIM(REGEXP_REPLACE(COALESCE(raw_text, ''), '\s+', ' ', 'g'))),
            LOWER(TRIM(COALESCE(merchant_name, ''))),
            COALESCE(purchase_date::date::text, ''),
            COALESCE(amount::text, '')
        )::bytea
    ),
    'hex'
)
WHERE content_hash IS NULL AND raw_text IS NOT NULL;
*/

-- Verify the changes
SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_name = 'receipts' AND column_name = 'content_hash';

-- Show the new indexes
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'receipts' AND indexname LIKE '%content_hash%';