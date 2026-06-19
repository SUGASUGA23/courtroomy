// server/src/lawyer.js
// Courtroom — AI trial-advocate (lawyer) service.
//
// generateArgument({ state, role, kind }) -> Promise<string> of the full argument
// spoken by the AI lawyer in `role`. Uses a provider-agnostic OpenAI-compatible
// LLM (Gemini by default) when a key is configured; otherwise (or on error) it
// falls back to a MOCK.
//
// `kind` ∈ 'opening' | 'argument' | 'closing'.
//
// FACT-GROUNDING: every argument must explicitly reference the specific case
// facts/evidence (names, dates, amounts, documents, issues). The real-LLM path
// validates this and REGENERATES if the draft cites too few specifics, and the
// mock weaves the facts in directly. Generic "I appear for the defense" speeches
// with no factual analysis are not allowed.
//
// EDUCATIONAL SIMULATION ONLY — not real legal advice.

import { isConfigured, modelName, chat } from './llm.js';
import { ROLES } from './protocol.js';

const MAX_TOKENS = 2000; // headroom for Gemini 2.5 "thinking" + a full argument
const MAX_FACT_TARGET = 3; // must cite at least this many specifics (when that many exist)
const MAX_ATTEMPTS = 2; // regeneration cap for the real path (kept low to limit calls)

// ---------------------------------------------------------------------------
// Helpers over room state
// ---------------------------------------------------------------------------

function sideLabels(state, role) {
  const sideA = (state && state.sideA) || 'the plaintiff/prosecution';
  const sideB = (state && state.sideB) || 'the defense';
  if (role === ROLES.LAWYER_B) {
    return { mine: sideB, theirs: sideA };
  }
  return { mine: sideA, theirs: sideB };
}

// The named human client each side represents (optional). Returns the trimmed
// names for MY client and the OPPOSING client given the lawyer's role. Either may
// be '' when no client name was provided for that side.
function clientLabels(state, role) {
  const a = ((state && state.clientA) || '').toString().trim();
  const b = ((state && state.clientB) || '').toString().trim();
  if (role === ROLES.LAWYER_B) {
    return { myClient: b, theirClient: a };
  }
  return { myClient: a, theirClient: b };
}

// Jurisdiction guidance for the system prompt. When set to a real jurisdiction we
// name it; when 'auto' (or unset) we tell the model to infer it from the case.
function jurisdictionGuidance(state) {
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
    `- Cite REAL, relevant legal authority by name. Jurisdiction: ${where}.`,
    "- Use that jurisdiction's law: UK → Acts of Parliament (e.g. the Equality Act 2010, the Theft Act 1968, the Children Act 1989) + common-law doctrines; US → federal/state statutes + constitutional provisions + doctrines.",
    '- Name actual statutes by name and year, legal doctrines (e.g. actus reus, mens rea, duty of care, burden of proof), constitutional provisions, and well-known principles appropriate to the jurisdiction and case type.',
    '- Cite accurately to the best of your knowledge. If unsure of an exact section number, name the Act or doctrine without inventing a precise citation.',
  ].join('\n');
}

function opponentLastArgument(state, role) {
  const transcript = (state && Array.isArray(state.transcript) && state.transcript) || [];
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    const e = transcript[i];
    if (e && e.type === 'argument' && e.role && e.role !== role) return e;
  }
  return null;
}

