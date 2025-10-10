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

See [DEVELOPMENT.md](DEVELOPMENT.md) for:
- Running services individually
- Database access
- Troubleshooting
- Testing without LLM service

## Deployment

### OpenShift
```bash
# Using Helm
helm install qaroot deployment/helm/qaroot -n qaroot-mvp -f values-production.yaml

# Or manual deployment
oc apply -f deployment/openshift/
```

See deployment guides:
- [OpenShift Deployment](deployment/openshift/README.md)
- [Helm Chart](deployment/helm/qaroot/README.md)

## Technology Stack

| Component | Technology |
|-----------|-----------|
| Frontend | React 19 + Vite + TypeScript + PatternFly 6 |
| Backend | Node.js 20 + TypeScript + Express |
| Real-time | Socket.io + Redis pub/sub |
| Database | PostgreSQL 15 + pgvector |
| Queue | Red Hat AMQ (ActiveMQ Artemis) |
| LLM | Llama Stack + External LLM (OpenAI-compatible) |
| Platform | OpenShift / Kubernetes |

## Key Features

- **Question Collection**: Timed collection windows (e.g., 60 seconds)
- **AI Clustering**: Groups similar questions using embeddings + cosine similarity
- **Topic Analysis**: AI-generated cluster labels and representative questions
- **Host Chat**: AI assistant for analyzing question themes
- **Real-time Updates**: WebSocket for live participant/question feeds
- **Mobile-friendly**: PatternFly 6 responsive UI

## Stop Services

```bash
# Stop Node.js services (Ctrl+C)

# Stop Podman services
podman-compose down

# Remove volumes (clears database)
podman-compose down -v
```

## License

MIT
