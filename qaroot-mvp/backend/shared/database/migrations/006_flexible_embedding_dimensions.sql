-- Migration: Support flexible embedding dimensions for local models
-- Date: 2025-10-14
-- Description: Change embedding columns from fixed 768 dimensions to variable dimensions
--              to support different embedding models (e.g., all-MiniLM-L6-v2 uses 384)

-- Alter questions table to accept variable-length embeddings
ALTER TABLE questions ALTER COLUMN embedding TYPE vector;

-- Alter question_clusters table to accept variable-length centroid embeddings
ALTER TABLE question_clusters ALTER COLUMN centroid_embedding TYPE vector;

-- Note: Existing indexes on embedding columns will continue to work with variable dimensions
