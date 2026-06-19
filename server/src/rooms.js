// In-memory, pure-ish room state + turn/phase logic for Courtroom.
// index.js owns socket wiring + judge calls. Functions here MUTATE the in-memory
// Map and return the new PUBLIC state (judgeNotes is NEVER part of public state).

import { ROLES, PHASES, MODES, CONTROLLER } from './protocol.js';

const rooms = new Map();

// 6-char uppercase codes, ambiguous chars (0/O/1/I/L) removed.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function makeCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

function uniqueCode() {
  let code;
  do {
    code = makeCode();
  } while (rooms.has(code));
  return code;
}

let entrySeq = 0;
function newId() {
  entrySeq += 1;
  return `e${Date.now().toString(36)}_${entrySeq}`;
}

function clampRounds(rounds) {
  const n = parseInt(rounds, 10);
  if (Number.isNaN(n)) return 1;
  return Math.max(1, Math.min(5, n));
}

// Derive the lawyer-seat controllers map from the chosen mode (+ the human side
// chosen for hva). Returns { lawyerA: 'human'|'ai', lawyerB: 'human'|'ai' }.
function deriveLawyers(mode, humanSide) {
  switch (mode) {
    case MODES.AVA:
      return { lawyerA: CONTROLLER.AI, lawyerB: CONTROLLER.AI };
    case MODES.HVA: {
      // The human argues `humanSide` (default lawyerA); the other side is AI.
      const human = humanSide === ROLES.LAWYER_B ? ROLES.LAWYER_B : ROLES.LAWYER_A;
      return {
        lawyerA: human === ROLES.LAWYER_A ? CONTROLLER.HUMAN : CONTROLLER.AI,
        lawyerB: human === ROLES.LAWYER_B ? CONTROLLER.HUMAN : CONTROLLER.AI,
      };
    }
    case MODES.HVH:
    default:
      return { lawyerA: CONTROLLER.HUMAN, lawyerB: CONTROLLER.HUMAN };
  }
}

function normalizeMode(mode) {
  return mode === MODES.HVA || mode === MODES.AVA ? mode : MODES.HVH;
}

// The creator is auto-seated as a human lawyer so the name they typed appears on
// the podium (instead of a generic "Lawyer A") and they can argue immediately.
//   HVH -> creator takes Side A; the second human joins and claims Side B.
//   HVA -> creator takes the side they chose to argue (humanSide); the other is AI.
//   AVA -> no human seats, so the creator presides as a spectator (role null).
function deriveHostRole(mode, humanSide) {
  if (mode === MODES.AVA) return null;
  if (mode === MODES.HVA) {
    return humanSide === ROLES.LAWYER_B ? ROLES.LAWYER_B : ROLES.LAWYER_A;
  }
  return ROLES.LAWYER_A;
}

// Is the given lawyer role controlled by the AI in this room?
export function isAiRole(room, role) {
  return Boolean(room.lawyers && room.lawyers[role] === CONTROLLER.AI);
}

function sideKey(role) {
  return role === ROLES.LAWYER_A ? 'lawyerA' : 'lawyerB';
}

function speakingPhase(phase) {
  return phase === PHASES.OPENING || phase === PHASES.ARGUMENTS || phase === PHASES.CLOSING;
}

export { speakingPhase };

export function getRoom(code) {
  return rooms.get(code);
}

export function deleteRoom(code) {
  rooms.delete(code);
}

// Append a transcript entry. Returns the entry.
export function addTranscript(room, { type, role = null, name = null, text }) {
  const entry = {
    id: newId(),
    type,
    role,
    name,
    text,
    ts: Date.now(),
  };
  room.transcript.push(entry);
  return entry;
}

// PRIVATE judge log (server-only, never broadcast).
export function appendNote(room, side, summary) {
  room.judgeNotes.push({ side, summary, ts: Date.now() });
  return room.judgeNotes;
}