function lastJudgeUtterance(state) {
  const transcript = (state && Array.isArray(state.transcript) && state.transcript) || [];
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    const e = transcript[i];
    // Only the bench speaks here: judge remarks, verdicts, and objection RULINGS
    // (objection entries authored by the bench have no role). A participant's
    // stated objection grounds (role set) is NOT a judge utterance.
    if (e && (e.type === 'judge' || e.type === 'verdict' || (e.type === 'objection' && !e.role))) return e;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fact extraction + checking
// ---------------------------------------------------------------------------
//
// Pull "specific particulars" out of the Facts/Evidence box (preferred) and the
// description: proper names, dates, money, numbers, percentages, quoted terms.
// These are what the lawyer must reference. countFactHits() then measures how
// many appear in a generated argument so we can regenerate weak drafts.

const NAME_STOPWORDS = new Set([
  'The', 'A', 'An', 'This', 'That', 'These', 'Those', 'Your', 'Honour', 'Honor', 'My', 'We', 'Our',
  'Court', 'Mr', 'Mrs', 'Ms', 'Dr', 'I', 'It', 'He', 'She', 'They', 'But', 'And', 'On', 'In', 'At',
  'Plaintiff', 'Defendant', 'Prosecution', 'Defense', 'Defence', 'Case',
]);

function extractSalientFacts(state) {
  const s = state || {};
  const facts = (s.facts && String(s.facts).trim()) || '';
  const desc = (s.description && String(s.description).trim()) || '';
  const clientA = (s.clientA && String(s.clientA).trim()) || '';
  const clientB = (s.clientB && String(s.clientB).trim()) || '';
  const src = `${facts}\n${desc}`.trim();
  // Nothing to ground on at all (no facts, no description, no named clients).
  if (!src && !clientA && !clientB) return [];

  const seen = new Map(); // lowercased -> original
  const add = (raw) => {
    if (!raw) return;
    const t = String(raw).trim().replace(/^["“'']+|["”'']+$/g, '').replace(/['’]s$/i, '').trim();
    if (t.length < 2) return;
    const key = t.toLowerCase();
    if (!seen.has(key)) seen.set(key, t);
  };

  // The named clients each side represents are salient particulars in their own
  // right — adding them means a lawyer must name their client to satisfy the
  // fact-grounding requirement.
  add(clientA);
  add(clientB);

  // Proper-noun sequences (1–4 capitalised words), minus common stopwords.
  (src.match(/[A-Z][a-zA-Z.'’-]+(?:\s+[A-Z][a-zA-Z.'’-]+){0,3}/g) || []).forEach((n) => {
    const head = n.split(/\s+/)[0];
    if (n.split(/\s+/).length === 1 && NAME_STOPWORDS.has(head)) return;
    add(n);
  });
  // Money, dates (12/03/2024 or 2024-03-12), percentages, multi-digit numbers.
  (src.match(/\$\s?\d[\d,]*(?:\.\d+)?/g) || []).forEach(add);
  (src.match(/\b\d{1,4}(?:[/.-]\d{1,4}){1,2}\b/g) || []).forEach(add);
  (src.match(/\b\d+\s?%/g) || []).forEach(add);
  (src.match(/\b\d{2,}\b/g) || []).forEach(add);
  // Month-name dates.
  (src.match(
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,?\s*\d{4})?/gi,
  ) || []).forEach(add);
  // Quoted phrases.
  (src.match(/["“'']([^"“''\n]{3,50})["”'']/g) || []).forEach(add);

  let list = [...seen.values()];
  // Drop near-duplicates: an entry that is a substring of a longer one
  // (e.g. "Sarah" / "Sarah's" when "Sarah Mitchell" is present).
  list = list.filter((a) => !list.some((b) => b !== a && b.toLowerCase().includes(a.toLowerCase())));
  return list.slice(0, 12);
}

function countFactHits(text, salient) {
  if (!text || !salient || !salient.length) return 0;
  const lower = String(text).toLowerCase();
  let n = 0;
  for (const f of salient) {
    if (lower.includes(String(f).toLowerCase())) n += 1;
  }
  return n;
}

function requiredFacts(salient) {
  return Math.min(MAX_FACT_TARGET, (salient && salient.length) || 0);
}

// ---------------------------------------------------------------------------
// System prompt (persona + hard fact-grounding requirement)
// ---------------------------------------------------------------------------

function buildSystemPrompt(state, role, kind, salient) {
  const s = state || {};
  const caseTitle = s.caseTitle || 'this matter';
  const caseType = s.caseType || 'general';
  const description = s.description || '(no further description provided)';
  const factsText =
    s.facts && String(s.facts).trim() ? String(s.facts).trim() : '(no specific facts or evidence were provided)';
  const { mine, theirs } = sideLabels(s, role);
  const { myClient, theirClient } = clientLabels(s, role);
  const need = requiredFacts(salient);

  const lines = [
    `You are a sharp, persuasive trial lawyer representing ${mine} in this mock trial. Argue to WIN.`,
    'You appear in a multiplayer MOCK-TRIAL SIMULATOR called "Courtroom". This is an EDUCATIONAL SIMULATION ONLY — but you play the role to the hilt, like a real advocate fighting for a client.',
    `Your opponent represents ${theirs}.`,
  ];
  if (myClient) {
    lines.push(
      '',
      `★ YOU ARE COUNSEL FOR ${myClient.toUpperCase()}:`,
      `- You represent ${myClient}, the ${mine}. Argue ${myClient}'s case on their behalf as their advocate, speak in the first person, and refer to your client by name (e.g. "my client, ${myClient}", "${myClient}'s position") throughout.`,
      `- The opposing party is ${theirClient || theirs}. Press ${myClient}'s case against ${theirClient || ('the ' + theirs)}.`,
    );
  }
  lines.push(
    '',
    '★ NON-NEGOTIABLE — GROUND EVERY ARGUMENT IN THE SPECIFIC CASE FACTS:',
    `- You MUST explicitly reference and ANALYSE at least ${Math.max(need, 3)} specific particulars from the case facts/evidence below — the people by name, the dates, the documents/evidence, the amounts, and the precise issues. Quote or cite them directly.`,
    '- A generic introduction ("I appear for the defense", "my client deserves justice", "the facts favour my client") with NO concrete factual analysis is FORBIDDEN. Lead with the facts, not with pleasantries.',
    '- Your opening, EVERY rebuttal, and your closing must each work the actual facts: state what a specific fact shows, why it matters, and how it compels a ruling for your client.',
  );
  if (salient && salient.length) {
    lines.push(
      `- The specific particulars in THIS case you must engage (reference at least ${Math.max(need, 3)} of them, by name/date/amount/document/issue): ${salient.join('; ')}.`,
    );
  }
  lines.push(
    '',
    jurisdictionGuidance(s),
    '',
    'YOUR MISSION — make SUBSTANTIVE, persuasive, case-specific arguments, never generic filler or echoes of your opponent:',
    "- Build a clear CASE THEORY: one through-line, grounded in the facts, that you return to every turn.",
    "- Marshal the CONCRETE facts and the HUMAN STAKES. Foreground what is actually at stake — a child's safety or welfare, real harm to a person, a livelihood or home, money owed, a person's liberty, a reputation — and spell out the real-world CONSEQUENCES of ruling each way.",
    '- If the provided facts are thin, you MAY introduce specific, plausible supporting details consistent with the scenario (names, dates, sums, a witness, a document) — vivid and concrete, never boilerplate.',
    '',
    'STRUCTURE EACH TURN:',
    '1. POSITION. 2. The KEY FACTS/EVIDENCE that support it (named, specific). 3. The applicable REAL LEGAL AUTHORITY (a named statute, doctrine, or principle for the jurisdiction above). 4. WHY the court must rule for your client, and the concrete consequence of failing to.',
    '',
    'ENGAGE THE OPPONENT:',
    "- In argument rounds, directly REBUT your opponent's specific points by name and dismantle them with facts; you MAY pose one pointed cross-examination-style question. In closing, drive home your strongest facts, answer their best point, and address the judge's concerns.",
    '',
    'TONE & VOICE — CONCISE, HUMAN, DIRECT:',
    '- Talk like a real, sharp lawyer who gets to the point. Plain and direct, NOT flowery. No "sacred duty", no "profound indicator", no purple or grandiose prose, no melodrama.',
    '- TIGHT: about 3-5 short sentences for an opening, argument, or closing. No padding. Every sentence lands a concrete point.',
    '- First person, addressing the bench ("Your Honour, my client…"). Persuasive and fact-grounded, just brief and natural. Never break character, never mention being an AI, never address the user, no stage directions.',
    '- Do NOT put a legal disclaimer in your argument; the proceeding already carries that caveat.',
    '',
    'CASE BEFORE THE COURT:',
    `- Title: ${caseTitle}`,
    `- Type: ${caseType}`,
    myClient
      ? `- You are counsel for ${myClient}, the ${mine}, opposed by counsel for ${theirClient || ('the ' + theirs)}.`
      : `- You are counsel for ${mine}, opposed by counsel for ${theirs}.`,
    `- Description: ${description}`,
    `- Case facts / evidence: ${factsText}`,
    '',
    `Current action kind: ${kind}.`,
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Messages from the transcript
// ---------------------------------------------------------------------------

function transcriptEntryToMessage(entry, role) {
  if (!entry || typeof entry !== 'object') return null;
  const text = typeof entry.text === 'string' ? entry.text : '';
  if (entry.type === 'argument' && entry.role === role) {
    return { role: 'assistant', content: text };
  }
  const who = entry.name || entry.role || 'Party';
  let label;
  if (entry.type === 'argument') label = `Opposing counsel (${who}) argues`;
  else if (entry.type === 'judge') label = 'The Judge';
  else if (entry.type === 'verdict') label = 'The Judge (verdict)';
  // An 'objection' entry authored by a participant (has a role) is the stated
  // grounds; one authored by the bench (role null) is the ruling.
  else if (entry.type === 'objection') label = entry.role ? `${who} objects` : 'The Judge rules on an objection';
  else if (entry.type === 'system') label = 'Court record';
  else label = who;
  return { role: 'user', content: `[${label}] ${text}` };
}

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
  while (out.length && out[0].role === 'assistant') out.shift();
  return out;
}

function instructionForKind(state, role, kind, salient) {
  const opp = opponentLastArgument(state, role);
  const judge = lastJudgeUtterance(state);
  const oppText =
    opp && typeof opp.text === 'string' && opp.text.trim()
      ? `\n\nYour opponent's latest argument:\n"""${opp.text.trim()}"""`
      : '';
  const judgeText =
    judge && typeof judge.text === 'string' && judge.text.trim()
      ? `\n\nThe court's most recent remark (address any question/concern it raised):\n"""${judge.text.trim()}"""`
      : '';
  const need = Math.max(requiredFacts(salient), 3);
  const factReminder =
    salient && salient.length
      ? `\n\nYou MUST explicitly cite and analyse at least ${need} of these specific particulars: ${salient.join('; ')}. Do NOT give a generic introduction.`
      : '\n\nDo NOT give a generic introduction — work the concrete facts of this case.';

  const brevity =
    ' Keep it tight: about 3-5 short sentences, plain and direct, no flowery language. Cite at least one REAL named statute, doctrine, or principle for the jurisdiction.';

  const { mine } = sideLabels(state, role);
  const { myClient } = clientLabels(state, role);
  // When a named client is set, the lawyer must open by introducing themselves as
  // that client's counsel, then argue the client's case by name.
  const openIntro = myClient
    ? `Begin by introducing yourself as ${myClient}'s counsel — e.g. "Your Honour, I appear for ${myClient}, the ${mine}…" — then argue ${myClient}'s case. `
    : '';
  const clientRef = myClient
    ? ` Refer to your client, ${myClient}, by name (e.g. "my client, ${myClient}", "${myClient}'s position").`
    : '';

  switch (kind) {
    case 'opening':
      return (
        'Deliver your OPENING statement. ' +
        openIntro +
        'Name the decisive facts of THIS case (people, dates, evidence, amounts) and the stakes — not pleasantries. ' +
        'Lay out your CASE THEORY: position, the specific facts that support it, the real legal authority, and the real-world consequence of ruling against your client. Do not yet rebut.' +
        clientRef +
        brevity +
        judgeText +
        factReminder
      );
    case 'argument':
      return (
        "Make your ARGUMENT for this round. First directly REBUT your opponent's specific latest points by name and dismantle them with the facts — do not echo them. " +
        'Then reinforce your single strongest point, grounded in the named facts/evidence and stakes, tied to a real legal authority. You MAY pose one pointed cross-examination question.' +
        clientRef +
        brevity +
        oppText +
        judgeText +
        factReminder
      );
    case 'closing':
      return (
        'Deliver your CLOSING. Tie together your strongest specific facts and the stakes, spell out the consequence of getting this wrong, answer the opponent\'s best argument head-on, and address any concern the judge raised.' +
        clientRef +
        brevity +
        oppText +
        judgeText +
        factReminder
      );
    default:
      return 'Respond in character as counsel, grounded in the specific facts of the transcript.' + brevity + oppText + judgeText + factReminder;
  }
}

function buildMessages(state, role, kind, salient) {
  const transcript = (state && Array.isArray(state.transcript) && state.transcript) || [];
  const mapped = transcript.map((e) => transcriptEntryToMessage(e, role)).filter(Boolean);
  mapped.push({ role: 'user', content: instructionForKind(state, role, kind, salient) });
  const normalized = normalizeMessages(mapped);
  if (!normalized.length) {
    normalized.push({ role: 'user', content: instructionForKind(state, role, kind, salient) });
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// LLM path — generate once, then validate fact coverage and regenerate.
// ---------------------------------------------------------------------------

async function generateOnce({ state, role, kind, salient, escalate }) {
  const messages = buildMessages(state, role, kind, salient);
  if (escalate && messages.length) {
    messages[messages.length - 1].content += escalate;
  }
  const text = await chat({
    system: buildSystemPrompt(state, role, kind, salient),
    messages,
    maxTokens: MAX_TOKENS,
  });
  return (text || '').trim();
}

async function generateRealWithFactCheck({ state, role, kind, salient }) {
  const need = requiredFacts(salient);
  const attempts = need > 0 ? MAX_ATTEMPTS : 1;
  let best = '';
  let bestHits = -1;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const escalate =
      attempt > 1
        ? `\n\n[COURT CLERK] Your previous draft was REJECTED: it failed to cite enough of the specific case facts. Rewrite it now, leading with the facts, and explicitly weave in at least ${need} of these exact particulars: ${salient.slice(0, 8).join('; ')}. No generic introduction.`
        : '';
    let text;
    try {
      text = await generateOnce({ state, role, kind, salient, escalate });
    } catch (err) {
      // A transient LLM error (e.g. 503 high-demand) on a later attempt must NOT
      // throw away a good real draft from an earlier attempt — keep the best so far.
      if (best) {
        console.warn(
          `[lawyer] ${role}/${kind} attempt ${attempt} errored (${(err && err.message) || err}); keeping best real draft (${bestHits} facts).`,
        );
        return best;
      }
      throw err; // nothing salvageable yet -> caller falls back to mock (and logs the error)
    }
    const hits = countFactHits(text, salient);
    console.log(`[lawyer] LLM ${role}/${kind} attempt ${attempt}/${attempts}: ${hits} fact reference(s) (need ${need})`);
    if (hits > bestHits) {
      best = text;
      bestHits = hits;
    }
    if (need === 0 || hits >= need) return text;
  }
  console.warn(`[lawyer] ${role}/${kind}: returning best-of-${attempts} (${bestHits}/${need} facts cited)`);
  return best;
}

// ---------------------------------------------------------------------------
// MOCK advocate (no key / on error) — now WEAVES IN the actual case facts so it
// no longer produces generic intros. Still weaker than the real LLM.
// ---------------------------------------------------------------------------

function illustrativePrincipleFor(kind, state) {
  const caseType = (state && state.caseType) || 'general';
  switch (kind) {
    case 'opening':
      return 'the principle that the court must weigh only what is properly placed before it';
    case 'argument':
      return caseType === 'criminal'
        ? 'the principle that the burden rests squarely on my opponent to prove their case beyond a reasonable doubt'
        : 'the principle that the party asserting a claim must carry the burden of proving each element';
    case 'closing':
      return 'the principle that a just outcome follows from the weight of the evidence actually presented';
    default:
      return 'a general, illustrative principle of fair adjudication';
  }
}

function stakeFor(state) {
  const caseType = (state && state.caseType) || 'general';
  switch (caseType) {
    case 'criminal':
      return "a person's liberty and good name hang in the balance";
    case 'civil':
      return "real money, a livelihood, and the parties' standing are on the line";
    case 'small-claims':
      return 'money hard-earned and promises relied upon are at stake';
    default:
      return 'the welfare and the rightful interests of the parties are at stake';
  }
}

function oppGist(state, role) {
  const opp = opponentLastArgument(state, role);
  const said = opp && typeof opp.text === 'string' ? opp.text.trim() : '';
  if (!said) return '';
  const firstSentence = said.split(/(?<=[.!?])\s+/)[0] || said;
  return firstSentence.length > 120 ? `${firstSentence.slice(0, 117)}…` : firstSentence;
}

function factClause(salient) {
  const top = (salient || []).slice(0, 3);
  if (!top.length) return '';
  if (top.length === 1) return top[0];
  if (top.length === 2) return `${top[0]} and ${top[1]}`;
  return `${top[0]}, ${top[1]}, and ${top[2]}`;
}

function buildMockText({ state, role, kind, salient }) {
  const { mine, theirs } = sideLabels(state, role);
  const { myClient } = clientLabels(state, role);
  const caseTitle = (state && state.caseTitle) || 'this matter';
  const principle = illustrativePrincipleFor(kind, state);
  const stake = stakeFor(state);
  const opposed = !!opponentLastArgument(state, role);
  const facts = factClause(salient);
  const factLead = facts
    ? `the record is specific: ${facts}`
    : 'the facts of this case are specific and they favour my client';
  // When a client name is set, refer to them; otherwise fall back to the side label.
  const myParty = myClient ? `my client, ${myClient},` : mine;
  const forMyParty = myClient ? `${myClient}` : mine;

  switch (kind) {
    case 'opening':
      return [
        myClient
          ? `Your Honour, I appear for ${myClient}, the ${mine}.`
          : `Your Honour, I appear for ${mine}.`,
        `In ${caseTitle}, ${factLead}.`,
        facts
          ? `Those particulars are not background — they are the case: they show precisely why ${myParty} must prevail, and ${stake}.`
          : `These facts go to the heart of the matter, and ${stake}.`,
        `Counsel for ${theirs} will urge the court to look past them; I will ask the court to hold them squarely in view.`,
        `Anchored in ${principle}, the facts — and the consequences of getting this wrong — point firmly to ${forMyParty}.`,
      ].join(' ');
    case 'argument':
      return [
        opposed
          ? `Your Honour, with respect, the theory my friend for ${theirs} advances does not survive the facts of this case.`
          : `Your Honour, my opponent has not yet confronted the decisive facts of this case.`,
        facts
          ? `Consider ${facts}: each cuts against their position and for ${myParty}, and together they show that ${stake}.`
          : `The decisive facts here cut for ${myParty}, and ${stake}.`,
        `Measured against ${principle}, ${myClient ? `${myClient}'s` : "my client's"} position holds where theirs gives way.`,
        `One question for counsel opposite: if their theory were sound, why does it leave ${facts || 'the central fact of this case'} wholly unexplained?`,
      ].join(' ');
    case 'closing':
      return [
        `Your Honour, as ${caseTitle} draws to a close, the choice is plain, and ${stake}.`,
        facts
          ? `Return to the facts that decide it — ${facts} — none of which counsel for ${theirs} has answered.`
          : `Counsel for ${theirs} has not met what this case truly requires.`,
        opposed ? `The contention they have urged cannot bear the weight they place upon it.` : '',
        `Weighed against ${principle}, the stronger and better-grounded position is that of ${forMyParty}. I respectfully ask the court to find for ${forMyParty}.`,
      ]
        .filter(Boolean)
        .join(' ');
    default:
      return `Your Honour, for ${myParty}, I press the facts of this case${facts ? ` — ${facts}` : ''}, mindful that ${stake} and grounded in ${principle}.`;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate an AI lawyer's argument and resolve with the full text.
 * @param {object} params
 * @param {object} params.state Public room state (transcript[], sideA, sideB, facts, ...).
 * @param {string} params.role  ROLES.LAWYER_A | ROLES.LAWYER_B.
 * @param {string} params.kind  'opening' | 'argument' | 'closing'.
 * @returns {Promise<string>}
 */
export async function generateArgument({ state, role, kind }) {
  const salient = extractSalientFacts(state);

  if (isConfigured()) {
    try {
      const text = await generateRealWithFactCheck({ state, role, kind, salient });
      if (text && text.trim()) {
        console.log(`[lawyer] ✓ Gemini (${modelName()}) argument for ${role}/${kind} (${salient.length} salient facts available)`);
        return text.trim();
      }
      console.warn(`[lawyer] ✗ empty LLM response for ${role}/${kind} → MOCK`);
    } catch (err) {
      console.warn(
        `[lawyer] ✗ LLM FAILED for ${role}/${kind} → MOCK fallback:`,
        (err && err.status) || '',
        (err && err.message) || String(err),
      );
    }
  } else {
    console.log('[lawyer] no key → MOCK advocate (set GEMINI_API_KEY in server/.env for real, fact-grounded arguments)');
  }
  return buildMockText({ state, role, kind, salient });
}

export default { generateArgument };
