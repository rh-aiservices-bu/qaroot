#!/bin/bash
#
# QARoot MVP - OpenShift Deployment Script
# Uses .env file for configuration
#
# Usage:
#   1. Copy .env.example to .env
#   2. Edit .env with your LLM configuration
#   3. Run: source .env && ./deploy.sh
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}QARoot MVP - OpenShift Deployment${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""

# Check if environment variables are set
if [ -z "$EXTERNAL_LLM_URL" ]; then
    echo -e "${RED}Error: EXTERNAL_LLM_URL not set${NC}"
    echo "Please source the .env file first:"
    echo "  cp .env.example .env"
    echo "  # Edit .env with your values"
    echo "  source .env"
    echo "  ./deploy.sh"
    exit 1
fi

# Set defaults
PROJECT_NAME="${PROJECT_NAME:-qaroot-mvp}"
HELM_RELEASE_NAME="${HELM_RELEASE_NAME:-qaroot}"

# Generate secrets if not provided
JWT_SECRET="${JWT_SECRET:-$(openssl rand -base64 32)}"
SESSION_SECRET="${SESSION_SECRET:-$(openssl rand -base64 32)}"
DATABASE_PASSWORD="${DATABASE_PASSWORD:-$(openssl rand -base64 24)}"
REDIS_PASSWORD="${REDIS_PASSWORD:-qaroot$(openssl rand -base64 12)}"
AMQ_PASSWORD="${AMQ_PASSWORD:-qaroot$(openssl rand -base64 12)}"

echo -e "${BLUE}Configuration:${NC}"
echo "  Project: $PROJECT_NAME"
echo "  Helm Release: $HELM_RELEASE_NAME"
echo "  LLM URL: $EXTERNAL_LLM_URL"
echo "  Embedding URL: $EMBEDDING_SERVICE_URL"
echo "  Chat Model: ${CHAT_MODEL:-qwen2.5-14b-instruct}"
echo "  Embedding Model: ${EMBEDDING_MODEL:-nomic-embed-text-v1.5}"
echo ""

# Confirm deployment
read -p "Continue with deployment? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled"
    exit 1
fi

echo ""
echo -e "${GREEN}Step 1: Creating/switching to OpenShift project${NC}"
oc new-project ${PROJECT_NAME} 2>/dev/null || oc project ${PROJECT_NAME}

echo ""
echo -e "${GREEN}Step 2: Creating LLM configuration secret${NC}"
oc delete secret llm-config -n ${PROJECT_NAME} 2>/dev/null || true
oc create secret generic llm-config \
  --from-literal=EXTERNAL_LLM_URL="${EXTERNAL_LLM_URL}" \
  --from-literal=EXTERNAL_LLM_API_KEY="${EXTERNAL_LLM_API_KEY}" \
  --from-literal=EMBEDDING_SERVICE_URL="${EMBEDDING_SERVICE_URL}" \
  --from-literal=EMBEDDING_SERVICE_API_KEY="${EMBEDDING_SERVICE_API_KEY}" \
  --from-literal=CHAT_MODEL="${CHAT_MODEL:-qwen2.5-14b-instruct}" \
  --from-literal=EMBEDDING_MODEL="${EMBEDDING_MODEL:-nomic-embed-text-v1.5}" \
  --from-literal=EMBEDDING_TIMEOUT="${EMBEDDING_TIMEOUT:-15000}" \
  --from-literal=LLM_TIMEOUT="${LLM_TIMEOUT:-60000}" \
  --from-literal=CLUSTERING_THRESHOLD="${CLUSTERING_THRESHOLD:-0.85}" \
  -n ${PROJECT_NAME}

echo ""
echo -e "${GREEN}Step 3: Creating application secrets${NC}"
oc delete secret qaroot-secrets -n ${PROJECT_NAME} 2>/dev/null || true
oc create secret generic qaroot-secrets \
  --from-literal=JWT_SECRET="${JWT_SECRET}" \
  --from-literal=SESSION_SECRET="${SESSION_SECRET}" \
  --from-literal=DATABASE_PASSWORD="${DATABASE_PASSWORD}" \
  --from-literal=REDIS_PASSWORD="${REDIS_PASSWORD}" \
  --from-literal=AMQ_PASSWORD="${AMQ_PASSWORD}" \
  -n ${PROJECT_NAME}

echo ""
echo -e "${GREEN}Step 4: Deploying with Helm${NC}"
cd "$(dirname "$0")/../helm"
helm upgrade --install ${HELM_RELEASE_NAME} qaroot \
  --namespace ${PROJECT_NAME} \
  --wait \
  --timeout 10m

echo ""
echo -e "${GREEN}Step 5: Waiting for pods to be ready${NC}"
echo "This may take a few minutes..."
oc wait --for=condition=ready pod \
  -l app.kubernetes.io/instance=${HELM_RELEASE_NAME} \
  -n ${PROJECT_NAME} \
  --timeout=10m || echo "Warning: Some pods may still be starting"

echo ""
echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""

# Get pod status
echo -e "${BLUE}Pod Status:${NC}"
oc get pods -n ${PROJECT_NAME}
echo ""

# Get the frontend route
ROUTE_URL=$(oc get route qaroot-frontend -n ${PROJECT_NAME} -o jsonpath='{.spec.host}' 2>/dev/null || echo "")

if [ -n "$ROUTE_URL" ]; then
    echo -e "${GREEN}✓ Application URL:${NC} ${BLUE}https://${ROUTE_URL}${NC}"
    echo ""
    echo -e "${YELLOW}Default Login Credentials:${NC}"
    echo "  Username: ${BLUE}admin${NC}"
    echo "  Password: ${BLUE}changeme123${NC}"
    echo ""
else
    echo -e "${YELLOW}Note: Route not found yet. Run to get URL later:${NC}"
    echo "  oc get route -n ${PROJECT_NAME}"
    echo ""
fi

echo -e "${YELLOW}Useful Commands:${NC}"
echo "  View pods:         ${BLUE}oc get pods -n ${PROJECT_NAME}${NC}"
echo "  View worker logs:  ${BLUE}oc logs -f deployment/qaroot-worker-pool -n ${PROJECT_NAME}${NC}"
echo "  View API logs:     ${BLUE}oc logs -f deployment/qaroot-api-service -n ${PROJECT_NAME}${NC}"
echo "  View routes:       ${BLUE}oc get route -n ${PROJECT_NAME}${NC}"
echo "  Scale workers:     ${BLUE}oc scale deployment/qaroot-worker-pool --replicas=2 -n ${PROJECT_NAME}${NC}"
echo "  Uninstall:         ${BLUE}helm uninstall ${HELM_RELEASE_NAME} -n ${PROJECT_NAME}${NC}"
echo ""

echo -e "${GREEN}Deployment script completed successfully!${NC}"
