# Qaroot Platform - MVP Technical Specification
## FAQ Mode Only

**Version:** 1.0
**Date:** October 2, 2025
**Project Lead:** Philip
**Project Support:** Guillaume
**Timeline:** 3 Months

---

## Executive Summary

This MVP implements **AI-powered FAQ answering** with Retrieval-Augmented Generation (RAG). Professors run live Q&A sessions where student questions are automatically answered using course materials.

**MVP Scope:**
- FAQ session mode only (no quiz or polling)
- Document upload and RAG processing
- AI-powered FAQ answer generation via Llama Stack
- Host review and publish workflow
- Real-time WebSocket communication
- Basic authentication (username/password in OpenShift Secret)

**Success Criteria:**
- ✅ Answer generation within 60 seconds
- ✅ 80%+ citation relevance
- ✅ 100% safety filtering
- ✅ 100 concurrent users per session

---

## 1. System Architecture

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                Load Balancer (OpenShift Router)                 │
└────────────────────────────┬────────────────────────────────────┘
                             │
        ┌────────────────────┴────────────────────┐
        │                                         │
┌───────▼────────┐                       ┌───────▼────────┐
│  Web Frontend  │                       │  Participant   │
│   (Host UI)    │                       │   Web App      │
└───────┬────────┘                       └───────┬────────┘
        │                                        │
        └────────────────┬───────────────────────┘
                         │
                ┌────────▼──────────┐
                │   API Service     │
                │  ┌──────────────┐ │
                │  │ Auth         │ │
                │  │ Documents    │ │
                │  │ Session Mgmt │ │
                │  └──────────────┘ │
                └────────┬──────────┘
                         │
        ┌────────────────┼────────────────────────┐
        │                │                        │
┌───────▼──────────┐ ┌───▼──────────────┐ ┌──────▼─────────────┐
│ WebSocket Service│ │ FAQ Worker Pool  │ │   Llama Stack      │
│  (Real-time)     │ │ ┌──────────────┐ │ │ ┌────────────────┐ │
│                  │ │ │ Aggregation  │ │ │ │ Orchestration  │ │
│ - FAQ Messages   │ │ │ LLM Process  │ │ │ │ RAG Engine     │ │
│ - Notifications  │ │ │ Answer Gen   │ │ │ │ Embeddings     │ │
│                  │ │ └──────────────┘ │ │ │ Safety         │ │
│                  │ │                  │ │ └────────────────┘ │
└───────┬──────────┘ └───┬──────────────┘ └──────────┬─────────┘
        │                │                           │
        │                │            ┌──────────────┴───────────────┐
        │                │            │                              │
        └────────────────┼────────────┼──────────────────────────────┼───┐
                         │            │                              │   │
        ┌────────────────┼────────────┼───┐   ┌──────────────────────▼───▼──┐
        │                │            │   │   │   External LLM Service      │
┌───────▼──────┐  ┌──────▼─────────┐  │   │   │  (Pre-existing OpenAI-      │
│ Red Hat AMQ  │  │  PostgreSQL    │  │   │   │   compatible API)           │
│  (Queues)    │  │  + pgvector    │  │   │   │                             │
└──────────────┘  └────────────────┘  │   │   │  Managed by infrastructure  │
                              ┌───────▼───▼──┐└─────────────────────────────┘
                              │    Redis     │
                              │  (Cache/     │
                              │   Sessions)  │
                              └──────────────┘
```

### 1.2 FAQ Processing Pipeline

```
Student submits question
    ↓
WebSocket receives → stores in DB
    ↓
FAQ Aggregation Agent (scheduled every 30s)
    ├─ Generate embeddings (Llama Stack)
    ├─ Cluster similar questions (pgvector)
    └─ Publish to AMQ: faq.cluster.created
         ↓
LLM Processing Agent (consumes AMQ)
    ├─ Retrieve relevant documents (RAG via Llama Stack)
    ├─ Generate answer (Qwen2.5-14B via external LLM)
    ├─ Safety check (Llama Guard via external service)
    └─ Publish to AMQ: faq.llm.completed
         ↓
Answer Generation Agent (consumes AMQ)
    ├─ Format answer with citations
    ├─ Post-process for readability
    └─ Store in DB (is_published=false)
         ↓
