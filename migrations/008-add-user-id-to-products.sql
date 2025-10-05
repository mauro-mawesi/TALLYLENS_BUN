-- Migration: Add user_id to products table for multi-tenant isolation
-- Date: 2025-01-05
-- Description: Converts products table from global shared catalog to user-specific catalog
--              This ensures privacy and data isolation in B2C multi-tenant architecture

BEGIN;

-- 1. Add user_id column to products table (initially nullable)
ALTER TABLE products
ADD COLUMN IF NOT EXISTS user_id UUID NULL;

-- 2. Add foreign key constraint to users table
ALTER TABLE products
ADD CONSTRAINT products_user_id_fkey
FOREIGN KEY (user_id)
REFERENCES users(id)
ON UPDATE CASCADE
ON DELETE CASCADE;

-- 3. Migrate existing products to the first user (or a default user)
-- This ensures existing data isn't lost during migration
DO $$
DECLARE
    default_user_id UUID;
BEGIN
    -- Get the first user created (oldest user)
    SELECT id INTO default_user_id
    FROM users
    ORDER BY created_at ASC
    LIMIT 1;

    -- If we found a user, assign all existing products to them
    IF default_user_id IS NOT NULL THEN
        UPDATE products
        SET user_id = default_user_id
        WHERE user_id IS NULL;

        RAISE NOTICE 'Assigned % existing products to user %',
            (SELECT COUNT(*) FROM products WHERE user_id = default_user_id),
            default_user_id;
    ELSE
        RAISE WARNING 'No users found in database. Products will remain unassigned.';
    END IF;
END $$;

-- 4. Make user_id NOT NULL after migration
ALTER TABLE products
ALTER COLUMN user_id SET NOT NULL;

-- 5. Drop the old unique constraint on normalized_name (global unique)
ALTER TABLE products
DROP CONSTRAINT IF EXISTS products_normalized_name_key;

-- Also try alternative constraint names
ALTER TABLE products
DROP CONSTRAINT IF EXISTS products_normalized_name_unique;

-- 6. Create new composite unique constraint on (user_id, normalized_name)
-- This ensures product names are unique PER USER, not globally
ALTER TABLE products
ADD CONSTRAINT products_user_id_normalized_name_key
UNIQUE (user_id, normalized_name);

-- 7. Create index on user_id for query performance
CREATE INDEX IF NOT EXISTS products_user_id_idx ON products(user_id);

-- 8. Add comment for documentation
COMMENT ON COLUMN products.user_id IS 'Owner of this product entry - ensures data isolation between users in B2C multi-tenant setup';

COMMIT;

-- Verification queries
SELECT
    'Products with user_id' AS check_name,
    COUNT(*) AS count
FROM products
WHERE user_id IS NOT NULL

UNION ALL

SELECT
    'Products without user_id' AS check_name,
    COUNT(*) AS count
FROM products
WHERE user_id IS NULL;

-- Show sample of migrated products
SELECT
    p.id,
    p.name,
    p.user_id,
    u.email AS owner_email,
    p.created_at
FROM products p
LEFT JOIN users u ON p.user_id = u.id
ORDER BY p.created_at DESC
LIMIT 5;
