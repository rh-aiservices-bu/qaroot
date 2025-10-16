# OpenShift Deployment - Command Reference

Quick reference for deploying QARoot MVP to OpenShift using `.env` file configuration.

## Complete Installation Commands

### Option 1: Using .env File (Recommended)

```bash
# 1. Navigate to deployment directory
cd deployment/openshift

# 2. Copy example .env file
cp .env.example .env

# 3. Edit .env with your LLM configuration
vi .env  # or use your preferred editor

# 4. Load environment variables
source .env

# 5. Login to OpenShift (if not already logged in)
oc login https://api.your-cluster.com:6443

# 6. Run deployment script
./deploy.sh
```

### Option 2: Using .env with Manual Commands

```bash
# 1. Setup environment
cd deployment/openshift
cp .env.example .env
vi .env  # Edit with your values
source .env

# 2. Login to OpenShift
oc login https://api.your-cluster.com:6443

# 3. Create project
oc new-project ${PROJECT_NAME:-qaroot-mvp}

# 4. Create LLM configuration secret
oc create secret generic llm-config \
  --from-literal=EXTERNAL_LLM_URL="$EXTERNAL_LLM_URL" \
  --from-literal=EXTERNAL_LLM_API_KEY="$EXTERNAL_LLM_API_KEY" \
  --from-literal=EMBEDDING_SERVICE_URL="$EMBEDDING_SERVICE_URL" \
  --from-literal=EMBEDDING_SERVICE_API_KEY="$EMBEDDING_SERVICE_API_KEY" \
  --from-literal=CHAT_MODEL="${CHAT_MODEL:-qwen2.5-14b-instruct}" \
  --from-literal=EMBEDDING_MODEL="${EMBEDDING_MODEL:-nomic-embed-text-v1.5}" \
  --from-literal=EMBEDDING_TIMEOUT="${EMBEDDING_TIMEOUT:-15000}" \
  --from-literal=LLM_TIMEOUT="${LLM_TIMEOUT:-60000}" \
  --from-literal=CLUSTERING_THRESHOLD="${CLUSTERING_THRESHOLD:-0.85}"

# 5. Create application secrets
oc create secret generic qaroot-secrets \
  --from-literal=JWT_SECRET="${JWT_SECRET:-$(openssl rand -base64 32)}" \
  --from-literal=SESSION_SECRET="${SESSION_SECRET:-$(openssl rand -base64 32)}" \
  --from-literal=DATABASE_PASSWORD="${DATABASE_PASSWORD:-$(openssl rand -base64 24)}" \
  --from-literal=REDIS_PASSWORD="${REDIS_PASSWORD:-qaroot$(openssl rand -base64 12)}" \
  --from-literal=AMQ_PASSWORD="${AMQ_PASSWORD:-qaroot$(openssl rand -base64 12)}"

# 6. Deploy with Helm
helm install qaroot ../helm/qaroot -n ${PROJECT_NAME:-qaroot-mvp} --wait

# 7. Get application URL
echo "https://$(oc get route qaroot-frontend -n ${PROJECT_NAME:-qaroot-mvp} -o jsonpath='{.spec.host}')"
```

## Red Hat AI Services (MaaS) Example

If you're using Red Hat AI Services for LLM and embeddings:

```bash
# Create secret with MaaS endpoints
oc create secret generic llm-config \
  --from-literal=EXTERNAL_LLM_URL='https://qwen-2-5-14b-instruct-maas-apicast-production.apps.prod.rhoai.rh-aiservices-bu.com:443/v1' \
  --from-literal=EXTERNAL_LLM_API_KEY='your-maas-token-here' \
  --from-literal=EMBEDDING_SERVICE_URL='https://nomic-embed-text-v1-5-maas-apicast-production.apps.prod.rhoai.rh-aiservices-bu.com:443/embeddings' \
  --from-literal=EMBEDDING_SERVICE_API_KEY='your-maas-token-here' \
  --from-literal=CHAT_MODEL='/mnt/models' \
  --from-literal=EMBEDDING_MODEL='/mnt/models' \
  --from-literal=EMBEDDING_TIMEOUT='15000' \
  --from-literal=LLM_TIMEOUT='60000'
```

## OpenAI-Compatible API Example

For OpenAI or OpenAI-compatible services:

