import { io } from 'socket.io-client';

const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5000');

let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io(SOCKET_URL, {
      withCredentials: true,
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      console.log(`[Socket.IO Client] Connected to ResolveIQ telemetry hub (${socket.id})`);
    });

    socket.on('connect_error', (err) => {
      console.warn('[Socket.IO Client] Connection notice (falling back to API refresh):', err.message);
    });
  }
  return socket;
}

export function subscribeToEvent(event, callback) {
  const s = getSocket();
  s.on(event, callback);
  return () => {
    s.off(event, callback);
  };
}