// Build the FULL PUBLIC room state. NEVER includes judgeNotes.
export function publicState(room) {
  return {
    code: room.code,
    caseTitle: room.caseTitle,
    caseType: room.caseType,
    description: room.description,
    facts: room.facts,
    jurisdiction: room.jurisdiction,
    sideA: room.sideA,
    sideB: room.sideB,
    clientA: room.clientA,
    clientB: room.clientB,
    rounds: room.rounds,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    status: room.status,
    currentTurn: room.currentTurn,
    mode: room.mode,
    lawyers: { lawyerA: room.lawyers.lawyerA, lawyerB: room.lawyers.lawyerB },
    aiThinking: room.aiThinking || null,
    result: room.result || null,
    submitted: { lawyerA: room.submitted.lawyerA, lawyerB: room.submitted.lawyerB },
    participants: room.participants.map((p) => ({ id: p.id, name: p.name, role: p.role })),
    transcript: room.transcript.map((t) => ({ ...t })),
  };
}

export function createRoom({ caseTitle, caseType, description, facts, jurisdiction, sideA, sideB, clientA, clientB, rounds, name, mode, humanSide }, hostSocketId) {
  const code = uniqueCode();
  const resolvedMode = normalizeMode(mode);
  const room = {
    code,
    caseTitle: caseTitle || 'Untitled Case',
    caseType: caseType || 'custom',
    description: description || '',
    facts: facts || '',
    jurisdiction: jurisdiction || 'auto',
    sideA: sideA || 'Plaintiff',
    sideB: sideB || 'Defendant',
    clientA: (clientA || '').toString().trim(),
    clientB: (clientB || '').toString().trim(),
    rounds: clampRounds(rounds),
    hostId: hostSocketId,
    phase: PHASES.LOBBY,
    round: 0,
    status: 'lobby',
    currentTurn: null,
    mode: resolvedMode,
    lawyers: deriveLawyers(resolvedMode, humanSide),
    aiThinking: null, // transient: role currently being composed by an AI lawyer
    aiBusy: false, // server-only guard so only one driveAI loop runs per room
    result: null, // verdict outcome { winner, scoreA, scoreB, sideA, sideB } once decided
    submitted: { lawyerA: false, lawyerB: false },
    participants: [{ id: hostSocketId, name: name || 'Host', role: deriveHostRole(resolvedMode, humanSide) }],
    transcript: [],
    judgeNotes: [], // PRIVATE — never broadcast
  };
  rooms.set(code, room);
  return room;
}

export function join(room, { id, name }) {
  const existing = room.participants.find((p) => p.id === id);
  if (existing) {
    existing.name = name || existing.name;
    return existing;
  }
  const participant = { id, name: name || 'Guest', role: null };
  room.participants.push(participant);
  return participant;
}

// First claim wins for LAWYER_A / LAWYER_B. Returns { ok, error? }.
export function pickRole(room, id, role) {
  const participant = room.participants.find((p) => p.id === id);
  if (!participant) return { ok: false, error: 'You are not in this room.' };
  if (role !== ROLES.LAWYER_A && role !== ROLES.LAWYER_B && role !== ROLES.SPECTATOR) {
    return { ok: false, error: 'Invalid role.' };
  }
  if (role === ROLES.LAWYER_A || role === ROLES.LAWYER_B) {
    if (isAiRole(room, role)) {
      return { ok: false, error: 'That seat is argued by AI Counsel and cannot be claimed.' };
    }
    const taken = room.participants.find((p) => p.role === role && p.id !== id);
    if (taken) return { ok: false, error: 'That seat is already taken.' };
  }
  participant.role = role;
  return { ok: true };
}

export function getParticipant(room, id) {
  return room.participants.find((p) => p.id === id) || null;
}

export function lawyerSeatFilled(room, role) {
  return room.participants.some((p) => p.role === role);
}

// A human-controlled seat is "ready" only when a participant occupies it.
// An AI-controlled seat needs no human and is always considered ready.
export function seatReady(room, role) {
  if (isAiRole(room, role)) return true;
  return lawyerSeatFilled(room, role);
}

// Remove a participant. If a lawyer leaves mid-trial, the seat is freed; the
// trial pauses/awaits (caller broadcasts ROOM_STATE).
export function leave(room, id) {
  const idx = room.participants.findIndex((p) => p.id === id);
  if (idx === -1) return { wasLawyer: false, role: null };
  const [removed] = room.participants.splice(idx, 1);
  if (room.hostId === id && room.participants.length > 0) {
    room.hostId = room.participants[0].id;
  }
  const wasLawyer = removed.role === ROLES.LAWYER_A || removed.role === ROLES.LAWYER_B;
  return { wasLawyer, role: removed.role };
}

