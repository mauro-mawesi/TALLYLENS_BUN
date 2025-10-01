-- Add enhanced fields for better receipt information capture
-- Migration script to add payment methods, VAT info, discounts, and product details

BEGIN;

-- Add new fields to receipts table
ALTER TABLE receipts
ADD COLUMN payment_method VARCHAR(20) CHECK (payment_method IN ('cash', 'card', 'mobile', 'voucher', 'other')),
ADD COLUMN card_type VARCHAR(50),
ADD COLUMN vat_info JSONB,
ADD COLUMN discount_info JSONB,
ADD COLUMN country CHAR(2);

-- Add comments for new fields
COMMENT ON COLUMN receipts.payment_method IS 'Method of payment used';
COMMENT ON COLUMN receipts.card_type IS 'Type of card used (Visa, Mastercard, etc.)';
COMMENT ON COLUMN receipts.vat_info IS 'VAT breakdown by rate: {21: {amount: 4.20, base: 20.00}}';
COMMENT ON COLUMN receipts.discount_info IS 'Discount details: {type: "member", amount: 2.50}';
COMMENT ON COLUMN receipts.country IS 'ISO 3166-1 alpha-2 country code';

-- Add new fields to products table
ALTER TABLE products
ADD COLUMN weight VARCHAR(50),
ADD COLUMN is_organic BOOLEAN DEFAULT FALSE NOT NULL,
ADD COLUMN nutritional_info JSONB;

-- Add comments for new product fields
COMMENT ON COLUMN products.weight IS 'Product weight/volume: "1.5L", "500g", "2kg", etc.';
COMMENT ON COLUMN products.is_organic IS 'Whether the product is organic/bio certified';
COMMENT ON COLUMN products.nutritional_info IS 'Basic nutritional information if available';

-- Add indexes for better performance
CREATE INDEX idx_receipts_payment_method ON receipts(payment_method);
CREATE INDEX idx_receipts_country ON receipts(country);
CREATE INDEX idx_products_weight ON products(weight);
CREATE INDEX idx_products_is_organic ON products(is_organic);
CREATE INDEX idx_receipts_vat_info ON receipts USING GIN(vat_info);
CREATE INDEX idx_receipts_discount_info ON receipts USING GIN(discount_info);

COMMIT;

-- Verify the changes
SELECT 'Enhanced fields added successfully' as status;