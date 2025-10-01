-- Normalize merchant names to uppercase
BEGIN;

-- Update all merchant names to uppercase
UPDATE receipts
SET merchant_name = UPPER(merchant_name)
WHERE merchant_name IS NOT NULL;

-- Get count of updated records
SELECT
    'Merchant names normalized successfully' as status,
    COUNT(*) as updated_records
FROM receipts
WHERE merchant_name IS NOT NULL;

COMMIT;