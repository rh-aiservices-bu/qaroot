# Qaroot Platform - MVP Technical Specification
## FAQ Mode Only

**Version:** 1.0
**Date:** October 2, 2025

---

## Executive Summary

This MVP implements an **AI-powered question aggregation and analysis tool** for live presentations. Presenters collect audience questions, then use AI to cluster, summarize, and rephrase them - making it easier to identify common themes and answer efficiently.

**Key Difference from Traditional FAQ Bots:**
- This is **NOT a RAG chatbot** that auto-answers questions from documents
- AI **clusters and summarizes** audience questions
- **Presenter manually answers** questions orally
- Optional: AI can analyze open-ended responses (e.g., "what features did you remember?")

**MVP Scope:**
- Question collection mode (timed sessions, e.g., 60 seconds)
- Real-time question submission from audience (anonymous)
- AI-powered question clustering and grouping
- AI-driven summarization and rephrasing of common questions
- Host interface for AI-assisted analysis
- Chat interface for host to query AI about collected questions
- Real-time WebSocket communication
- Basic authentication (username/password in OpenShift Secret)

**Success Criteria:**
- ✅ Collect questions from 100 concurrent users in 60 seconds
- ✅ Cluster similar questions with 80%+ accuracy
- ✅ AI summarization within 10 seconds
- ✅ Host can query AI about question themes/topics

---

## 1. User Interaction Flows & Data Flow

### 1.1 Host User Journey

**Phase 1: Setup (30 seconds)**
```
1. Host logs in → Dashboard
2. Host clicks "Create Session" → Form (title, timer duration)
3. POST /api/v1/sessions → Returns PIN + QR code
4. Host lands on Session Lobby → Shows QR, PIN, participant counter
```

**Phase 2: Collection (60 seconds)**
```
5. Participants join → Counter updates in real-time
6. Host clicks "Start Collection" → Timer starts (60s countdown)
7. Questions stream in → Host sees live feed + counter
8. Timer ends → Collection stops, "Analyze" button appears
```

**Phase 3: Analysis (10-30 seconds)**
```
9. Host clicks "Analyze Questions" → Worker processes in background
   - Generate embeddings for all questions
   - Cluster by similarity (cosine > 0.85)
   - Generate representative question per cluster
10. Host sees clustered view → 8 groups of questions
```

**Phase 4: AI-Assisted Review (5-10 minutes)**
```
11. Host expands clusters → Reviews similar questions grouped together
12. Host uses AI chat:
    - "What are the main topics ranked by frequency?"
    - "Rephrase the most common question in Cluster 1"
    - AI streams responses based on collected questions
13. Host answers questions orally to audience
14. (Optional) Host reopens collection for next topic
```

**Data Flow: Question Submission**
```
Participant Browser
    │ WebSocket: question:submit
    │ { sessionId, questionText }
    ▼
WebSocket Service (Node.js)
    │ Validates session is active
    │ Validates text length < 500 chars
    ▼
PostgreSQL
    │ INSERT INTO questions
    │   (session_id, question_text, submitted_at)
    │ Returns question_id
    ▼
WebSocket Service
    │ Broadcast to host: question:new
    │ { questionId, text, submittedAt }
    ▼
Host Browser
    │ Updates question counter
    │ Appends to question feed
```

**Data Flow: AI Clustering**
```
Host clicks "Analyze"
    ▼
API Service
    │ POST /api/v1/sessions/{id}/analyze
    │ Publishes to AMQ: analyze.questions
    │ Returns 202 Accepted
    ▼
Question Analysis Worker
    │ 1. SELECT * FROM questions WHERE session_id = ?
    │ 2. For each question:
    │      POST /llama-stack/embeddings → 768-dim vector
    │      UPDATE questions SET embedding = ?
    │ 3. Pgvector similarity search:
    │      SELECT q1.id, q2.id, (q1.embedding <=> q2.embedding)
    │      WHERE distance < 0.15
    │ 4. Group into clusters (similarity > 0.85)
    │ 5. For each cluster:
    │      INSERT INTO question_clusters
    │      POST /llama-stack/inference (rephrase questions)
    │      UPDATE question_clusters SET representative_question = ?
    ▼
WebSocket Service
    │ Broadcast: analysis:complete { clusterCount }
    ▼
Host Browser
    │ Displays clustered view
```

