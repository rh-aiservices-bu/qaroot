# QARoot Helm Chart

Helm chart for deploying QARoot MVP on OpenShift.

## Prerequisites

- Helm 3.x
- OpenShift CLI (`oc`)
- Access to an OpenShift cluster

## Installation

### 1. Update Configuration

Edit `values.yaml` or create environment-specific values files:

```yaml
# values-production.yaml
externalLLM:
  url: "https://your-llm-service.com/v1"
  apiKey: "your-api-key"

auth:
  adminPassword: "secure-password-here"
  jwtSecret: "generate-with-openssl-rand-base64-32"
  sessionSecret: "generate-with-openssl-rand-base64-32"

database:
  password: "secure-db-password"

amq:
  password: "secure-amq-password"
```

### 2. Install Chart

```bash
# Create namespace
oc create namespace qaroot-mvp

# Install with default values
helm install qaroot ./qaroot -n $PROJECT

# Or install with custom values
helm install qaroot ./qaroot -n $PROJECT -f values-production.yaml
```

### 3. Verify Installation

```bash
# Check pods
oc get pods -n $PROJECT

# Check services
oc get svc -n $PROJECT

# Check routes
oc get routes -n $PROJECT
```

## Upgrade

```bash
# Upgrade with new values
helm upgrade qaroot ./qaroot -n $PROJECT -f values-production.yaml

# Upgrade with inline overrides
helm upgrade qaroot ./qaroot -n $PROJECT \
  --set images.apiService.tag=v1.1.0
```

## Uninstall

```bash
helm uninstall qaroot -n $PROJECT

# Optionally delete namespace
oc delete namespace qaroot-mvp
```

## Configuration

See [values.yaml](values.yaml) for all configurable parameters.

### Key Parameters

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.namespace` | Kubernetes namespace | `qaroot-mvp` |
| `global.domain` | Base domain for routes | `qaroot.university.edu` |
| `externalLLM.url` | External LLM service URL | `https://llm.university.edu/v1` |
| `auth.adminPassword` | Admin user password | `changeme123` |
| `database.password` | PostgreSQL password | `changeme` |
| `storage.postgresql.size` | PostgreSQL storage size | `100Gi` |

## Troubleshooting

### Dry run to check templates

```bash
helm install qaroot ./qaroot -n $PROJECT --dry-run --debug
```

### Check generated manifests

```bash
helm template qaroot ./qaroot > manifests.yaml
```

### Rollback to previous version

```bash
helm rollback qaroot -n $PROJECT
```
