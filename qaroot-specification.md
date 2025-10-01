# Qaroot Platform - Technical Specification Document

**Version:** 1.0
**Date:** October 1, 2025
**Project Lead:** Philip
**Project Support:** Guillaume

---

## 1. Executive Summary

Qaroot is an open-source, agentic quiz platform designed for university professors and teaching assistants to enhance AI-enabled academic pedagogy. The platform supports real-time assessments, sentiment polling, and automated FAQ generation through LLM integration, scaling from 5 to 5,000 concurrent users.

### 1.1 Key Objectives

- Deploy scalable, microservices-based architecture on OpenShift
- Support three pedagogical interaction modes: Timed Quiz, Polling, and Live FAQ Builder
- Integrate LLM pipeline for automated FAQ generation and knowledge gap analysis
- Provide Kahoot-like user experience with enhanced academic features
- Maintain comprehensive audit trails for pedagogical research

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
                │  │ Quiz/Content │ │
                │  │ Session Mgmt │ │
                │  │ Analytics    │ │
                │  └──────────────┘ │
                └────────┬──────────┘
                         │
        ┌────────────────┼────────────────────────┐
        │                │                        │
┌───────▼──────────┐ ┌───▼──────────────┐ ┌──────▼─────────────┐
│ WebSocket Service│ │ FAQ Worker Pool  │ │   Llama Stack      │
│  (Real-time)     │ │ ┌──────────────┐ │ │ ┌────────────────┐ │
│                  │ │ │ Aggregation  │ │ │ │ Orchestration  │ │
│ - Quiz/Poll      │ │ │ LLM Process  │ │ │ │ RAG Engine     │ │
│ - FAQ            │ │ │ Answer Gen   │ │ │ │ Embeddings     │ │
│ - Leaderboard    │ │ │ Analysis     │ │ │ │ Memory         │ │
│                  │ │ └──────────────┘ │ │ └────────────────┘ │
└───────┬──────────┘ └───┬──────────────┘ └──────────┬─────────┘
        │                │                           │
        │                │            ┌──────────────┴───────────────┐
        │                │            │                              │
        └────────────────┼────────────┼──────────────────────────────┼───┐
                         │            │                              │   │
        ┌────────────────┼────────────┼───┐   ┌──────────────────────▼───▼──┐
        │                │            │   │   │   vLLM Services (Separate)  │
┌───────▼──────┐  ┌──────▼─────────┐  │   │   │ ┌───────────────────────┐   │
│ Red Hat AMQ  │  │  PostgreSQL    │  │   │   │ │ vLLM: Qwen 14B (×2)   │   │
│  (Queues)    │  │  + pgvector    │  │   │   │ │ vLLM: Guard 3 (×2)    │   │
└──────────────┘  │  + TimescaleDB │  │   │   │ └───────────────────────┘   │
                  └────────────────┘  │   │   └─────────────────────────────┘
                              ┌───────▼───▼──┐
                              │    Redis     │
                              │  (Cache/     │
                              │   Sessions)  │
                              └──────────────┘
```

### 2.2 FAQ Agent Architecture

The FAQ answering system uses a **worker pool of specialized agents** that coordinate via Red Hat AMQ and integrate with Llama Stack for AI capabilities.

#### 2.2.1 Agent Services Overview

**FAQ Agent Worker Pool** is a Node.js/TypeScript service that runs multiple concurrent workers, each executing one of four specialized agent types. These agents communicate via Red Hat AMQ message queues and leverage Llama Stack for LLM operations.

```
FAQ Service (API) → Publishes to Red Hat AMQ
                    ↓
    ┌───────────────┴───────────────┐
    │   FAQ Agent Worker Pool       │
    │  (Multiple Pods/Replicas)     │
    │                               │
    │  Workers consume from queues: │
    │  - faq.aggregate.queue        │
    │  - faq.llm.queue             │
    │  - faq.answer.queue          │
    │  - faq.analysis.queue        │
    └───────────────┬───────────────┘
                    ↓
            Llama Stack API
         (Inference + RAG + Safety)
```

#### 2.2.2 Agent Responsibilities

**1. FAQ Aggregation Agent**
- **Trigger**: Scheduled cron (every 30-60 seconds) or event-based
- **Process**:
  1. Fetches new unprocessed FAQ questions from PostgreSQL
  2. Calls **Llama Stack Embeddings API** to generate embeddings for each question
  3. Stores embeddings in pgvector (faq_questions.embedding column)
  4. Performs vector similarity search in pgvector to find similar questions
  5. Clusters questions with cosine similarity > 0.85
  6. Selects representative "master question" for each cluster
  7. Publishes `faq.cluster.created` event to Red Hat AMQ
- **Output**: Master questions ready for answer generation
- **Llama Stack API Used**: `embeddings.create()` for question embeddings

**2. LLM Processing Agent**
- **Trigger**: Consumes `faq.cluster.created` messages from Red Hat AMQ
- **Process**:
  1. Receives master question and cluster metadata
  2. Calls **Llama Stack Inference API** with:
     - Model: Qwen2.5-14B-Instruct (via vLLM)
     - RAG enabled: retrieves relevant course documents from pgvector
     - Safety enabled: Llama Guard 3 filters inputs/outputs (via vLLM)
  3. Implements retry logic (3 attempts with exponential backoff)
  4. Streams response tokens as they're generated
  5. Publishes `faq.llm.completed` to Red Hat AMQ (with raw answer)
- **Output**: Raw LLM-generated answer text
- **Llama Stack API Used**: `inference.chatCompletion()` with RAG + Safety
- **Note**: Llama Stack routes requests to separate vLLM services

**3. Answer Generation Agent**
- **Trigger**: Receives raw LLM answer from LLM Processing Agent
- **Process**:
  1. Post-processes LLM output for pedagogical quality
  2. Extracts citations from RAG-retrieved documents
  3. **Optional**: Calls **Llama Stack Inference API** for answer refinement:
     - Reformat citations to academic style
     - Add executive summary if answer is long
     - Simplify complex language for student comprehension
  4. Applies additional content filters (profanity check)
  5. Validates answer length (50-2000 chars)
  6. Stores in `faq_master_questions` table with `is_published=false`
  7. Publishes `faq.answer.generated` event to WebSocket Hub
- **Output**: Polished, citation-formatted answer ready for host review
- **Llama Stack API Used**: Optionally `inference.chatCompletion()` for post-processing refinement

**4. Knowledge Gap Analysis Agent**
- **Trigger**: End of session or scheduled batch (nightly)
- **Process**:
  1. Analyzes all FAQ questions from session or time period
  2. Identifies recurring topics using embedding clustering
  3. Calls **Llama Stack Memory API** to track historical patterns
  4. Compares current session themes vs. historical data (TimescaleDB)
  5. Generates insights: "20% of questions about Recursion vs. 5% historically"
  6. Stores insights in `session_archives` and TimescaleDB
- **Output**: Knowledge gap report for instructor dashboard
- **Llama Stack API Used**: `memory.query()` for historical context

#### 2.2.3 FAQ Processing Flow (Complete Sequence)

```
Student → FAQ Question Submission
    │
    ▼
[FAQ Service]
    │ Validates & stores question in PostgreSQL (faq_questions table)
    │ Publishes: faq.question.submitted → Red Hat AMQ
    │ Returns: 202 Accepted to student
    │
    ▼ (Every 30-60s)
[Aggregation Agent Worker]
    │ 1. Fetches unprocessed questions from DB
    │ 2. Calls Llama Stack Embeddings API:
    │    POST /embeddings/create
    │    { "model": "nomic-embed-text-v1.5", "input": [...questions] }
    │ 3. Stores embeddings in pgvector
    │ 4. Vector search in pgvector (cosine similarity)
    │ 5. Clusters similar questions (similarity > 0.85)
    │ 6. Selects master question per cluster
    │ 7. Publishes: faq.cluster.created → Red Hat AMQ
    │
    ▼
[LLM Processing Agent Worker]
    │ 1. Consumes faq.cluster.created message
    │ 2. Prepares RAG context: quiz_set_id → retrieves relevant docs
    │ 3. Calls Llama Stack API:
    │    POST /inference/chat-completion
    │    {
    │      "model": "Qwen/Qwen2.5-14B-Instruct",
    │      "messages": [...],
    │      "rag": { "enabled": true, "vector_db_ids": [...], "top_k": 5 },
    │      "safety": { "enabled": true, "shield": "llama-guard-3" }
    │    }
    │ 4. Llama Stack internally:
    │    - Retrieves top-5 document chunks from pgvector
    │    - Runs Llama Guard 3 on input
    │    - Calls vLLM inference with RAG context
    │    - Runs Llama Guard 3 on output
    │ 5. Receives answer with citations
    │ 6. Publishes: faq.llm.completed → Red Hat AMQ (with raw answer)
    │
    ▼
[Answer Generation Agent Worker]
    │ 1. Consumes faq.llm.completed message
    │ 2. Post-processes answer:
    │    - Formats citations as footnotes
    │    - Validates length & quality
    │    - Checks for profanity (additional layer)
    │ 3. Stores in faq_master_questions (is_published = false)
    │ 4. Publishes: faq.answer.generated → WebSocket Hub
    │
    ▼
[WebSocket Hub] → Broadcasts to Host UI
    │ Host sees: "New FAQ answer ready for review"
    │ Host reviews, edits if needed, clicks "Publish"
    │
    ▼
[FAQ Service] → Updates is_published = true
    │ Publishes: faq.published → WebSocket Hub
    │
    ▼
[WebSocket Hub] → Broadcasts to all Students in session
    │ Students see answer appear in real-time
    │
    ▼ (End of session or nightly)
[Knowledge Gap Analysis Agent Worker]
    │ 1. Analyzes session FAQ patterns
    │ 2. Calls Llama Stack Memory API for historical context
    │ 3. Generates insights report
    │ 4. Stores in session_archives & TimescaleDB
