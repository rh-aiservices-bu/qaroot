# QARoot MVP - OpenShift Deployment

## Prerequisites

- OpenShift CLI (`oc`) installed
- Access to an OpenShift cluster
- Cluster admin permissions (for namespace creation)

## Deployment Steps

### 1. Create Namespace

```bash
oc apply -f 00-namespace.yaml
```

### 2. Create Secrets

**Important:** Before deploying secrets, update the following values in `01-secrets.yaml`:

- `postgres-credentials`: Database credentials
- `app-credentials`: Admin username/password, JWT secrets
- `llm-credentials`: External LLM service URL and API key
- `amq-credentials`: AMQ broker credentials

```bash
# Edit secrets first
vi 01-secrets.yaml

# Apply secrets
oc apply -f 01-secrets.yaml
```

### 3. Create ConfigMaps

```bash
oc apply -f 02-configmaps.yaml
```

### 4. Deploy Infrastructure Services

```bash
# Deploy PostgreSQL with pgvector
oc apply -f 03-postgresql.yaml

# Deploy Redis
oc apply -f 04-redis.yaml

# Deploy Red Hat AMQ
oc apply -f 05-amq.yaml

# Deploy Llama Stack
oc apply -f 06-llama-stack.yaml
```

Wait for all infrastructure pods to be ready:

```bash
oc get pods -n $PROJECT -w
```

### 5. Run Database Migrations

Once PostgreSQL is running, execute migrations:

```bash
# Get the PostgreSQL pod name
POD_NAME=$(oc get pods -n $PROJECT -l app=postgresql -o jsonpath='{.items[0].metadata.name}')

# Connect to PostgreSQL and run migrations
oc exec -n $PROJECT -it $POD_NAME -- psql -U qaroot -d qaroot_mvp -f /path/to/migrations/001_init.sql
```

Or run migrations from the API service once deployed.

### 6. Deploy Application Services

After deploying with Helm (see [../helm/README.md](../helm/README.md)), or manually apply manifests.

## Verification

Check all pods are running:

```bash
oc get pods -n $PROJECT
```

Check services:

```bash
oc get svc -n $PROJECT
```

Check routes (if configured):

```bash
oc get routes -n $PROJECT
```

## Troubleshooting

### PostgreSQL not starting

```bash
oc logs -n $PROJECT deployment/postgresql
oc describe pod -n $PROJECT -l app=postgresql
```

### AMQ connection issues

```bash
oc logs -n $PROJECT deployment/amq-broker
```

### Llama Stack errors

```bash
oc logs -n $PROJECT deployment/llama-stack
```

## Cleanup

To remove all resources:

```bash
oc delete namespace qaroot-mvp
```