WebSocket notifies host → Host reviews → Host publishes
         ↓
WebSocket broadcasts → Students see answer
```

### 1.3 Service Responsibilities

**API Service** (Node.js + Express)
- Basic authentication (username/password)
- Document upload and parsing
- Session CRUD operations
- RESTful endpoints for host/participant

**WebSocket Service** (Node.js + Socket.io)
- Real-time FAQ question submission
- Host notifications for new questions/answers
- Published answer broadcasting
- Redis pub/sub for multi-pod coordination

**FAQ Worker Pool** (Node.js + Bull)
- **Aggregation Agent**: Question clustering via embeddings
- **LLM Processing Agent**: RAG retrieval + answer generation
- **Answer Generation Agent**: Citation formatting + post-processing

**Llama Stack** (Python)
- Unified API for inference, embeddings, RAG, safety
- Connects to external LLM service (OpenAI-compatible)
- Manages pgvector integration for RAG retrieval

---

## 2. Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend** | React + TypeScript | 18.x |
| **Backend** | Node.js + TypeScript | 20.x |
| **API Framework** | Express.js | 4.x |
| **Real-time** | Socket.io | 4.x |
| **Database** | PostgreSQL + pgvector | 15.x |
| **Cache** | Redis | 7.x |
| **Message Queue** | Red Hat AMQ (Artemis) | 7.11.x |
| **LLM Orchestration** | Llama Stack | latest |
| **Authentication** | Basic Auth (Secret) | - |
| **Container Platform** | OpenShift | 4.13+ |

### 2.1 AI/LLM Configuration

- **Inference Provider**: External LLM service (Qwen2.5-14B-Instruct)
- **Safety Provider**: External safety service (Llama Guard 3 compatible)
- **Embeddings Model**: nomic-embed-text-v1.5 (768 dimensions, local in Llama Stack)
- **Vector Store**: pgvector with IVFFlat indexing
- **RAG Strategy**: Top-5 chunks, cosine similarity > 0.7
- **Chunking**: 512 tokens with 50 token overlap

---

## 3. Database Schema

### 3.1 PostgreSQL Extensions

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgvector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
```

### 3.2 Core Tables

#### Users
```sql
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
```

#### Document Collections
```sql
CREATE TABLE document_collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    tags TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_collections_owner ON document_collections(owner_id);
```

#### Sessions
```sql
CREATE TYPE session_status AS ENUM ('waiting', 'active', 'paused', 'completed');

CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id UUID REFERENCES document_collections(id) ON DELETE SET NULL,
    host_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    session_pin VARCHAR(8) UNIQUE NOT NULL,
    session_status session_status DEFAULT 'waiting',
    actual_start TIMESTAMP WITH TIME ZONE,
    ended_at TIMESTAMP WITH TIME ZONE,
    settings JSONB,
    participant_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sessions_host ON sessions(host_id);
CREATE INDEX idx_sessions_collection ON sessions(collection_id);
CREATE INDEX idx_sessions_pin ON sessions(session_pin);
CREATE INDEX idx_sessions_status ON sessions(session_status);
```

#### Participants
```sql
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
```

### 3.3 FAQ Tables

#### FAQ Questions
```sql
CREATE TABLE faq_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    embedding vector(768),
    cluster_id UUID,
    is_processed BOOLEAN DEFAULT FALSE,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_faq_session ON faq_questions(session_id);
CREATE INDEX idx_faq_cluster ON faq_questions(cluster_id);
CREATE INDEX idx_faq_embedding ON faq_questions USING ivfflat (embedding vector_cosine_ops);
```

#### FAQ Master Questions (Clustered + Answered)
```sql
CREATE TABLE faq_master_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    cluster_id UUID UNIQUE NOT NULL,
    master_question TEXT NOT NULL,
    source_question_ids UUID[] NOT NULL,
    generated_answer TEXT,
    citations JSONB,
    upvotes INTEGER DEFAULT 0,
    downvotes INTEGER DEFAULT 0,
    is_published BOOLEAN DEFAULT FALSE,
    published_at TIMESTAMP WITH TIME ZONE,
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    llm_model VARCHAR(100),
    processing_time_ms INTEGER
);

CREATE INDEX idx_master_session ON faq_master_questions(session_id);
CREATE INDEX idx_master_published ON faq_master_questions(is_published, session_id);
```