```

#### 2.2.4 Key Integration Points

**How Agents Use Llama Stack:**

1. **Aggregation Agent** → ✅ Uses `embeddings.create()` for question embeddings
2. **LLM Processing Agent** → ✅ **Primary Llama Stack user**
   - Calls: `inference.chatCompletion()` with RAG + Safety
   - Llama Stack routes to: vLLM (Qwen 14B) and vLLM (Llama Guard 3)
3. **Answer Generation Agent** → ✅ Optionally uses `inference.chatCompletion()` for answer refinement
4. **Knowledge Gap Agent** → ✅ Uses `memory.query()` for historical context

**Why This Architecture:**
- **Separation of Concerns**: Each agent has a single, well-defined responsibility
- **Scalability**: Agents can scale independently based on queue depth
- **Fault Tolerance**: If LLM Processing Agent fails, questions remain in queue for retry
- **RAG Context**: Llama Stack automatically retrieves course materials without manual vector search in agent code
- **Safety**: Llama Guard 3 integrated at Llama Stack level, not agent level
- **Observability**: Each agent can be monitored separately (queue depth, processing time, error rate)

#### 2.2.5 Message-Driven Communication

- **Message Broker:** Red Hat AMQ (ActiveMQ Artemis) with topic exchanges
- **Message Patterns:**
  - Command: Direct service invocation
  - Event: Broadcast state changes
  - Query: Request-response with caching

**Key Topics:**
```
session.created
session.question.submitted
quiz.answer.submitted
poll.vote.submitted
faq.question.submitted
faq.cluster.created         # New: triggers LLM processing
faq.llm.completed           # New: triggers answer generation
faq.answer.generated        # Sent to WebSocket Hub
faq.published               # Final broadcast to students
analytics.event
```

### 2.3 Simplified Service Architecture

The platform now consists of **3 core services** plus supporting infrastructure:

#### 2.3.1 API Service (Unified REST API)

**Purpose**: Single REST API handling all HTTP requests

**Consolidated Responsibilities**:
- **Authentication (Auth Module)**
  - OIDC authentication (university SSO)
  - JWT token issuance and validation
  - RBAC enforcement
  - Participant PIN-based join (no auth required)

- **Quiz/Content Management (Quiz Module)**
  - Quiz set and question CRUD
  - RAG document upload and management
  - Document chunking and embedding orchestration
  - Quiz export

- **Session Management (Session Module)**
  - Session lifecycle (create, start, pause, end)
  - Session PIN generation
  - Participant tracking
  - Session state management

- **Analytics (Analytics Module)**
  - Session statistics and reports
  - Question performance analysis
  - Knowledge gap detection
  - Data export (JSON/CSV)

**Key Operations**:
```
# Auth
POST   /api/v1/auth/login
GET    /api/v1/auth/oidc/callback
POST   /api/v1/auth/refresh

# Quiz/Content
POST   /api/v1/quizzes
POST   /api/v1/quizzes/:id/questions
POST   /api/v1/quizzes/:id/documents        # RAG documents

# Sessions
POST   /api/v1/sessions
POST   /api/v1/sessions/join/:pin            # Participant join
POST   /api/v1/sessions/:id/start
POST   /api/v1/sessions/:id/next-question

# Analytics
GET    /api/v1/analytics/sessions/:id
GET    /api/v1/analytics/knowledge-gaps
GET    /api/v1/sessions/:id/export
```

**Technology**: Node.js 20 (TypeScript), single deployable service

**Data Access**: All PostgreSQL tables, Redis cache, TimescaleDB

---

#### 2.3.2 WebSocket Service (Real-time Communication)

**Purpose**: Handles all real-time bidirectional communication

**Responsibilities**:
- **Quiz/Poll Events**
  - Question display synchronization
  - Answer submission
  - Live leaderboard updates
  - Result visualization

- **FAQ Events**
  - Student question submission
  - Answer publication notifications
  - Upvote/downvote

- **Connection Management**
  - WebSocket connection lifecycle
  - Room-based broadcasting (one room per session)
  - Heartbeat and reconnection
  - Redis pub/sub for multi-pod coordination

**Key Events**:
```javascript
// Host → Participants
question:show           // Display question
question:closed         // Stop accepting answers
leaderboard:update      // Update rankings
faq:published          // New FAQ answer available

// Participant → Server
answer:submit          // Quiz/poll response
faq:submit            // FAQ question

// Server → Host
participant:joined     // New participant
response:received      // Answer submitted
faq:answer:generated   // New FAQ answer ready for review
```

**Technology**: Socket.io with Redis adapter

**Integration**:
- Reads from Redis for session state
- Publishes FAQ questions to Red Hat AMQ
- Subscribes to Red Hat AMQ for FAQ answer events

---

#### 2.3.3 FAQ Worker Pool (Background Processing)

**Purpose**: Asynchronous FAQ question processing with LLM

**Responsibilities**:
- **Aggregation Worker**
  - Batch questions every 30-60s
  - Cluster similar questions using embeddings
  - Create master questions

- **LLM Processing Worker**
  - Call Llama Stack inference API
  - Enable RAG for context retrieval
  - Handle retry and fallback logic

- **Answer Generation Worker**
  - Format LLM output with citations
  - Quality validation
  - Store in database

- **Analysis Worker**
  - Cross-session pattern analysis
  - Knowledge gap insights
  - Historical trend tracking

**Technology**: Node.js worker threads, Red Hat AMQ consumers

**Integration**:
- Consumes from Red Hat AMQ queues
- Calls Llama Stack APIs:
  - `embeddings.create()` for question clustering
  - `inference.chatCompletion()` for answer generation
  - `memory.query()` for historical analysis
- Publishes results to Red Hat AMQ → WebSocket Service

---

### 2.4 Service Communication Patterns

```
┌─────────────────────────────────────────────────────────────┐
│                     Communication Flow                       │
└─────────────────────────────────────────────────────────────┘

Frontend ──HTTP/REST──> API Service ──PostgreSQL──> All Tables
                         │           └──Redis──> Session Cache
                         │
                         └──triggers──> Llama Stack Embeddings API
                                       (for RAG doc chunking)

Frontend ──WebSocket──> WebSocket Service ──Redis Pub/Sub──> Other pods
                         │                └──Red Hat AMQ──> FAQ Workers
                         │
                         └──broadcasts──> All connected clients

FAQ Workers ──consume──> Red Hat AMQ
            └──call──> Llama Stack:
                       - Embeddings API (clustering)
                       - Inference API (RAG + Safety)
                       - Memory API (historical context)
            └──publish──> Red Hat AMQ ──> WebSocket Service
```

### 2.5 Deployment Model

**3 Core Services = 3 Kubernetes Deployments:**

1. **api-service** (2-6 replicas)
   - Stateless REST API
   - Scales based on HTTP request load

2. **websocket-service** (3-10 replicas)
   - Stateful WebSocket connections
   - Scales based on connected client count
   - Sticky sessions via Redis

3. **faq-worker-pool** (2-5 replicas)
   - Background workers
   - Scales based on Red Hat AMQ queue depth

**Benefits of Simplified Architecture:**
- ✅ **Fewer moving parts**: 3 services vs 7 original services
- ✅ **Simpler deployment**: Less orchestration complexity
- ✅ **Easier development**: Modules within monolith instead of microservices
- ✅ **Reduced network latency**: In-process function calls vs HTTP
- ✅ **Shared code/types**: Common data models across modules
- ✅ **Still scalable**: Each service scales independently
- ✅ **Clear boundaries**: API (sync), WebSocket (real-time), Workers (async)

---

## 3. Technology Stack

### 3.1 Frontend

| Component | Technology | Justification |
|-----------|-----------|---------------|
| Host Interface | React 18 + TypeScript | Component reusability, type safety |
| Participant Interface | React Native (Web/Mobile) | Cross-platform consistency |
| State Management | Zustand + React Query | Lightweight, optimized for real-time |
| Real-time | Socket.io Client | Broad browser support, fallbacks |
| UI Framework | Tailwind CSS + shadcn/ui | Rapid development, accessibility |
| Charts/Leaderboard | Recharts + Framer Motion | Engaging visualizations |
| QR Code | qrcode.react | Session join functionality |

#### 3.1.1 Host Interface (Web Frontend) - Detailed Functionality

The Host Interface is a React-based web application used by professors and teaching assistants to create, manage, and run interactive sessions.

---

**A. Dashboard & Quiz Management**

**1. Home Dashboard**
- View all created quizzes/quiz sets
- Recent session history
- Quick stats: total sessions run, avg participation, top performing quizzes
- Quick actions: "Create New Quiz", "Start Session", "View Analytics"

**2. Quiz Builder**
- **Quiz Set Creation**
  - Title, description, cover image
  - Tags for categorization (e.g., "Week 3", "Recursion", "Midterm Review")
  - Public/private toggle

- **Question Editor**
  - Drag-and-drop question reordering
  - Question types:
    - Multiple Choice (single or multiple answers)
    - True/False
    - Type Answer (text input with fuzzy matching)
    - Slider (numeric range)
    - Word Cloud (free text for sentiment)
  - Question settings:
    - Time limit (5-120 seconds)
    - Points value (default 1000, time-bonus enabled)
    - Media upload (images, videos, GIFs)
  - Answer configuration:
    - Mark correct answers
    - Randomize answer order option
  - Question preview

**3. RAG Document Management** (NEW)
- **Upload Interface**
  - Drag-and-drop for PDFs, PPTX, DOCX, TXT
  - Document type selection (lecture slides, syllabus, readings, etc.)
  - Metadata: title, lecture date, page numbers
- **Document List**
  - View all uploaded documents for quiz set
  - Processing status: "Uploading", "Chunking", "Embedding", "Ready"
  - Preview button (first page/section)
  - Delete and re-process options
- **Usage Indicator**
  - Shows which documents are referenced in FAQ answers
  - Citation analytics: "Used in 12 FAQ answers"

---

**B. Session Management (Live Control)**

**4. Pre-Session Setup**
- **Create Session Screen**
  - Select quiz set
  - Choose mode: Quiz (competitive), Poll (sentiment), FAQ (Q&A), or Mixed
  - Settings:
    - Show leaderboard: Always / After each question / Never
    - Allow late joins: Yes/No
    - Randomize question order: Yes/No
    - Enable FAQ mode: Yes/No
  - Schedule start time (optional) or "Start Now"
  - Generate QR code automatically

**5. Lobby (Waiting Room)**
- **Large QR Code Display**
  - Prominent QR code for students to scan
  - Session PIN displayed (large, bold, e.g., "ABC123")
  - Join URL: `https://qaroot.university.edu/join/ABC123`
- **Live Participant List**
  - Real-time participant join notifications (with sound effect)
  - Participant nicknames displayed
  - Participant count: "42 participants joined"
- **Host Controls**
  - "Start Session" button (prominent, enabled when >0 participants)
  - "Edit Settings" button
  - "Cancel Session" button

