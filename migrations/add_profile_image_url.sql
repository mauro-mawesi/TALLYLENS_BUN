-- Migration: Add profile_image_url to users table
-- Date: 2025-10-03

-- Add profile image URL column
ALTER TABLE users
ADD COLUMN IF NOT EXISTS profile_image_url TEXT NULL;

-- Add comment to column for documentation
COMMENT ON COLUMN users.profile_image_url IS 'URL to user profile image stored in cloud storage';

-- Verify the column was added
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'users' AND column_name = 'profile_image_url';
