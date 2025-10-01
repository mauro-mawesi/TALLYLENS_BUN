-- Complete migration: Update unit constraints and data for receipt_items and products tables
-- Converts all unit values from Spanish to English

BEGIN;

-- 1. Show current state
SELECT 'BEFORE MIGRATION - RECEIPT_ITEMS UNITS' as info;
SELECT unit, COUNT(*) as count
FROM receipt_items
WHERE unit IS NOT NULL
GROUP BY unit
ORDER BY count DESC;

SELECT 'BEFORE MIGRATION - PRODUCTS UNITS' as info;
SELECT unit, COUNT(*) as count
FROM products
WHERE unit IS NOT NULL
GROUP BY unit
ORDER BY count DESC;

-- 2. Remove constraints from both tables temporarily
ALTER TABLE receipt_items DROP CONSTRAINT IF EXISTS receipt_items_unit_check;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_unit_check;

-- 3. Update receipt_items table units from Spanish to English
UPDATE receipt_items SET unit = 'unit' WHERE unit = 'unidad';
UPDATE receipt_items SET unit = 'kg' WHERE unit = 'kg';  -- Already in English
UPDATE receipt_items SET unit = 'g' WHERE unit = 'g';    -- Already in English
UPDATE receipt_items SET unit = 'l' WHERE unit = 'l';    -- Already in English
UPDATE receipt_items SET unit = 'ml' WHERE unit = 'ml';  -- Already in English
UPDATE receipt_items SET unit = 'package' WHERE unit = 'paquete';
UPDATE receipt_items SET unit = 'box' WHERE unit = 'caja';
UPDATE receipt_items SET unit = 'bottle' WHERE unit = 'botella';

-- 4. Update products table units from Spanish to English
UPDATE products SET unit = 'unit' WHERE unit = 'unidad';
UPDATE products SET unit = 'kg' WHERE unit = 'kg';
UPDATE products SET unit = 'g' WHERE unit = 'g';
UPDATE products SET unit = 'l' WHERE unit = 'l';
UPDATE products SET unit = 'ml' WHERE unit = 'ml';
UPDATE products SET unit = 'package' WHERE unit = 'paquete';
UPDATE products SET unit = 'box' WHERE unit = 'caja';
UPDATE products SET unit = 'bottle' WHERE unit = 'botella';

-- 5. Add new constraints with English units
ALTER TABLE receipt_items ADD CONSTRAINT receipt_items_unit_check
    CHECK (unit = ANY (ARRAY['unit'::character varying, 'kg'::character varying, 'g'::character varying, 'l'::character varying, 'ml'::character varying, 'package'::character varying, 'box'::character varying, 'bottle'::character varying]::text[]));

ALTER TABLE products ADD CONSTRAINT products_unit_check
    CHECK (unit = ANY (ARRAY['unit'::character varying, 'kg'::character varying, 'g'::character varying, 'l'::character varying, 'ml'::character varying, 'package'::character varying, 'box'::character varying, 'bottle'::character varying]::text[]));

-- 6. Show final state
SELECT 'AFTER MIGRATION - RECEIPT_ITEMS UNITS' as info;
SELECT unit, COUNT(*) as count
FROM receipt_items
WHERE unit IS NOT NULL
GROUP BY unit
ORDER BY count DESC;

SELECT 'AFTER MIGRATION - PRODUCTS UNITS' as info;
SELECT unit, COUNT(*) as count
FROM products
WHERE unit IS NOT NULL
GROUP BY unit
ORDER BY count DESC;

-- 7. Verify no issues remain
SELECT 'ANY REMAINING NON-ENGLISH UNITS IN RECEIPT_ITEMS' as info;
SELECT DISTINCT unit
FROM receipt_items
WHERE unit IS NOT NULL
AND unit NOT IN ('unit', 'kg', 'g', 'l', 'ml', 'package', 'box', 'bottle');

SELECT 'ANY REMAINING NON-ENGLISH UNITS IN PRODUCTS' as info;
SELECT DISTINCT unit
FROM products
WHERE unit IS NOT NULL
AND unit NOT IN ('unit', 'kg', 'g', 'l', 'ml', 'package', 'box', 'bottle');

-- 8. Show updated constraints
SELECT 'NEW RECEIPT_ITEMS UNIT CONSTRAINT' as info;
SELECT pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint
WHERE conname = 'receipt_items_unit_check';

SELECT 'NEW PRODUCTS UNIT CONSTRAINT' as info;
SELECT pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint
WHERE conname = 'products_unit_check';

COMMIT;