**6. Live Session Control Panel**
- **Main Display Area**
  - Current question displayed (same view as participants see)
  - Timer countdown (circular progress indicator)
  - Question number: "Question 5 of 12"

- **Live Response Feed (Right Sidebar)**
  - Real-time answer submissions
  - Participant avatars + nicknames
  - Response time indicator
  - Correct/incorrect status (color-coded)
  - Response rate: "38/42 answered (90%)"

- **Host Controls Bar (Bottom)**
  - "Show Question" - Reveals question to participants
  - "Close Answers" - Stop accepting responses early
  - "Show Results" - Display answer distribution
  - "Show Leaderboard" - Display top 10 rankings
  - "Next Question" - Advance to next
  - "Pause Session" - Freeze session
  - "End Session" - Complete and archive

**7. Live Results Visualization**
- **Answer Distribution**
  - Bar chart showing percentage per answer option
  - Correct answer highlighted in green
  - Average response time displayed
  - Hardest/easiest difficulty indicator

- **Leaderboard Display**
  - Top 10 participants
  - Rank, nickname, score, streak indicator
  - Animated transitions (Framer Motion)
  - Point changes highlighted

---

**C. FAQ Mode Interface**

**8. FAQ Question Queue**
- **Left Panel: Incoming Questions**
  - Live stream of student questions
  - Questions appear as they're submitted
  - Timestamp and participant nickname
  - Automatically grouped by similarity (clustered)
  - Badge showing cluster size: "3 similar questions"

**9. FAQ Answer Review Panel**
- **Generated Answer Card**
  - Master question (representative of cluster)
  - AI-generated answer with RAG citations
  - Source documents referenced (clickable to view)
  - Processing status: "Generating...", "Ready for Review", "Published"

- **Host Actions**
  - Edit answer (rich text editor)
  - Approve & Publish
  - Reject & Regenerate
  - Add manual answer
  - Preview how participants will see it

**10. Published FAQ Display**
- List of published Q&As
- Upvote/downvote counts from participants
- Unpublish option
- Export FAQ to PDF/Markdown

---

**D. Analytics & Reporting**

**11. Session Results Dashboard**
- **Overview Metrics**
  - Total participants
  - Completion rate
  - Average score
  - Average response time
  - Participation rate per question

- **Question Performance**
  - Table view: Question | Difficulty | Correct % | Avg Time
  - Identify questions that are too easy/hard
  - Distribution graphs (bell curve of scores)

- **Participant Performance**
  - Leaderboard (final rankings)
  - Individual participant drill-down
  - Time-to-answer trends
  - Struggle indicators (questions with long response times)

**12. Knowledge Gap Analysis** (NEW)
- **Cross-Session Insights**
  - Recurring FAQ topics across multiple sessions
  - Trending confusion areas (e.g., "Pointers appeared in 80% of sessions")
  - Comparison: current session vs. historical average
  - Recommendations: "Consider adding lecture on topic X"

- **FAQ Analytics**
  - Most asked question categories
  - Questions without good answers (low upvotes)
  - Citation usage: which documents are most referenced
  - Student engagement: FAQ submission rate per session

**13. Export & Sharing**
- **Export Options**
  - JSON (full session data)
  - CSV (responses, participants)
  - PDF Report (summary with charts)
  - FAQ Export (Markdown/PDF)
- **Share Session**
  - Public URL for results (anonymous)
  - Integration with LMS (Canvas, Blackboard) - future enhancement

---

**E. User Experience Features**

**14. Real-Time Updates**
- All data updates via WebSocket (no page refresh needed)
- Smooth animations for participant joins, answer submissions, leaderboard changes
- Toast notifications for important events

**15. Responsive Design**
- Desktop-optimized (primary use case: projector/large screen)
- Tablet support for on-the-go session management
- Mobile view for monitoring sessions remotely

**16. Keyboard Shortcuts**
- Space: Show next question
- Enter: Show results
- L: Show leaderboard
- P: Pause session
- Esc: Cancel current action

**17. Accessibility**
- WCAG 2.1 AA compliant
- Screen reader support
- Keyboard navigation
- High contrast mode
- Configurable text size

---

### 3.2 Backend Services

| Service | Technology | Justification |
|---------|-----------|---------------|
| Service Runtime | Node.js 20 (TypeScript) | Async I/O, WebSocket support |
| Alternative Runtime | Go 1.21 | High-performance services (Analytics) |
| Real-time Engine | Socket.io | Auto-scaling, Redis adapter |
| Message Queue | Red Hat AMQ (Artemis) | Enterprise messaging, Red Hat support |
| Caching | Redis 7 | Fast session state, leaderboards |
| Task Scheduling | Bull (Redis-backed) | Distributed job processing |

### 3.3 Data Layer

| Component | Technology | Justification |
|-----------|-----------|---------------|
| Primary Database | PostgreSQL 15 | ACID, JSON support, extensions |
| Time-Series Analytics | TimescaleDB | Question trends, performance metrics |
| Object Storage | MinIO (S3-compatible) | Media assets, exports |
| Search Engine | PostgreSQL Full-Text | Simplicity, adequate for scale |

### 3.4 Infrastructure

| Component | Technology | Justification |
|-----------|-----------|---------------|
| Orchestration | OpenShift 4.x (Kubernetes) | Container orchestration, scaling |
| Service Mesh | Istio (optional) | Traffic management, observability |
| Ingress | OpenShift Router (HAProxy) | Native integration |
| CI/CD | Tekton + ArgoCD | GitOps, OpenShift native |
| Monitoring | Prometheus + Grafana | Metrics, alerting |
| Logging | EFK Stack (Elasticsearch, Fluentd, Kibana) | Centralized logs |
| Tracing | Jaeger | Distributed tracing |

### 3.5 AI/LLM Integration

| Component | Technology | Justification |
|-----------|-----------|---------------|
| LLM Stack Framework | Llama Stack | Unified API for inference, embeddings, RAG, safety |
| Model Serving | vLLM (separate services) | High-throughput inference, independent scaling |
| Primary LLM | Qwen2.5-14B-Instruct | Best for instruction-following, multilingual support |
| Embeddings | nomic-embed-text-v1.5 (768d) via Llama Stack | Integrated in Llama Stack, no separate service needed |
| Vector Store | pgvector (PostgreSQL) | RAG document store, simplicity, integration |
| RAG Framework | Llama Stack RAG | Native RAG support with lecture materials context |
| Safety Layer | Llama Guard 3 (via vLLM) | Content moderation, prompt injection protection |

#### 3.5.1 Model Selection Rationale

**Primary Model: Qwen2.5-14B-Instruct**
- **Best for pedagogical tasks**: Superior instruction-following and reasoning capabilities
- **Multilingual support**: Native support for English, Chinese, and other languages (important for diverse student populations)
- **Context length**: 32K tokens (adequate for FAQ context with lecture materials)
- **Performance**: State-of-the-art results on academic Q&A benchmarks
- **VRAM requirement**: ~28GB in FP16, fits on single A100 40GB

**Safety Model: Llama Guard 3-8B**
- **Content moderation**: 13 safety categories for filtering harmful content
- **Speed**: Fast inference (~50ms per check) for real-time safety
- **VRAM requirement**: ~16GB in FP16, fits on L4 or T4 GPUs

**Embedding Model: nomic-embed-text-v1.5**
- **Dimensionality**: 768 dimensions (good balance of accuracy and storage)
- **Context length**: 8192 tokens (handles long questions)
- **Performance**: Comparable to OpenAI embeddings on clustering tasks
- **Privacy**: Fully open-source, no external API calls
- **Speed**: ~5ms per embedding on CPU, suitable for real-time clustering

**Llama Stack Integration**
- **Unified API**: Single interface for inference, RAG, memory, and safety
- **RAG Support**: Native retrieval from lecture materials, slides, and previous Q&A
- **Guardrails**: Llama Guard 3 for content moderation and safety filtering
- **Memory**: Conversation context management for multi-turn FAQ interactions
- **Routing**: Automatic model selection based on query complexity

#### 3.5.2 RAG Architecture for FAQ Answering

**Document Sources for RAG:**
1. **Lecture Materials**: Slides, notes, readings uploaded by host
2. **Previous Session Q&A**: Historical FAQ answers from same course
3. **Course Syllabus**: Learning objectives, topics, key concepts
4. **Textbook Excerpts**: Reference materials (if available)

**RAG Pipeline:**
```
Student Question → Embedding → Vector Search (pgvector)
→ Retrieve Top-K Relevant Docs → Llama Stack RAG API
→ LLM Generation with Context → Llama Guard Filtering → Answer
```

**Implementation Benefits:**
- **Contextual Answers**: Answers grounded in actual course materials
- **Reduced Hallucination**: RAG constrains responses to known information
- **Instructor Control**: Hosts can upload/manage source documents
- **Answer Citations**: Include references to source materials
- **Progressive Learning**: RAG corpus grows with each session

---

## 4. Database Schema

### 4.1 Core Tables

#### 4.1.1 Users Table
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    full_name VARCHAR(255),
    role VARCHAR(50) NOT NULL CHECK (role IN ('host', 'admin')),
    oidc_subject VARCHAR(255) UNIQUE, -- OIDC 'sub' claim
    institution VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_oidc ON users(oidc_subject);
```

#### 4.1.2 Quiz Sets Table
```sql
CREATE TABLE quiz_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    cover_image_url VARCHAR(1000),
    is_public BOOLEAN DEFAULT FALSE,
    tags TEXT[], -- Array of tags for categorization
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_quiz_sets_owner ON quiz_sets(owner_id);
CREATE INDEX idx_quiz_sets_tags ON quiz_sets USING GIN(tags);
```

#### 4.1.3 Questions Table
```sql
CREATE TYPE question_type AS ENUM (
    'multiple_choice',
    'true_false',
    'type_answer',
    'poll',
    'slider',
    'word_cloud'
);

CREATE TABLE questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_set_id UUID NOT NULL REFERENCES quiz_sets(id) ON DELETE CASCADE,
    question_order INTEGER NOT NULL,
    question_type question_type NOT NULL,
    question_text TEXT NOT NULL,
    time_limit INTEGER DEFAULT 20, -- seconds
    points INTEGER DEFAULT 1000,
    media_url VARCHAR(1000), -- Image/video URL
    config JSONB, -- Type-specific configuration
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(quiz_set_id, question_order)
);

CREATE INDEX idx_questions_quiz_set ON questions(quiz_set_id);