export function roomEmpty(room) {
  return room.participants.length === 0;
}

// START_TRIAL -> OPENING, round 0, currentTurn LAWYER_A, submitted reset.
// Returns { ok, error? }.
export function startTrial(room, hostId) {
  if (room.hostId !== hostId) return { ok: false, error: 'Only the host can begin the trial.' };
  if (room.status !== 'lobby') return { ok: false, error: 'Trial already started.' };
  // Every HUMAN-controlled lawyer seat must be filled; AI seats need no human.
  if (!seatReady(room, ROLES.LAWYER_A) || !seatReady(room, ROLES.LAWYER_B)) {
    return { ok: false, error: 'Every human lawyer seat must be filled to begin.' };
  }
  room.phase = PHASES.OPENING;
  room.round = 0;
  room.status = 'in-trial';
  room.currentTurn = ROLES.LAWYER_A;
  room.submitted = { lawyerA: false, lawyerB: false };
  return { ok: true };
}

// The label shown for an AI-controlled lawyer in the transcript.
export function lawyerDisplayName(room, role) {
  const occupant = room.participants.find((p) => p.role === role);
  if (occupant) return occupant.name;
  if (isAiRole(room, role)) {
    const side = role === ROLES.LAWYER_A ? room.sideA : room.sideB;
    return `AI Counsel (${side})`;
  }
  return role === ROLES.LAWYER_A ? 'Lawyer A' : 'Lawyer B';
}

// CORE submit logic, driven by ROLE (not socket id). Used by both the human
// SUBMIT_ARGUMENT path and the server-side AI driver. It does NOT enforce the
// human "is it your turn / are you in the room" checks — callers that wrap a
// human action validate that first. It DOES enforce phase + turn consistency so
// the server cannot corrupt the trial. Records the 'argument' entry, marks
// submitted, then determines the judge response kind and any auto-advance.
// Returns:
//   { ok:false, error }
//   { ok:true, entry, side, judgeKind, advanced:false }            (turn flipped, partner still to go)
//   { ok:true, entry, side, judgeKind, advanced:true, verdict:false } (phase advanced, no verdict)
//   { ok:true, entry, side, judgeKind, advanced:true, verdict:true }  (closing done -> verdict pending)
// The judge response (judgeKind) is emitted by index.js BEFORE any verdict.
export function submitArgumentByRole(room, role, text, name = null) {
  if (role !== ROLES.LAWYER_A && role !== ROLES.LAWYER_B) {
    return { ok: false, error: 'Only lawyers can submit arguments.' };
  }
  if (!speakingPhase(room.phase) || room.status !== 'in-trial') {
    return { ok: false, error: 'Not a speaking phase right now.' };
  }
  if (room.currentTurn !== role) {
    return { ok: false, error: 'It is not this lawyer\'s turn.' };
  }
  const trimmed = (text || '').trim();
  if (!trimmed) return { ok: false, error: 'The argument is empty.' };

  const side = sideKey(role);
  if (room.submitted[side]) return { ok: false, error: 'This side has already submitted for this phase.' };

  const speakerName = name || lawyerDisplayName(room, role);
  const entry = addTranscript(room, { type: 'argument', role, name: speakerName, text: trimmed });
  room.submitted[side] = true;

  let judgeKind;
  if (room.phase === PHASES.OPENING) judgeKind = 'opening_response';
  else if (room.phase === PHASES.ARGUMENTS) judgeKind = 'argument_response';
  else judgeKind = 'closing_response';

  const bothDone = room.submitted.lawyerA && room.submitted.lawyerB;

  if (!bothDone) {
    // Flip turn to the side that hasn't submitted.
    room.currentTurn = role === ROLES.LAWYER_A ? ROLES.LAWYER_B : ROLES.LAWYER_A;
    return { ok: true, entry, side, judgeKind, advanced: false };
  }

  // Both submitted -> AUTO-ADVANCE.
  if (room.phase === PHASES.OPENING) {
    room.phase = PHASES.ARGUMENTS;
    room.round = 1;
    room.submitted = { lawyerA: false, lawyerB: false };
    room.currentTurn = ROLES.LAWYER_A;
    return { ok: true, entry, side, judgeKind, advanced: true, verdict: false };
  }

  if (room.phase === PHASES.ARGUMENTS) {
    if (room.round < room.rounds) {
      room.round += 1;
      room.submitted = { lawyerA: false, lawyerB: false };
      room.currentTurn = ROLES.LAWYER_A;
    } else {
      room.phase = PHASES.CLOSING;
      room.round = 0;
      room.submitted = { lawyerA: false, lawyerB: false };
      room.currentTurn = ROLES.LAWYER_A;
    }
    return { ok: true, entry, side, judgeKind, advanced: true, verdict: false };
  }

  // CLOSING done -> VERDICT pending. index.js delivers verdict, then ENDED.
  room.currentTurn = null;
  return { ok: true, entry, side, judgeKind, advanced: true, verdict: true };
}

