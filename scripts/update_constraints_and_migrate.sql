-- Update database constraints and migrate category values from Spanish to English
-- This script:
-- 1. Updates check constraints to allow English categories
-- 2. Migrates existing data from Spanish to English
-- 3. Ensures data consistency

BEGIN;

-- 1. First, show current state
SELECT 'BEFORE MIGRATION - RECEIPTS' as info;
SELECT category, COUNT(*) as count
FROM receipts
WHERE category IS NOT NULL
GROUP BY category
ORDER BY count DESC;

SELECT 'BEFORE MIGRATION - PRODUCTS' as info;
SELECT category, COUNT(*) as count
FROM products
WHERE category IS NOT NULL
GROUP BY category
ORDER BY count DESC;

-- 2. Drop the existing check constraint on receipts table
ALTER TABLE receipts DROP CONSTRAINT IF EXISTS receipts_category_check;

-- 3. Add new check constraint that allows English categories
ALTER TABLE receipts ADD CONSTRAINT receipts_category_check
    CHECK (category = ANY (ARRAY['grocery'::text, 'transport'::text, 'food'::text, 'fuel'::text, 'others'::text]));

-- 4. Check if products table has similar constraints (it might not)
-- First let's see the structure
\d products

-- 5. Update receipts table categories from Spanish to English
UPDATE receipts SET category = 'grocery' WHERE category = 'Mercado';
UPDATE receipts SET category = 'transport' WHERE category = 'Transporte';
UPDATE receipts SET category = 'food' WHERE category = 'Comida';
UPDATE receipts SET category = 'fuel' WHERE category = 'Combustible';
UPDATE receipts SET category = 'others' WHERE category = 'Otros';

-- 6. Update products table categories
-- Check if products table has constraints first, if not we can proceed
UPDATE products SET category = 'food' WHERE category = 'Alimentos';
UPDATE products SET category = 'food' WHERE category = 'Bebidas';
UPDATE products SET category = 'others' WHERE category = 'Limpieza';
UPDATE products SET category = 'others' WHERE category = 'Higiene';
UPDATE products SET category = 'others' WHERE category = 'Farmacia';
UPDATE products SET category = 'transport' WHERE category = 'Transporte';
UPDATE products SET category = 'food' WHERE category = 'Comida';
UPDATE products SET category = 'fuel' WHERE category = 'Combustible';
UPDATE products SET category = 'others' WHERE category = 'Otros';

-- 7. Show results after migration
SELECT 'AFTER MIGRATION - RECEIPTS' as info;
SELECT category, COUNT(*) as count
FROM receipts
WHERE category IS NOT NULL
GROUP BY category
ORDER BY count DESC;

SELECT 'AFTER MIGRATION - PRODUCTS' as info;
SELECT category, COUNT(*) as count
FROM products
WHERE category IS NOT NULL
GROUP BY category
ORDER BY count DESC;

-- 8. Verify no Spanish categories remain
SELECT 'REMAINING NON-ENGLISH CATEGORIES IN RECEIPTS' as info;
SELECT DISTINCT category
FROM receipts
WHERE category IS NOT NULL
AND category NOT IN ('grocery', 'transport', 'food', 'fuel', 'others');

SELECT 'REMAINING NON-ENGLISH CATEGORIES IN PRODUCTS' as info;
SELECT DISTINCT category
FROM products
WHERE category IS NOT NULL
AND category NOT IN ('grocery', 'transport', 'food', 'fuel', 'others');

-- 9. Show updated constraint
SELECT 'UPDATED CONSTRAINT' as info;
SELECT conname, consrc
FROM pg_constraint
WHERE conname = 'receipts_category_check';

COMMIT;