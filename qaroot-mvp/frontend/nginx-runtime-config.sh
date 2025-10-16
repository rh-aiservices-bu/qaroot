#!/bin/bash
set -e

# Determine the base URL for API and WebSocket
# If running in OpenShift/production, use relative paths (proxied through nginx)
# If VITE_API_URL is explicitly set, use it (for local development)
if [ -z "$VITE_API_URL" ]; then
  # Production: use relative paths that nginx will proxy
  # Note: Empty string because api.ts adds /api/v1, and nginx proxies /api/* to the API service
  # WebSocket: Use dynamic JavaScript to determine protocol and host at runtime
  API_URL=""
  WS_URL_JS="(window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host"
  cat > /opt/app-root/src/config.js << EOF
window.ENV = {
  VITE_API_URL: '',
  VITE_WS_URL: ${WS_URL_JS}
};
EOF
else
  # Development: use explicit URLs
  API_URL="$VITE_API_URL"
  WS_URL="${VITE_WS_URL:-ws://localhost:3001}"
  cat > /opt/app-root/src/config.js << EOF
window.ENV = {
  VITE_API_URL: '${API_URL}',
  VITE_WS_URL: '${WS_URL}'
};
EOF
fi

echo "Runtime configuration created:"
echo "  VITE_API_URL=${API_URL}"
if [ -z "$VITE_API_URL" ]; then
  echo "  VITE_WS_URL=<dynamic>"
else
  echo "  VITE_WS_URL=${WS_URL}"
fi

# Start nginx
exec nginx -g "daemon off;"