### 1.2 Participant User Journey

**Phase 1: Join (5 seconds)**
```
1. Scan QR code or type URL → https://qaroot.edu/join/ABC123
2. GET /join/ABC123 → Returns session info
3. (Optional) Enter nickname → POST /participants
4. WebSocket connect → Waits for collection to start
```

**Phase 2: Submit (During 60s window)**
```
5. Collection starts → Timer appears, input enabled
6. Type question → Character counter shows 0/500
7. Click "Submit" → WebSocket sends question
8. See confirmation → "Question submitted!"
9. Can submit additional questions (5s cooldown between submissions)
```

**Phase 3: Wait**
```
10. Timer ends → Input disabled
11. See message: "Collection ended. Thank you!"
12. (Presenter answers questions orally - no UI updates needed)
```

---

## 2. System Architecture

### 2.1 High-Level Architecture

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

### 1.2 Question Collection & Analysis Pipeline

```
Presenter starts question collection (60 second timer)
    ↓
Audience submits questions via WebSocket
    ↓
Questions stored in DB + embeddings generated
    ↓
Collection timer ends
    ↓
Presenter clicks "Analyze Questions"
    ↓
AI Clustering Agent
    ├─ Generate embeddings for all questions (Llama Stack)
    ├─ Cluster similar questions using cosine similarity (pgvector)
    ├─ Group questions by topic/theme
    └─ Return clusters to host interface
         ↓
Presenter views clustered questions + uses AI chat
    ├─ "Summarize the main topics, ranked by frequency"
    ├─ "What is the most common question?"
    ├─ "Rephrase this cluster's question"
    └─ AI responds via LLM (Qwen2.5-14B)
         ↓
Presenter answers questions orally
    ↓
Optional: Presenter reopens question collector for next topic
```

### 1.3 Service Responsibilities

**API Service** (Node.js + Express)
- Basic authentication (username/password)
- Session CRUD operations (create, start/stop collection timer)
- Question CRUD operations
- Chat API for host-AI interaction
- RESTful endpoints for host/participant

**WebSocket Service** (Node.js + Socket.io)
- Real-time question submission (audience → DB)
- Live question count updates to host
- Collection timer synchronization
- Redis pub/sub for multi-pod coordination

**Question Analysis Worker** (Node.js + Bull)
- **Clustering Agent**: Groups similar questions using embeddings + cosine similarity
- **Summarization Agent**: Generates topic summaries and rephrased questions via LLM
- Triggered on-demand when host clicks "Analyze Questions"

**Llama Stack** (Python)
- Embeddings API (nomic-embed-text-v1.5, 768 dimensions)
- Inference API for chat responses and summarization (Qwen2.5-14B)
- Connects to external LLM service (OpenAI-compatible)
- Vector similarity search via pgvector

---

## 2. Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend Framework** | React + TypeScript | 18.x |
| **UI Component Library** | PatternFly 6 | 6.x |
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
- **Embeddings Model**: nomic-embed-text-v1.5 (768 dimensions, local in Llama Stack)
- **Vector Store**: pgvector with IVFFlat indexing
- **Clustering Strategy**: Cosine similarity > 0.85 for question grouping
- **Use Cases**:
  - Question embedding generation
  - Question clustering/grouping
  - Topic summarization
  - Question rephrasing
  - Host chat queries (e.g., "what are the main topics?")

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

#### Presentation Collections (Optional - Future)
```sql
-- MVP: Not needed - sessions are standalone
-- Future: Group related sessions by presentation/course
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
```