### 3.4 RAG Document Tables

#### RAG Documents
```sql
CREATE TYPE document_type AS ENUM (
    'lecture_slides',
    'lecture_notes',
    'syllabus',
    'reading',
    'textbook_excerpt',
    'supplementary'
);

CREATE TABLE rag_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id UUID REFERENCES document_collections(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_type document_type NOT NULL,
    title VARCHAR(500) NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB,
    file_url VARCHAR(1000),
    embedding vector(768),
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_rag_collection ON rag_documents(collection_id);
CREATE INDEX idx_rag_owner ON rag_documents(owner_id);
CREATE INDEX idx_rag_embedding ON rag_documents USING ivfflat (embedding vector_cosine_ops);
```

#### RAG Document Chunks
```sql
CREATE TABLE rag_document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding vector(768) NOT NULL,
    metadata JSONB,
    UNIQUE(document_id, chunk_index)
);

CREATE INDEX idx_chunk_document ON rag_document_chunks(document_id);
CREATE INDEX idx_chunk_embedding ON rag_document_chunks USING ivfflat (embedding vector_cosine_ops);
```

---

## 4. OpenShift Deployment

### 4.1 Resource Requirements

| Service | Replicas | CPU | Memory | Storage |
|---------|----------|-----|--------|---------|
| API Service | 2 | 1-2 | 2-4Gi | - |
| WebSocket Service | 2 | 1-2 | 2-4Gi | - |
| FAQ Worker Pool | 2 | 2-4 | 4-8Gi | - |
| Llama Stack | 2 | 2-4 | 4-8Gi | - |
| PostgreSQL | 1 | 2-4 | 8-16Gi | 100Gi |
| Redis | 1 | 1-2 | 2-4Gi | - |
| Red Hat AMQ | 1 | 1-2 | 2-4Gi | 10Gi |
| Frontend (Nginx) | 2 | 0.5-1 | 512Mi-1Gi | - |

**Total:** ~15-25 CPU cores, ~30-55Gi memory, 110Gi storage

### 4.2 Llama Stack Deployment

#### ConfigMap: llama-stack-config
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: llama-stack-config
  namespace: qaroot-mvp
data:
  config.yaml: |
    version: "1.0"

    # Inference Provider (External LLM)
    inference:
      provider: remote::openai-compatible
      config:
        url: ${EXTERNAL_LLM_URL}
        api_key: ${EXTERNAL_LLM_API_KEY}
        model: qwen2.5-14b-instruct
        temperature: 0.7
        max_tokens: 2048

    # Safety Provider (External Llama Guard)
    safety:
      provider: remote::openai-compatible
      config:
        url: ${EXTERNAL_SAFETY_URL}
        api_key: ${EXTERNAL_SAFETY_API_KEY}
        model: llama-guard-3
        enable_prompt_guard: true
        enable_output_guard: true

    # Embeddings Provider (Local in Llama Stack)
    embeddings:
      provider: sentence-transformers
      config:
        model: nomic-ai/nomic-embed-text-v1.5
        dimension: 768

    # RAG/Memory Provider (PostgreSQL + pgvector)
    memory:
      provider: pgvector
      config:
        connection_string: ${DATABASE_URL}
        table_name: rag_document_chunks
        embedding_dimension: 768
        similarity_metric: cosine

    # RAG Configuration
    rag:
      retrieval:
        top_k: 5
        similarity_threshold: 0.7
      chunking:
        strategy: recursive
        chunk_size: 512
        chunk_overlap: 50
```

#### Secret: llm-credentials
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: llm-credentials
  namespace: qaroot-mvp
type: Opaque
stringData:
  llm-url: "https://llm.university.edu/v1"
  llm-api-key: "your-api-key-here"
  safety-url: "https://llm.university.edu/safety/v1"
  safety-api-key: "your-safety-api-key-here"
```

#### Deployment: llama-stack
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: llama-stack
  namespace: qaroot-mvp
