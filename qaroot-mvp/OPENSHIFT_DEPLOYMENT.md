# OpenShift Deployment Guide

Complete guide for deploying QARoot MVP to OpenShift.

## Prerequisites

- OpenShift CLI (`oc`) installed
- Access to an OpenShift cluster with:
  - Ability to create projects/namespaces
  - Ability to create routes (for external access)
  - Persistent volume support (for PostgreSQL)
- LLM service endpoint (OpenAI-compatible API) - for chat completion/summarization only
  - **Note:** Embeddings are computed locally using transformers.js - no external embedding service needed
- Container images pushed to accessible registry (quay.io/hayesphilip/* in the provided manifests)

## Architecture Overview

The deployment consists of:
- **PostgreSQL** (15-el9): Primary database with persistent storage
- **Redis** (7-el9): Session store and WebSocket pub/sub (no persistence)
- **RabbitMQ** (3-management-alpine): Message queue for worker jobs
- **API Service**: REST API (Node.js/Express)
- **WebSocket Service**: Real-time communication (Socket.io)
- **Worker Pool**: Background job processing for analysis (uses local embeddings)
- **Frontend**: Static SPA (React/Vite served by Nginx)

## Important Configuration Notes

1. **Clustering Threshold**: Set to `0.65` for optimal semantic grouping (not 0.85)
2. **Redis Persistence**: Disabled (`--save ""` and `--appendonly no`) to avoid write errors
3. **Embeddings**: Generated locally on CPU (384 dimensions) - no GPU required
4. **Routes**: All routes use edge TLS termination

## Deployment Steps

### 1. Login to OpenShift

```bash
# Login to your OpenShift cluster
oc login https://api.your-cluster.com:6443 --token=YOUR_TOKEN

# Or with username/password
oc login https://api.your-cluster.com:6443 -u username -p password
```

### 2. Create Project/Namespace

```bash

export PROJECT=qaroot-mvp
# Create a new project
oc new-project $PROJECT

# Or switch to existing project
oc project $PROJECT
```

### 3. Create Secrets

The deployment requires the following secrets. You can use the provided manifests in `deployment/openshift/01-secrets.yaml` as templates.

#### A. PostgreSQL Credentials

**IMPORTANT**: The password must not contain special characters like `/`, `@`, `:` that would break URL parsing in the DATABASE_URL connection string.

```bash
# Generate a simple alphanumeric password (letters and numbers only)
oc create secret generic postgres-credentials \
  --from-literal=username='qaroot' \
  --from-literal=password='changeme' \
  --from-literal=database='qaroot_mvp' \
  --from-literal=connection-string='postgresql://qaroot:changeme@postgresql:5432/qaroot_mvp'
```

**Note**: Change `changeme` to a secure password without special URL characters.

#### B. Application Credentials

```bash
oc create secret generic app-credentials \
  --from-literal=jwt-secret="$(openssl rand -base64 32)" \
  --from-literal=session-secret="$(openssl rand -base64 32)" \
  --from-literal=admin-email='admin@qaroot.local' \
  --from-literal=admin-username='admin' \
  --from-literal=admin-password='admin123'
```

#### C. LLM Configuration Secret

**Note:** Embeddings are computed locally on CPU using transformers.js - no external embedding service needed!

```bash
# Set your LLM service details (for chat/summarization only)
# IMPORTANT:
# - URL must include /v1 path for OpenAI-compatible API
# - CHAT_MODEL must match an available model
# - To verify model availability: curl -H "Authorization: Bearer $API_KEY" $URL/models
export EXTERNAL_LLM_URL='https://llama-3-2-3b-xxx:443/v1'
export EXTERNAL_LLM_API_KEY='your-api-key-here'
export CHAT_MODEL='llama-3-2-3b'

# Create secret with optimal clustering threshold
oc create secret generic llm-config \
  --from-literal=EXTERNAL_LLM_URL="$EXTERNAL_LLM_URL" \
  --from-literal=EXTERNAL_LLM_API_KEY="$EXTERNAL_LLM_API_KEY" \
  --from-literal=CHAT_MODEL="$CHAT_MODEL" \
  --from-literal=USE_LOCAL_EMBEDDINGS='true' \
  --from-literal=LLM_TIMEOUT='60000' \
  --from-literal=CLUSTERING_THRESHOLD='0.65'
```

#### D. Application Configuration

```bash
oc create secret generic app-config \
  --from-literal=DEFAULT_CHAT_PROMPT='Given the topic given to the participants, and given their responses, create a summary report of the survey.
1. Summarize the topic that was asked.
2. Describe how many distinct people participated.
3. Group similar responses together, and replace them with a summarized version.
4. Display a bullet list of the 5 most popular responses, with a count of how many time that response was provided.
5. Give Kudos to the user who was the fastest, with relevant emojis.

Format the response for an event speaker, to provide short feedback to the audience'
```

### 4. Deploy Application

Deploy in the following order to ensure dependencies are available:

```bash
# 1. Deploy PostgreSQL
oc apply -f deployment/openshift/03-postgresql.yaml -n $PROJECT
oc wait --for=condition=ready pod -l app=postgresql -n $PROJECT --timeout=300s

# 2. Run database migrations
oc apply -f deployment/openshift/06-db-migrations.yaml -n $PROJECT
oc wait --for=condition=complete job/db-migrations -n $PROJECT --timeout=120s

# 3. Deploy Redis
oc apply -f deployment/openshift/04-redis.yaml -n $PROJECT
oc wait --for=condition=ready pod -l app=redis -n $PROJECT --timeout=120s

# 4. Deploy RabbitMQ (or AMQ Operator)
oc apply -f deployment/openshift/05-rabbitmq.yaml -n $PROJECT
oc wait --for=condition=ready pod -l app=rabbitmq -n $PROJECT --timeout=120s

# 5. Deploy application services
oc apply -f deployment/openshift/08-api-service.yaml -n $PROJECT
oc apply -f deployment/openshift/09-websocket-service.yaml -n $PROJECT
oc apply -f deployment/openshift/10-worker-pool.yaml -n $PROJECT

# 6. Deploy frontend
oc apply -f deployment/openshift/07-frontend.yaml -n $PROJECT

# Check deployment status
oc get pods -n $PROJECT
```

**Or deploy all at once (less controlled):**
```bash
oc apply -f deployment/openshift/ -n $PROJECT
```

### 5. Get Application URL

```bash
# Get the frontend route
oc get route qaroot-frontend -n $PROJECT

# Or get full URL
echo "https://$(oc get route qaroot-frontend -n $PROJECT -o jsonpath='{.spec.host}')"
```

### 6. Verify Deployment

```bash
# Check all pods are running
oc get pods -n $PROJECT

NAME                                       READY   STATUS      RESTARTS   AGE
db-migrations-htc2d                        0/1     Completed   0          10m
postgresql-67685df56f-dp8r2                1/1     Running     0          11m
qaroot-api-service-5468888558-ztjgc        1/1     Running     0          4m21s
qaroot-frontend-54c69f487d-9hgkk           1/1     Running     0          10m
qaroot-websocket-service-c4dd947f8-jlblr   1/1     Running     0          4m20s
qaroot-worker-pool-798b598cff-d6pqn        1/1     Running     0          4m19s
rabbitmq-69fb95fc99-5fxgv                  1/1     Running     0          10m
redis-7b55ccfd7-82rdd                      1/1     Running     0          10m

# Check services
oc get svc -n $PROJECT

# Check routes
oc get route -n $PROJECT
```

### 7. Access the Application

Open the route URL in your browser:

```
https://qaroot-frontend-qaroot-mvp.apps.your-cluster.com
```

Default login credentials (as configured in app-credentials secret):
- Username: `admin@qaroot.com`
- Password: `admin123` (change this in production!)

## Configuration

### Update Configuration

```bash
# Update LLM configuration
oc delete secret llm-config -n $PROJECT
oc create secret generic llm-config \
  --from-literal=EXTERNAL_LLM_URL='https://new-endpoint/v1' \
  --from-literal=EXTERNAL_LLM_API_KEY='new-key' \
  --from-literal=CHAT_MODEL='gpt-4' \
  --from-literal=USE_LOCAL_EMBEDDINGS='true' \
  --from-literal=LLM_TIMEOUT='60000' \
  --from-literal=CLUSTERING_THRESHOLD='0.65'

# Restart worker pool to pick up new LLM config
oc rollout restart deployment/qaroot-worker-pool -n $PROJECT

# Update clustering threshold only
oc patch secret llm-config -n $PROJECT \
  --type='json' \
  -p='[{"op": "replace", "path": "/data/CLUSTERING_THRESHOLD", "value": "'$(echo -n "0.65" | base64)'"}]'
oc rollout restart deployment/qaroot-worker-pool -n $PROJECT
```

## Monitoring

### View Logs

```bash
# API Service logs
oc logs -f deployment/qaroot-api-service -n $PROJECT

# WebSocket Service logs
oc logs -f deployment/qaroot-websocket-service -n $PROJECT

# Worker Pool logs (shows LLM analysis progress)
oc logs -f deployment/qaroot-worker-pool -n $PROJECT

# Frontend logs
oc logs -f deployment/qaroot-frontend -n $PROJECT

# Database logs
oc logs -f deployment/postgresql -n $PROJECT
```

### Check Pod Status

```bash
# Get pod details
oc describe pod <pod-name> -n $PROJECT

# Get pod events
oc get events -n $PROJECT --sort-by='.lastTimestamp'

# Check resource usage
oc adm top pods -n $PROJECT
```

## Troubleshooting

### LLM Connection Issues

If analysis is timing out:

```bash
# Check worker logs
oc logs -f deployment/qaroot-worker-pool -n $PROJECT | grep -i "llm\|embedding\|timeout"

# Verify secret
oc get secret llm-config -n $PROJECT -o yaml

# Test connectivity from worker pod
oc rsh deployment/qaroot-worker-pool
curl -v https://your-llm-endpoint/v1/models
```

### Database Connection Issues

```bash
# Check PostgreSQL status
oc get deployment postgresql -n $PROJECT

# Connect to database
oc exec -it deployment/postgresql -n $PROJECT -- psql -U qaroot -d qaroot_mvp

# Check if migrations ran
oc get job db-migrations -n $PROJECT
oc logs job/db-migrations -n $PROJECT

# Verify database schema
oc exec deployment/postgresql -n $PROJECT -- psql -U qaroot -d qaroot_mvp -c "\dt"
```

### WebSocket Issues

```bash
# Check Redis connectivity
oc rsh deployment/qaroot-redis
redis-cli ping

# Check WebSocket service logs
oc logs -f deployment/qaroot-websocket-service -n $PROJECT | grep -i "connect\|disconnect"
```

## Scaling

### Scale Services

```bash
# Scale API service
oc scale deployment qaroot-api-service --replicas=3 -n $PROJECT

# Scale WebSocket service
oc scale deployment qaroot-websocket-service --replicas=2 -n $PROJECT

# Scale Worker pool
oc scale deployment qaroot-worker-pool --replicas=2 -n $PROJECT

# Scale Frontend
oc scale deployment qaroot-frontend --replicas=3 -n $PROJECT
```

### Autoscaling

```bash
# Create HorizontalPodAutoscaler for API service
oc autoscale deployment qaroot-api-service \
  --min=2 \
  --max=10 \
  --cpu-percent=70 \
  -n $PROJECT

# Create HPA for worker pool
oc autoscale deployment qaroot-worker-pool \
  --min=1 \
  --max=5 \
  --cpu-percent=80 \
  -n $PROJECT
```


## Upgrade

```bash
# Pull latest manifests
git pull origin main

# Apply updated manifests
oc apply -f deployment/openshift/ -n $PROJECT

# Check rollout status
oc rollout status deployment/qaroot-api-service -n $PROJECT
oc rollout status deployment/qaroot-websocket-service -n $PROJECT
oc rollout status deployment/qaroot-worker-pool -n $PROJECT
oc rollout status deployment/qaroot-frontend -n $PROJECT
```

## Uninstall

```bash
# Delete all resources
oc delete -f deployment/openshift/ -n $PROJECT

# Delete secrets (optional)
oc delete secret llm-config -n $PROJECT
oc delete secret qaroot-secrets -n $PROJECT

# Delete project (removes everything)
oc delete project $PROJECT
```

## Security Considerations

### Network Policies

```bash
# Apply network policies to restrict traffic
oc apply -f deployment/openshift/network-policies.yaml -n $PROJECT
```

### RBAC

```bash
# Create service account with limited permissions
oc create sa qaroot-app -n $PROJECT

# Assign minimal required permissions
oc adm policy add-role-to-user view system:serviceaccount:qaroot-mvp:qaroot-app
```

### TLS/SSL

Routes are automatically secured with TLS by OpenShift. To use custom certificates:

```bash
# Create TLS secret
oc create secret tls qaroot-tls \
  --cert=path/to/tls.crt \
  --key=path/to/tls.key \
  -n $PROJECT

# Update route to use custom cert
oc patch route qaroot-frontend \
  -n $PROJECT \
  -p '{"spec":{"tls":{"termination":"edge","certificate":"...","key":"..."}}}'
```

## Production Checklist

- [ ] LLM endpoints configured and tested
- [ ] Secrets created with strong passwords
- [ ] Resource limits set appropriately
- [ ] Persistent volume claims configured
- [ ] Backup strategy in place
- [ ] Monitoring/alerting configured
- [ ] Network policies applied
- [ ] TLS certificates configured
- [ ] Autoscaling configured
- [ ] Health checks verified
- [ ] Log aggregation configured

## Support

For issues or questions:
- Check logs: `oc logs -f deployment/<service-name> -n $PROJECT`
- Review events: `oc get events -n $PROJECT`
- GitHub Issues: https://github.com/your-org/qaroot-mvp/issues