#### Sessions
```sql
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

### 3.3 Question Tables

#### Questions
```sql
CREATE TABLE questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    participant_id UUID REFERENCES participants(id) ON DELETE SET NULL, -- nullable for anonymous
    question_text TEXT NOT NULL,
    embedding vector(768), -- generated after submission
    cluster_id UUID, -- assigned after clustering
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_questions_session ON questions(session_id);
CREATE INDEX idx_questions_cluster ON questions(cluster_id);
CREATE INDEX idx_questions_embedding ON questions USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX idx_questions_submitted ON questions(submitted_at);
```

#### Question Clusters
```sql
CREATE TABLE question_clusters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    cluster_label VARCHAR(255), -- e.g., "Migration Questions", "Feature Requests"
    representative_question TEXT, -- AI-generated rephrased question
    question_count INTEGER DEFAULT 0,
    centroid_embedding vector(768), -- cluster center for similarity
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_clusters_session ON question_clusters(session_id);
```

#### Host Chat Messages
```sql
-- Chat between host and AI for question analysis
CREATE TABLE host_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_chat_session ON host_chat_messages(session_id, created_at);
```

---

## 4. OpenShift Deployment

### 4.1 Resource Requirements

| Service | Replicas | CPU | Memory | Storage |
|---------|----------|-----|--------|---------|
| API Service | 1 | 1-2 | 2-4Gi | - |
| WebSocket Service | 1 | 1-2 | 2-4Gi | - |
| FAQ Worker Pool | 1 | 2-4 | 4-8Gi | - |
| Llama Stack | 1 | 2-4 | 4-8Gi | - |
| PostgreSQL | 1 | 2-4 | 8-16Gi | 100Gi |
| Redis | 1 | 1-2 | 2-4Gi | - |
| Red Hat AMQ | 1 | 1-2 | 2-4Gi | 10Gi |
| Frontend (Nginx) | 1 | 0.5-1 | 512Mi-1Gi | - |

**Total:** ~10-18 CPU cores, ~22-40Gi memory, 110Gi storage

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

    # Embeddings Provider (Local in Llama Stack)
    embeddings:
      provider: sentence-transformers
      config:
        model: nomic-ai/nomic-embed-text-v1.5
        dimension: 768
        batch_size: 32
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
```

#### Deployment: llama-stack
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: llama-stack
  namespace: qaroot-mvp
spec:
  replicas: 1
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
  replicas: 1
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
  replicas: 1
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
  replicas: 1
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

## 6. Helm Chart Structure

The application will be deployed using a Helm chart for simplified configuration management and deployment across different environments.

### 6.1 Chart Structure

```
qaroot/
├── Chart.yaml                 # Chart metadata
├── values.yaml                # Default configuration values
├── values-dev.yaml            # Development environment overrides
├── values-staging.yaml        # Staging environment overrides
├── values-production.yaml     # Production environment overrides
├── templates/
│   ├── _helpers.tpl           # Template helpers
│   ├── NOTES.txt              # Post-install instructions
│   │
│   ├── namespace.yaml         # Namespace definition
│   │
│   ├── secrets/
│   │   ├── app-credentials.yaml
│   │   ├── llm-credentials.yaml
│   │   ├── postgres-credentials.yaml
│   │   └── amq-credentials.yaml
│   │
│   ├── configmaps/
│   │   └── llama-stack-config.yaml
│   │
│   ├── postgresql/
│   │   ├── statefulset.yaml
│   │   ├── service.yaml
│   │   └── pvc.yaml
│   │
│   ├── redis/
│   │   ├── deployment.yaml
│   │   └── service.yaml
│   │
│   ├── amq/
│   │   ├── deployment.yaml
│   │   └── service.yaml
│   │
│   ├── llama-stack/
│   │   ├── deployment.yaml
│   │   └── service.yaml
│   │
│   ├── api-service/
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   └── route.yaml
│   │
│   ├── websocket-service/
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   └── route.yaml
│   │
│   ├── faq-worker-pool/
│   │   └── deployment.yaml
│   │
│   └── frontend/
│       ├── deployment.yaml
│       ├── service.yaml
│       └── route.yaml
│
└── README.md                  # Chart documentation
```

