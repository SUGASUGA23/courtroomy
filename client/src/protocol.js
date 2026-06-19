// Shared protocol constants. MUST match client/src/protocol.js byte-for-byte.

export const EVENTS = {
  // client -> server
  CREATE_ROOM: 'room:create',
  JOIN_ROOM: 'room:join',
  PICK_ROLE: 'room:pickRole',
  START_TRIAL: 'trial:start',
  SUBMIT_ARGUMENT: 'argument:submit',
  // RAISE_OBJECTION payload: { code, text } — `text` is the user-stated objection
  // grounds (e.g. "Hearsay") that the judge rules on.
  RAISE_OBJECTION: 'objection:raise',
  LEAVE_ROOM: 'room:leave',
  // server -> client
  ROOM_STATE: 'room:state',
  JUDGE_THINKING: 'judge:thinking',
  JUDGE_TOKEN: 'judge:token',
  JUDGE_DONE: 'judge:done',
  ERROR_MSG: 'error:msg',
};

export const ROLES = { LAWYER_A: 'lawyerA', LAWYER_B: 'lawyerB', SPECTATOR: 'spectator' };

export const PHASES = { LOBBY: 'lobby', OPENING: 'opening', ARGUMENTS: 'arguments', CLOSING: 'closing', VERDICT: 'verdict', ENDED: 'ended' };

// Case modes chosen at creation.
//   HVH = Human vs Human  (both lawyer seats are human)
//   HVA = Human vs AI     (one human seat, one AI seat; creator picks the human side)
//   AVA = AI vs AI        (both lawyer seats are AI; no human lawyers needed)
export const MODES = { HVH: 'hvh', HVA: 'hva', AVA: 'ava' };

// Who controls a lawyer seat.
export const CONTROLLER = { HUMAN: 'human', AI: 'ai' };
