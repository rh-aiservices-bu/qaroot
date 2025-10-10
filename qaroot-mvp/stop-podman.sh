#!/bin/bash
# Stop QARoot infrastructure

echo "Stopping and removing containers..."
podman stop qaroot-postgres qaroot-redis qaroot-amq 2>/dev/null
podman rm qaroot-postgres qaroot-redis qaroot-amq 2>/dev/null

echo "Removing pod..."
podman pod rm qaroot-pod 2>/dev/null

echo "✓ All services stopped!"
echo ""
echo "To remove data volumes, run:"
echo "  podman volume rm qaroot-postgres-data"
