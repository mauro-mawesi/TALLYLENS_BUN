# Migration 008: Add user_id to Products Table

## Overview
This migration converts the `products` table from a global shared catalog to a user-specific catalog, ensuring proper data isolation in a B2C multi-tenant architecture.

## Problem Statement
Previously, all products were shared globally across all users, which caused:
- **Privacy violations**: Users could see aggregated statistics from other users
- **Data contamination**: Price statistics mixed data from different users
- **Security issues**: Potential information disclosure about other users' shopping habits

## Solution
Add `user_id` column to the `products` table and update all related code to scope products to individual users.

## Changes Made

### 1. Database Migration (`008-add-user-id-to-products.sql`)
- Adds `user_id UUID NOT NULL` column with foreign key to `users`
- Migrates existing products to the first user in the database
- Drops global unique constraint on `normalized_name`
- Creates composite unique constraint on `(user_id, normalized_name)`
- Adds index on `user_id` for performance

### 2. Model Updates (`src/models/Product.js`)
- Added `userId` field to model definition
- Updated indexes to use composite unique key
- Modified `findOrCreateByName(userId, name, ...)` to require userId
- Modified `findSimilar(userId, name, ...)` to filter by userId

### 3. Association Updates (`src/models/associations.js`)
- Added `User.hasMany(Product)` relationship
- Added `Product.belongsTo(User)` relationship

### 4. Service Updates (`src/services/receiptItemService.js`)
- Updated `processReceiptItems(receiptId, userId, ...)` to pass userId
- Updated `mergeProducts(userId, ...)` to verify ownership
- Updated `findPotentialDuplicates(userId, ...)` to scope to user

### 5. Controller Updates
- `receiptsController.js`: Pass userId when calling `processReceiptItems`
- `productController.js`: All queries now filter by userId
  - `getProducts`: Simplified query with direct userId filter
  - `getProduct`: Verify ownership via userId
  - `getPriceHistory`: Check ownership before returning data
  - `updateProduct`: Verify ownership before updating

## How to Run

### Prerequisites
1. Ensure you have at least one user in the database
2. Backup your database before running the migration
3. Stop the application if it's running

### Execution Steps

```bash
# 1. Navigate to the backend directory
cd /home/mauricio/projects/LAB/RECIBOS_APP/backend

# 2. Connect to PostgreSQL
psql -U your_username -d receipts_db

# 3. Run the migration
\i migrations/008-add-user-id-to-products.sql

# 4. Verify the migration
SELECT COUNT(*) FROM products WHERE user_id IS NOT NULL;

# 5. Check sample data
SELECT p.id, p.name, p.user_id, u.email AS owner_email
FROM products p
LEFT JOIN users u ON p.user_id = u.id
LIMIT 10;
```

### Rollback (if needed)

```sql
BEGIN;

-- 1. Remove user_id column
ALTER TABLE products DROP COLUMN user_id;

-- 2. Drop composite unique constraint
ALTER TABLE products
DROP CONSTRAINT IF EXISTS products_user_id_normalized_name_key;

-- 3. Restore global unique constraint
ALTER TABLE products
ADD CONSTRAINT products_normalized_name_key
UNIQUE (normalized_name);

COMMIT;
```

## Testing Checklist

After running the migration, test the following:

- [ ] Users can create new receipts with items
- [ ] Each user sees only their own products
- [ ] Product statistics are calculated correctly per user
- [ ] Price history shows only user's purchases
- [ ] Top products endpoint returns user-specific data
- [ ] Duplicate product detection works within user scope
- [ ] Two users can have products with the same name independently

## API Behavior Changes

### Before Migration
- Products were global and shared
- `/api/products` returned all products ever purchased by any user
- Product statistics included data from all users

### After Migration
- Products are scoped to individual users
- `/api/products` returns only the current user's products
- Product statistics reflect only the current user's purchases
- Each user has their own product catalog

## Data Integrity

The migration ensures:
- No data loss: All existing products are assigned to the first user
- Referential integrity: Foreign key constraints prevent orphaned records
- Unique constraints: Product names are unique per user
- Cascade deletes: Deleting a user will delete their products

## Performance Impact

- **Improved**: Queries are now scoped to userId, reducing result sets
- **Improved**: Direct userId filtering is faster than complex joins
- **Added index**: `products_user_id_idx` speeds up user-scoped queries

## Security Improvements

- ✅ Users cannot access other users' product data
- ✅ Product statistics are private and accurate
- ✅ No information disclosure about other users' habits
- ✅ Proper B2C multi-tenant isolation

## Notes

- **Default User**: If you run this migration and want to reassign products to different users, you'll need to write a custom script based on receipt ownership
- **Future Products**: All new products will automatically be scoped to the user creating them
- **Barcode Uniqueness**: Barcode constraint remains global (optional). If you want user-specific barcodes, modify the barcode index
