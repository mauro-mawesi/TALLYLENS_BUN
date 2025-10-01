-- Expand product categories to be more specific and useful
BEGIN;

-- Remove the old constraint
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_category_check;

-- Add the new constraint with expanded categories
ALTER TABLE products ADD CONSTRAINT products_category_check
CHECK (category IN ('food', 'beverages', 'cleaning', 'personal_care', 'pharmacy', 'transport', 'fuel', 'others'));

COMMIT;

-- Show result
SELECT 'Product categories constraint updated successfully' as status;