-- Example config structures:
-- Multiple choice: {"answers": [{"text": "Paris", "correct": true}, ...]}
-- Slider: {"min": 0, "max": 100, "correct_value": 42, "tolerance": 5}
-- Word cloud: {"max_words": 100}
```

#### 4.1.4 Sessions Table
```sql
CREATE TYPE session_mode AS ENUM ('quiz', 'poll', 'faq');
CREATE TYPE session_status AS ENUM ('scheduled', 'waiting', 'active', 'paused', 'completed', 'archived');

CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_set_id UUID REFERENCES quiz_sets(id) ON DELETE SET NULL,
    host_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_pin VARCHAR(8) UNIQUE NOT NULL, -- 6-8 digit join code
    session_mode session_mode NOT NULL,
    session_status session_status DEFAULT 'waiting',
    scheduled_start TIMESTAMP WITH TIME ZONE,
    actual_start TIMESTAMP WITH TIME ZONE,
    ended_at TIMESTAMP WITH TIME ZONE,
    current_question_id UUID REFERENCES questions(id),
    current_question_started_at TIMESTAMP WITH TIME ZONE,
    settings JSONB, -- Session-specific settings
    participant_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sessions_host ON sessions(host_id);
CREATE INDEX idx_sessions_pin ON sessions(session_pin);
CREATE INDEX idx_sessions_status ON sessions(session_status);

-- Example settings:
-- {"show_leaderboard": true, "randomize_answers": true, "allow_late_joins": false}
```

#### 4.1.5 Participants Table
```sql
CREATE TABLE participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    nickname VARCHAR(100) NOT NULL,
    device_fingerprint VARCHAR(255), -- Prevent duplicate joins
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    total_score INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(session_id, nickname)
);

CREATE INDEX idx_participants_session ON participants(session_id);
CREATE INDEX idx_participants_score ON participants(session_id, total_score DESC);
```

#### 4.1.6 Responses Table
```sql
CREATE TABLE responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    response_data JSONB NOT NULL, -- Flexible response storage
    is_correct BOOLEAN,
    points_awarded INTEGER DEFAULT 0,
    response_time_ms INTEGER, -- Milliseconds to answer
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(session_id, participant_id, question_id)
);

CREATE INDEX idx_responses_session ON responses(session_id);
CREATE INDEX idx_responses_question ON responses(question_id);
CREATE INDEX idx_responses_participant ON responses(participant_id);

-- Example response_data:
-- Multiple choice: {"selected": [0, 2]} (answer indices)
-- Type answer: {"text": "photosynthesis"}
-- Slider: {"value": 45}
-- Word cloud: {"text": "collaboration"}
```

#### 4.1.7 FAQ Questions Table (Mode 3)
```sql
CREATE TABLE faq_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    embedding vector(1536), -- For similarity clustering using pgvector
    cluster_id UUID, -- Groups similar questions
    is_processed BOOLEAN DEFAULT FALSE,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_faq_session ON faq_questions(session_id);
CREATE INDEX idx_faq_cluster ON faq_questions(cluster_id);
CREATE INDEX idx_faq_embedding ON faq_questions USING ivfflat (embedding vector_cosine_ops);
```

#### 4.1.8 FAQ Master Questions Table
```sql
CREATE TABLE faq_master_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    cluster_id UUID UNIQUE NOT NULL,
    master_question TEXT NOT NULL,
    source_question_ids UUID[] NOT NULL, -- Original questions
    generated_answer TEXT,
    upvotes INTEGER DEFAULT 0,
    downvotes INTEGER DEFAULT 0,
    is_published BOOLEAN DEFAULT FALSE,
    published_at TIMESTAMP WITH TIME ZONE,
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    llm_model VARCHAR(100), -- Track which model generated this
    processing_time_ms INTEGER
);

CREATE INDEX idx_master_session ON faq_master_questions(session_id);
CREATE INDEX idx_master_published ON faq_master_questions(is_published, session_id);
```

#### 4.1.9 RAG Documents Table

```sql
CREATE TYPE document_type AS ENUM (
    'lecture_slides',
    'lecture_notes',
    'syllabus',
    'reading',
    'textbook_excerpt',
    'previous_qa',
    'supplementary'
);

CREATE TABLE rag_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_set_id UUID REFERENCES quiz_sets(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_type document_type NOT NULL,
    title VARCHAR(500) NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB, -- Page numbers, lecture date, etc.
    file_url VARCHAR(1000), -- Original file location
    embedding vector(768), -- Document-level embedding
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_rag_quiz_set ON rag_documents(quiz_set_id);
CREATE INDEX idx_rag_owner ON rag_documents(owner_id);
CREATE INDEX idx_rag_type ON rag_documents(document_type);
CREATE INDEX idx_rag_embedding ON rag_documents USING ivfflat (embedding vector_cosine_ops);

-- Chunked documents for better RAG retrieval
CREATE TABLE rag_document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding vector(768) NOT NULL,
    metadata JSONB, -- Page, section, headers
    UNIQUE(document_id, chunk_index)
);

CREATE INDEX idx_chunk_document ON rag_document_chunks(document_id);
CREATE INDEX idx_chunk_embedding ON rag_document_chunks USING ivfflat (embedding vector_cosine_ops);
```

#### 4.1.10 Session Archives Table
```sql
CREATE TABLE session_archives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    host_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    archive_data JSONB NOT NULL, -- Complete session snapshot
    statistics JSONB, -- Aggregated metrics
    export_url VARCHAR(1000), -- Link to downloadable export
    archived_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_archives_host ON session_archives(host_id);
CREATE INDEX idx_archives_session ON session_archives(session_id);
```

### 4.2 Analytics Tables (TimescaleDB Hypertables)

```sql
-- Create extension for TimescaleDB
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE session_metrics (
    time TIMESTAMP WITH TIME ZONE NOT NULL,
    session_id UUID NOT NULL,
    metric_name VARCHAR(100) NOT NULL,
    metric_value DOUBLE PRECISION,
    metadata JSONB
);

SELECT create_hypertable('session_metrics', 'time');
CREATE INDEX idx_session_metrics_id ON session_metrics(session_id, time DESC);

-- Examples of metrics:
-- participation_rate, average_response_time, correct_answer_rate,
-- question_difficulty_score, faq_submission_rate
```

### 4.3 Redis Data Structures

```
# Active session state
session:{session_id}:state -> Hash
  {
    status: "active",
    current_question: "uuid",
    question_started_at: "timestamp",
    participant_count: 145
  }

# Real-time leaderboard
session:{session_id}:leaderboard -> Sorted Set
  {participant_id -> total_score}

# Response collection buffer
session:{session_id}:question:{question_id}:responses -> List
  [response_data, ...]

# FAQ question queue
session:{session_id}:faq:queue -> List
  [question_data, ...]

# Rate limiting
ratelimit:participant:{device_fp}:responses -> String (counter)
  TTL: 60 seconds

# Session join codes (temporary)
join:pin:{pin} -> session_id
  TTL: Session duration
```

---

## 5. API Design

### 5.1 RESTful API Endpoints

#### 5.1.1 Authentication

```
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
POST   /api/v1/auth/refresh
GET    /api/v1/auth/me
GET    /api/v1/auth/oidc/callback
```

#### 5.1.2 Quiz Management

```
GET    /api/v1/quizzes                    # List user's quizzes
POST   /api/v1/quizzes                    # Create new quiz set
GET    /api/v1/quizzes/:id                # Get quiz details
PUT    /api/v1/quizzes/:id                # Update quiz
DELETE /api/v1/quizzes/:id                # Delete quiz
POST   /api/v1/quizzes/:id/duplicate      # Clone quiz
GET    /api/v1/quizzes/:id/export         # Export as JSON

POST   /api/v1/quizzes/:id/questions      # Add question
PUT    /api/v1/questions/:id              # Update question
DELETE /api/v1/questions/:id              # Delete question
POST   /api/v1/questions/:id/reorder      # Change order

# RAG Document Management
POST   /api/v1/quizzes/:id/documents      # Upload document for RAG
GET    /api/v1/quizzes/:id/documents      # List documents
DELETE /api/v1/documents/:id              # Delete document
POST   /api/v1/documents/:id/reprocess    # Re-chunk and re-embed
```

#### 5.1.3 Session Management

```
POST   /api/v1/sessions                   # Create session
GET    /api/v1/sessions/:id               # Get session details
PUT    /api/v1/sessions/:id               # Update session
DELETE /api/v1/sessions/:id               # Cancel session
POST   /api/v1/sessions/:id/start         # Start session
POST   /api/v1/sessions/:id/pause         # Pause session
POST   /api/v1/sessions/:id/resume        # Resume session
POST   /api/v1/sessions/:id/end           # End session
POST   /api/v1/sessions/:id/next-question # Advance to next
GET    /api/v1/sessions/:id/results       # Get results
GET    /api/v1/sessions/:id/export        # Export results

# Participant join
POST   /api/v1/sessions/join/:pin         # Join with PIN
```

#### 5.1.4 FAQ Management

```
GET    /api/v1/sessions/:id/faq/questions        # List submitted questions
GET    /api/v1/sessions/:id/faq/masters          # Get master questions
POST   /api/v1/sessions/:id/faq/masters/:mid/vote # Vote on answer
PUT    /api/v1/sessions/:id/faq/masters/:mid     # Edit answer
POST   /api/v1/sessions/:id/faq/masters/:mid/publish # Publish to display
```

#### 5.1.5 Analytics

```
GET    /api/v1/analytics/sessions/:id     # Session analytics
GET    /api/v1/analytics/questions/:id    # Question performance
GET    /api/v1/analytics/dashboard        # Host dashboard stats
GET    /api/v1/analytics/knowledge-gaps   # Cross-session analysis
```

### 5.2 WebSocket Events

#### 5.2.1 Host Events

```javascript
// Outbound (Server -> Host)
{
  event: "participant:joined",
  data: { participant_id, nickname, participant_count }
}

{
  event: "participant:left",
  data: { participant_id, participant_count }
}

{
  event: "response:received",
  data: { participant_id, question_id, is_correct, response_time_ms }
}

{
  event: "question:summary",
  data: {
    question_id,
    responses_count,
    correct_count,
    answer_distribution: {...},
    average_time_ms
  }
}

{
  event: "faq:question:submitted",
  data: { question_id, participant_nickname, question_text, timestamp }
}

