-- Add description field to sessions table
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS description TEXT;