spec:
  replicas: 2
  selector:
    matchLabels:
      app: llama-stack
  template:
    metadata:
      labels:
        app: llama-stack
    spec:
      containers:
      - name: llama-stack
        image: llamastack/distribution:latest
        args:
        - llama-stack-run
        - --config
        - /config/config.yaml
        - --port
        - "5000"
        ports:
        - containerPort: 5000
          name: http
        volumeMounts:
        - name: config
          mountPath: /config
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: postgres-credentials
              key: connection-string
        - name: EXTERNAL_LLM_URL
          valueFrom:
            secretKeyRef:
              name: llm-credentials
              key: llm-url
        - name: EXTERNAL_LLM_API_KEY
          valueFrom:
            secretKeyRef:
              name: llm-credentials
              key: llm-api-key
        - name: EXTERNAL_SAFETY_URL
          valueFrom:
            secretKeyRef:
              name: llm-credentials
              key: safety-url
        - name: EXTERNAL_SAFETY_API_KEY
          valueFrom:
            secretKeyRef:
              name: llm-credentials
              key: safety-api-key
        resources:
          requests:
            memory: 4Gi
            cpu: 2
          limits:
            memory: 8Gi
            cpu: 4
        livenessProbe:
          httpGet:
            path: /health
            port: 5000
          initialDelaySeconds: 60
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /health
            port: 5000
          initialDelaySeconds: 30
          periodSeconds: 10
      volumes:
      - name: config
        configMap:
          name: llama-stack-config
---
apiVersion: v1
kind: Service
metadata:
  name: llama-stack
  namespace: qaroot-mvp
spec:
  selector:
    app: llama-stack
  ports:
  - name: http
    port: 5000
    targetPort: 5000
  type: ClusterIP
```

### 4.3 PostgreSQL Deployment

#### Deployment: postgresql
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgresql
  namespace: qaroot-mvp
spec:
  replicas: 1
  selector:
    matchLabels:
      app: postgresql
  template:
    metadata:
      labels:
        app: postgresql
    spec:
      containers:
      - name: postgresql
        image: pgvector/pgvector:pg15
        ports:
        - containerPort: 5432
        env:
        - name: POSTGRES_DB
          value: qaroot_mvp
        - name: POSTGRES_USER
          valueFrom:
            secretKeyRef:
              name: postgres-credentials
              key: username
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: postgres-credentials
              key: password
        volumeMounts:
        - name: postgres-storage
          mountPath: /var/lib/postgresql/data
        resources:
          requests:
            memory: 8Gi
            cpu: 2
          limits:
            memory: 16Gi
            cpu: 4
      volumes:
      - name: postgres-storage
        persistentVolumeClaim:
          claimName: postgres-pvc
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-pvc
  namespace: qaroot-mvp
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 100Gi
  storageClassName: gp3
---
apiVersion: v1
kind: Service
metadata:
  name: postgresql
  namespace: qaroot-mvp
spec:
  selector:
    app: postgresql
  ports:
  - name: postgres
    port: 5432
    targetPort: 5432
  type: ClusterIP
```

### 4.4 Redis Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis
  namespace: qaroot-mvp
spec:
  replicas: 1
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
      - name: redis
        image: redis:7-alpine
        ports:
        - containerPort: 6379
        resources:
          requests:
            memory: 2Gi
            cpu: 1
          limits:
            memory: 4Gi
            cpu: 2
---
apiVersion: v1
kind: Service
metadata:
  name: redis
  namespace: qaroot-mvp
spec:
  selector:
    app: redis
  ports:
  - name: redis
    port: 6379
    targetPort: 6379
  type: ClusterIP
```

### 4.5 Red Hat AMQ Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: amq-broker
  namespace: qaroot-mvp
spec:
  replicas: 1
  selector:
    matchLabels:
      app: amq-broker
  template:
    metadata:
      labels:
        app: amq-broker
    spec:
      containers:
      - name: amq-broker
        image: registry.redhat.io/amq7/amq-broker:7.11
        ports:
        - containerPort: 5672
          name: amqp
        - containerPort: 8161
          name: console
        env:
        - name: AMQ_USER
          value: admin
        - name: AMQ_PASSWORD
          valueFrom:
            secretKeyRef:
              name: amq-credentials
              key: password
        resources:
          requests:
            memory: 2Gi
            cpu: 1
          limits:
            memory: 4Gi
            cpu: 2
---
apiVersion: v1
kind: Service
metadata:
  name: amq-broker
  namespace: qaroot-mvp
spec:
  selector:
    app: amq-broker
  ports:
  - name: amqp
    port: 5672
    targetPort: 5672
  - name: console
    port: 8161
    targetPort: 8161
  type: ClusterIP
```

