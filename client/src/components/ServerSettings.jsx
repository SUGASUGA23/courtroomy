import React, { useState, useEffect } from 'react';
import { socket, getServerUrl, setServerUrl } from '../socket.js';

// A small, collapsible "Server address" panel shown on the home screen. On the
// web the default (localhost) just works; in the Android app the player points
// this at their computer's network address (e.g. http://192.168.1.50:4000) or a
// hosted server. Shows live connection status so it's obvious when it's wired up.
export default function ServerSettings() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(getServerUrl());
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    const on = () => setConnected(true);
    const off = () => setConnected(false);
    socket.on('connect', on);
    socket.on('disconnect', off);
    socket.on('connect_error', off);
    return () => {
      socket.off('connect', on);
      socket.off('disconnect', off);
      socket.off('connect_error', off);
    };
  }, []);

  return (
    <div className={`server-settings${open ? ' open' : ''}`}>
      <button
        type="button"
        className="server-settings-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className={`conn-dot ${connected ? 'on' : 'off'}`} aria-hidden="true" />
        {connected ? 'Connected to court server' : 'Not connected'}
        <span className="server-settings-gear" aria-hidden="true">⚙</span>
      </button>

      {open ? (
        <div className="server-settings-body">
          <label className="server-settings-label">
            Server address
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://192.168.1.50:4000"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          <p className="server-settings-hint">
            On a phone, enter your computer's network address (e.g.
            {' '}<code>http://192.168.1.50:4000</code>) — not <code>localhost</code>. On the
            same Wi-Fi, find it with <code>ipconfig</code> on the PC running the server.
          </p>
          <div className="server-settings-actions">
            <button type="button" className="btn btn-secondary" onClick={() => setServerUrl(url)}>
              Save &amp; reconnect
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
