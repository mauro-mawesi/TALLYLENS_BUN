-- Migration: Add full-text search to receipts table
-- Description: Adds search_vector column with GIN index and automatic update trigger

-- Add search_vector column
ALTER TABLE receipts
ADD COLUMN search_vector tsvector;

COMMENT ON COLUMN receipts.search_vector IS 'Full-text search vector for efficient text searching';

-- Create GIN index for fast full-text search
CREATE INDEX receipts_search_vector_idx
ON receipts
USING gin(search_vector);

-- Create function to update search_vector
-- Combines merchant_name, raw_text, notes, tags, and category with different weights
-- Weight A (highest): merchant_name
-- Weight B: raw_text (OCR extracted text)
-- Weight C: notes and tags
-- Weight D (lowest): category
CREATE OR REPLACE FUNCTION receipts_search_vector_update()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.merchant_name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.raw_text, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.notes, '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.tags, ' '), '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(NEW.category, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update search_vector on INSERT or UPDATE
CREATE TRIGGER receipts_search_update
BEFORE INSERT OR UPDATE OF merchant_name, raw_text, notes, tags, category
ON receipts
FOR EACH ROW
EXECUTE FUNCTION receipts_search_vector_update();

-- Populate search_vector for existing receipts
UPDATE receipts
SET search_vector =
  setweight(to_tsvector('english', COALESCE(merchant_name, '')), 'A') ||
  setweight(to_tsvector('english', COALESCE(raw_text, '')), 'B') ||
  setweight(to_tsvector('english', COALESCE(notes, '')), 'C') ||
  setweight(to_tsvector('english', COALESCE(array_to_string(tags, ' '), '')), 'C') ||
  setweight(to_tsvector('english', COALESCE(category, '')), 'D');
