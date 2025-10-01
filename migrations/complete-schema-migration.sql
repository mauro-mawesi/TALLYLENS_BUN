-- Complete Schema Migration for Receipts App
-- Date: 2025-09-28
-- Description: Creates all missing tables and updates existing ones to match models

-- First, let's create the users table if it doesn't exist
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    email_verified BOOLEAN DEFAULT false,
    email_verification_token VARCHAR(255),
    email_verification_expires TIMESTAMP WITH TIME ZONE,
    password_reset_token VARCHAR(255),
    password_reset_expires TIMESTAMP WITH TIME ZONE,
    failed_login_attempts INTEGER DEFAULT 0,
    account_locked_until TIMESTAMP WITH TIME ZONE,
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for users table
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_email_verified ON users(email_verified);
CREATE INDEX IF NOT EXISTS idx_users_email_verification_token ON users(email_verification_token);
CREATE INDEX IF NOT EXISTS idx_users_password_reset_token ON users(password_reset_token);

-- Create refresh_tokens table
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for refresh_tokens
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

-- Update receipts table to match the model
ALTER TABLE receipts
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS image_thumbnail_url TEXT,
ADD COLUMN IF NOT EXISTS parsed_data JSONB,
ADD COLUMN IF NOT EXISTS amount DECIMAL(10,2) CHECK (amount >= 0),
ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'USD' CHECK (LENGTH(currency) = 3),
ADD COLUMN IF NOT EXISTS merchant_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS purchase_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS notes TEXT,
ADD COLUMN IF NOT EXISTS is_processed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS processing_status VARCHAR(20) DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
ADD COLUMN IF NOT EXISTS processing_error TEXT,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

-- Update category column constraint
ALTER TABLE receipts
DROP CONSTRAINT IF EXISTS receipts_category_check,
ADD CONSTRAINT receipts_category_check CHECK (category IN ('Mercado', 'Transporte', 'Comida', 'Combustible', 'Otros'));

-- Create indexes for receipts
CREATE INDEX IF NOT EXISTS idx_receipts_user_id ON receipts(user_id);
CREATE INDEX IF NOT EXISTS idx_receipts_category ON receipts(category);
CREATE INDEX IF NOT EXISTS idx_receipts_purchase_date ON receipts(purchase_date);
CREATE INDEX IF NOT EXISTS idx_receipts_processing_status ON receipts(processing_status);
CREATE INDEX IF NOT EXISTS idx_receipts_is_processed ON receipts(is_processed);

-- Create products table
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    normalized_name VARCHAR(255) NOT NULL UNIQUE,
    category VARCHAR(50) CHECK (category IN ('Alimentos', 'Bebidas', 'Limpieza', 'Higiene', 'Farmacia', 'Otros')),
    brand VARCHAR(100),
    unit VARCHAR(20) DEFAULT 'unidad' CHECK (unit IN ('unidad', 'kg', 'g', 'l', 'ml', 'paquete', 'caja', 'botella')),
    description TEXT,
    barcode VARCHAR(50) UNIQUE,
    tags TEXT[] DEFAULT '{}',
    average_price DECIMAL(10,2) CHECK (average_price >= 0),
    lowest_price DECIMAL(10,2) CHECK (lowest_price >= 0),
    highest_price DECIMAL(10,2) CHECK (highest_price >= 0),
    last_seen_price DECIMAL(10,2) CHECK (last_seen_price >= 0),
    last_seen_at TIMESTAMP WITH TIME ZONE,
    purchase_count INTEGER DEFAULT 0 CHECK (purchase_count >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for products table
CREATE INDEX IF NOT EXISTS idx_products_normalized_name ON products(normalized_name);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_average_price ON products(average_price);
CREATE INDEX IF NOT EXISTS idx_products_last_seen_at ON products(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_products_purchase_count ON products(purchase_count);

-- Create receipt_items table
CREATE TABLE IF NOT EXISTS receipt_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id UUID NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    original_text TEXT NOT NULL,
    quantity DECIMAL(10,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price DECIMAL(10,2) NOT NULL CHECK (unit_price >= 0),
    total_price DECIMAL(10,2) NOT NULL CHECK (total_price >= 0),
    currency VARCHAR(3) DEFAULT 'USD' CHECK (LENGTH(currency) = 3),
    unit VARCHAR(20) DEFAULT 'unidad' CHECK (unit IN ('unidad', 'kg', 'g', 'l', 'ml', 'paquete', 'caja', 'botella')),
    discount DECIMAL(10,2) DEFAULT 0 CHECK (discount >= 0),
    tax DECIMAL(10,2) DEFAULT 0 CHECK (tax >= 0),
    confidence DECIMAL(3,2) CHECK (confidence >= 0 AND confidence <= 1),
    is_verified BOOLEAN DEFAULT false,
    notes TEXT,
    position INTEGER CHECK (position >= 0),
    raw_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(receipt_id, position)
);

-- Create indexes for receipt_items table
CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt_id ON receipt_items(receipt_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_product_id ON receipt_items(product_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_unit_price ON receipt_items(unit_price);
CREATE INDEX IF NOT EXISTS idx_receipt_items_total_price ON receipt_items(total_price);
CREATE INDEX IF NOT EXISTS idx_receipt_items_created_at ON receipt_items(created_at);
CREATE INDEX IF NOT EXISTS idx_receipt_items_is_verified ON receipt_items(is_verified);
CREATE INDEX IF NOT EXISTS idx_receipt_items_position ON receipt_items(position);

-- Create or replace function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at columns
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_receipts_updated_at ON receipts;
CREATE TRIGGER update_receipts_updated_at
    BEFORE UPDATE ON receipts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_products_updated_at ON products;
CREATE TRIGGER update_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_receipt_items_updated_at ON receipt_items;
CREATE TRIGGER update_receipt_items_updated_at
    BEFORE UPDATE ON receipt_items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Insert a default user if none exists (for testing)
INSERT INTO users (email, password, name, email_verified)
SELECT 'test@example.com', '$2b$12$dummy.hash.for.testing', 'Test User', true
WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'test@example.com');

COMMIT;