-- Final migration script: Remove constraint, migrate data, add new constraint
-- This approach avoids constraint violations during migration

BEGIN;

-- 1. Show current state
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

-- 2. Remove the existing check constraint temporarily
ALTER TABLE receipts DROP CONSTRAINT IF EXISTS receipts_category_check;

-- 3. Now safely update all categories to English
UPDATE receipts SET category = 'grocery' WHERE category = 'Mercado';
UPDATE receipts SET category = 'transport' WHERE category = 'Transporte';
UPDATE receipts SET category = 'food' WHERE category = 'Comida';
UPDATE receipts SET category = 'fuel' WHERE category = 'Combustible';
UPDATE receipts SET category = 'others' WHERE category = 'Otros';

-- 4. Update products table (no constraints expected here)
UPDATE products SET category = 'food' WHERE category = 'Alimentos';
UPDATE products SET category = 'food' WHERE category = 'Bebidas';
UPDATE products SET category = 'others' WHERE category = 'Limpieza';
UPDATE products SET category = 'others' WHERE category = 'Higiene';
UPDATE products SET category = 'others' WHERE category = 'Farmacia';
UPDATE products SET category = 'transport' WHERE category = 'Transporte';
UPDATE products SET category = 'food' WHERE category = 'Comida';
UPDATE products SET category = 'fuel' WHERE category = 'Combustible';
UPDATE products SET category = 'others' WHERE category = 'Otros';

-- 5. Add the new constraint with English categories
ALTER TABLE receipts ADD CONSTRAINT receipts_category_check
    CHECK (category = ANY (ARRAY['grocery'::text, 'transport'::text, 'food'::text, 'fuel'::text, 'others'::text]));

-- 6. Show final state
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

-- 7. Verify no issues remain
SELECT 'ANY REMAINING NON-ENGLISH CATEGORIES IN RECEIPTS' as info;
SELECT DISTINCT category
FROM receipts
WHERE category IS NOT NULL
AND category NOT IN ('grocery', 'transport', 'food', 'fuel', 'others');

SELECT 'ANY REMAINING NON-ENGLISH CATEGORIES IN PRODUCTS' as info;
SELECT DISTINCT category
FROM products
WHERE category IS NOT NULL
AND category NOT IN ('grocery', 'transport', 'food', 'fuel', 'others');

COMMIT;