{
  event: "faq:master:generated",
  data: { master_question_id, master_question, answer, source_count }
}

// Inbound (Host -> Server)
{
  event: "session:start",
  data: { session_id }
}

{
  event: "question:show",
  data: { question_id }
}

{
  event: "question:close",
  data: { question_id }
}

{
  event: "leaderboard:show",
  data: { top_n: 10 }
}
```

#### 5.2.2 Participant Events

```javascript
// Outbound (Server -> Participant)
{
  event: "session:started",
  data: { session_id, mode, quiz_title }
}

{
  event: "question:show",
  data: {
    question_id,
    question_text,
    question_type,
    answers: [...],
    time_limit,
    media_url
  }
}

{
  event: "question:closed",
  data: { question_id }
}

{
  event: "answer:result",
  data: {
    question_id,
    is_correct,
    correct_answer,
    points_awarded,
    new_total_score,
    current_rank
  }
}

{
  event: "leaderboard:update",
  data: {
    leaderboard: [
      { rank, nickname, score, is_you }
    ],
    your_rank,
    your_score
  }
}

{
  event: "faq:published",
  data: { master_question, answer }
}

// Inbound (Participant -> Server)
{
  event: "answer:submit",
  data: { question_id, response_data, timestamp }
}

{
  event: "faq:submit",
  data: { question_text }
}
```

---

## 6. Security Architecture

### 6.1 Authentication & Authorization

#### 6.1.1 Host Authentication

**Primary Method: OIDC (OpenID Connect)**

- **Provider Options:**
  - University SSO (Shibboleth/SAML -> OIDC bridge)
  - Keycloak (self-hosted)
  - Auth0, Okta (managed services)

- **Flow:** Authorization Code Flow with PKCE
- **Token Storage:**
  - Access token: Memory only (short-lived, 15 min)
  - Refresh token: HttpOnly cookie (7 days)
- **Claims Required:** `sub`, `email`, `name`, `groups` (for role mapping)

**Fallback Method: OpenShift OAuth**

- For OpenShift-integrated deployments
- Uses OpenShift Service Accounts for programmatic access
- Maps OpenShift groups to Qaroot roles

**Implementation:**
```typescript
// JWT validation middleware
const validateHostToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  try {
    const decoded = await verifyOIDCToken(token, {
      issuer: process.env.OIDC_ISSUER,
      audience: process.env.OIDC_AUDIENCE
    });

    req.user = await getUserFromOIDCSubject(decoded.sub);
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};
```

#### 6.1.2 Participant Authentication

**Method: Stateless Session-Based**

- No traditional authentication required
- Participants join with session PIN + chosen nickname
- Device fingerprinting prevents duplicate joins
- Short-lived session tokens (duration of session only)

**Device Fingerprint Components:**
- IP address (hashed)
- User-Agent
- Screen resolution
- Timezone
- Canvas fingerprint (optional)

**Anti-Abuse Measures:**
- Rate limiting: 10 joins per device per hour
- Nickname validation: Profanity filter, length limits
- CAPTCHA for suspicious patterns

#### 6.1.3 Authorization Model

**Role-Based Access Control (RBAC)**

```
Roles:
  - admin: Full system access
  - host: Create/manage own quizzes and sessions
  - participant: Join sessions only (no persistent account)

Permissions:
  quiz:create -> host, admin
  quiz:read:own -> host, admin
  quiz:update:own -> host, admin
  quiz:delete:own -> host, admin

  session:create -> host, admin
  session:manage:own -> host, admin
  session:join -> participant (with valid PIN)

  faq:read:own-session -> host, admin
  analytics:read:own -> host, admin
  analytics:read:all -> admin
```

### 6.2 Data Security

#### 6.2.1 Encryption

**Data in Transit:**
- TLS 1.3 for all external connections
- Internal service mesh: mTLS (via Istio)
- WebSocket: WSS (WebSocket Secure)

**Data at Rest:**
- PostgreSQL: Transparent Data Encryption (TDE) via LUKS volumes
- Redis: AOF persistence on encrypted volumes
- MinIO: Server-Side Encryption (SSE-C)
- Secrets: OpenShift Secrets (encrypted etcd)

#### 6.2.2 Sensitive Data Handling

**PII Minimization:**
- Participant nicknames: Pseudonymous, not linked to identity
- Host emails: Hashed for analytics, raw only for auth
- IP addresses: Hashed with salt, retained 30 days

**Data Retention:**
- Active sessions: Real-time
- Completed sessions: 2 years (configurable)
- FAQ questions: 5 years (research purposes)
- Audit logs: 7 years (compliance)
- Participant device fingerprints: Session duration only

**GDPR Compliance:**
- Right to erasure: Cascade delete for host accounts
- Data portability: JSON export of all user data
- Consent management: Terms acceptance tracking
- Privacy by design: Minimal data collection

### 6.3 API Security

#### 6.3.1 Rate Limiting

```
Host Endpoints:
  - Authentication: 5 requests/minute/IP
  - Quiz CRUD: 100 requests/minute/user
  - Session management: 50 requests/minute/user

Participant Endpoints:
  - Join session: 10 requests/hour/device
  - Submit answer: 1 request/question/participant
  - Submit FAQ: 5 requests/minute/participant

WebSocket:
  - Connection attempts: 10/minute/IP
  - Message rate: 100 messages/minute/connection
```

**Implementation:** Redis-backed sliding window counters

#### 6.3.2 Input Validation

**All Inputs:**
- JSON schema validation (Ajv)
- SQL injection prevention: Parameterized queries only
- XSS prevention: DOMPurify for user content
- File uploads: MIME type verification, size limits (5MB)

**Specific Validations:**
```typescript
// Session PIN: 6-8 alphanumeric characters
const PIN_REGEX = /^[A-Z0-9]{6,8}$/;

// Nickname: 1-30 characters, alphanumeric + spaces
const NICKNAME_REGEX = /^[a-zA-Z0-9 ]{1,30}$/;

// Quiz title: 1-500 characters
const TITLE_MAX_LENGTH = 500;

// Question text: 1-2000 characters
const QUESTION_MAX_LENGTH = 2000;

// FAQ question: 10-1000 characters
const FAQ_MIN_LENGTH = 10;
const FAQ_MAX_LENGTH = 1000;
```

#### 6.3.3 CORS Configuration

```typescript
const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      /\.university\.edu$/, // University subdomains
      'http://localhost:3000' // Development only
    ];

    if (!origin || allowedOrigins.some(allowed =>
      typeof allowed === 'string' ? allowed === origin : allowed.test(origin)
    )) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  maxAge: 86400 // 24 hours
};
```

### 6.4 LLM Security

#### 6.4.1 Llama Guard Integration

**Llama Stack automatically applies Llama Guard 3 for:**
- **Input Filtering**: Detects prompt injections, jailbreak attempts, malicious instructions
- **Output Filtering**: Blocks inappropriate content, toxicity, PII leaks
- **Multi-category Safety**: Violence, hate speech, sexual content, self-harm, etc.

**Safety Categories Applied:**
```yaml
Categories:
  - S1: Violent Crimes
  - S2: Non-Violent Crimes
  - S3: Sex Crimes
  - S4: Child Exploitation
  - S5: Defamation
  - S6: Specialized Advice (medical, legal, financial)
  - S7: Privacy Violations
  - S8: Intellectual Property
  - S9: Indiscriminate Weapons
  - S10: Hate Speech
  - S11: Self-Harm
  - S12: Sexual Content
  - S13: Elections (misinformation)
```

**Additional Input Sanitization:**
```typescript
const sanitizeFAQQuestion = (text: string): string => {
  // Basic sanitization before Llama Guard
  // Remove excessive whitespace and normalize
  let sanitized = text.trim().replace(/\s+/g, ' ');

  // Length limits
  return sanitized.slice(0, FAQ_MAX_LENGTH);
};
```

**RAG-Enhanced FAQ Generation with Llama Stack:**
```typescript
const FAQ_SYSTEM_PROMPT = `You are an academic teaching assistant.
Analyze student questions and generate clear, accurate answers based on the provided course materials.
Always cite sources from the retrieved context.
Maintain professional, educational tone.`;

const generateFAQAnswerWithRAG = async (
  masterQuestion: string,
  quizSetId: string
) => {
  // Llama Stack handles RAG automatically
  const response = await llamaStackClient.inference.chatCompletion({
    model: 'Qwen/Qwen2.5-14B-Instruct',
    messages: [
      { role: 'system', content: FAQ_SYSTEM_PROMPT },
      { role: 'user', content: masterQuestion }
    ],
    // Llama Stack RAG configuration
    rag: {
      enabled: true,
      vector_db_ids: [`quiz_set_${quizSetId}`],
      top_k: 5,
      similarity_threshold: 0.7,
      include_citations: true
    },
    // Safety is automatically applied via Llama Guard
    safety: {
      enabled: true,
      shield: 'llama-guard-3'
    },
    max_tokens: 1000,
    temperature: 0.7
  });

  return response;
};
```

#### 6.4.2 Content Filtering

**Llama Guard 3 Automatic Filtering:**
- All inputs/outputs automatically filtered by Llama Guard 3
- Blocks unsafe content across 13 safety categories
- Returns safety violations with specific category codes

**Additional Validation:**
- Length limits: 50-2000 characters for answers
- Citation validation: Ensure answers reference provided documents
- Confidence scoring via RAG relevance scores

**Moderation Queue:**
- Llama Guard-flagged content requires host review
- Track safety violation rates and categories
- Host can override and approve flagged content
- Fallback to "Answer pending review" for violations

#### 6.4.3 Infrastructure Security

**Model Storage:**
- Models stored on persistent volumes with encryption at rest
- Access restricted to Llama Stack pods via RBAC
- Regular security scanning of container images

**API Access:**
- Internal ClusterIP service only (not exposed externally)
- Rate limiting: 100 requests/minute per session
- Request/response logging for audit trails

---

## 7. Scalability & Performance

### 7.1 Horizontal Scaling Strategy

#### 7.1.1 Service Scaling Profiles

```yaml
# OpenShift HorizontalPodAutoscaler configurations (Simplified Architecture)

API Service:
  replicas: 2-6
  target_cpu: 70%
  target_memory: 80%
  # Handles: Auth, Quiz, Session, Analytics

WebSocket Service:
  replicas: 3-10
  target_cpu: 50%
  custom_metric: connected_clients (target: 500/pod)
  # Handles: Real-time events for quiz, poll, FAQ