### 6.2 Sample values.yaml

```yaml
# Global settings
global:
  namespace: qaroot-mvp
  domain: qaroot.university.edu

# Image settings
images:
  apiService:
    repository: qaroot/api-service
    tag: latest
    pullPolicy: IfNotPresent

  websocketService:
    repository: qaroot/websocket-service
    tag: latest
    pullPolicy: IfNotPresent

  faqWorkerPool:
    repository: qaroot/faq-worker-pool
    tag: latest
    pullPolicy: IfNotPresent

  frontend:
    repository: qaroot/frontend
    tag: latest
    pullPolicy: IfNotPresent

  llamaStack:
    repository: llamastack/distribution
    tag: latest
    pullPolicy: IfNotPresent

  postgresql:
    repository: pgvector/pgvector
    tag: pg15
    pullPolicy: IfNotPresent

  redis:
    repository: redis
    tag: 7-alpine
    pullPolicy: IfNotPresent

  amq:
    repository: registry.redhat.io/amq7/amq-broker
    tag: "7.11"
    pullPolicy: IfNotPresent

# Replica counts
replicaCount:
  apiService: 1
  websocketService: 1
  faqWorkerPool: 1
  llamaStack: 1
  frontend: 1

# Resource limits
resources:
  apiService:
    requests:
      memory: 2Gi
      cpu: 1
    limits:
      memory: 4Gi
      cpu: 2

  websocketService:
    requests:
      memory: 2Gi
      cpu: 1
    limits:
      memory: 4Gi
      cpu: 2

  faqWorkerPool:
    requests:
      memory: 4Gi
      cpu: 2
    limits:
      memory: 8Gi
      cpu: 4

  llamaStack:
    requests:
      memory: 4Gi
      cpu: 2
    limits:
      memory: 8Gi
      cpu: 4

  postgresql:
    requests:
      memory: 8Gi
      cpu: 2
    limits:
      memory: 16Gi
      cpu: 4

  redis:
    requests:
      memory: 2Gi
      cpu: 1
    limits:
      memory: 4Gi
      cpu: 2

  amq:
    requests:
      memory: 2Gi
      cpu: 1
    limits:
      memory: 4Gi
      cpu: 2

  frontend:
    requests:
      memory: 512Mi
      cpu: 500m
    limits:
      memory: 1Gi
      cpu: 1

# Storage
storage:
  postgresql:
    size: 100Gi
    storageClass: gp3

  amq:
    size: 10Gi
    storageClass: gp3

# External LLM configuration
externalLLM:
  url: "https://llm.university.edu/v1"
  apiKey: "changeme"
  safetyUrl: "https://llm.university.edu/safety/v1"
  safetyApiKey: "changeme"

# Application credentials
auth:
  adminUsername: "admin"
  adminPassword: "changeme123"
  adminEmail: "admin@university.edu"
  jwtSecret: "your-random-jwt-secret-here-min-32-chars"
  sessionSecret: "your-random-session-secret-here-min-32-chars"

# Database credentials
database:
  username: "qaroot"
  password: "changeme"
  database: "qaroot_mvp"

# AMQ credentials
amq:
  username: "admin"
  password: "changeme"

# CORS settings
cors:
  origin: "https://qaroot.university.edu"

# File upload settings
fileUpload:
  path: "/var/qaroot/uploads"
  maxSize: "50MB"

# Worker settings
worker:
  concurrency: 4
  aggregationInterval: "30s"
  llmTimeout: "60s"
  maxRetries: 3

# Llama Stack configuration
llamaStack:
  embeddings:
    model: "nomic-ai/nomic-embed-text-v1.5"
    dimension: 768

  rag:
    topK: 5
    similarityThreshold: 0.7
    chunkSize: 512
    chunkOverlap: 50

  inference:
    model: "qwen2.5-14b-instruct"
    temperature: 0.7
    maxTokens: 2048

  safety:
    model: "llama-guard-3"
    enablePromptGuard: true
    enableOutputGuard: true

# OpenShift routes
routes:
  apiService:
    enabled: true
    host: "api.qaroot.university.edu"
    tls:
      termination: edge
      insecureEdgeTerminationPolicy: Redirect

  websocketService:
    enabled: true
    host: "ws.qaroot.university.edu"
    tls:
      termination: edge
      insecureEdgeTerminationPolicy: Redirect

  frontend:
    enabled: true
    host: "qaroot.university.edu"
    tls:
      termination: edge
      insecureEdgeTerminationPolicy: Redirect
```

