/**
 * Socket.IO Real-Time Event Service
 * Broadcasts operational telemetry to authorized responder terminals with safe fallback
 */

let ioInstance = null;

export function registerSocketServer(io) {
  ioInstance = io;
}

export function getSocketServer() {
  return ioInstance;
}

/**
 * Emit real-time incident lifecycle events
 */
export function emitIncidentEvent(event, data) {
  try {
    if (ioInstance) {
      ioInstance.emit(event, data);
      ioInstance.emit('dashboard:refresh', { trigger: event, timestamp: new Date() });
    }
  } catch (err) {
    console.warn(`[SocketService] Warning: Failed to emit ${event}:`, err.message);
  }
}

/**
 * Trigger immediate dashboard metrics refresh
 */
export function emitDashboardRefresh(reason = 'update') {
  try {
    if (ioInstance) {
      ioInstance.emit('dashboard:refresh', { reason, timestamp: new Date() });
    }
  } catch (err) {
    console.warn('[SocketService] Warning: Failed to emit dashboard:refresh:', err.message);
  }
}