FAQ Worker Pool:
  replicas: 2-5
  target_cpu: 75%
  custom_metric: amq_queue_depth (scale_up: 50, scale_down: 10)
  # Handles: Background FAQ processing
```

#### 7.1.2 Database Scaling

**PostgreSQL:**
- Master-replica setup (1 master, 2 read replicas)
- Connection pooling: PgBouncer (transaction mode)
- Read queries route to replicas
- Write queries to master only

**Redis:**
- Redis Cluster mode (3 masters, 3 replicas)
- Sentinel for automatic failover
- Separate clusters for:
  - Session state (persistent)
  - Cache (volatile-lru eviction)
  - Rate limiting (volatile-ttl)

**TimescaleDB:**
- Separate instance from main PostgreSQL
- Continuous aggregates for common queries
- Data retention: 90 days detailed, 2 years aggregated

### 7.2 Performance Optimizations

#### 7.2.1 Caching Strategy

```
Layer 1 - CDN (CloudFlare/AWS CloudFront):
  - Static assets: 1 year
  - Quiz images/media: 30 days

Layer 2 - Redis Cache:
  - Session state: Session duration
  - User profiles: 15 minutes
  - Quiz definitions: 5 minutes
  - Leaderboards: Real-time (no TTL, invalidate on update)

Layer 3 - Application Memory:
  - Active session config: In-memory for duration
  - Question data: Preloaded at session start
```

#### 7.2.2 WebSocket Optimization

**Connection Management:**
- Sticky sessions via IP hash (HAProxy)
- Connection pooling: Redis pub/sub for cross-pod communication
- Heartbeat: 30s interval
- Automatic reconnection with exponential backoff

**Message Optimization:**
- Binary protocol for large payloads (msgpack)
- Batch updates: Leaderboard every 2s (not per answer)
- Selective broadcasting: Only send to relevant participants
- Compression: Per-message deflate for text >1KB

#### 7.2.3 Database Optimization

**Indexing Strategy:**
- Analyzed all query patterns (see schema section)
- Composite indexes for common filters
- Partial indexes for active sessions only
- GIN indexes for JSONB and array columns

**Query Optimization:**
```sql
-- Example: Leaderboard query with pre-aggregation
CREATE MATERIALIZED VIEW session_leaderboard AS
SELECT
  session_id,
  participant_id,
  SUM(points_awarded) as total_score,
  COUNT(*) as questions_answered,
  AVG(response_time_ms) as avg_response_time
FROM responses
GROUP BY session_id, participant_id;

CREATE UNIQUE INDEX ON session_leaderboard(session_id, participant_id);
CREATE INDEX ON session_leaderboard(session_id, total_score DESC);

-- Refresh strategy: CONCURRENTLY on each question completion
REFRESH MATERIALIZED VIEW CONCURRENTLY session_leaderboard;
```

**Connection Management:**
- Pool size: 25 connections per service pod
- Idle timeout: 10 minutes
- Max lifetime: 1 hour (prevent stale connections)

### 7.3 Load Testing Targets

```
Scenario 1: Small Class (50 participants)
  - Concurrent users: 50
  - Response time: p95 < 200ms
  - WebSocket latency: p95 < 100ms

Scenario 2: Large Lecture (500 participants)
  - Concurrent users: 500
  - Response time: p95 < 500ms
  - WebSocket latency: p95 < 200ms

Scenario 3: Multi-Session (10 sessions x 200 participants)
  - Concurrent users: 2000
  - Response time: p95 < 1s
  - WebSocket latency: p95 < 300ms

Scenario 4: Peak Load (5000 participants, single session)
  - Concurrent users: 5000
  - Response time: p95 < 2s
  - WebSocket latency: p95 < 500ms
  - Successful connection rate: >99%
```

**Tools:** k6, Artillery, or custom Go-based load generator

---

## 8. OpenShift Deployment

### 8.1 Container Images

```dockerfile
# Example: Node.js service Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

FROM node:20-alpine
RUN apk add --no-cache dumb-init
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
USER node
EXPOSE 3000
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]

# Health checks
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD node healthcheck.js || exit 1
```

### 8.2 OpenShift Resources

#### 8.2.1 Namespace Structure

```
qaroot-dev
qaroot-staging
qaroot-production
qaroot-monitoring (shared)
```

#### 8.2.2 Deployment Configuration

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: session-service
  namespace: qaroot-production
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: session-service
  template:
    metadata:
      labels:
        app: session-service
        version: v1.2.0
    spec:
      containers:
      - name: session-service
        image: quay.io/qaroot/session-service:v1.2.0
        ports:
        - containerPort: 3000
          name: http
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: postgres-credentials
              key: connection-string
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: redis-credentials
              key: connection-string
        - name: NODE_ENV
          value: "production"
        resources:
          requests:
            cpu: 100m
            memory: 256Mi
          limits:
            cpu: 500m
            memory: 512Mi
        livenessProbe:
          httpGet:
            path: /health/live
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 5
```

#### 8.2.3 Service Mesh Configuration

```yaml
apiVersion: v1
kind: Service
metadata:
  name: session-service
  namespace: qaroot-production
spec:
  selector:
    app: session-service
  ports:
  - name: http
    port: 80
    targetPort: 3000
  type: ClusterIP

---
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: session-service
  namespace: qaroot-production
spec:
  hosts:
  - session-service
  http:
  - timeout: 30s
    retries:
      attempts: 3
      perTryTimeout: 10s
      retryOn: 5xx,reset,connect-failure
    route:
    - destination:
        host: session-service
        port:
          number: 80
```

#### 8.2.4 Ingress/Route

```yaml
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: qaroot-api
  namespace: qaroot-production
spec:
  host: api.qaroot.university.edu
  to:
    kind: Service
    name: session-service
  port:
    targetPort: http
  tls:
    termination: edge
    insecureEdgeTerminationPolicy: Redirect
    certificate: |
      -----BEGIN CERTIFICATE-----
      [Certificate content]
      -----END CERTIFICATE-----
    key: |
      -----BEGIN PRIVATE KEY-----
      [Key content]
      -----END PRIVATE KEY-----
```

### 8.3 Persistent Storage

```yaml
# PostgreSQL Persistent Volume Claim
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-data
  namespace: qaroot-production
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 100Gi
  storageClassName: gp3-csi # AWS EBS, or OpenShift storage class

---
# StatefulSet for PostgreSQL
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: qaroot-production
spec:
  serviceName: postgres
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
      - name: postgres
        image: postgres:15-alpine
        ports:
        - containerPort: 5432
          name: postgres
        env:
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: postgres-credentials
              key: password
        - name: POSTGRES_DB
          value: qaroot
        - name: PGDATA
          value: /var/lib/postgresql/data/pgdata
        volumeMounts:
        - name: postgres-data
          mountPath: /var/lib/postgresql/data
        resources:
          requests:
            cpu: 500m
            memory: 1Gi
          limits:
            cpu: 2000m
            memory: 4Gi
  volumeClaimTemplates:
  - metadata:
      name: postgres-data
    spec:
      accessModes: [ "ReadWriteOnce" ]
      storageClassName: gp3-csi
      resources:
        requests:
          storage: 100Gi
```

### 8.4 CI/CD Pipeline (Tekton)

```yaml
apiVersion: tekton.dev/v1beta1
kind: Pipeline
metadata:
  name: qaroot-build-deploy
  namespace: qaroot-cicd
spec:
  params:
  - name: git-url
    type: string
  - name: git-revision
    type: string
    default: main
  - name: image-name
    type: string
  - name: deployment-namespace
    type: string

  workspaces:
  - name: shared-workspace

  tasks:
  - name: fetch-repository
    taskRef:
      name: git-clone
    workspaces:
    - name: output
      workspace: shared-workspace
    params:
    - name: url
      value: $(params.git-url)
    - name: revision
      value: $(params.git-revision)

  - name: run-tests
    taskRef:
      name: npm-test
    workspaces:
    - name: source
      workspace: shared-workspace
    runAfter:
    - fetch-repository

  - name: build-image
    taskRef:
      name: buildah
    workspaces:
    - name: source
      workspace: shared-workspace
    params:
    - name: IMAGE
      value: $(params.image-name):$(tasks.fetch-repository.results.commit)
    runAfter:
    - run-tests

  - name: deploy-to-openshift
    taskRef:
      name: openshift-client
    params:
    - name: SCRIPT
      value: |
        oc set image deployment/session-service \
          session-service=$(params.image-name):$(tasks.fetch-repository.results.commit) \
          -n $(params.deployment-namespace)
        oc rollout status deployment/session-service -n $(params.deployment-namespace)
    runAfter:
    - build-image
```

### 8.5 vLLM and Llama Stack Deployment

The architecture uses **separate vLLM deployments** for each model, with Llama Stack orchestrating them.

#### 8.5.1 vLLM Deployment for Qwen2.5-14B (Primary Model)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vllm-qwen-14b
  namespace: qaroot-production
spec:
  replicas: 2  # For HA
  selector:
    matchLabels:
      app: vllm-qwen
  template:
    metadata:
      labels:
        app: vllm-qwen
    spec:
      nodeSelector:
        nvidia.com/gpu: "true"
      containers:
      - name: vllm
        image: vllm/vllm-openai:latest
        args:
        - --model
        - Qwen/Qwen2.5-14B-Instruct
        - --tensor-parallel-size
        - "1"
        - --max-model-len
        - "8192"
        - --gpu-memory-utilization
        - "0.90"
        - --port
        - "8000"
        - --trust-remote-code
        ports:
        - containerPort: 8000
          name: http
        resources:
          requests:
            nvidia.com/gpu: 1
            memory: 32Gi
            cpu: 4
          limits:
            nvidia.com/gpu: 1
            memory: 48Gi
            cpu: 8
        livenessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 300
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 300
          periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: vllm-qwen-service
  namespace: qaroot-production
spec:
  selector:
    app: vllm-qwen
  ports:
  - name: http
    port: 8000
    targetPort: 8000
  type: ClusterIP
