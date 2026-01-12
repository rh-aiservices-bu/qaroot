#!/bin/bash
# Start QARoot infrastructure with Podman

# Check if pod exists
if podman pod exists qaroot-pod 2>/dev/null; then
  echo "Pod already exists, starting it..."
  podman pod start qaroot-pod
else
  echo "Creating pod for QARoot services..."
  podman pod create --name qaroot-pod -p 5432:5432 -p 6379:6379 -p 5672:5672 -p 8161:8161

  echo "Starting PostgreSQL..."
  podman run -d \
    --pod qaroot-pod \
    --name qaroot-postgres \
    -e POSTGRES_USER=qaroot \
    -e POSTGRES_PASSWORD=changeme \
    -e POSTGRES_DB=qaroot_mvp \
    -v qaroot-postgres-data:/var/lib/postgresql/data \
    docker.io/pgvector/pgvector:pg15

  echo "Starting Redis..."
  podman run -d \
    --pod qaroot-pod \
    --name qaroot-redis \
    docker.io/redis:7-alpine \
    redis-server --appendonly yes

  echo "Starting ActiveMQ Artemis..."
  podman run -d \
    --pod qaroot-pod \
    --name qaroot-amq \
    -e ARTEMIS_USER=admin \
    -e ARTEMIS_PASSWORD=changeme \
    docker.io/apache/activemq-artemis:latest
fi

echo "✓ All services started!"
echo ""
echo "PostgreSQL: localhost:5432"
echo "Redis: localhost:6379"
echo "AMQ AMQP: localhost:5672"
echo "AMQ Console: http://localhost:8161"
echo ""
echo "To stop: ./stop-podman.sh"
