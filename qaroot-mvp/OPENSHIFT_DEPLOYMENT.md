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
# Create a new project
oc new-project qaroot-mvp

# Or switch to existing project
oc project qaroot-mvp
```

### 3. Create Secrets

The deployment requires the following secrets. You can use the provided manifests in `deployment/openshift/01-secrets.yaml` as templates.

#### A. PostgreSQL Credentials

```bash
oc create secret generic postgres-credentials \
  --from-literal=username='qaroot' \
  --from-literal=password="$(openssl rand -base64 24)" \
  --from-literal=database='qaroot_mvp' \
  --from-literal=host='postgresql'
```

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
export EXTERNAL_LLM_URL='https://your-llm-endpoint/v1'
export EXTERNAL_LLM_API_KEY='your-api-key-here'
export CHAT_MODEL='qwen2.5-14b-instruct'

# Create secret with optimal clustering threshold
oc create secret generic llm-config \
  --from-literal=EXTERNAL_LLM_URL="$EXTERNAL_LLM_URL" \
  --from-literal=EXTERNAL_LLM_API_KEY="$EXTERNAL_LLM_API_KEY" \
  --from-literal=CHAT_MODEL="$CHAT_MODEL" \
  --from-literal=USE_LOCAL_EMBEDDINGS='true' \
  --from-literal=LLM_TIMEOUT='60000' \
  --from-literal=CLUSTERING_THRESHOLD='0.65'
```

**Example with OpenAI:**
```bash
oc create secret generic llm-config \
  --from-literal=EXTERNAL_LLM_URL='https://api.openai.com/v1' \
  --from-literal=EXTERNAL_LLM_API_KEY='sk-...' \
  --from-literal=CHAT_MODEL='gpt-4' \
  --from-literal=USE_LOCAL_EMBEDDINGS='true' \
  --from-literal=LLM_TIMEOUT='60000' \
  --from-literal=CLUSTERING_THRESHOLD='0.65'
```

### 4. Deploy Application

Deploy in the following order to ensure dependencies are available:

```bash
# 1. Deploy PostgreSQL
oc apply -f deployment/openshift/03-postgresql.yaml -n qaroot-mvp
oc wait --for=condition=ready pod -l app=postgresql -n qaroot-mvp --timeout=300s

# 2. Run database migrations
oc apply -f deployment/openshift/06-db-migrations.yaml -n qaroot-mvp
oc wait --for=condition=complete job/db-migrations -n qaroot-mvp --timeout=120s

# 3. Deploy Redis
oc apply -f deployment/openshift/04-redis.yaml -n qaroot-mvp
oc wait --for=condition=ready pod -l app=redis -n qaroot-mvp --timeout=120s

# 4. Deploy RabbitMQ (or AMQ Operator)
oc apply -f deployment/openshift/05-rabbitmq.yaml -n qaroot-mvp
oc wait --for=condition=ready pod -l app=rabbitmq -n qaroot-mvp --timeout=120s

# 5. Deploy application services
oc apply -f deployment/openshift/08-api-service.yaml -n qaroot-mvp
oc apply -f deployment/openshift/09-websocket-service.yaml -n qaroot-mvp
oc apply -f deployment/openshift/10-worker-pool.yaml -n qaroot-mvp

# 6. Deploy frontend
oc apply -f deployment/openshift/07-frontend.yaml -n qaroot-mvp

# Check deployment status
oc get pods -n qaroot-mvp
```

**Or deploy all at once (less controlled):**
```bash
oc apply -f deployment/openshift/ -n qaroot-mvp
```

### 5. Get Application URL

```bash
# Get the frontend route
oc get route qaroot-frontend -n qaroot-mvp

# Or get full URL
echo "https://$(oc get route qaroot-frontend -n qaroot-mvp -o jsonpath='{.spec.host}')"
```

### 6. Verify Deployment

```bash
# Check all pods are running
oc get pods -n qaroot-mvp

# Expected output:
# NAME                                         READY   STATUS      RESTARTS   AGE
# amq-broker-controller-manager-xxx            1/1     Running     0          10m
# db-migrations-xxx                            0/1     Completed   0          10m
# postgresql-xxx                               1/1     Running     0          10m
# qaroot-api-service-xxx                       1/1     Running     0          5m
# qaroot-frontend-xxx                          1/1     Running     0          5m
# qaroot-websocket-service-xxx                 1/1     Running     0          5m
# qaroot-worker-pool-xxx                       1/1     Running     0          5m
# rabbitmq-xxx                                 1/1     Running     0          8m
# redis-xxx                                    1/1     Running     0          10m

# Check services
oc get svc -n qaroot-mvp

# Check routes
oc get route -n qaroot-mvp
```

### 7. Access the Application

Open the route URL in your browser:

```
https://qaroot-frontend-qaroot-mvp.apps.your-cluster.com
```

Default login credentials (as configured in app-credentials secret):
- Username: `admin`
- Password: `admin123` (change this in production!)

## Configuration

### Update Configuration

