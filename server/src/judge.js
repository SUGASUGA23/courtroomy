// server/src/judge.js
// Courtroom — AI judge service.
//
// Exposes streamJudge({ state, kind, latest, judgeNotes }, onToken) which streams
// an in-character judge response token-by-token via onToken(delta) and resolves
// with the full text. Uses a provider-agnostic OpenAI-compatible LLM (Gemini by
// default) when a key is configured; otherwise (or on any error) falls back to a
// built-in MOCK judge so the app runs with no key.
//
// EDUCATIONAL SIMULATION ONLY — not real legal advice.

import { isConfigured, modelName, streamChat } from './llm.js';

// Token budgets: snappy rulings, roomier verdict.
const MAX_TOKENS_RULING = 2000;
const MAX_TOKENS_VERDICT = 3000;

// The educational/illustrative caveat the judge attaches to any cited
// statute / precedent / principle.
const CAVEAT =
  'Note that any legal principles, statutes, or precedents I reference are offered ' +
  'for educational and illustrative purposes only — they may not reflect current or ' +
  'accurate law, and this proceeding is a simulation, not real legal advice.';

// ---------------------------------------------------------------------------
// Judge system prompt (persona)
// ---------------------------------------------------------------------------

function jurisdictionGuidanceForJudge(state) {
  const raw = ((state && state.jurisdiction) || 'auto').toString().trim();
  const j = raw.toLowerCase();
  let where;
  if (j === 'uk' || j === 'united kingdom') {
    where = 'United Kingdom';
  } else if (j === 'us' || j === 'usa' || j === 'united states') {
    where = 'United States';
  } else if (j === 'auto' || !j) {
    where =
      "infer it from the case (title, parties, description) — e.g. 'The People v X' or 'State v X' signal US criminal law; 'R v X' or 'Regina v X' signal UK criminal law; otherwise pick the most fitting jurisdiction";
  } else {
    // An arbitrary user-typed jurisdiction (e.g. "Japan", "China", "Germany"):
    // apply that country's real law by name.
    where = `${raw} — apply that jurisdiction's real law (its statutes/codes and legal doctrines)`;
  }
  return [
    'CITE REAL, RELEVANT LAW:',
    `- When you reference law, cite REAL, relevant authority by name. Jurisdiction: ${where}.`,
    "- Use that jurisdiction's law: UK → Acts of Parliament (e.g. the Equality Act 2010, the Theft Act 1968, the Children Act 1989) + common-law doctrines; US → federal/state statutes + constitutional provisions + doctrines.",
    '- Name actual statutes by name and year, doctrines (e.g. actus reus, mens rea, duty of care, burden of proof), constitutional provisions, and well-known principles. If unsure of an exact section number, name the Act or doctrine without inventing a precise citation.',
  ].join('\n');
}

