import { io, Socket } from 'socket.io-client';

// Runtime config from window.ENV or build-time env
// @ts-ignore
const WS_URL = (typeof window !== 'undefined' && window.ENV?.VITE_WS_URL) || import.meta.env.VITE_WS_URL || 'http://localhost:3001';

console.log('WS_URL:', WS_URL);

let socket: Socket | null = null;

export function connectSocket(): Socket {
  if (socket && socket.connected) {
    return socket;
  }

  socket = io(WS_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });

  socket.on('connect', () => {
    console.log('WebSocket connected');
  });

  socket.on('disconnect', () => {
    console.log('WebSocket disconnected');
  });

  socket.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function getSocket(): Socket | null {
  return socket;
}