```bash
oc create secret generic llm-config \
  --from-literal=EXTERNAL_LLM_URL='https://api.openai.com/v1' \
  --from-literal=EXTERNAL_LLM_API_KEY='sk-your-openai-key' \
  --from-literal=EMBEDDING_SERVICE_URL='https://api.openai.com/v1' \
  --from-literal=EMBEDDING_SERVICE_API_KEY='sk-your-openai-key' \
  --from-literal=CHAT_MODEL='gpt-4' \
  --from-literal=EMBEDDING_MODEL='text-embedding-3-small' \
  --from-literal=EMBEDDING_TIMEOUT='15000' \
  --from-literal=LLM_TIMEOUT='60000'
```

## Verify Installation

```bash
# Check all pods are running
oc get pods -n $PROJECT

# View worker logs (shows LLM processing)
oc logs -f deployment/qaroot-worker-pool -n $PROJECT

# Get application URL
oc get route qaroot-frontend -n $PROJECT
```

## Update LLM Configuration

```bash
# Delete existing secret
oc delete secret llm-config -n $PROJECT

# Create new secret with updated values
oc create secret generic llm-config \
  --from-literal=EXTERNAL_LLM_URL='https://new-endpoint/v1' \
  --from-literal=EXTERNAL_LLM_API_KEY='new-key'

# Restart worker pods to pick up new config
oc rollout restart deployment/qaroot-worker-pool -n $PROJECT
oc rollout restart deployment/qaroot-api-service -n $PROJECT
```

## Troubleshooting Commands

```bash
# Check pod status
oc get pods -n $PROJECT

# View logs
oc logs -f deployment/qaroot-worker-pool -n $PROJECT
oc logs -f deployment/qaroot-api-service -n $PROJECT
oc logs -f deployment/qaroot-websocket-service -n $PROJECT

# Check events
oc get events -n $PROJECT --sort-by='.lastTimestamp'

# Describe pod for detailed info
oc describe pod <pod-name> -n $PROJECT

# Test LLM connectivity from worker pod
oc rsh deployment/qaroot-worker-pool
curl -v $EXTERNAL_LLM_URL/models -H "Authorization: Bearer $EXTERNAL_LLM_API_KEY"
```

## Scaling Commands

```bash
# Scale API service
oc scale deployment qaroot-api-service --replicas=3 -n $PROJECT

# Scale worker pool
oc scale deployment qaroot-worker-pool --replicas=2 -n $PROJECT

# Scale frontend
oc scale deployment qaroot-frontend --replicas=3 -n $PROJECT
```

## Uninstall

```bash
# Uninstall Helm release
helm uninstall qaroot -n $PROJECT

# Delete secrets
oc delete secret llm-config -n $PROJECT
oc delete secret qaroot-secrets -n $PROJECT

# Delete entire project
oc delete project qaroot-mvp
```

## Access Application

Default credentials:
- **Username**: `admin`
- **Password**: `changeme123`

Get URL:
```bash
oc get route qaroot-frontend -n $PROJECT
```

## Required Secrets Summary

QARoot requires two secrets to be created:

1. **llm-config** - LLM and embedding service configuration
   - EXTERNAL_LLM_URL
   - EXTERNAL_LLM_API_KEY
   - EMBEDDING_SERVICE_URL
   - EMBEDDING_SERVICE_API_KEY
   - CHAT_MODEL
   - EMBEDDING_MODEL
   - EMBEDDING_TIMEOUT
   - LLM_TIMEOUT

2. **qaroot-secrets** - Application secrets (auto-generated)
   - JWT_SECRET
   - SESSION_SECRET
   - DATABASE_PASSWORD
   - REDIS_PASSWORD
   - AMQ_PASSWORD

## Environment Variables

All configuration is stored in secrets and injected as environment variables:

| Variable | Description | Example |
|----------|-------------|---------|
| EXTERNAL_LLM_URL | LLM service endpoint | https://api.openai.com/v1 |
| EXTERNAL_LLM_API_KEY | LLM API key/token | sk-... |
| EMBEDDING_SERVICE_URL | Embedding service endpoint | https://api.openai.com/v1 |
| EMBEDDING_SERVICE_API_KEY | Embedding API key/token | sk-... |
| CHAT_MODEL | Model name for chat/completion | gpt-4 or /mnt/models |
| EMBEDDING_MODEL | Model name for embeddings | text-embedding-3-small |
| EMBEDDING_TIMEOUT | Embedding request timeout (ms) | 15000 |
| LLM_TIMEOUT | LLM request timeout (ms) | 60000 |
| CLUSTERING_THRESHOLD | Similarity threshold (0-1) | 0.85 |

## Support

For detailed documentation, see [OPENSHIFT_DEPLOYMENT.md](OPENSHIFT_DEPLOYMENT.md)
