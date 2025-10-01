-- Migration script to convert category values from Spanish to English
-- This ensures data consistency with the new internal English format

BEGIN;

-- Show current state before migration
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

-- Update receipts table categories from Spanish to English
UPDATE receipts SET category = 'grocery' WHERE category = 'Mercado';
UPDATE receipts SET category = 'transport' WHERE category = 'Transporte';
UPDATE receipts SET category = 'food' WHERE category = 'Comida';
UPDATE receipts SET category = 'fuel' WHERE category = 'Combustible';
UPDATE receipts SET category = 'others' WHERE category = 'Otros';

-- Update products table categories from Spanish to English
UPDATE products SET category = 'grocery' WHERE category = 'Alimentos';
UPDATE products SET category = 'transport' WHERE category = 'Transporte';
UPDATE products SET category = 'food' WHERE category = 'Comida';
UPDATE products SET category = 'fuel' WHERE category = 'Combustible';
UPDATE products SET category = 'others' WHERE category = 'Otros';

-- Additional product category mappings based on the locales
UPDATE products SET category = 'food' WHERE category = 'Bebidas';
UPDATE products SET category = 'others' WHERE category = 'Limpieza';
UPDATE products SET category = 'others' WHERE category = 'Higiene';
UPDATE products SET category = 'others' WHERE category = 'Farmacia';

-- Show results after migration
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

-- Check for any remaining Spanish categories that might need attention
SELECT 'REMAINING SPANISH CATEGORIES IN RECEIPTS' as info;
SELECT DISTINCT category
FROM receipts
WHERE category IS NOT NULL
AND category NOT IN ('grocery', 'transport', 'food', 'fuel', 'others');

SELECT 'REMAINING SPANISH CATEGORIES IN PRODUCTS' as info;
SELECT DISTINCT category
FROM products
WHERE category IS NOT NULL
AND category NOT IN ('grocery', 'transport', 'food', 'fuel', 'others');

COMMIT;