```bash
# Update LLM configuration
oc delete secret llm-config -n qaroot-mvp
oc create secret generic llm-config \
  --from-literal=EXTERNAL_LLM_URL='https://new-endpoint/v1' \
  --from-literal=EXTERNAL_LLM_API_KEY='new-key' \
  --from-literal=CHAT_MODEL='gpt-4' \
  --from-literal=USE_LOCAL_EMBEDDINGS='true' \
  --from-literal=LLM_TIMEOUT='60000' \
  --from-literal=CLUSTERING_THRESHOLD='0.65'

# Restart worker pool to pick up new LLM config
oc rollout restart deployment/qaroot-worker-pool -n qaroot-mvp

# Update clustering threshold only
oc patch secret llm-config -n qaroot-mvp \
  --type='json' \
  -p='[{"op": "replace", "path": "/data/CLUSTERING_THRESHOLD", "value": "'$(echo -n "0.65" | base64)'"}]'
oc rollout restart deployment/qaroot-worker-pool -n qaroot-mvp
```

## Monitoring

### View Logs

```bash
# API Service logs
oc logs -f deployment/qaroot-api-service -n qaroot-mvp

# WebSocket Service logs
oc logs -f deployment/qaroot-websocket-service -n qaroot-mvp

# Worker Pool logs (shows LLM analysis progress)
oc logs -f deployment/qaroot-worker-pool -n qaroot-mvp

# Frontend logs
oc logs -f deployment/qaroot-frontend -n qaroot-mvp

# Database logs
oc logs -f deployment/postgresql -n qaroot-mvp
```

### Check Pod Status

```bash
# Get pod details
oc describe pod <pod-name> -n qaroot-mvp

# Get pod events
oc get events -n qaroot-mvp --sort-by='.lastTimestamp'

# Check resource usage
oc adm top pods -n qaroot-mvp
```

## Troubleshooting

### LLM Connection Issues

If analysis is timing out:

```bash
# Check worker logs
oc logs -f deployment/qaroot-worker-pool -n qaroot-mvp | grep -i "llm\|embedding\|timeout"

# Verify secret
oc get secret llm-config -n qaroot-mvp -o yaml

# Test connectivity from worker pod
oc rsh deployment/qaroot-worker-pool
curl -v https://your-llm-endpoint/v1/models
```

### Database Connection Issues

```bash
# Check PostgreSQL status
oc get deployment postgresql -n qaroot-mvp

# Connect to database
oc exec -it deployment/postgresql -n qaroot-mvp -- psql -U qaroot -d qaroot_mvp

# Check if migrations ran
oc get job db-migrations -n qaroot-mvp
oc logs job/db-migrations -n qaroot-mvp

# Verify database schema
oc exec deployment/postgresql -n qaroot-mvp -- psql -U qaroot -d qaroot_mvp -c "\dt"
```

### WebSocket Issues

```bash
# Check Redis connectivity
oc rsh deployment/qaroot-redis
redis-cli ping

# Check WebSocket service logs
oc logs -f deployment/qaroot-websocket-service -n qaroot-mvp | grep -i "connect\|disconnect"
```

## Scaling

### Scale Services

```bash
# Scale API service
oc scale deployment qaroot-api-service --replicas=3 -n qaroot-mvp

# Scale WebSocket service
oc scale deployment qaroot-websocket-service --replicas=2 -n qaroot-mvp

# Scale Worker pool
oc scale deployment qaroot-worker-pool --replicas=2 -n qaroot-mvp

# Scale Frontend
oc scale deployment qaroot-frontend --replicas=3 -n qaroot-mvp
```

### Autoscaling

```bash
# Create HorizontalPodAutoscaler for API service
oc autoscale deployment qaroot-api-service \
  --min=2 \
  --max=10 \
  --cpu-percent=70 \
  -n qaroot-mvp

# Create HPA for worker pool
oc autoscale deployment qaroot-worker-pool \
  --min=1 \
  --max=5 \
  --cpu-percent=80 \
  -n qaroot-mvp
```


## Upgrade

```bash
# Pull latest manifests
git pull origin main

# Apply updated manifests
oc apply -f deployment/openshift/ -n qaroot-mvp

# Check rollout status
oc rollout status deployment/qaroot-api-service -n qaroot-mvp
oc rollout status deployment/qaroot-websocket-service -n qaroot-mvp
oc rollout status deployment/qaroot-worker-pool -n qaroot-mvp
oc rollout status deployment/qaroot-frontend -n qaroot-mvp
```

## Uninstall

```bash
# Delete all resources
oc delete -f deployment/openshift/ -n qaroot-mvp

# Delete secrets (optional)
oc delete secret llm-config -n qaroot-mvp
oc delete secret qaroot-secrets -n qaroot-mvp

# Delete project (removes everything)
oc delete project qaroot-mvp
```

## Security Considerations

### Network Policies

```bash
# Apply network policies to restrict traffic
oc apply -f deployment/openshift/network-policies.yaml -n qaroot-mvp
```

### RBAC

```bash
# Create service account with limited permissions
oc create sa qaroot-app -n qaroot-mvp

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
  -n qaroot-mvp

# Update route to use custom cert
oc patch route qaroot-frontend \
  -n qaroot-mvp \
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
- Check logs: `oc logs -f deployment/<service-name> -n qaroot-mvp`
- Review events: `oc get events -n qaroot-mvp`
- GitHub Issues: https://github.com/your-org/qaroot-mvp/issues
