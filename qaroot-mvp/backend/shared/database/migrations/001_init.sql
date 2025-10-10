-- QARoot MVP Initial Database Schema
-- Version: 1.0
-- Date: 2025-10-02

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    role VARCHAR(50) NOT NULL CHECK (role IN ('host', 'admin')),
    institution VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_role ON users(role);

-- Sessions table
CREATE TYPE session_status AS ENUM ('waiting', 'active', 'paused', 'completed');

CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    session_pin VARCHAR(8) UNIQUE NOT NULL,
    session_status session_status DEFAULT 'waiting',
    collection_timer_duration INTEGER DEFAULT 60, -- seconds
    collection_started_at TIMESTAMP WITH TIME ZONE,
    collection_ended_at TIMESTAMP WITH TIME ZONE,
    actual_start TIMESTAMP WITH TIME ZONE,
    ended_at TIMESTAMP WITH TIME ZONE,
    settings JSONB,
    participant_count INTEGER DEFAULT 0,
    question_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sessions_host ON sessions(host_id);
CREATE INDEX idx_sessions_pin ON sessions(session_pin);
CREATE INDEX idx_sessions_status ON sessions(session_status);
CREATE INDEX idx_sessions_created ON sessions(created_at DESC);

-- Participants table
CREATE TABLE participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    nickname VARCHAR(100) NOT NULL,
    device_fingerprint VARCHAR(255),
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(session_id, nickname)
);

CREATE INDEX idx_participants_session ON participants(session_id);
CREATE INDEX idx_participants_joined ON participants(joined_at);

-- Questions table
CREATE TABLE questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    participant_id UUID REFERENCES participants(id) ON DELETE SET NULL,
    question_text TEXT NOT NULL,
    embedding vector(768),
    cluster_id UUID,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_questions_session ON questions(session_id);
CREATE INDEX idx_questions_cluster ON questions(cluster_id);
CREATE INDEX idx_questions_submitted ON questions(submitted_at);
-- IVFFlat index for vector similarity search (create after data is inserted)
-- CREATE INDEX idx_questions_embedding ON questions USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Question clusters table
CREATE TABLE question_clusters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    cluster_label VARCHAR(255),
    representative_question TEXT,
    question_count INTEGER DEFAULT 0,
    centroid_embedding vector(768),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_clusters_session ON question_clusters(session_id);
CREATE INDEX idx_clusters_created ON question_clusters(created_at);

-- Host chat messages table
CREATE TABLE host_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_chat_session ON host_chat_messages(session_id, created_at);

-- Future: Presentation collections (optional)
CREATE TABLE presentation_collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    tags TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_collections_owner ON presentation_collections(owner_id);
CREATE INDEX idx_collections_created ON presentation_collections(created_at DESC);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to sessions
CREATE TRIGGER update_sessions_updated_at
    BEFORE UPDATE ON sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to presentation_collections
CREATE TRIGGER update_collections_updated_at
    BEFORE UPDATE ON presentation_collections
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
