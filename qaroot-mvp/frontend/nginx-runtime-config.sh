#!/bin/bash
set -e

# Create runtime config file
cat > /opt/app-root/src/config.js << EOF
window.ENV = {
  VITE_API_URL: '${VITE_API_URL:-http://localhost:3000}',
  VITE_WS_URL: '${VITE_WS_URL:-ws://localhost:3001}'
};
EOF

echo "Runtime configuration created:"
echo "  VITE_API_URL=${VITE_API_URL}"
echo "  VITE_WS_URL=${VITE_WS_URL}"

# Start nginx
exec nginx -g "daemon off;"
