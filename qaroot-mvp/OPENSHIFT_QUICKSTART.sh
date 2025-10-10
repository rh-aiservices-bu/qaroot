#!/bin/bash
#
# QARoot MVP - OpenShift Quick Deployment Script
# This script provides a complete deployment to OpenShift
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}QARoot MVP - OpenShift Deployment${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""

# Configuration Variables
PROJECT_NAME="${PROJECT_NAME:-qaroot-mvp}"
HELM_RELEASE_NAME="${HELM_RELEASE_NAME:-qaroot}"

# Prompt for LLM configuration
echo -e "${YELLOW}LLM Configuration${NC}"
echo "Please provide your LLM and embedding service details:"
echo ""

read -p "LLM Endpoint URL (e.g., https://your-llm-endpoint/v1): " LLM_URL
read -p "LLM API Key: " LLM_API_KEY
read -p "Embedding Service URL (e.g., https://your-embedding-endpoint/embeddings): " EMBEDDING_URL
read -p "Embedding API Key: " EMBEDDING_API_KEY
read -p "Chat Model Name [qwen2.5-14b-instruct]: " CHAT_MODEL
CHAT_MODEL=${CHAT_MODEL:-qwen2.5-14b-instruct}
read -p "Embedding Model Name [nomic-embed-text-v1.5]: " EMBEDDING_MODEL
EMBEDDING_MODEL=${EMBEDDING_MODEL:-nomic-embed-text-v1.5}

echo ""
echo -e "${GREEN}Step 1: Creating OpenShift project${NC}"
oc new-project ${PROJECT_NAME} || oc project ${PROJECT_NAME}

echo ""
echo -e "${GREEN}Step 2: Creating LLM configuration secret${NC}"
oc create secret generic llm-config \
  --from-literal=EXTERNAL_LLM_URL="${LLM_URL}" \
  --from-literal=EXTERNAL_LLM_API_KEY="${LLM_API_KEY}" \
  --from-literal=EMBEDDING_SERVICE_URL="${EMBEDDING_URL}" \
  --from-literal=EMBEDDING_SERVICE_API_KEY="${EMBEDDING_API_KEY}" \
  --from-literal=CHAT_MODEL="${CHAT_MODEL}" \
  --from-literal=EMBEDDING_MODEL="${EMBEDDING_MODEL}" \
  --from-literal=EMBEDDING_TIMEOUT="15000" \
  --from-literal=LLM_TIMEOUT="60000" \
  --from-literal=CLUSTERING_THRESHOLD="0.85" \
  -n ${PROJECT_NAME} || echo "Secret already exists, updating..."

echo ""
echo -e "${GREEN}Step 3: Generating application secrets${NC}"
JWT_SECRET=$(openssl rand -base64 32)
SESSION_SECRET=$(openssl rand -base64 32)
DB_PASSWORD=$(openssl rand -base64 24)
REDIS_PASSWORD="qaroot$(openssl rand -base64 12)"
AMQ_PASSWORD="qaroot$(openssl rand -base64 12)"

oc create secret generic qaroot-secrets \
  --from-literal=JWT_SECRET="${JWT_SECRET}" \
  --from-literal=SESSION_SECRET="${SESSION_SECRET}" \
  --from-literal=DATABASE_PASSWORD="${DB_PASSWORD}" \
  --from-literal=REDIS_PASSWORD="${REDIS_PASSWORD}" \
  --from-literal=AMQ_PASSWORD="${AMQ_PASSWORD}" \
  -n ${PROJECT_NAME} || echo "Secret already exists, using existing..."

echo ""
echo -e "${GREEN}Step 4: Deploying with Helm${NC}"
helm install ${HELM_RELEASE_NAME} deployment/helm/qaroot \
  --namespace ${PROJECT_NAME} \
  --wait \
  --timeout 10m

echo ""
echo -e "${GREEN}Step 5: Waiting for pods to be ready${NC}"
oc wait --for=condition=ready pod \
  -l app.kubernetes.io/instance=${HELM_RELEASE_NAME} \
  -n ${PROJECT_NAME} \
  --timeout=5m

echo ""
echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""

# Get the frontend route
ROUTE_URL=$(oc get route qaroot-frontend -n ${PROJECT_NAME} -o jsonpath='{.spec.host}' 2>/dev/null || echo "Route not found")

if [ "$ROUTE_URL" != "Route not found" ]; then
    echo -e "${GREEN}Application URL:${NC} https://${ROUTE_URL}"
    echo ""
    echo -e "${YELLOW}Default Login Credentials:${NC}"
    echo "  Username: admin"
    echo "  Password: changeme123"
    echo ""
else
    echo -e "${RED}Warning: Could not retrieve route URL${NC}"
    echo "Run: oc get route -n ${PROJECT_NAME}"
fi

echo -e "${YELLOW}Useful Commands:${NC}"
echo "  View pods:    oc get pods -n ${PROJECT_NAME}"
echo "  View logs:    oc logs -f deployment/qaroot-api-service -n ${PROJECT_NAME}"
echo "  View routes:  oc get route -n ${PROJECT_NAME}"
echo "  Uninstall:    helm uninstall ${HELM_RELEASE_NAME} -n ${PROJECT_NAME}"
echo ""
