-- Add iteration tracking for questions and clusters
-- This allows tracking multiple rounds of questions in the same session

-- Add iteration number to questions
ALTER TABLE questions ADD COLUMN IF NOT EXISTS iteration INTEGER DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_questions_iteration ON questions(session_id, iteration);

-- Add iteration number to question_clusters
ALTER TABLE question_clusters ADD COLUMN IF NOT EXISTS iteration INTEGER DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_clusters_iteration ON question_clusters(session_id, iteration);

-- Add current_iteration to sessions to track which round we're on
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS current_iteration INTEGER DEFAULT 1;