### 6.3 Helm Installation Commands

**Install chart:**
```bash
# Create namespace
oc create namespace qaroot-mvp

# Install with default values
helm install qaroot ./qaroot -n qaroot-mvp

# Install with custom values file
helm install qaroot ./qaroot -n qaroot-mvp -f values-production.yaml

# Install with inline overrides
helm install qaroot ./qaroot -n qaroot-mvp \
  --set externalLLM.url=https://llm.example.com/v1 \
  --set auth.adminPassword=securepassword123
```

**Upgrade chart:**
```bash
# Upgrade with new values
helm upgrade qaroot ./qaroot -n qaroot-mvp -f values-production.yaml

# Upgrade with inline overrides
helm upgrade qaroot ./qaroot -n qaroot-mvp \
  --set images.apiService.tag=v1.2.0
```

**Uninstall chart:**
```bash
helm uninstall qaroot -n qaroot-mvp
```

**Dry run (template validation):**
```bash
helm install qaroot ./qaroot -n qaroot-mvp --dry-run --debug
```

### 6.4 Key Helm Features

**Templating Benefits:**
- Single source of truth for all Kubernetes resources
- Environment-specific configuration via values files
- Automated secret generation from values
- Consistent labeling and naming conventions
- Easy rollback to previous versions

**Configuration Management:**
- All secrets managed through Helm values (encrypted with tools like helm-secrets or sealed-secrets)
- ConfigMaps generated from templates
- Resource limits configurable per environment
- Replica counts adjustable per environment

**Deployment Flexibility:**
- Deploy to dev/staging/production with different values files
- Override individual values via `--set` flags
- Supports Helm hooks for pre/post-install tasks (e.g., database migrations)

---

## 7. Implementation Checklist

### Foundation
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

### RAG & LLM Integration
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

### Frontend & Testing
- [ ] Host dashboard (document collections, sessions)
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

### Deployment & Helm Charts
- [ ] Create Helm chart structure (`helm create qaroot`)
- [ ] Create `values.yaml` with all configurable parameters
- [ ] Create Helm templates for all services
  - [ ] PostgreSQL StatefulSet template
  - [ ] Redis Deployment template
  - [ ] Red Hat AMQ Deployment template
  - [ ] Llama Stack Deployment template
  - [ ] API Service Deployment template
  - [ ] WebSocket Service Deployment template
  - [ ] FAQ Worker Pool Deployment template
  - [ ] Frontend Deployment template
- [ ] Create Helm templates for ConfigMaps and Secrets
  - [ ] `llama-stack-config` ConfigMap template
  - [ ] `app-credentials` Secret template
  - [ ] `llm-credentials` Secret template
  - [ ] `postgres-credentials` Secret template
  - [ ] `amq-credentials` Secret template
- [ ] Create Helm templates for Services
- [ ] Create Helm templates for PersistentVolumeClaims
- [ ] Create Helm templates for OpenShift Routes (Ingress)
- [ ] Test Helm chart deployment (`helm install qaroot ./qaroot`)
- [ ] Document Helm chart usage in README
- [ ] Production deployment via Helm
- [ ] User documentation

