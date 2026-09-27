/**
 * Socket.IO connection, shared across the app.
 *
 * The server authenticates the socket from the same session cookie as the REST
 * API, so there is nothing to pass in. One connection is reused; components
 * subscribe and unsubscribe via `onEvent`.
 */
import { io } from 'socket.io-client';
import { useEffect, useRef } from 'react';

let socket = null;

export function getSocket() {
  if (socket) return socket;
  socket = io({
    path: '/socket.io',
    withCredentials: true,
    transports: ['websocket', 'polling'],
    reconnectionDelay: 700,
    reconnectionDelayMax: 6000,
  });
  return socket;
}

export function closeSocket() {
  if (socket) {
    socket.close();
    socket = null;
  }
}

/**
 * Subscribe to a socket event for the life of a component.
 *
 * The handler is held in a ref so a re-render does not detach and reattach the
 * listener — otherwise a fast-updating parent can drop an event in the gap.
 */
export function useSocketEvent(event, handler, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    if (!enabled) return undefined;
    const s = getSocket();
    const fn = (...args) => ref.current?.(...args);
    s.on(event, fn);
    return () => s.off(event, fn);
  }, [event, enabled]);
}

/** Watch one job's updates while a detail page is open. */
export function useJobWatch(jobId, enabled = true) {
  useEffect(() => {
    if (!jobId || !enabled) return undefined;
    const s = getSocket();

    const join = () => s.emit('job:watch', jobId);
    join();
    // Re-join after a reconnect, or the page goes quietly stale.
    s.on('connect', join);

    return () => {
      s.off('connect', join);
      s.emit('job:unwatch', jobId);
    };
  }, [jobId, enabled]);
}