```

#### 8.5.2 vLLM Deployment for Llama Guard 3 (Safety)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vllm-llama-guard
  namespace: qaroot-production
spec:
  replicas: 2  # Safety is critical
  selector:
    matchLabels:
      app: vllm-guard
  template:
    metadata:
      labels:
        app: vllm-guard
    spec:
      nodeSelector:
        nvidia.com/gpu: "true"
      containers:
      - name: vllm
        image: vllm/vllm-openai:latest
        args:
        - --model
        - meta-llama/Llama-Guard-3-8B
        - --tensor-parallel-size
        - "1"
        - --max-model-len
        - "4096"
        - --gpu-memory-utilization
        - "0.70"
        - --port
        - "8000"
        ports:
        - containerPort: 8000
          name: http
        resources:
          requests:
            nvidia.com/gpu: 1
            memory: 18Gi
            cpu: 2
          limits:
            nvidia.com/gpu: 1
            memory: 24Gi
            cpu: 4
        livenessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 200
          periodSeconds: 30
---
apiVersion: v1
kind: Service
metadata:
  name: vllm-guard-service
  namespace: qaroot-production
spec:
  selector:
    app: vllm-guard
  ports:
  - name: http
    port: 8000
    targetPort: 8000
  type: ClusterIP
```

#### 8.5.3 Llama Stack Orchestration Layer

Llama Stack connects to the separate vLLM services and provides a unified API.

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: llama-stack-config
  namespace: qaroot-production
data:
  config.yaml: |
    version: 2

    # Inference: Connect to remote vLLM service for Qwen
    inference:
      provider: remote::vllm
      config:
        url: http://vllm-qwen-service:8000/v1
        api_token: null

    # Embeddings: Run internally in Llama Stack
    embeddings:
      provider: sentence-transformers
      config:
        model: nomic-ai/nomic-embed-text-v1.5
        dimension: 768
        max_batch_size: 32

    # Safety: Connect to remote vLLM service for Llama Guard
    safety:
      provider: remote::vllm
      config:
        url: http://vllm-guard-service:8000/v1
        api_token: null

    # Memory: Store in PostgreSQL
    memory:
      provider: postgres
      config:
        host: postgres-service
        port: 5432
        database: qaroot

    # Vector DB: Use pgvector for RAG
    vector_db:
      provider: pgvector
      config:
        host: postgres-service
        port: 5432
        database: qaroot

    # RAG Retrieval settings
    retrieval:
      chunk_size: 512
      chunk_overlap: 50
      top_k: 5
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: llama-stack
  namespace: qaroot-production
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
        resources:
          requests:
            memory: 8Gi
            cpu: 4
          limits:
            memory: 16Gi
            cpu: 8
        livenessProbe:
          httpGet:
            path: /health
            port: 5000
          initialDelaySeconds: 400
          periodSeconds: 30
        readinessProbe:
          httpGet:
            path: /health
            port: 5000
          initialDelaySeconds: 400
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
  namespace: qaroot-production
spec:
  selector:
    app: llama-stack
  ports:
  - name: http
    port: 5000
    targetPort: 5000
  type: ClusterIP

# Note: Embeddings are now handled by Llama Stack (sentence-transformers provider)
# No separate embedding service deployment needed
```

#### 8.5.4 Deployment Architecture Summary

**Total GPU Requirements:**
- **Qwen2.5-14B**: 2 replicas × 1 GPU = **2 GPUs** (A100 40GB or L40S recommended)
- **Llama Guard 3**: 2 replicas × 1 GPU = **2 GPUs** (L4 or T4 acceptable)
- **Total: 4 GPUs minimum** for production deployment

**Architecture Benefits:**
- ✅ **vLLM and Llama Stack are separate**: vLLM provides inference, Llama Stack orchestrates
- ✅ **Independent scaling**: Scale vLLM inference pods without restarting Llama Stack
- ✅ **High availability**: Qwen and Guard both have 2 replicas for redundancy
- ✅ **Resource isolation**: Inference models don't compete for GPU memory
- ✅ **Unified API**: Llama Stack provides single endpoint for all AI operations
- ✅ **Safety always on**: Llama Guard has 2 replicas for critical safety filtering

**Request Flow:**
```
Application
    ↓