// HUMAN submit wrapper: validates the socket is a lawyer in the room and that it
// really is their turn before delegating to the role-driven core. AI seats can
// never be claimed by a human, so a human can only ever submit for their own
// human seat.
export function submitArgument(room, id, text) {
  const participant = getParticipant(room, id);
  if (!participant) return { ok: false, error: 'You are not in this room.' };
  const role = participant.role;
  if (role !== ROLES.LAWYER_A && role !== ROLES.LAWYER_B) {
    return { ok: false, error: 'Only lawyers can submit arguments.' };
  }
  if (isAiRole(room, role)) {
    return { ok: false, error: 'This seat is controlled by AI Counsel.' };
  }
  if (room.currentTurn !== role) {
    return { ok: false, error: 'It is not your turn.' };
  }
  return submitArgumentByRole(room, role, text, participant.name);
}

// Move to VERDICT phase (called by index.js once it is about to stream the verdict).
export function enterVerdict(room) {
  room.phase = PHASES.VERDICT;
  room.currentTurn = null;
}

// Finalize after verdict is delivered.
export function endTrial(room) {
  room.phase = PHASES.ENDED;
  room.status = 'ended';
  room.currentTurn = null;
}

// RAISE_OBJECTION: ANY participant in the room (host, spectator, or a lawyer not
// currently speaking) may object while the trial is in progress and in a speaking
// phase (opening / arguments / closing). This lets the watching human object even
// in AI-vs-AI mode. The objector STATES the grounds of their objection (`text`),
// which is recorded as an 'objection' transcript entry attributed to the OBJECTOR
// (the judge's ruling is appended separately by index.js after the judge streams).
// Turn is unchanged. Objections do NOT consume a turn.
export function raiseObjection(room, id, text) {
  const participant = getParticipant(room, id);
  if (!participant) return { ok: false, error: 'You are not in this room.' };
  if (!speakingPhase(room.phase) || room.status !== 'in-trial') {
    return { ok: false, error: 'Objections may only be raised while counsel has the floor.' };
  }
  const complaint = (text || '').trim();
  if (!complaint) return { ok: false, error: 'State the grounds of your objection.' };
  const role = participant.role;
  // A lawyer cannot object during their own turn; everyone else may object any time
  // counsel has the floor (the objection targets whoever is speaking).
  if ((role === ROLES.LAWYER_A || role === ROLES.LAWYER_B) && room.currentTurn === role) {
    return { ok: false, error: 'You cannot object during your own turn.' };
  }
  // The objector's "side" is the currently-speaking floor (the argument objected to).
  const objectingRole = role === ROLES.LAWYER_A || role === ROLES.LAWYER_B ? role : (room.currentTurn || null);
  // Record the objector's stated complaint as an 'objection' entry attributed to
  // them, so the court record shows what was objected to (the judge rules next).
  addTranscript(room, { type: 'objection', role: objectingRole, name: participant.name, text: complaint });
  return { ok: true, objector: { role: objectingRole, name: participant.name }, complaint };
}
