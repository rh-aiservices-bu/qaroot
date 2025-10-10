# Local Development Guide

## Quick Start

### 1. Start Infrastructure

```bash
# Start PostgreSQL, Redis, and AMQ using podman-compose
podman-compose up -d

# Verify services are running
podman-compose ps
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up Environment Variables

```bash
# Copy example env files
cp .env.example backend/api-service/.env
cp .env.example backend/websocket-service/.env
cp .env.example backend/faq-worker-pool/.env
cp .env.example frontend/.env

# Generate secure secrets
echo "JWT_SECRET=$(openssl rand -base64 32)" >> backend/api-service/.env
echo "SESSION_SECRET=$(openssl rand -base64 32)" >> backend/api-service/.env
```

### 4. Run Database Migrations

```bash
export DATABASE_URL="postgresql://qaroot:changeme@localhost:5432/qaroot_mvp"
npm run migrate --workspace=backend/shared
```

### 5. Start All Services

```bash
# Start all services in development mode
npm run dev
```

This will start:
- **API Service** on `http://localhost:3000`
- **WebSocket Service** on `http://localhost:3001`
- **FAQ Worker Pool** (background)
- **Frontend** on `http://localhost:5173`

### 6. Access the Application

Open your browser to: **http://localhost:5173**

Login with:
- **Username**: `admin`
- **Password**: `changeme123`

## Without LLM Service (Mock Mode)

If you don't have access to an external LLM service, you can run in mock mode:

### Option 1: Skip AI Features
Just test question collection and clustering without AI analysis:
1. Create session
2. Submit questions
3. Clustering will use embeddings only (no AI labels/rephrasing)

### Option 2: Use OpenAI API
If you have an OpenAI API key:

```bash
# In backend/api-service/.env and backend/faq-worker-pool/.env
EXTERNAL_LLM_URL=https://api.openai.com/v1
EXTERNAL_LLM_API_KEY=sk-your-openai-api-key

# Update Llama Stack to use OpenAI
# (Or just call OpenAI directly from services)
```

## Testing Workflow

### Test as Host (Presenter)

1. Login at `http://localhost:5173`
2. Click **"Create Session"**
3. Enter title: "Test Q&A Session"
4. Copy the **PIN** (e.g., `ABC123`)
5. Click **"Start Collection"** (60 second timer)
6. Wait for questions to come in
7. Click **"End Collection"**
8. Click **"Analyze Questions"** (triggers clustering)
9. View clustered questions by topic

### Test as Participant (Audience)

1. Open new browser/incognito window
2. Go to `http://localhost:5173/join/ABC123` (use your PIN)
3. (Optional) Enter a nickname
4. Click **"Join"**
5. Type your question (max 500 chars)
6. Click **"Submit Question"**
7. See confirmation message

### Simulate Multiple Participants

```bash
# Use this script to simulate 10 participants submitting questions
curl -X POST http://localhost:3001 \
  -H "Content-Type: application/json" \
  -d '{
    "event": "question:submit",
    "data": {
      "session_id": "YOUR_SESSION_ID",
      "question_text": "How does React hooks work?"
    }
  }'
```

## Development Tips

### Run Services Individually

```bash
# API Service only
npm run dev:api

# WebSocket Service only
npm run dev:websocket

# Worker Pool only
npm run dev:worker

# Frontend only
npm run dev:frontend
```

### Watch Logs

```bash
# All services (in dev mode above)
# Logs appear in the same terminal

# Check Podman logs
podman-compose logs -f postgres
podman-compose logs -f redis
podman-compose logs -f amq
```

### Database Access

```bash
# Connect to PostgreSQL
podman exec -it qaroot-mvp-postgres-1 psql -U qaroot -d qaroot_mvp

# Run queries
qaroot_mvp=# SELECT * FROM sessions;
qaroot_mvp=# SELECT * FROM questions;
qaroot_mvp=# \q
```

### Redis Access

```bash
# Connect to Redis
podman exec -it qaroot-mvp-redis-1 redis-cli

# Check keys
127.0.0.1:6379> KEYS *
127.0.0.1:6379> GET cooldown:some-socket-id
```

### AMQ Console

Open AMQ web console: **http://localhost:8161**
- Username: `admin`
- Password: `changeme`

Check queue: `analyze.questions`

## Rebuild After Changes

```bash
# Rebuild TypeScript
npm run build

# Or use watch mode (auto-rebuild)
npm run dev
```

## Stop Services

```bash
# Stop Node.js services
# Ctrl+C in the terminal running npm run dev

# Stop Podman services
podman-compose down

# Stop and remove volumes (clears database)
podman-compose down -v
```

## Troubleshooting

### Port already in use

```bash
# Find process using port 3000
lsof -ti:3000 | xargs kill -9

# Or change port in .env files
```

### Database connection failed

```bash
# Check if PostgreSQL is running
podman-compose ps postgres

# Restart PostgreSQL
podman-compose restart postgres
```

### Migrations failed

```bash
# Drop and recreate database
podman exec -it qaroot-mvp-postgres-1 psql -U qaroot -c "DROP DATABASE qaroot_mvp;"
podman exec -it qaroot-mvp-postgres-1 psql -U qaroot -c "CREATE DATABASE qaroot_mvp;"

# Run migrations again
npm run migrate --workspace=backend/shared
```

### Frontend not loading

```bash
# Clear Vite cache
cd frontend
rm -rf node_modules/.vite
npm run dev
```

## Next Steps

- Add more PatternFly 6 components to UI
- Implement cluster visualization
- Add AI chat interface for host
- Add question voting/upvoting
- Add analytics dashboard
