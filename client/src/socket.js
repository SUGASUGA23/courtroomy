import { io } from 'socket.io-client';

const STORAGE_KEY = 'courtroom.serverUrl';
// Build-time default. On the web this is fine (same machine). In the Android app
// `localhost` means the PHONE itself, so the address is overridable at runtime
// (Server settings on the home screen) and persisted in localStorage.
const DEFAULT_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:4000';

/** The backend URL to connect to: a saved override, else the build-time default. */
export function getServerUrl() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved.trim()) return saved.trim();
  } catch (_) {
    /* localStorage may be unavailable */
  }
  return DEFAULT_URL;
}

/** Persist a new server URL and reload so the socket reconnects to it. */
export function setServerUrl(url) {
  const clean = (url || '').trim().replace(/\/+$/, '');
  try {
    if (clean) localStorage.setItem(STORAGE_KEY, clean);
    else localStorage.removeItem(STORAGE_KEY);
  } catch (_) {
    /* ignore */
  }
  if (typeof window !== 'undefined' && window.location) window.location.reload();
}

export const socket = io(getServerUrl(), {
  autoConnect: true,
  transports: ['websocket', 'polling'],
});

// Emit an event and await its server ack callback.
// Resolves with the ack payload; rejects on timeout.
export function emitWithAck(event, payload, { timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error(`Request timed out: ${event}`));
    }, timeout);

    socket.emit(event, payload, (ack) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

export default socket;