---

## 8. Frontend Development Guidelines

### 8.1 UI Component Library: PatternFly 6

The MVP uses **PatternFly 6** (Red Hat's open-source design system) for all UI components.

**Why PatternFly 6:**
- Red Hat's official design system
- Enterprise-ready, accessible (WCAG 2.1 AA)
- Consistent with OpenShift console UX
- Comprehensive component library
- Built for React + TypeScript

**PatternFly 6 Resources:**
- Official Docs: https://www.patternfly.org/
- React Components: https://www.patternfly.org/components/all-components
- GitHub: https://github.com/patternfly/patternfly-react

**AI Development Guide:**
- For AI-assisted development with PatternFly 6, reference the LiteMaaS project's CLAUDE.md files:
  - Main guide: `CLAUDE.md` (general Context7 instructions)
  - Frontend guide: `frontend/CLAUDE.md` (PatternFly 6 specific instructions)
  - PatternFly 6 guide: `docs/pf6-guide.md` (comprehensive PF6 patterns)
- Location: https://github.com/rh-aiservices-bu/LiteMaaS/tree/dev

### 8.2 Key UI Components for MVP

**Host Interface Components:**
- `Page` + `PageSection` - Layout structure
- `Card` - Session lobby, clustered questions
- `Button` - Primary actions (Start Collection, Analyze, Submit)
- `TextInput` - Session title, chat input
- `Timer` (custom) - Countdown display
- `Badge` - Question counter, participant counter
- `Modal` - Session creation form
- `ExpandableSection` - Collapsible question clusters
- `DataList` - Question feed, clustered questions
- `ChatBot` (custom or use `MessageBox`) - AI chat interface
- `EmptyState` - No questions collected yet
- `Spinner` - Loading during analysis

**Participant Interface Components:**
- `Page` + `PageSection` - Layout
- `Form` + `FormGroup` - Join session, question input
- `TextArea` - Question input (500 char limit)
- `CharacterCounter` (custom) - Shows X/500
- `Button` - Submit question
- `Alert` - Success/error messages
- `Timer` (custom) - Countdown display
- `EmptyState` - Waiting for collection to start

**Common Components:**
- `Masthead` - Top navigation (minimal for MVP)
- `Alert` - Notifications and error messages
- `Progress` - Analysis progress indicator
- `Tooltip` - Hints and help text

### 8.3 Color Palette & Theming

PatternFly 6 uses CSS variables for theming. Key colors for MVP:

```css
/* Primary actions */
--pf-v6-global--primary-color--100: #0066cc; /* Blue */

/* Success states */
--pf-v6-global--success-color--100: #3e8635; /* Green */

/* Warning/timer */
--pf-v6-global--warning-color--100: #f0ab00; /* Orange */

/* Danger/errors */
--pf-v6-global--danger-color--100: #c9190b; /* Red */

/* Backgrounds */
--pf-v6-global--BackgroundColor--100: #ffffff; /* White */
--pf-v6-global--BackgroundColor--200: #f0f0f0; /* Light gray */
```

### 8.4 Responsive Design

PatternFly 6 is mobile-responsive by default. Key breakpoints:

- **Desktop**: 1200px+ (primary target for host interface)
- **Tablet**: 768px-1199px
- **Mobile**: < 768px (primary target for participant interface)

**Host Interface**: Optimized for desktop/laptop (presenter typically uses larger screen)
**Participant Interface**: Mobile-first (audience uses phones to scan QR and submit)

### 8.5 Accessibility Requirements

- All components must meet **WCAG 2.1 Level AA**
- Keyboard navigation support (Tab, Enter, Esc)
- Screen reader compatibility (ARIA labels)
- Sufficient color contrast (4.5:1 for text)
- Focus indicators on all interactive elements

PatternFly 6 components include accessibility by default.

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