Llama Stack API (http://llama-stack:5000)
    ↓
    ├──[Inference Request]──→ vllm-qwen-service:8000      (Qwen inference via OpenAI API)
    ├──[Safety Check]───────→ vllm-guard-service:8000     (Llama Guard via OpenAI API)
    ├──[Embeddings]─────────→ Internal (sentence-transformers in Llama Stack)
    └──[RAG/Memory]─────────→ PostgreSQL + pgvector
```

**Key Architecture Points:**
- vLLM services expose OpenAI-compatible APIs
- Llama Stack connects to vLLM as remote providers
- Embeddings run inside Llama Stack (no GPU needed)
- RAG retrieval uses pgvector in PostgreSQL

**Node Affinity Strategy:**
- Use `nodeSelector: nvidia.com/gpu: "true"` to place vLLM pods on GPU nodes
- Consider node taints/tolerations to dedicate nodes to specific models
- Example: Dedicate 2 nodes with A100s for Qwen, 1 node with L4s for Guard
- Llama Stack pods don't need GPUs (embeddings run on CPU)

---

## 9. Monitoring & Observability

### 9.1 Metrics (Prometheus)

#### 9.1.1 Application Metrics

```typescript
// Example: Prometheus metrics in Node.js service
import client from 'prom-client';

// Default metrics (CPU, memory, etc.)
client.collectDefaultMetrics();

// Custom business metrics
const sessionGauge = new client.Gauge({
  name: 'qaroot_active_sessions_total',
  help: 'Number of currently active sessions'
});

const participantGauge = new client.Gauge({
  name: 'qaroot_active_participants_total',
  help: 'Number of currently active participants',
  labelNames: ['session_id']
});

const responseHistogram = new client.Histogram({
  name: 'qaroot_response_time_ms',
  help: 'Response submission time in milliseconds',
  labelNames: ['question_type'],
  buckets: [100, 500, 1000, 2000, 5000, 10000]
});

const faqProcessingHistogram = new client.Histogram({
  name: 'qaroot_faq_processing_time_ms',
  help: 'FAQ LLM processing time in milliseconds',
  buckets: [1000, 2000, 5000, 10000, 20000, 30000]
});

const llmErrorCounter = new client.Counter({
  name: 'qaroot_llm_errors_total',
  help: 'Total number of LLM API errors',
  labelNames: ['provider', 'error_type']
});
```

#### 9.1.2 Key Metrics to Track

```
# System Health
- CPU/Memory usage per service
- Pod restart count
- Network I/O

# Application Performance
- API endpoint latency (p50, p95, p99)
- WebSocket message latency
- Database query duration
- Cache hit rate

# Business Metrics
- Active sessions (gauge)
- Active participants per session (gauge)
- Questions asked per hour (counter)
- Responses submitted (counter)
- FAQ questions processed (counter)
- LLM API calls (counter)
- Session completion rate (histogram)

# Error Rates
- HTTP 5xx errors (counter)
- WebSocket connection failures (counter)
- Database connection errors (counter)
- LLM API failures (counter)
```

### 9.2 Logging (EFK Stack)

#### 9.2.1 Log Structure (JSON)

```json
{
  "timestamp": "2025-10-01T14:32:15.123Z",
  "level": "info",
  "service": "session-service",
  "pod": "session-service-7d9f6c8b4-xk2p9",
  "trace_id": "a3c5e7b9d2f4a1c8",
  "span_id": "d2f4a1c8e7b9",
  "event": "session.started",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "host_id": "123e4567-e89b-12d3-a456-426614174000",
  "metadata": {
    "quiz_set_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "mode": "quiz",
    "participant_limit": 500
  }
}
```

#### 9.2.2 Log Levels

```
ERROR: System errors, unhandled exceptions, LLM failures
WARN:  Degraded performance, retries, quota warnings
INFO:  Session lifecycle, question transitions, FAQ generation
DEBUG: Detailed request/response, WebSocket messages (dev only)
```

#### 9.2.3 Log Retention

```
- Elasticsearch hot tier: 7 days (fast queries)
- Elasticsearch warm tier: 30 days (slower queries)
- S3 archive: 1 year (compliance, rarely accessed)
```

### 9.3 Distributed Tracing (Jaeger)

```typescript
// OpenTelemetry instrumentation
import { NodeSDK } from '@opentelemetry/sdk-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';

const sdk = new NodeSDK({
  traceExporter: new JaegerExporter({
    endpoint: 'http://jaeger-collector:14268/api/traces'
  }),
  serviceName: 'session-service'
});

sdk.start();

// Example: Trace session creation flow
const tracer = trace.getTracer('session-service');

const span = tracer.startSpan('create_session');
span.setAttribute('user_id', userId);
span.setAttribute('quiz_set_id', quizSetId);

try {
  // Create session logic
  const session = await createSession(quizSetId);
  span.setAttribute('session_id', session.id);
  span.setStatus({ code: SpanStatusCode.OK });
} catch (error) {
  span.recordException(error);
  span.setStatus({ code: SpanStatusCode.ERROR });
} finally {
  span.end();
}
```

### 9.4 Alerting Rules

```yaml
# Prometheus AlertManager rules
groups:
- name: qaroot-critical
  interval: 30s
  rules:

  - alert: HighErrorRate
    expr: |
      (sum(rate(http_requests_total{status=~"5.."}[5m])) by (service)
      / sum(rate(http_requests_total[5m])) by (service)) > 0.05
    for: 5m
    labels:
      severity: critical
    annotations:
      summary: "High error rate on {{ $labels.service }}"
      description: "Error rate is {{ $value | humanizePercentage }}"

  - alert: SessionServiceDown
    expr: up{job="session-service"} == 0
    for: 2m
    labels:
      severity: critical
    annotations:
      summary: "Session service is down"

  - alert: DatabaseConnectionPoolExhausted
    expr: database_connections_active / database_connections_max > 0.9
    for: 3m
    labels:
      severity: warning
    annotations:
      summary: "Database connection pool nearly exhausted"

  - alert: LLMAPIHighLatency
    expr: |
      histogram_quantile(0.95,
        rate(qaroot_faq_processing_time_ms_bucket[5m])
      ) > 15000
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "LLM API latency is high (p95 > 15s)"

  - alert: ActiveSessionsSpike
    expr: |
      rate(qaroot_active_sessions_total[5m]) >
      avg_over_time(qaroot_active_sessions_total[1h]) * 2
    for: 5m
    labels:
      severity: info
    annotations:
      summary: "Unusual spike in active sessions (potential autoscaling trigger)"
```

---

## 10. Development & Deployment Workflow

### 10.1 Development Environment

```bash
# docker-compose.yml for local development
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: qaroot_dev
      POSTGRES_PASSWORD: dev_password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  amq:
    image: registry.redhat.io/amq7/amq-broker-rhel8:latest
    ports:
      - "5672:5672"      # AMQP
      - "8161:8161"      # Web Console
      - "61616:61616"    # OpenWire
    environment:
      AMQ_USER: admin
      AMQ_PASSWORD: admin
      AMQ_ROLE: admin
      AMQ_NAME: broker
      AMQ_TRANSPORTS: openwire,amqp,stomp,mqtt,hornetq
      AMQ_QUEUES: faq.aggregate.queue,faq.llm.queue,faq.answer.queue,faq.analysis.queue
      AMQ_REQUIRE_LOGIN: true

  minio:
    image: minio/minio
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      MINIO_ROOT_USER: dev
      MINIO_ROOT_PASSWORD: dev_password
    command: server /data --console-address ":9001"
    volumes:
      - minio_data:/data

volumes:
  postgres_data:
  minio_data:
```

### 10.2 Environment Configuration

```bash
# .env.example
NODE_ENV=development

# Database
DATABASE_URL=postgresql://postgres:dev_password@localhost:5432/qaroot_dev
DATABASE_POOL_SIZE=10

# Redis
REDIS_URL=redis://localhost:6379
REDIS_CACHE_URL=redis://localhost:6379/1
REDIS_RATE_LIMIT_URL=redis://localhost:6379/2

# Red Hat AMQ
AMQ_URL=amqp://admin:admin@localhost:5672
AMQ_MANAGEMENT_URL=http://localhost:8161

# Object Storage
MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=dev
MINIO_SECRET_KEY=dev_password
MINIO_BUCKET=qaroot-dev

# Authentication
OIDC_ISSUER=https://sso.university.edu/auth/realms/qaroot
OIDC_CLIENT_ID=qaroot-dev
OIDC_CLIENT_SECRET=secret_here
OIDC_REDIRECT_URI=http://localhost:3000/auth/callback

# LLM Integration (Llama Stack - connects to vLLM)
LLAMA_STACK_API_BASE=http://llama-stack:5000
LLAMA_STACK_MODEL=Qwen/Qwen2.5-14B-Instruct
LLAMA_STACK_EMBEDDING_MODEL=nomic-ai/nomic-embed-text-v1.5

# vLLM Services (for reference, accessed via Llama Stack)
VLLM_QWEN_URL=http://vllm-qwen-service:8000/v1
VLLM_GUARD_URL=http://vllm-guard-service:8000/v1

# RAG Configuration
RAG_CHUNK_SIZE=512
RAG_CHUNK_OVERLAP=50
RAG_TOP_K=5
RAG_SIMILARITY_THRESHOLD=0.7

# Frontend
FRONTEND_URL=http://localhost:3001
WS_URL=ws://localhost:3000

# Monitoring
PROMETHEUS_PORT=9090
JAEGER_ENDPOINT=http://localhost:14268/api/traces
```

### 10.3 Git Workflow

```
Branching Strategy: GitFlow

main (production)
  └─ develop (staging)
      ├─ feature/quiz-builder-ui
      ├─ feature/faq-llm-integration
      └─ bugfix/leaderboard-race-condition

Commit Convention: Conventional Commits
  feat: Add word cloud question type
  fix: Resolve WebSocket reconnection loop
  docs: Update API documentation
  refactor: Extract LLM service interface
  test: Add integration tests for session lifecycle
  chore: Update dependencies

Pull Request Requirements:
  - All tests passing
  - Code coverage > 80%
  - No security vulnerabilities (Snyk scan)
  - Approved by 1 reviewer
  - Updated documentation
```

### 10.4 Testing Strategy

```
Unit Tests:
  - Framework: Jest (Node.js), pytest (Python)
  - Coverage target: 80%
  - Run on every commit (pre-commit hook)

Integration Tests:
  - Framework: Supertest (API), Playwright (E2E)
  - Database: Testcontainers (ephemeral Postgres)
  - Run on every PR

Load Tests:
  - Framework: k6
  - Scenarios: See section 7.3
  - Run weekly on staging, before major releases

Security Tests:
  - SAST: SonarQube (code analysis)
  - DAST: OWASP ZAP (dynamic scanning)
  - Dependency scanning: Snyk, npm audit
  - Container scanning: Trivy
  - Run on every PR and nightly
```

---

## 11. FAQ & Open Questions

### 11.1 Answered in This Spec

**Q: How will we authenticate hosts?**
**A:** Primary method is OIDC (OpenID Connect) integrated with university SSO. Fallback to OpenShift OAuth for OpenShift-native deployments. See section 6.1.1.

**Q: Should we generate a QR code when creating a new session?**
**A:** Yes. QR codes will be generated on session creation, encoding the session PIN and join URL. Implementation using `qrcode.react` on frontend. QR displayed prominently in host interface for projection to students.

**Q: What happens when a session is finished?**
**A:** Sessions transition to `completed` status. Automatically archived to `session_archives` table with full snapshot (questions, responses, statistics). Host can access archives in their account dashboard indefinitely (subject to retention policy). Export as JSON/CSV available.

**Q: How is a session started?**
**A:** Two modes:
1. **Immediate Start:** Host creates session and clicks "Start Now" - transitions to `waiting` (lobby), then `active` when host advances to first question.
2. **Scheduled Start:** (Future enhancement) Host sets `scheduled_start` timestamp. Session auto-transitions to `waiting` at that time. Host still controls transition to `active`.

### 11.2 Questions for Stakeholders

1. **Institution Integration:**
   - Which OIDC provider will university use? (Keycloak, Shibboleth bridge, commercial?)
   - Are there existing branding guidelines (colors, logos, fonts)?
   - LMS integration required (Canvas, Blackboard)? Export grades?

2. **LLM Infrastructure:**
   - GPU allocation for vLLM: Minimum 1x A100 (40GB) or 2x L40S recommended
   - Model preference: Qwen2.5-14B (requires ~28GB VRAM) or Llama-3.1-8B (requires ~16GB VRAM)?
   - Concurrent session capacity: Target inference throughput requirements
   - Privacy advantage: All inference on-premise, no data leaves infrastructure

3. **Data Governance:**
   - IRB approval needed for storing student responses for research?
   - FERPA compliance requirements?
   - Data residency requirements (must stay in specific geographic region)?
   - Can anonymized data be shared with education researchers?

4. **Feature Prioritization:**
   - Which question types are MVP vs. future enhancements?
   - Priority: Mobile app (React Native) or mobile-optimized web?
   - Accessibility requirements (WCAG 2.1 AA minimum)?
   - Internationalization: Languages to support beyond English?

5. **Operational:**
   - Who manages OpenShift cluster? (University IT, dedicated DevOps team?)
   - Backup/disaster recovery RPO/RTO targets?
   - Support model: Self-service documentation vs. helpdesk?
   - Release cadence: Weekly, bi-weekly, monthly?

---

## 12. Roadmap & Future Enhancements

### Phase 1: MVP 
- [x] Core architecture design (this document)
- [ ] OpenShift cluster setup
- [ ] User authentication (OIDC)
- [ ] Quiz builder (multiple choice, true/false only)
- [ ] Session management (create, start, end)
- [ ] Real-time quiz mode with leaderboard
- [ ] Basic participant interface (web only)
- [ ] Simple analytics dashboard

### Phase 2: Enhanced Pedagogy
- [ ] Polling mode (sentiment checks)
- [ ] FAQ mode with LLM integration
- [ ] Additional question types (type answer, slider)
- [ ] Session scheduling
- [ ] Detailed analytics (knowledge gap analysis)
- [ ] Export functionality (JSON, CSV)

### Phase 3: Scale & Polish 
- [ ] Mobile app (React Native)
- [ ] Advanced word cloud visualization
- [ ] Multi-language support
- [ ] LMS integration (Canvas)
- [ ] Advanced LLM features (context-aware answers)
- [ ] Comprehensive load testing & optimization

---

## 13. Appendices

### Appendix A: Technology Alternatives Considered

| Category | Chosen | Alternatives Considered | Rationale |
|----------|--------|-------------------------|-----------|
| Backend Runtime | Node.js | Python (FastAPI), Go | Async I/O for WebSockets, ecosystem |
| Database | PostgreSQL | MongoDB, CockroachDB | ACID, pgvector, TimescaleDB compat |
| Message Queue | Red Hat AMQ | Kafka, RabbitMQ | Red Hat support, enterprise features |
| Real-time | Socket.io | Native WebSocket, SSE | Fallbacks, Redis adapter |
| Frontend | React | Vue, Svelte | Ecosystem, React Native reuse |
| LLM Stack | Llama Stack | LangChain, LlamaIndex | Unified API: inference, RAG, safety, memory |
| LLM Serving | vLLM (separate) | TGI, Ollama | Highest throughput, independent scaling |
| LLM Model | Qwen2.5-14B | Llama-3.x, Mistral, GPT-4 | Best instruction-following, multilingual |
| Safety | Llama Guard 3 | OpenAI Moderation, Custom | Native vLLM integration, 13 categories |
| Embeddings | nomic-embed-text | BGE, E5, OpenAI | Open-source, efficient, runs in Stack |

### Appendix B: References

**Inspiration Projects:**
- [ClassQuiz](https://classquiz.de/) - Open-source Kahoot alternative
- [Supabase Kahoot Alternative](https://github.com/supabase-community/kahoot-alternative)

**Technical Documentation:**
- [OpenShift Documentation](https://docs.openshift.com/)
- [Llama Stack Documentation](https://llama-stack.readthedocs.io/)
- [vLLM Documentation](https://docs.vllm.ai/)
- [Llama Guard 3](https://ai.meta.com/research/publications/llama-guard-3/)
- [Socket.io Scalability Guide](https://socket.io/docs/v4/using-multiple-nodes/)
- [PostgreSQL High Availability](https://www.postgresql.org/docs/15/high-availability.html)
- [pgvector Documentation](https://github.com/pgvector/pgvector)

**Standards & Compliance:**
- WCAG 2.1 (Web Accessibility)
- GDPR (Data Protection)
- FERPA (Student Privacy)
- OWASP Top 10 (Security)

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-10-01 | Claude (AI Assistant) | Initial specification based on project briefing |

**Review Schedule:** Quarterly or upon major requirement changes

**Approval Required From:**
- [ ] Philip (Project Lead)
- [ ] Guillaume (Project Support)

---

**End of Document**