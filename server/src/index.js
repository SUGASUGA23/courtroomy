// Courtroom server: Express + Socket.io. Wires rooms + the streamed AI judge.
// EDUCATIONAL SIMULATION ONLY. The LLM API key never reaches the client.

import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';

import { EVENTS, ROLES, PHASES } from './protocol.js';
import { streamJudge } from './judge.js';
import { generateArgument } from './lawyer.js';
import {
  createRoom,
  getRoom,
  deleteRoom,
  join,
  pickRole,
  startTrial,
  submitArgument,
  submitArgumentByRole,
  raiseObjection,
  enterVerdict,
  endTrial,
  leave,
  roomEmpty,
  publicState,
  addTranscript,
  appendNote,
  getParticipant,
  isAiRole,
  speakingPhase,
  lawyerDisplayName,
} from './rooms.js';

const PORT = process.env.PORT || 4000;
// CORS: default to allowing ANY origin so the Android app and other devices on
// your network can connect (the API key never reaches the client, so this is
// safe for this educational app). Lock it down by setting CLIENT_ORIGIN to a
// specific URL, or a comma-separated list, in server/.env.
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';
const corsOrigin =
  CLIENT_ORIGIN === '*' ? '*' : CLIENT_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);

const app = express();
app.use(cors({ origin: corsOrigin }));
app.get('/health', (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
});

function broadcastState(room) {
  io.to(room.code).emit(EVENTS.ROOM_STATE, publicState(room));
}

// Parse the machine-readable "RESULT: winner=<A|B|tie>; scoreA=<n>; scoreB=<n>"
// line the judge appends to its verdict. Returns { result, cleanText } where
// `cleanText` has that line stripped, and `result` is null if absent/unparseable.
function parseVerdictResult(room, fullText) {
  const text = typeof fullText === 'string' ? fullText : '';
  const m = text.match(/^[ \t>*_-]*RESULT:\s*winner\s*=\s*(A|B|tie)\s*;\s*scoreA\s*=\s*(\d{1,2})\s*;\s*scoreB\s*=\s*(\d{1,2})/im);
  if (!m) {
    return { result: null, cleanText: text };
  }
  const clamp = (n) => Math.max(0, Math.min(10, n));
  const winnerToken = m[1].toLowerCase();
  const winner = winnerToken === 'a' ? 'lawyerA' : winnerToken === 'b' ? 'lawyerB' : 'tie';
  const result = {
    winner,
    scoreA: clamp(parseInt(m[2], 10)),
    scoreB: clamp(parseInt(m[3], 10)),
    sideA: room.sideA,
    sideB: room.sideB,
  };
  // Remove the whole RESULT line (and any trailing blank lines it left behind).
  const cleanText = text.replace(/[ \t>*_-]*RESULT:\s*winner\s*=\s*(?:A|B|tie)\s*;[^\n]*\n?/i, '').trimEnd();
  return { result, cleanText };
}

function roleName(room, role) {
  const p = room.participants.find((x) => x.role === role);
  return p ? p.name : null;
}