function buildSystemPrompt(state, kind) {
  const s = state || {};
  const caseTitle = s.caseTitle || 'this matter';
  const caseType = s.caseType || 'general';
  const sideA = s.sideA || 'the plaintiff/prosecution';
  const sideB = s.sideB || 'the defense';
  const clientA = (s.clientA && String(s.clientA).trim()) || '';
  const clientB = (s.clientB && String(s.clientB).trim()) || '';
  const description = s.description || '(no further description provided)';
  const facts =
    s.facts && String(s.facts).trim() ? String(s.facts).trim() : '(no specific facts or evidence were provided)';

  // When a side names the human client it represents, tell the judge so it may
  // refer to the parties by name and name the winning party in the verdict.
  const clientsLine =
    clientA || clientB
      ? `- ${sideA} represents ${clientA || 'an unnamed party'}; ${sideB} represents ${clientB || 'an unnamed party'}. You may refer to the parties by name.`
      : null;

  return [
    'You are the presiding judge in a multiplayer MOCK-TRIAL SIMULATOR called "Courtroom".',
    'This is an EDUCATIONAL SIMULATION ONLY — it is not, and must never claim to be, real legal advice.',
    '',
    'PERSONA:',
    '- You are formal, fair, dignified, and impartial. You address the parties with measured, courtroom-appropriate language.',
    '- You preside over the proceeding and respond in character after each argument.',
    '',
    'KNOWLEDGE & HONESTY:',
    '- You rely ONLY on general legal knowledge from your training. You NEVER claim to look anything up live, consult a live database, or access current case law.',
    '- Do NOT append a legal disclaimer to every line. Keep your remarks natural and immersive; ONE clear educational caveat in your final verdict is sufficient.',
    '',
    jurisdictionGuidanceForJudge(s),
    '',
    'ENGAGE THE SUBSTANCE:',
    '- Ground EVERY response in the SPECIFIC argument, objection, or moment just presented. Briefly WEIGH the actual point or stake the lawyer just raised — what it establishes, where it is strong, where it is exposed — never a generic acknowledgement.',
    '- Reference the concrete facts and human stakes of this case (safety, welfare, harm, money, liberty, reputation, the parties\' circumstances) where the lawyers have invoked them.',
    '- You may ask at most one clarifying question when it genuinely aids the proceeding.',
    '',
    'OBJECTIONS:',
    '- When ruling on an objection, open with exactly one of "Sustained." or "Overruled." followed by a single-line reason grounded in the specific objection and the argument it targets.',
    '',
    'VERDICT:',
    '- Reason from the STRONGEST facts and stakes each side actually raised. SCORE EACH SIDE out of 10 with a single line of reasoning per side that points to their best concrete argument, then declare a clear WINNER with reasoning that references arguments from BOTH sides, and restate ONCE that this is an educational simulation.',
    '',
    'TONE & LENGTH — CONCISE, PLAIN, DIRECT:',
    '- Speak plainly and directly, like a real judge who gets to the point. No flowery, grandiose, or melodramatic language.',
    '- Keep per-argument replies and objection rulings to roughly 3-5 short sentences. Keep a verdict to a few short paragraphs. No padding.',
    '',
    'CASE BEFORE YOU:',
    `- Title: ${caseTitle}`,
    `- Type: ${caseType}`,
    `- ${sideA} (Lawyer A) vs. ${sideB} (Lawyer B)`,
    ...(clientsLine ? [clientsLine] : []),
    `- Description: ${description}`,
    `- Case facts / evidence: ${facts}`,
    '',
    `Current action kind: ${kind}.`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Messages from the transcript
// ---------------------------------------------------------------------------
//
// We map the public transcript onto an alternating user/assistant conversation:
//   - judge entries  -> assistant turns (what the court has already said)
//   - everything else (arguments, objections, system) -> user turns
// A final user turn instructs the judge what to do for THIS action.

function transcriptEntryToMessage(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const text = typeof entry.text === 'string' ? entry.text : '';
  if (entry.type === 'judge' || entry.type === 'verdict') {
    return { role: 'assistant', content: text };
  }
  const who = entry.name || entry.role || 'Party';
  const label =
    entry.type === 'argument'
      ? `${who} argues`
      : entry.type === 'objection'
        ? `${who} raises an objection`
        : entry.type === 'system'
          ? 'Court record'
          : who;
  return { role: 'user', content: `[${label}] ${text}` };
}

// Collapse consecutive same-role turns and ensure the conversation starts with
// a user turn (the chat API expects the first message after system to be 'user').
function normalizeMessages(messages) {
  const out = [];
  for (const m of messages) {
    if (!m || !m.content) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) {
      prev.content += '\n\n' + m.content;
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  // Drop a leading assistant turn — the first message must be 'user'.
  while (out.length && out[0].role === 'assistant') out.shift();
  return out;
}

function instructionForKind(kind, latest, state) {
  const said =
    latest && typeof latest.text === 'string' && latest.text.trim()
      ? latest.text.trim()
      : '';
  const who = (latest && (latest.name || latest.side)) || 'the speaking lawyer';
  const quoted = said ? `\n\nThe argument just made by ${who}:\n"""${said}"""` : '';
  // For an objection, `latest.text` is the objector's STATED GROUNDS, not an argument.
  const objectionQuoted = said ? `\n\nThe objection grounds stated by ${who}:\n"""${said}"""` : '';

  switch (kind) {
    case 'opening_scene':
      return (
        'Open the proceeding. Set the scene for this case in character: greet the court, ' +
        'briefly frame the matter and what each side must show, and remind everyone this is a simulation. ' +
        'Do not yet rule on anything.'
      );
    case 'opening_response':
      return (
        'Respond in character to the opening statement just delivered. Briefly WEIGH the specific case theory and the stakes it raised — ' +
        'what it establishes and what it still leaves open — and you may pose at most one clarifying question. Do not append a disclaimer.' +
        quoted
      );
    case 'argument_response':
      return (
        'Respond in character to the argument just made. Engage with the SPECIFIC point and the concrete fact or stake it rests on: ' +
        'note its force, and where it remains exposed or unanswered. Weigh it fairly and you may pose at most one clarifying question. Do not append a disclaimer.' +
        quoted
      );
    case 'closing_response':
      return (
        'Respond in character to the closing argument just delivered. Weigh how its strongest facts and stakes tie the case together ' +
        'and what it asks the court to conclude. Do not append a disclaimer.' +
        quoted
      );
    case 'objection':
      return (
        'A participant has raised an objection on the specific grounds quoted below. Rule on THOSE grounds now. ' +
        'Begin your reply with exactly "Sustained." or "Overruled." and give a one-line reason that references the specific grounds stated.' +
        objectionQuoted
      );
    case 'verdict':
      return (
        'Deliver your final verdict, reasoning from the STRONGEST facts and stakes each side actually raised. First SCORE EACH SIDE out of 10, ' +
        'giving one line of reasoning per side that points to their best concrete argument (format each as "<side>: X/10 — reason"). Then declare a clear WINNER, ' +
        'with reasoning that references arguments from BOTH sides, and restate ONCE that this is an educational simulation. ' +
        'Keep the prose concise and plain. ' +
        'Then, as the VERY LAST line and with NOTHING after it, output exactly one machine-readable line in this format ' +
        '(A = ' + ((state && state.sideA) || 'side A') + ', B = ' + ((state && state.sideB) || 'side B') + '):\n' +
        'RESULT: winner=<A|B|tie>; scoreA=<0-10>; scoreB=<0-10>'
      );
    default:
      return (
        'Respond in character to the most recent development in the proceeding, grounded in what was just said.' +
        quoted
      );
  }
}

function buildMessages(state, kind, latest) {
  const transcript = (state && Array.isArray(state.transcript) && state.transcript) || [];
  const mapped = transcript.map(transcriptEntryToMessage).filter(Boolean);
  mapped.push({ role: 'user', content: instructionForKind(kind, latest, state) });
  const normalized = normalizeMessages(mapped);
  if (!normalized.length) {
    normalized.push({ role: 'user', content: instructionForKind(kind, latest, state) });
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// LLM streaming path (OpenAI-compatible — Gemini by default)
// ---------------------------------------------------------------------------

async function streamReal({ state, kind, latest }, onToken) {
  const system = buildSystemPrompt(state, kind);
  const messages = buildMessages(state, kind, latest);
  const maxTokens = kind === 'verdict' ? MAX_TOKENS_VERDICT : MAX_TOKENS_RULING;

  return streamChat({ system, messages, maxTokens }, (delta) => {
    if (delta) onToken(delta);
  });
}

// ---------------------------------------------------------------------------
// MOCK judge (no key / on error) — streams word-by-word via timed onToken calls
// ---------------------------------------------------------------------------

function illustrativePrincipleFor(kind, state) {
  const caseType = (state && state.caseType) || 'general';
  switch (kind) {
    case 'opening_scene':
      return 'the foundational principle that every party is entitled to a fair and impartial hearing';
    case 'opening_response':
      return 'the illustrative principle that an opening statement frames the issues but is not itself evidence';
    case 'argument_response':
      return caseType === 'criminal'
        ? 'the illustrative principle that the burden of proof rests on the prosecution beyond a reasonable doubt'
        : 'the illustrative principle that the party asserting a claim generally bears the burden of proving it';
    case 'closing_response':
      return 'the illustrative principle that closing argument must rest on what was actually placed before the court';
    case 'objection':
      return 'the illustrative principle that objections guard the relevance and fairness of what the court may consider';
    case 'verdict':
      return 'the illustrative principle that a judgment must follow from the reasoned weighing of both parties\' positions';
    default:
      return 'a general, illustrative principle of fair adjudication';
  }
}

function buildMockText({ state, kind, latest }) {
  const said =
    latest && typeof latest.text === 'string' && latest.text.trim()
      ? latest.text.trim()
      : '';
  const who = (latest && (latest.name || latest.side)) || 'counsel';
  const principle = illustrativePrincipleFor(kind, state);
  const sideA = (state && state.sideA) || 'the first side';
  const sideB = (state && state.sideB) || 'the opposing side';
  // A short paraphrase of the point just made, so the bench can weigh the
  // actual substance rather than echo it verbatim.
  const point = said
    ? (() => {
        const first = said.split(/(?<=[.!?])\s+/)[0] || said;
        return first.length > 130 ? `${first.slice(0, 127)}…` : first;
      })()
    : '';
  const ref = point
    ? `I have heard ${who} press the point that ${point.charAt(0).toLowerCase()}${point.slice(1)}`
    : `I have noted the most recent submission from ${who}.`;

  switch (kind) {
    case 'opening_scene':
      return [
        'This court is now in session. We are here in an educational simulation to weigh the matter before us with care and impartiality.',
        `Both ${sideA} and ${sideB} will be heard in full, and I will rest my conclusions on the facts and the real stakes each side can prove.`,
      ].join(' ');
    case 'opening_response':
      return [
        `${ref}`,
        `Weighed against ${principle}, that theory frames the dispute squarely, though it is the proof of those stakes — not their assertion — that will decide this matter.`,
        'Counsel, what is the single fact you most want this court to keep in mind?',
      ].join(' ');
    case 'argument_response':
      return [
        `${ref}`,
        `Measured against ${principle}, that point carries real weight where it touches what is genuinely at stake here, yet it remains exposed until the opposing side has answered it.`,
        'I will hold it in the balance as the matter proceeds.',
      ].join(' ');
    case 'closing_response':
      return [
        `${ref}`,
        `In light of ${principle}, I accept this as a fair summation of the stakes urged upon the court.`,
        'The matter now stands ready for decision.',
      ].join(' ');
    case 'objection': {
      // Vary the ruling deterministically by the objection text length so the
      // mock judge produces both Sustained and Overruled outcomes.
      const sustained = said ? said.length % 2 === 0 : true;
      const ruling = sustained ? 'Sustained.' : 'Overruled.';
      const reason = sustained
        ? 'the objection identifies a genuine concern about what this court may properly consider'
        : 'the matter objected to remains within the bounds of fair argument';
      return [
        `${ruling}`,
        said ? `Counsel objects that "${said}".` : 'The court has heard the objection.',
        `I rule as I do because ${reason}, consistent with ${principle}.`,
      ].join(' ');
    }
    case 'verdict': {
      // Deterministic-but-varied scores derived from the transcript size so the
      // mock verdict still names a clear winner with per-side reasoning.
      const argCount =
        state && Array.isArray(state.transcript)
          ? state.transcript.filter((t) => t && t.type === 'argument').length
          : 0;
      const scoreA = 6 + (argCount % 3); // 6..8
      const scoreB = 6 + ((argCount + 1) % 4); // 6..9
      const aWins = scoreA >= scoreB;
      const winner = aWins ? sideA : sideB;
      const margin = Math.abs(scoreA - scoreB);
      const resultTag = `RESULT: winner=${aWins ? 'A' : 'B'}; scoreA=${scoreA}; scoreB=${scoreB}`;
      return [
        'Having heard the matter in full, I now deliver my verdict and my scoring in this simulation.',
        `Scoring — ${sideA}: ${scoreA}/10, for pressing its strongest facts and naming the concrete stakes it asked this court to protect.`,
        `${sideB}: ${scoreB}/10, for confronting those stakes head-on and exposing where the opposing case was thin.`,
        `Weighing the best of what each side actually argued${margin === 0 ? ', by the narrowest of margins,' : ''}, the more persuasive and better-grounded position is that of ${winner}, and I rule accordingly in favour of ${winner}.`,
        'Let the record reflect that this is an educational simulation and not real legal advice, nor a substitute for it.',
        CAVEAT,
        '\n' + resultTag,
      ].join(' ');
    }
    default:
      return [
        `${ref}`,
        `I consider it in light of ${principle} and what it means for the stakes of this case.`,
      ].join(' ');
  }
}

function streamMock({ state, kind, latest }, onToken) {
  const text = buildMockText({ state, kind, latest });
  const words = text.split(/(\s+)/).filter((w) => w.length > 0);

  return new Promise((resolve) => {
    let i = 0;
    const tick = () => {
      if (i >= words.length) {
        resolve(text);
        return;
      }
      onToken(words[i]);
      i += 1;
      setTimeout(tick, 28);
    };
    tick();
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Stream an in-character judge response.
 *
 * @param {object} params
 * @param {object} params.state       Public room state (must include transcript[]).
 * @param {string} params.kind        One of 'opening_scene' | 'opening_response' |
 *                                     'argument_response' | 'objection' |
 *                                     'closing_response' | 'verdict'.
 * @param {object} [params.latest]    Most recent relevant action { side, name, text }.
 * @param {Array}  [params.judgeNotes] Private notes log (passed for verdict context).
 * @param {(delta: string) => void} onToken  Called for each streamed chunk.
 * @returns {Promise<string>} The full judge text.
 */
export async function streamJudge({ state, kind, latest, judgeNotes }, onToken) {
  const cb = typeof onToken === 'function' ? onToken : () => {};

  if (isConfigured()) {
    try {
      const text = await streamReal({ state, kind, latest, judgeNotes }, cb);
      if (text && text.trim()) {
        console.log(`[judge] ✓ Gemini (${modelName()})`);
        return text;
      }
      // Empty response — fall through to mock.
      console.warn('[judge] ✗ LLM failed → MOCK: empty response');
    } catch (err) {
      // Any failure -> graceful mock fallback (so the app keeps running).
      console.warn(`[judge] ✗ LLM failed → MOCK: ${(err && err.message) || String(err)}`);
    }
  } else {
    console.log('[judge] no key → MOCK');
  }

  return streamMock({ state, kind, latest, judgeNotes }, cb);
}

/**
 * Append a short private note to the server-only judgeNotes log. Never broadcast.
 *
 * @param {Array}  judgeNotes  The room's private notes array (created if absent).
 * @param {string} side        Which side the note concerns (e.g. ROLES.LAWYER_A).
 * @param {string} summary     A short summary of that side's argument strength.
 * @returns {Array} The (mutated) judgeNotes array.
 */
export function appendNote(judgeNotes, side, summary) {
  const notes = Array.isArray(judgeNotes) ? judgeNotes : [];
  notes.push({
    side: side || null,
    summary: typeof summary === 'string' ? summary : String(summary == null ? '' : summary),
    ts: Date.now(),
  });
  return notes;
}

export default { streamJudge, appendNote };