### 4.6 Application Secrets

#### Secret: app-credentials
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: app-credentials
  namespace: qaroot-mvp
type: Opaque
stringData:
  # Default admin credentials (change after first login)
  admin-username: "admin"
  admin-password: "changeme123"
  admin-email: "admin@university.edu"

  # JWT signing secret
  jwt-secret: "your-random-jwt-secret-here-min-32-chars"

  # Session secret
  session-secret: "your-random-session-secret-here-min-32-chars"
```

### 4.7 Application Services

#### API Service
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-service
  namespace: qaroot-mvp
spec:
  replicas: 2
  selector:
    matchLabels:
      app: api-service
  template:
    metadata:
      labels:
        app: api-service
    spec:
      containers:
      - name: api-service
        image: qaroot/api-service:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: production
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: postgres-credentials
              key: connection-string
        - name: REDIS_URL
          value: redis://redis:6379
        - name: AMQ_URL
          value: amqp://amq-broker:5672
        - name: LLAMA_STACK_URL
          value: http://llama-stack:5000
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: app-credentials
              key: jwt-secret
        - name: SESSION_SECRET
          valueFrom:
            secretKeyRef:
              name: app-credentials
              key: session-secret
        - name: ADMIN_USERNAME
          valueFrom:
            secretKeyRef:
              name: app-credentials
              key: admin-username
        - name: ADMIN_PASSWORD
          valueFrom:
            secretKeyRef:
              name: app-credentials
              key: admin-password
        - name: ADMIN_EMAIL
          valueFrom:
            secretKeyRef:
              name: app-credentials
              key: admin-email
        resources:
          requests:
            memory: 2Gi
            cpu: 1
          limits:
            memory: 4Gi
            cpu: 2
---
apiVersion: v1
kind: Service
metadata:
  name: api-service
  namespace: qaroot-mvp
spec:
  selector:
    app: api-service
  ports:
  - name: http
    port: 3000
    targetPort: 3000
  type: ClusterIP
```

#### WebSocket Service
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: websocket-service
  namespace: qaroot-mvp
spec:
  replicas: 2
  selector:
    matchLabels:
      app: websocket-service
  template:
    metadata:
      labels:
        app: websocket-service
    spec:
      containers:
      - name: websocket-service
        image: qaroot/websocket-service:latest
        ports:
        - containerPort: 3001
        env:
        - name: NODE_ENV
          value: production
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: postgres-credentials
              key: connection-string
        - name: REDIS_URL
          value: redis://redis:6379
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: app-credentials
              key: jwt-secret
        resources:
          requests:
            memory: 2Gi
            cpu: 1
          limits:
            memory: 4Gi
            cpu: 2
---
apiVersion: v1
kind: Service
metadata:
  name: websocket-service
  namespace: qaroot-mvp
spec:
  selector:
    app: websocket-service
  ports:
  - name: http
    port: 3001
    targetPort: 3001
  type: ClusterIP
  sessionAffinity: ClientIP
```

#### FAQ Worker Pool
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: faq-worker-pool
  namespace: qaroot-mvp
spec:
  replicas: 2
  selector:
    matchLabels:
      app: faq-worker-pool
  template:
    metadata:
      labels:
        app: faq-worker-pool
    spec:
      containers:
      - name: faq-worker-pool
        image: qaroot/faq-worker-pool:latest
        env:
        - name: NODE_ENV
          value: production
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: postgres-credentials
              key: connection-string
        - name: REDIS_URL
          value: redis://redis:6379
        - name: AMQ_URL
          value: amqp://amq-broker:5672
        - name: LLAMA_STACK_URL
          value: http://llama-stack:5000
        - name: WORKER_CONCURRENCY
          value: "4"
        - name: AGGREGATION_INTERVAL
          value: "30s"
        resources:
          requests:
            memory: 4Gi
            cpu: 2
          limits:
            memory: 8Gi
            cpu: 4
```

