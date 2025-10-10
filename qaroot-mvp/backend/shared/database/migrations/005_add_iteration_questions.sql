-- Track the question prompt for each iteration
-- This allows different questions for each round

CREATE TABLE IF NOT EXISTS iteration_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    iteration INTEGER NOT NULL,
    question_text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(session_id, iteration)
);

CREATE INDEX IF NOT EXISTS idx_iteration_questions_session ON iteration_questions(session_id);
CREATE INDEX IF NOT EXISTS idx_iteration_questions_iteration ON iteration_questions(session_id, iteration);

-- Migrate existing session descriptions to iteration_questions table
INSERT INTO iteration_questions (session_id, iteration, question_text, created_at)
SELECT id, 1, description, created_at
FROM sessions
WHERE description IS NOT NULL AND description != ''
ON CONFLICT (session_id, iteration) DO NOTHING;
