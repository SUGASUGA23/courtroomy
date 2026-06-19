# ⚖️ Courtroom

A multiplayer mock-trial simulator with an AI judge. Friends join a virtual courtroom as
opposing lawyers (or spectators); an AI judge presides, responds in character after each
argument (streamed token-by-token), rules on live objections, and delivers a final verdict.

> ⚖️ **Educational simulation only — not real legal advice.**
> Everything in Courtroom — including every statement, ruling, citation, and verdict produced by
> the AI judge — is a fictional simulation for entertainment and learning. It is **not** legal
> advice, does **not** reflect the law of any jurisdiction, and must never be relied upon for any
> real legal matter. Any statutes, precedents, or principles the judge mentions are illustrative
> and may not be current or accurate. Consult a qualified attorney for actual legal questions.

---

## Prerequisites

- **Node.js 18 or newer** (the project uses native `fetch` and ESM). Check with `node -v`.
- npm (ships with Node).
- Optional: an **Anthropic API key** for the real Claude judge. Courtroom runs fine without one —
  see below.

## Run it

From the `courtroom/` directory:

1. **Create the server env file.** Copy the example and (optionally) add a key:

   ```bash
   cp server/.env.example server/.env
   ```

   Then open `server/.env`. You can leave `ANTHROPIC_API_KEY=` blank — **Courtroom works with no
   key thanks to a built-in mock judge** that streams an in-character response for every ruling and
   verdict. To use the real Claude judge instead, paste your key:

   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```

   The judge engine picks itself automatically: **real Claude when `ANTHROPIC_API_KEY` is set,
   otherwise the mock judge.** Same behavior either way. The key lives only on the server and never
   reaches the browser.

2. **Install everything** (root + server + client):

   ```bash
   npm run install:all
   ```

3. **Start both servers together:**

   ```bash
   npm run dev
   ```

   This uses `concurrently` to run the backend and frontend at once. To run them separately, use
   `npm run dev:server` and `npm run dev:client` in two terminals.

4. **Open the app.** Vite prints a local URL — open **http://localhost:5173** in your browser.
   Create a case, share the room code, and have a friend join from another tab or browser.

## How to play

1. **Create a case.** On the home screen choose **Create a case** and fill in the case title, type
   (civil / criminal / small-claims / custom), a short description, the two side labels (Side A and
   Side B), the number of argument rounds (1–5), and your name. You become the host.
2. **Share the code.** Creating a case generates a 6-character room code. Send it to your friends.
3. **Join in another tab.** Each player chooses **Join with code**, enters the room code and their
   name, then **picks a side** — Lawyer A, Lawyer B, or Spectator. The two lawyer slots are
   first-come-first-served; taken slots are shown as unavailable.
4. **Pick opposing sides.** You need one Lawyer A and one Lawyer B for a trial. Everyone else can
   watch from the gallery as spectators.
5. **Begin the trial.** Once both lawyer slots are filled, the host clicks **Begin trial**. The
   judge sets the scene, then play proceeds through the phases automatically:
   **Opening → Arguments (per round) → Closing → Verdict.**
   - On your turn, type your argument and submit it. The judge responds in character, streamed live
     to everyone on the bench.
   - When it is **not** your turn during the Arguments phase, you can hit **Objection!** — the judge
     rules *Sustained* or *Overruled* in character. Objections do **not** consume a turn.
   - Phases **auto-advance** as soon as both sides have submitted for the current phase/round.
   - After closing arguments, the judge delivers a final **verdict** referencing both sides, and the
     trial ends.

## Ports

| Service            | URL                     | Port |
| ------------------ | ----------------------- | ---- |
| Client (Vite)      | http://localhost:5173   | 5173 |
| Server (Express)   | http://localhost:4000   | 4000 |

The server's Socket.io CORS is configured to allow the client origin via `CLIENT_ORIGIN`
(`http://localhost:5173` by default in `server/.env`). The client connects to the server at
`VITE_SERVER_URL` or `http://localhost:4000` by default. If you change a port, update the matching
value in `server/.env` / your client env so the two still agree.

## Architecture

```
courtroom/
  package.json        Root scripts: install:all, dev, dev:server, dev:client (uses concurrently)
  README.md           This file
  server/             Node.js + Express + Socket.io backend (ESM)
    .env.example      ANTHROPIC_API_KEY, PORT=4000, CLIENT_ORIGIN=http://localhost:5173
    src/
      protocol.js     Shared EVENTS / ROLES / PHASES constants (must match the client copy)
      rooms.js        In-memory rooms, room codes, turn/phase logic (no sockets, no DB)
      judge.js        Streaming AI judge — real Claude when keyed, mock judge otherwise
      index.js        Express + Socket.io wiring; relays streamed judge tokens to all clients
  client/             React + Vite frontend (ESM, .jsx)
    src/
      protocol.js     Identical EVENTS / ROLES / PHASES constants as the server
      socket.js       socket.io-client singleton + helpers
      App.jsx         Top-level state machine: home → create/join → courtroom
      components/      Bench, Podium, Gallery, Transcript, ArgumentInput, etc.
      styles.css      Courtroom theme
```

**How it fits together:**

- **Frontend** is a React + Vite single-page app. It holds no authoritative state of its own — it
  renders whatever the server broadcasts and sends player actions (create/join, pick role, start,
  submit argument, object) over a single Socket.io connection.
- **Backend** is an Express + Socket.io server. All trial state lives **in memory** (no database);
  rooms are ephemeral and disappear when the process restarts. `rooms.js` owns the turn/phase rules
  and auto-advance logic; `index.js` wires sockets to rooms and to the judge.
- **AI judge** runs **only on the backend** (model `claude-sonnet-4-6`). Responses are **streamed**
  token-by-token from the server to every client in the room, so the whole gallery watches the
  judge “type” in real time. When no `ANTHROPIC_API_KEY` is present, an interface-compatible mock
  judge produces an in-character, illustrative response instead — so the app always runs.
- **Privacy:** the Anthropic API key never leaves the server, and the judge's private scoring notes
  are never broadcast to clients.

## Disclaimer

**Courtroom is an EDUCATIONAL SIMULATION ONLY.** It is a game for learning how a mock trial flows
and for having fun with friends. It is not a source of legal advice, it does not represent the law
of any real jurisdiction, and the AI judge's statements, rulings, citations, and verdicts are
fictional and illustrative. Do not rely on anything here for real legal decisions — consult a
qualified attorney.