---

## 5. Environment Variables

### API Service
```bash
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@postgresql:5432/qaroot_mvp
REDIS_URL=redis://redis:6379
AMQ_URL=amqp://amq-broker:5672
LLAMA_STACK_URL=http://llama-stack:5000

# Authentication (from app-credentials Secret)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=changeme123
ADMIN_EMAIL=admin@university.edu
JWT_SECRET=your-random-jwt-secret-here-min-32-chars
SESSION_SECRET=your-random-session-secret-here-min-32-chars

# CORS
CORS_ORIGIN=https://qaroot.university.edu

# File Storage
FILE_UPLOAD_PATH=/var/qaroot/uploads
MAX_FILE_SIZE=50MB
```

### WebSocket Service
```bash
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@postgresql:5432/qaroot_mvp
REDIS_URL=redis://redis:6379

# Authentication (from app-credentials Secret)
JWT_SECRET=your-random-jwt-secret-here-min-32-chars

# CORS
CORS_ORIGIN=https://qaroot.university.edu
```

### FAQ Worker Pool
```bash
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@postgresql:5432/qaroot_mvp
REDIS_URL=redis://redis:6379
AMQ_URL=amqp://amq-broker:5672
LLAMA_STACK_URL=http://llama-stack:5000

# Worker Configuration
WORKER_CONCURRENCY=4
AGGREGATION_INTERVAL=30s
LLM_TIMEOUT=60s
MAX_RETRIES=3
```

### Llama Stack
```bash
DATABASE_URL=postgresql://user:pass@postgresql:5432/qaroot_mvp
EXTERNAL_LLM_URL=https://llm.university.edu/v1
EXTERNAL_LLM_API_KEY=api-key-here
EXTERNAL_SAFETY_URL=https://llm.university.edu/safety/v1
EXTERNAL_SAFETY_API_KEY=safety-api-key-here
```

---

## 6. Implementation Checklist

### Month 1: Foundation
- [ ] OpenShift namespace setup (`qaroot-mvp`)
- [ ] Deploy PostgreSQL + pgvector
- [ ] Deploy Redis
- [ ] Deploy Red Hat AMQ
- [ ] Obtain external LLM credentials
- [ ] Create `app-credentials` Secret (admin user, JWT/session secrets)
- [ ] Implement API Service skeleton with basic auth (bcrypt password hashing)
- [ ] Implement WebSocket Service skeleton
- [ ] Create database schema (run migrations)
- [ ] Seed admin user from Secret
- [ ] Frontend scaffolding (React + Vite)

### Month 2: RAG & LLM Integration
- [ ] Document upload API (PDF, PPTX, DOCX parsing)
- [ ] Document chunking service (512 tokens)
- [ ] Deploy Llama Stack with external LLM config
- [ ] Test embedding generation
- [ ] Store embeddings in `rag_document_chunks`
- [ ] Build document management UI
- [ ] Implement FAQ Aggregation Agent
- [ ] Implement LLM Processing Agent (RAG-enhanced)
- [ ] Implement Answer Generation Agent
- [ ] Test end-to-end FAQ pipeline

### Month 3: Frontend & Testing
- [ ] Host dashboard (quiz sets, sessions)
- [ ] Document management page (upload, list, status)
- [ ] Session lobby (QR code, participant feed)
- [ ] Live FAQ session page (question queue, answer review)
- [ ] Participant join page
- [ ] Participant FAQ interface (submit, view, vote)
- [ ] Unit tests (API, agents)
- [ ] Integration tests (end-to-end FAQ flow)
- [ ] Load testing (100 concurrent users)
- [ ] RAG quality testing (80%+ relevance)
- [ ] Safety testing (100% blocking)
- [ ] Production deployment
- [ ] Documentation

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-10-02 | Claude (AI Assistant) | MVP specification (FAQ mode only) |

**Approval Required From:**
- [ ] Philip (Project Lead)
- [ ] Guillaume (Project Support)

---

**End of Document**
