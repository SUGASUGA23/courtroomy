import React, { useState, useEffect, useCallback, useRef } from 'react';
import { socket } from './socket.js';
import { EVENTS } from './protocol.js';
import Home from './components/Home.jsx';
import Courtroom from './components/Courtroom.jsx';

let toastId = 0;

export default function App() {
  // screen: 'home' | 'courtroom'
  // you: { id, role, name } for the local participant
  // state: the full public ROOM_STATE broadcast from the server (source of truth)
  const [screen, setScreen] = useState('home');
  const [code, setCode] = useState(null);
  const [you, setYou] = useState(null);
  const [state, setState] = useState(null);

  // Live judge streaming state (not part of ROOM_STATE).
  const [judgeThinking, setJudgeThinking] = useState(false);
  const [judgeLive, setJudgeLive] = useState('');

  // Transient toasts for ERROR_MSG.
  const [toasts, setToasts] = useState([]);
  const youRef = useRef(you);
  youRef.current = you;

  const pushToast = useCallback((message) => {
    const id = ++toastId;
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, 4000);
  }, []);

  useEffect(() => {
    const onRoomState = (next) => {
      setState(next);
      // Keep the local participant's role in sync with the authoritative state.
      const me = youRef.current;
      if (me && next && Array.isArray(next.participants)) {
        const mine = next.participants.find((p) => p.id === me.id);
        if (mine && mine.role !== me.role) {
          setYou((y) => (y ? { ...y, role: mine.role } : y));
        }
      }
    };
    const onJudgeThinking = () => {
      setJudgeThinking(true);
      setJudgeLive('');
    };
    const onJudgeToken = ({ delta } = {}) => {
      setJudgeThinking(false);
      if (typeof delta === 'string') setJudgeLive((prev) => prev + delta);
    };
    const onJudgeDone = () => {
      // The finalized entry arrives in the next ROOM_STATE transcript.
      setJudgeThinking(false);
      setJudgeLive('');
    };
    const onError = ({ message } = {}) => {
      pushToast(message || 'An error occurred.');
    };

    socket.on(EVENTS.ROOM_STATE, onRoomState);
    socket.on(EVENTS.JUDGE_THINKING, onJudgeThinking);
    socket.on(EVENTS.JUDGE_TOKEN, onJudgeToken);
    socket.on(EVENTS.JUDGE_DONE, onJudgeDone);
    socket.on(EVENTS.ERROR_MSG, onError);

    return () => {
      socket.off(EVENTS.ROOM_STATE, onRoomState);
      socket.off(EVENTS.JUDGE_THINKING, onJudgeThinking);
      socket.off(EVENTS.JUDGE_TOKEN, onJudgeToken);
      socket.off(EVENTS.JUDGE_DONE, onJudgeDone);
      socket.off(EVENTS.ERROR_MSG, onError);
    };
  }, [pushToast]);

  // Called by Home after a successful CREATE_ROOM / JOIN_ROOM ack.
  const enterRoom = useCallback(({ code: roomCode, you: me, state: initialState }) => {
    if (roomCode) setCode(roomCode);
    if (me) setYou(me);
    if (initialState) setState(initialState);
    setScreen('courtroom');
  }, []);

  const leaveRoom = useCallback(() => {
    if (code) socket.emit(EVENTS.LEAVE_ROOM, { code });
    setScreen('home');
    setCode(null);
    setYou(null);
    setState(null);
    setJudgeThinking(false);
    setJudgeLive('');
  }, [code]);

  return (
    <>
      {screen === 'home' && (
        <Home onJoined={enterRoom} onToast={pushToast} />
      )}
      {screen === 'courtroom' && (
        <Courtroom
          code={code}
          you={you}
          state={state}
          judgeThinking={judgeThinking}
          judgeLive={judgeLive}
          onLeave={leaveRoom}
          onToast={pushToast}
        />
      )}

      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className="toast" role="alert">
            {t.message}
          </div>
        ))}
      </div>
    </>
  );
}