// Stream a judge utterance to all clients in the room, append the finalized
// transcript entry, then emit JUDGE_DONE + ROOM_STATE.
//   kind   : judge kind
//   latest : { side, name, text } | null
//   type   : transcript entry type ('judge' | 'objection' | 'verdict')
async function runJudge(room, { kind, latest, type = 'judge' }) {
  const code = room.code;
  io.to(code).emit(EVENTS.JUDGE_THINKING, { code });

  let fullText;
  try {
    fullText = await streamJudge(
      { state: publicState(room), kind, latest, judgeNotes: room.judgeNotes },
      (delta) => io.to(code).emit(EVENTS.JUDGE_TOKEN, { code, delta }),
    );
  } catch (err) {
    fullText = 'The court reserves comment at this time. (Educational simulation only.)';
  }

  // For the verdict, parse + strip the machine-readable RESULT line so the stored
  // transcript shows clean prose and room.result drives the on-screen banner.
  let storedText = fullText;
  if (kind === 'verdict') {
    const { result, cleanText } = parseVerdictResult(room, fullText);
    storedText = cleanText;
    if (result) {
      room.result = result;
      console.log(`[verdict] parsed RESULT → winner=${result.winner} scoreA=${result.scoreA} scoreB=${result.scoreB}`);
    } else {
      console.warn('[verdict] no parseable RESULT line found; result stays null');
    }
  }

  const entry = addTranscript(room, { type, role: null, name: 'The Judge', text: storedText });

  // Private note: track each side's argument strength after each argument.
  if (latest && latest.side) {
    appendNote(room, latest.side, `[${kind}] ${(latest.text || '').slice(0, 200)}`);
  }

  io.to(code).emit(EVENTS.JUDGE_DONE, { code, entry });
  broadcastState(room);
  return fullText;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Pacing delay so spectators can read AI-vs-AI exchanges (ms).
const AI_PACE_MS = 1100;

// Given the result of a submit (human OR AI), run the judge response and, if the
// closing is complete, deliver the verdict and end the trial. Shared by the human
// SUBMIT_ARGUMENT handler and the AI driver so both behave identically.
async function resolveAfterArgument(room, result) {
  broadcastState(room);

  const latest = {
    side: result.side,
    name: result.entry.name,
    text: result.entry.text,
  };
  await runJudge(room, { kind: result.judgeKind, latest, type: 'judge' });

  // If closing is complete, deliver the final verdict.
  if (result.advanced && result.verdict) {
    enterVerdict(room);
    broadcastState(room);
    await runJudge(room, { kind: 'verdict', latest: null, type: 'verdict' });
    endTrial(room);
    broadcastState(room);
  }
}

// Map the trial phase to the AI lawyer 'kind'.
function lawyerKindForPhase(phase) {
  if (phase === PHASES.OPENING) return 'opening';
  if (phase === PHASES.CLOSING) return 'closing';
  return 'argument'; // PHASES.ARGUMENTS
}

// SERVER-DRIVEN AI loop. While the trial is in a speaking phase and it is an
// AI-controlled seat's turn, the server auto-produces that lawyer's argument
// (instead of waiting for a human SUBMIT_ARGUMENT), records it as a normal
// 'argument' entry, runs the SAME judge-response flow, then re-evaluates and
// loops. Stops when the turn becomes a human seat or the trial reaches verdict/
// ENDED. Guarded by room.aiBusy so only one loop runs per room.
async function driveAI(room) {
  if (!room || room.aiBusy) return;
  room.aiBusy = true;
  try {
    let guard = 0;
    while (
      room.status === 'in-trial' &&
      speakingPhase(room.phase) &&
      room.currentTurn &&
      isAiRole(room, room.currentTurn) &&
      guard < 50
    ) {
      guard += 1;
      const role = room.currentTurn;
      const kind = lawyerKindForPhase(room.phase);

      // Show "Counsel is composing…" in the UI.
      room.aiThinking = role;
      broadcastState(room);
      await delay(AI_PACE_MS);

      let text;
      try {
        text = await generateArgument({ state: publicState(room), role, kind });
      } catch (_err) {
        text = null;
      }
      // Defensive fallback so the loop never stalls on a thrown/empty result.
      if (!text || !text.trim()) {
        text = 'Your Honor, counsel rests on the arguments already before this court. (Educational simulation only.)';
      }

      // The turn may have changed (e.g. a lawyer left) while awaiting the model.
      if (room.status !== 'in-trial' || room.currentTurn !== role || !isAiRole(room, role)) {
        room.aiThinking = null;
        broadcastState(room);
        break;
      }

      const result = submitArgumentByRole(room, role, text, lawyerDisplayName(room, role));
      room.aiThinking = null;
      if (!result.ok) {
        broadcastState(room);
        break;
      }

      await resolveAfterArgument(room, result);
      await delay(AI_PACE_MS);
      // Loop re-checks currentTurn: continues for AI-vs-AI, stops on a human seat.
    }
  } finally {
    room.aiThinking = null;
    room.aiBusy = false;
    broadcastState(room);
  }
}

io.on('connection', (socket) => {
  socket.data.code = null;

  socket.on(EVENTS.CREATE_ROOM, (payload = {}, ack) => {
    try {
      const room = createRoom(payload, socket.id);
      socket.join(room.code);
      socket.data.code = room.code;
      const you = getParticipant(room, socket.id);
      if (typeof ack === 'function') {
        ack({ ok: true, code: room.code, you: { id: you.id, role: you.role, name: you.name }, state: publicState(room) });
      }
      broadcastState(room);
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Could not create room.' });
    }
  });

  socket.on(EVENTS.JOIN_ROOM, (payload = {}, ack) => {
    const room = getRoom(payload.code);
    if (!room) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Room not found.' });
      return;
    }
    const you = join(room, { id: socket.id, name: payload.name });
    socket.join(room.code);
    socket.data.code = room.code;
    if (typeof ack === 'function') {
      ack({ ok: true, you: { id: you.id, role: you.role, name: you.name }, state: publicState(room) });
    }
    broadcastState(room);
  });

  socket.on(EVENTS.PICK_ROLE, (payload = {}, ack) => {
    const room = getRoom(payload.code);
    if (!room) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Room not found.' });
      return;
    }
    const result = pickRole(room, socket.id, payload.role);
    if (typeof ack === 'function') ack(result);
    if (result.ok) broadcastState(room);
  });

  socket.on(EVENTS.START_TRIAL, async (payload = {}, ack) => {
    const room = getRoom(payload.code);
    if (!room) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Room not found.' });
      return;
    }
    const result = startTrial(room, socket.id);
    if (!result.ok) {
      if (typeof ack === 'function') ack(result);
      socket.emit(EVENTS.ERROR_MSG, { message: result.error });
      return;
    }
    if (typeof ack === 'function') ack({ ok: true });
    broadcastState(room);
    // Judge gives an opening scene-setting statement.
    await runJudge(room, { kind: 'opening_scene', latest: null, type: 'judge' });
    // If it is now an AI seat's turn (e.g. ava, or hva with AI on side A),
    // the server drives the AI. In ava this runs the whole trial to verdict.
    await driveAI(room);
  });

  socket.on(EVENTS.SUBMIT_ARGUMENT, async (payload = {}, ack) => {
    const room = getRoom(payload.code);
    if (!room) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Room not found.' });
      return;
    }
    const result = submitArgument(room, socket.id, payload.text);
    if (!result.ok) {
      if (typeof ack === 'function') ack(result);
      socket.emit(EVENTS.ERROR_MSG, { message: result.error });
      return;
    }
    if (typeof ack === 'function') ack({ ok: true });

    // Record the argument, run the judge, and (if closing is done) the verdict.
    await resolveAfterArgument(room, result);

    // If it is now an AI opponent's turn, the server drives its response.
    await driveAI(room);
  });

  socket.on(EVENTS.RAISE_OBJECTION, async (payload = {}, ack) => {
    const room = getRoom(payload.code);
    if (!room) {
      if (typeof ack === 'function') ack({ ok: false, error: 'Room not found.' });
      return;
    }
    const result = raiseObjection(room, socket.id, payload.text);
    if (!result.ok) {
      if (typeof ack === 'function') ack(result);
      socket.emit(EVENTS.ERROR_MSG, { message: result.error });
      return;
    }
    if (typeof ack === 'function') ack({ ok: true });

    // The objector's stated complaint was just recorded in the transcript; show it.
    broadcastState(room);

    // Rule on the SPECIFIC objection the user stated. `latest.text` is the user's
    // complaint (the grounds), attributed to the objector, so the judge rules on it.
    const latest = {
      // objector.role may be null when a spectator/host objects with no active turn.
      side: result.objector.role === ROLES.LAWYER_B ? 'lawyerB' : 'lawyerA',
      name: result.objector.name,
      text: result.complaint,
    };
    // Judge rules Sustained/Overruled. Turn is unchanged (objections don't consume a turn).
    await runJudge(room, { kind: 'objection', latest, type: 'objection' });

    // If the floor still belongs to an AI seat (e.g. a human objected during the
    // AI's turn), let the server resume driving that AI's argument.
    await driveAI(room);
  });

  socket.on(EVENTS.LEAVE_ROOM, (payload = {}) => {
    const room = getRoom(payload.code) || getRoom(socket.data.code);
    if (!room) return;
    socket.leave(room.code);
    leave(room, socket.id);
    socket.data.code = null;
    if (roomEmpty(room)) {
      deleteRoom(room.code);
    } else {
      broadcastState(room);
    }
  });

  socket.on('disconnect', () => {
    const room = getRoom(socket.data.code);
    if (!room) return;
    leave(room, socket.id);
    if (roomEmpty(room)) {
      deleteRoom(room.code);
    } else {
      broadcastState(room);
    }
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Courtroom server listening on :${PORT} (client origin: ${CLIENT_ORIGIN})`);
});

export { app, server, io };
