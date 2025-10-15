# QARoot MVP

AI-powered question aggregation and analysis tool for live presentations.

## Quick Start (Local Development with Podman)

### Prerequisites
- Node.js 20+
- Podman
- OpenSSL (for generating secrets)

### 1. Start Infrastructure Services

**Option A: Using podman-compose (if installed)**
```bash
# Install podman-compose first: pip3 install podman-compose
podman-compose up -d
podman-compose ps
```

**Option B: Using Podman directly (no compose needed)**
```bash
# Use the provided script
./start-podman.sh

# Check status
podman pod ps
podman ps
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up Environment

```bash
# Copy env files to each service
cp .env.example backend/api-service/.env
cp .env.example backend/websocket-service/.env
cp .env.example backend/faq-worker-pool/.env
cp .env.example frontend/.env

# Generate secure secrets (optional, defaults work for dev)
echo "JWT_SECRET=$(openssl rand -base64 32)" >> backend/api-service/.env
echo "SESSION_SECRET=$(openssl rand -base64 32)" >> backend/api-service/.env
```

### 4. Build the Project

```bash
npm run build
```

### 5. Run Database Migrations

```bash
export DATABASE_URL="postgresql://qaroot:changeme@localhost:5432/qaroot_mvp"
npm run migrate --workspace=backend/shared
```

### 6. Start All Services

```bash
npm run dev
```

This starts:
- **API Service** on `http://localhost:3000`
- **WebSocket Service** on `http://localhost:3001`
- **FAQ Worker Pool** (background)
- **Frontend** on `http://localhost:5173`

### 7. Access the Application

Open: **http://localhost:5173**

Login:
- Username: `admin`
- Password: `changeme123`

## Project Structure

```
qaroot-mvp/
├── backend/
│   ├── api-service/         # REST API service
│   ├── websocket-service/   # Real-time WebSocket service
│   ├── faq-worker-pool/     # Question analysis worker
│   └── shared/              # Shared types and utilities
├── frontend/                # React + Vite + PatternFly 6
├── deployment/
│   ├── openshift/          # OpenShift manifests
│   └── helm/               # Helm charts
└── docs/                   # Documentation
```

## Testing the Application

### As Host (Presenter)
1. Login → Create Session → Copy PIN
2. Start Collection (60 second timer)
3. Wait for participant questions
4. End Collection → Analyze Questions
5. View clustered questions by topic

### As Participant (Audience)
1. Open `http://localhost:5173/join/{PIN}`
2. Enter nickname (optional)
3. Submit questions (max 500 chars)

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for detailed development instructions.

### Common Local Development Issues

**Port Already in Use:**
```bash
# Check what's using the port
lsof -i :5432  # PostgreSQL
lsof -i :6379  # Redis
lsof -i :5672  # RabbitMQ

# Stop existing Podman containers
podman pod stop qaroot-mvp
podman pod rm qaroot-mvp
```

**Database Connection Failed:**
```bash
# Check PostgreSQL is running
podman ps | grep postgres

# Reset database
podman exec -it qaroot-postgres psql -U qaroot -d qaroot_mvp

# Re-run migrations
npm run migrate --workspace=backend/shared
```

**Analysis Not Working:**
```bash
# Check if worker pool is running
ps aux | grep worker-pool

# Check ActiveMQ Artemis is accessible
curl http://localhost:8161

# Check AMQ container
podman ps | grep amq

# Verify LLM config in .env files
grep EXTERNAL_LLM backend/faq-worker-pool/.env
```

## Deployment

### OpenShift

For complete OpenShift deployment instructions, see **[OPENSHIFT_DEPLOYMENT.md](OPENSHIFT_DEPLOYMENT.md)**

Quick start:
```bash
# 1. Create secrets (PostgreSQL, app credentials, LLM config)
oc create secret generic postgres-credentials \
  --from-literal=username='qaroot' \
  --from-literal=password="$(openssl rand -base64 24)" \
  --from-literal=database='qaroot_mvp' \
  --from-literal=host='postgresql'

# 2. Deploy infrastructure (PostgreSQL, Redis, RabbitMQ)
oc apply -f deployment/openshift/03-postgresql.yaml
oc apply -f deployment/openshift/04-redis.yaml
oc apply -f deployment/openshift/05-rabbitmq.yaml

# 3. Run migrations
oc apply -f deployment/openshift/06-db-migrations.yaml

# 4. Deploy application services
oc apply -f deployment/openshift/08-api-service.yaml
oc apply -f deployment/openshift/09-websocket-service.yaml
oc apply -f deployment/openshift/10-worker-pool.yaml
oc apply -f deployment/openshift/07-frontend.yaml
```

**Important Notes:**
- Embeddings are generated locally using transformers.js (no GPU needed)
- Clustering threshold should be set to `0.65` for optimal results
- Redis persistence is disabled to avoid write errors in containerized environments
- Full documentation: [OPENSHIFT_DEPLOYMENT.md](OPENSHIFT_DEPLOYMENT.md)

## Technology Stack

| Component | Technology |
|-----------|-----------|
| Frontend | React 19 + Vite + TypeScript + PatternFly 6 |
| Backend | Node.js 20 + TypeScript + Express |
| Real-time | Socket.io + Redis pub/sub |
| Database | PostgreSQL 15 |
| Queue | ActiveMQ Artemis (local) / RabbitMQ (OpenShift) |
| Embeddings | transformers.js (local CPU, 384 dimensions) |
| LLM | External LLM (OpenAI-compatible) for chat/summarization |
| Platform | Local (Podman) / OpenShift / Kubernetes |

## Key Features

- **Question Collection**: Timed collection windows (e.g., 60 seconds)
- **AI Clustering**: Groups similar questions using embeddings + cosine similarity
  - Embeddings generated locally on CPU using transformers.js (384 dimensions)
  - No external embedding service or GPU required
  - Optimal clustering threshold: 0.65
- **Topic Analysis**: AI-generated cluster labels and representative questions
- **Multi-iteration Sessions**: Ask new questions and analyze responses across multiple rounds
- **Host Chat**: AI assistant for analyzing question themes
- **Real-time Updates**: WebSocket for live participant/question feeds
- **Mobile-friendly**: PatternFly 6 responsive UI

## Stop Services

```bash
# Stop Node.js services (Ctrl+C in the terminal running npm run dev)

# Stop Podman services
podman-compose down

# Or if using start-podman.sh
./stop-podman.sh

# Remove volumes (clears database - WARNING: deletes all data)
podman-compose down -v
```

## Infrastructure Services Details

When you run `./start-podman.sh` or `podman-compose up -d`, the following services start:

- **PostgreSQL** (port 5432): Main database
  - Uses pgvector/pgvector:pg15 image
- **Redis** (port 6379): Session storage and WebSocket pub/sub
- **ActiveMQ Artemis** (ports 5672, 8161): Message queue for worker jobs
  - Web Console: http://localhost:8161 (admin/changeme)
  - AMQP port: 5672

All data is stored in persistent volumes that survive container restarts.

## License

MIT
