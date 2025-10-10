-- Seed initial admin user
-- This will be replaced by environment variable credentials at runtime
-- Password: changeme123 (bcrypt hash)

INSERT INTO users (email, username, password_hash, full_name, role, is_active)
VALUES (
    'admin@university.edu',
    'admin',
    '$2b$10$rBV2xrAq8UKxU8qMxZ5qOeN9X7wQjZqZjFVxJxGvZxJxJxJxJxJxJ', -- changeme123
    'System Administrator',
    'admin',
    true
)
ON CONFLICT (email) DO NOTHING;
