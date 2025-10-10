# OpenShift Deployment Guide

Complete guide for deploying QARoot MVP to OpenShift.

## Prerequisites

- OpenShift CLI (`oc`) installed
- Helm 3.x installed
- Access to an OpenShift cluster
- LLM service endpoint (OpenAI-compatible API)
- Embedding service endpoint

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

#### A. LLM Configuration Secret

```bash
# Create secret with your LLM and embedding service details
oc create secret generic llm-config \
  --from-literal=EXTERNAL_LLM_URL='https://your-llm-endpoint/v1' \
  --from-literal=EXTERNAL_LLM_API_KEY='your-api-key-here' \
  --from-literal=EMBEDDING_SERVICE_URL='https://your-embedding-endpoint/embeddings' \
  --from-literal=EMBEDDING_SERVICE_API_KEY='your-embedding-api-key-here' \
  --from-literal=CHAT_MODEL='qwen2.5-14b-instruct' \
  --from-literal=EMBEDDING_MODEL='nomic-embed-text-v1.5' \
  --from-literal=EMBEDDING_TIMEOUT='15000' \
  --from-literal=LLM_TIMEOUT='60000' \
  --from-literal=CLUSTERING_THRESHOLD='0.85'
```

**Example with Red Hat AI Services:**
```bash
oc create secret generic llm-config \
  --from-literal=EXTERNAL_LLM_URL='https://qwen-2-5-14b-instruct-maas-apicast-production.apps.prod.rhoai.rh-aiservices-bu.com:443/v1' \
  --from-literal=EXTERNAL_LLM_API_KEY='your-maas-token' \
  --from-literal=EMBEDDING_SERVICE_URL='https://nomic-embed-text-v1-5-maas-apicast-production.apps.prod.rhoai.rh-aiservices-bu.com:443/embeddings' \
  --from-literal=EMBEDDING_SERVICE_API_KEY='your-maas-token' \
  --from-literal=CHAT_MODEL='/mnt/models' \
  --from-literal=EMBEDDING_MODEL='/mnt/models' \
  --from-literal=EMBEDDING_TIMEOUT='15000' \
  --from-literal=LLM_TIMEOUT='60000'
```

#### B. Application Secrets

```bash
# Generate secure random secrets
JWT_SECRET=$(openssl rand -base64 32)
SESSION_SECRET=$(openssl rand -base64 32)
DB_PASSWORD=$(openssl rand -base64 24)

# Create application secrets
oc create secret generic qaroot-secrets \
  --from-literal=JWT_SECRET="$JWT_SECRET" \
  --from-literal=SESSION_SECRET="$SESSION_SECRET" \
  --from-literal=DATABASE_PASSWORD="$DB_PASSWORD" \
  --from-literal=REDIS_PASSWORD="qaroot$(openssl rand -base64 12)" \
  --from-literal=AMQ_PASSWORD="qaroot$(openssl rand -base64 12)"
```

### 4. Deploy with Helm

```bash
# From the project root directory
helm install qaroot deployment/helm/qaroot \
  --namespace qaroot-mvp \
  --create-namespace \
  --wait

# Check deployment status
oc get pods -n qaroot-mvp
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
# NAME                                READY   STATUS    RESTARTS   AGE
# qaroot-api-service-xxx              1/1     Running   0          2m
# qaroot-websocket-service-xxx        1/1     Running   0          2m
# qaroot-worker-pool-xxx              1/1     Running   0          2m
# qaroot-frontend-xxx                 1/1     Running   0          2m
# qaroot-postgresql-0                 1/1     Running   0          2m
# qaroot-redis-xxx                    1/1     Running   0          2m
# qaroot-amq-xxx                      1/1     Running   0          2m

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

Default login credentials:
- Username: `admin`
- Password: `changeme123`

## Configuration

### Custom Values

Create a `values-custom.yaml` file:

```yaml
# values-custom.yaml
global:
  domain: apps.your-cluster.com

frontend:
  replicas: 2
  resources:
    limits:
      cpu: 500m
      memory: 512Mi
    requests:
      cpu: 100m
      memory: 256Mi

apiService:
  replicas: 2
  resources:
    limits:
      cpu: 1000m
      memory: 1Gi
    requests:
      cpu: 200m
      memory: 512Mi

postgresql:
  persistence:
    size: 20Gi
    storageClass: gp3-csi

redis:
  resources:
    limits:
      cpu: 500m
      memory: 512Mi

amq:
  resources:
    limits:
      cpu: 1000m
      memory: 2Gi
```

Install with custom values:

```bash
helm install qaroot deployment/helm/qaroot \
  -n qaroot-mvp \
  -f values-custom.yaml
```

### Update Configuration

```bash
# Update secrets
oc delete secret llm-config -n qaroot-mvp
oc create secret generic llm-config \
  --from-literal=EXTERNAL_LLM_URL='https://new-endpoint/v1' \
  --from-literal=EXTERNAL_LLM_API_KEY='new-key'

# Restart pods to pick up new secrets
oc rollout restart deployment/qaroot-api-service -n qaroot-mvp
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
oc logs -f statefulset/qaroot-postgresql -n qaroot-mvp
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
oc get statefulset qaroot-postgresql -n qaroot-mvp

# Connect to database
oc rsh statefulset/qaroot-postgresql
psql -U qaroot -d qaroot_mvp

# Run migrations manually if needed
oc rsh deployment/qaroot-api-service
npm run migrate
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

## Backup and Restore

### Backup Database

```bash
# Create backup
oc rsh statefulset/qaroot-postgresql
pg_dump -U qaroot qaroot_mvp > /tmp/backup.sql
exit

# Copy backup out
oc cp qaroot-mvp/qaroot-postgresql-0:/tmp/backup.sql ./backup-$(date +%Y%m%d).sql
```

### Restore Database

```bash
# Copy backup to pod
oc cp ./backup.sql qaroot-mvp/qaroot-postgresql-0:/tmp/backup.sql

# Restore
oc rsh statefulset/qaroot-postgresql
psql -U qaroot -d qaroot_mvp < /tmp/backup.sql
```

## Upgrade

```bash
# Pull latest charts
git pull origin main

# Upgrade deployment
helm upgrade qaroot deployment/helm/qaroot \
  -n qaroot-mvp \
  -f values-custom.yaml

# Check rollout status
oc rollout status deployment/qaroot-api-service -n qaroot-mvp
oc rollout status deployment/qaroot-websocket-service -n qaroot-mvp
oc rollout status deployment/qaroot-worker-pool -n qaroot-mvp
oc rollout status deployment/qaroot-frontend -n qaroot-mvp
```

## Uninstall

```bash
# Uninstall Helm release
helm uninstall qaroot -n qaroot-mvp

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
