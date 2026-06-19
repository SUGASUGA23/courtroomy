import React, { useState } from 'react';
import CreateCase from './CreateCase.jsx';
import JoinRoom from './JoinRoom.jsx';
import DisclaimerBanner from './DisclaimerBanner.jsx';
import Scales from './Scales.jsx';
import ServerSettings from './ServerSettings.jsx';

// Landing screen: choose to create a case or join an existing one with a code.
// onJoined({ code, you, state }) bubbles a successful create/join up to App.
export default function Home({ onJoined, onToast }) {
  const [mode, setMode] = useState('menu'); // 'menu' | 'create' | 'join'

  if (mode === 'create') {
    return <CreateCase onJoined={onJoined} onBack={() => setMode('menu')} />;
  }
  if (mode === 'join') {
    return <JoinRoom onJoined={onJoined} onBack={() => setMode('menu')} />;
  }

  return (
    <div className="entry-scene">
      <DisclaimerBanner />
      <div className="entry-center">
        <div className="entry-card">
          <Scales className="entry-emblem" />
          <h1 className="entry-title serif">The Honorable AI Judge</h1>
          <div className="entry-flourish" aria-hidden="true" />
          <p className="entry-tagline serif">
            A multiplayer mock-trial simulator presided over by an AI judge.
          </p>
          <div className="entry-actions">
            <button className="btn btn-primary" onClick={() => setMode('create')}>
              Create a Case
            </button>
            <button className="btn btn-secondary" onClick={() => setMode('join')}>
              Join with a Code
            </button>
          </div>
          <ServerSettings />
        </div>
      </div>
    </div>
  );
}
