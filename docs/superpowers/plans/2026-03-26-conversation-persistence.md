# Conversation & Run Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist conversations, messages, and run telemetry to SQLite at `~/.config/clawdia/data.sqlite` so nothing is lost on app restart.

**Architecture:** A thin `db.ts` module owns the SQLite connection and all query functions. A `runTracker.ts` wrapper manages run lifecycle. The existing in-memory `sessions` map stays as the runtime cache; `db.ts` is the write-through backing store. All queries use `better-sqlite3` (synchronous) — no async complexity needed for a single-user desktop app.

**Tech Stack:** `better-sqlite3` ^12.6.2, `@types/better-sqlite3` ^7.6.12, TypeScript, Electron main process (Node.js)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/main/db.ts` | SQLite connection, schema init, all typed query functions |
| Create | `src/main/runTracker.ts` | Run lifecycle wrapper (startRun, trackToolCall, trackToolResult, completeRun, failRun) |
| Create | `tests/main/db.test.ts` | Unit tests for db.ts |
| Modify | `package.json` | Add better-sqlite3 + @types/better-sqlite3 |
| Modify | `src/main/main.ts` | Call `initDb()` before registering IPC handlers |
| Modify | `src/main/registerIpc.ts` | Wire CHAT_NEW, CHAT_LIST, CHAT_LOAD, CHAT_DELETE, CHAT_SEND to db.ts; wire RUN_LIST, RUN_EVENTS |
| Modify | `src/main/anthropicChat.ts` | Call runTracker at loop start/tool-calls/end |
| Modify | `src/main/openaiChat.ts` | Call runTracker at loop start/tool-calls/end |
| Modify | `src/main/geminiChat.ts` | Call runTracker at loop start/tool-calls/end |

---

## Task 1: Install better-sqlite3

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the packages**

```bash
cd /home/dp/Desktop/clawdia7.0
npm install better-sqlite3@^12.6.2
npm install --save-dev @types/better-sqlite3@^7.6.12
```

Expected output: packages added, `package.json` updated with both entries.

- [ ] **Step 2: Rebuild native module against Electron's Node**

```bash
cd /home/dp/Desktop/clawdia7.0
./node_modules/.bin/electron-rebuild -f -w better-sqlite3
```

Expected output: `✔ Rebuild Complete` (or similar). If `electron-rebuild` is not in PATH, use `npx electron-rebuild -f -w better-sqlite3`.

- [ ] **Step 3: Verify import works**

```bash
cd /home/dp/Desktop/clawdia7.0
node -e "const db = require('better-sqlite3')(':memory:'); db.exec('CREATE TABLE t (id TEXT)'); console.log('ok');"
```

Expected output: `ok`

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add better-sqlite3 for conversation persistence"
```

---

## Task 2: Write db.ts with schema and query functions

**Files:**
- Create: `src/main/db.ts`
- Create: `tests/main/db.test.ts`

- [ ] **Step 1: Write the failing test first**

Create `tests/main/db.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// We test db.ts by pointing it at a temp file
process.env.CLAWDIA_DB_PATH_OVERRIDE = path.join(os.tmpdir(), `clawdia-test-${Date.now()}.sqlite`);

import {
  initDb,
  createConversation,
  listConversations,
  getConversation,
  updateConversation,
  deleteConversation,
  addMessage,
  getMessages,
  createRun,
  updateRun,
  getRuns,
  appendRunEvent,
  getRunEvents,
} from '../../src/main/db';

const testDbPath = process.env.CLAWDIA_DB_PATH_OVERRIDE!;

beforeEach(() => {
  initDb();
});

afterEach(() => {
  // Close and delete the temp db between tests
  try { fs.unlinkSync(testDbPath); } catch {}
});

describe('conversations', () => {
  it('creates and lists a conversation', () => {
    createConversation({ id: 'c1', title: 'Hello', mode: 'chat', created_at: 1000, updated_at: 1000 });
    const list = listConversations();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('c1');
    expect(list[0].title).toBe('Hello');
  });

  it('returns conversations sorted by updated_at desc', () => {
    createConversation({ id: 'c1', title: 'First', mode: 'chat', created_at: 1000, updated_at: 1000 });
    createConversation({ id: 'c2', title: 'Second', mode: 'chat', created_at: 2000, updated_at: 2000 });
    const list = listConversations();
    expect(list[0].id).toBe('c2');
    expect(list[1].id).toBe('c1');
  });

  it('gets a single conversation', () => {
    createConversation({ id: 'c1', title: 'Hello', mode: 'chat', created_at: 1000, updated_at: 1000 });
    const conv = getConversation('c1');
    expect(conv).not.toBeNull();
    expect(conv!.title).toBe('Hello');
  });

  it('returns null for missing conversation', () => {
    expect(getConversation('nonexistent')).toBeNull();
  });

  it('updates a conversation', () => {
    createConversation({ id: 'c1', title: 'Old', mode: 'chat', created_at: 1000, updated_at: 1000 });
    updateConversation('c1', { title: 'New', updated_at: 9999 });
    const conv = getConversation('c1');
    expect(conv!.title).toBe('New');
    expect(conv!.updated_at).toBe(9999);
  });

  it('deletes a conversation and cascades to messages', () => {
    createConversation({ id: 'c1', title: 'Hello', mode: 'chat', created_at: 1000, updated_at: 1000 });
    addMessage({ id: 'm1', conversation_id: 'c1', role: 'user', content: JSON.stringify({ content: 'hi' }), created_at: 1001 });
    deleteConversation('c1');
    expect(listConversations()).toHaveLength(0);
    expect(getMessages('c1')).toHaveLength(0);
  });
});

describe('messages', () => {
  beforeEach(() => {
    createConversation({ id: 'c1', title: 'Test', mode: 'chat', created_at: 1000, updated_at: 1000 });
  });

  it('adds and retrieves messages in order', () => {
    addMessage({ id: 'm1', conversation_id: 'c1', role: 'user', content: JSON.stringify({ content: 'hello' }), created_at: 1001 });
    addMessage({ id: 'm2', conversation_id: 'c1', role: 'assistant', content: JSON.stringify({ content: 'hi there' }), created_at: 1002 });
    const msgs = getMessages('c1');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].id).toBe('m1');
    expect(msgs[1].id).toBe('m2');
  });

  it('returns empty array for conversation with no messages', () => {
    expect(getMessages('c1')).toHaveLength(0);
  });
});

describe('runs', () => {
  beforeEach(() => {
    createConversation({ id: 'c1', title: 'Test', mode: 'chat', created_at: 1000, updated_at: 1000 });
  });

  it('creates and retrieves a run', () => {
    createRun({ id: 'r1', conversation_id: 'c1', status: 'running', provider: 'anthropic', model: 'claude-sonnet-4-6', started_at: 2000 });
    const runs = getRuns('c1');
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('running');
  });

  it('updates run status and completion fields', () => {
    createRun({ id: 'r1', conversation_id: 'c1', status: 'running', provider: 'anthropic', model: 'claude-sonnet-4-6', started_at: 2000 });
    updateRun('r1', { status: 'completed', completed_at: 3000, total_tokens: 500, estimated_cost_usd: 0.005 });
    const runs = getRuns('c1');
    expect(runs[0].status).toBe('completed');
    expect(runs[0].total_tokens).toBe(500);
  });
});

describe('run_events', () => {
  beforeEach(() => {
    createConversation({ id: 'c1', title: 'Test', mode: 'chat', created_at: 1000, updated_at: 1000 });
    createRun({ id: 'r1', conversation_id: 'c1', status: 'running', provider: 'anthropic', model: 'claude-sonnet-4-6', started_at: 2000 });
  });

  it('appends and retrieves run events in order', () => {
    appendRunEvent({ id: 'e1', run_id: 'r1', type: 'tool_call', payload: JSON.stringify({ tool: 'bash', args: 'ls' }), created_at: 2001 });
    appendRunEvent({ id: 'e2', run_id: 'r1', type: 'tool_result', payload: JSON.stringify({ result: 'file.txt', duration_ms: 120 }), created_at: 2002 });
    const events = getRunEvents('r1');
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('tool_call');
    expect(events[1].type).toBe('tool_result');
  });
});

describe('orphaned run cleanup', () => {
  it('marks running runs as failed on initDb', () => {
    createRun({ id: 'r1', conversation_id: 'c1', status: 'running', provider: 'anthropic', model: 'claude-sonnet-4-6', started_at: 1000 });
    // Simulate re-init (app restart)
    initDb();
    const runs = getRuns('c1');
    expect(runs[0].status).toBe('failed');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails (db.ts doesn't exist yet)**

```bash
cd /home/dp/Desktop/clawdia7.0
npx vitest run tests/main/db.test.ts 2>&1 | head -30
```

Expected: error about missing module `../../src/main/db`

- [ ] **Step 3: Create src/main/db.ts**

```typescript
import Database from 'better-sqlite3';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// Row types — plain data shapes matching the SQL schema exactly
export interface ConversationRow {
  id: string;
  title: string;
  mode: string;
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string; // JSON-serialized Message
  created_at: number;
}

export interface RunRow {
  id: string;
  conversation_id: string;
  status: string;
  provider: string;
  model: string;
  started_at: number;
  completed_at?: number;
  total_tokens?: number;
  estimated_cost_usd?: number;
}

export interface RunEventRow {
  id: string;
  run_id: string;
  type: string;
  payload: string; // JSON
  created_at: number;
}

// Allow test override of DB path via env variable
function resolveDbPath(): string {
  if (process.env.CLAWDIA_DB_PATH_OVERRIDE) {
    return process.env.CLAWDIA_DB_PATH_OVERRIDE;
  }
  const configDir = path.join(os.homedir(), '.config', 'clawdia');
  fs.mkdirSync(configDir, { recursive: true });
  return path.join(configDir, 'data.sqlite');
}

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) throw new Error('db not initialized — call initDb() first');
  return db;
}

export function initDb(): void {
  try {
    const dbPath = resolveDbPath();
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id         TEXT PRIMARY KEY,
        title      TEXT NOT NULL,
        mode       TEXT NOT NULL DEFAULT 'chat',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id                TEXT PRIMARY KEY,
        conversation_id   TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role              TEXT NOT NULL,
        content           TEXT NOT NULL,
        created_at        INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

      CREATE TABLE IF NOT EXISTS runs (
        id                  TEXT PRIMARY KEY,
        conversation_id     TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        status              TEXT NOT NULL,
        provider            TEXT NOT NULL,
        model               TEXT NOT NULL,
        started_at          INTEGER NOT NULL,
        completed_at        INTEGER,
        total_tokens        INTEGER,
        estimated_cost_usd  REAL
      );
      CREATE INDEX IF NOT EXISTS idx_runs_conversation ON runs(conversation_id, started_at);

      CREATE TABLE IF NOT EXISTS run_events (
        id          TEXT PRIMARY KEY,
        run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        type        TEXT NOT NULL,
        payload     TEXT NOT NULL,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id, created_at);
    `);

    // Mark orphaned runs as failed (app was killed mid-run)
    db.prepare(`UPDATE runs SET status = 'failed' WHERE status = 'running'`).run();
  } catch (err) {
    console.error('[db] Failed to initialize database:', err);
    db = null; // degrade to in-memory-only mode
  }
}

// ── Conversations ──────────────────────────────────────────────────────────

export function createConversation(conv: ConversationRow): void {
  try {
    getDb()
      .prepare(`INSERT INTO conversations (id, title, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run(conv.id, conv.title, conv.mode, conv.created_at, conv.updated_at);
  } catch (err) {
    console.error('[db] createConversation failed:', err);
  }
}

export function listConversations(): ConversationRow[] {
  try {
    return getDb()
      .prepare(`SELECT * FROM conversations ORDER BY updated_at DESC`)
      .all() as ConversationRow[];
  } catch (err) {
    console.error('[db] listConversations failed:', err);
    return [];
  }
}

export function getConversation(id: string): ConversationRow | null {
  try {
    return (getDb().prepare(`SELECT * FROM conversations WHERE id = ?`).get(id) as ConversationRow) ?? null;
  } catch (err) {
    console.error('[db] getConversation failed:', err);
    return null;
  }
}

export function updateConversation(id: string, patch: Partial<ConversationRow>): void {
  try {
    const fields = Object.keys(patch)
      .map((k) => `${k} = ?`)
      .join(', ');
    const values = [...Object.values(patch), id];
    getDb().prepare(`UPDATE conversations SET ${fields} WHERE id = ?`).run(...values);
  } catch (err) {
    console.error('[db] updateConversation failed:', err);
  }
}

export function deleteConversation(id: string): void {
  try {
    getDb().prepare(`DELETE FROM conversations WHERE id = ?`).run(id);
  } catch (err) {
    console.error('[db] deleteConversation failed:', err);
  }
}

// ── Messages ───────────────────────────────────────────────────────────────

export function addMessage(msg: MessageRow): void {
  try {
    getDb()
      .prepare(`INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(msg.id, msg.conversation_id, msg.role, msg.content, msg.created_at);
  } catch (err) {
    console.error('[db] addMessage failed:', err);
  }
}

export function getMessages(conversationId: string): MessageRow[] {
  try {
    return getDb()
      .prepare(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`)
      .all(conversationId) as MessageRow[];
  } catch (err) {
    console.error('[db] getMessages failed:', err);
    return [];
  }
}

// ── Runs ───────────────────────────────────────────────────────────────────

export function createRun(run: RunRow): void {
  try {
    getDb()
      .prepare(`INSERT INTO runs (id, conversation_id, status, provider, model, started_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(run.id, run.conversation_id, run.status, run.provider, run.model, run.started_at);
  } catch (err) {
    console.error('[db] createRun failed:', err);
  }
}

export function updateRun(id: string, patch: Partial<RunRow>): void {
  try {
    const fields = Object.keys(patch)
      .map((k) => `${k} = ?`)
      .join(', ');
    const values = [...Object.values(patch), id];
    getDb().prepare(`UPDATE runs SET ${fields} WHERE id = ?`).run(...values);
  } catch (err) {
    console.error('[db] updateRun failed:', err);
  }
}

export function getRuns(conversationId: string): RunRow[] {
  try {
    return getDb()
      .prepare(`SELECT * FROM runs WHERE conversation_id = ? ORDER BY started_at DESC`)
      .all(conversationId) as RunRow[];
  } catch (err) {
    console.error('[db] getRuns failed:', err);
    return [];
  }
}

// ── Run Events ─────────────────────────────────────────────────────────────

export function appendRunEvent(event: RunEventRow): void {
  try {
    getDb()
      .prepare(`INSERT INTO run_events (id, run_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(event.id, event.run_id, event.type, event.payload, event.created_at);
  } catch (err) {
    console.error('[db] appendRunEvent failed:', err);
  }
}

export function getRunEvents(runId: string): RunEventRow[] {
  try {
    return getDb()
      .prepare(`SELECT * FROM run_events WHERE run_id = ? ORDER BY created_at ASC`)
      .all(runId) as RunEventRow[];
  } catch (err) {
    console.error('[db] getRunEvents failed:', err);
    return [];
  }
}
```

- [ ] **Step 4: Run the tests**

```bash
cd /home/dp/Desktop/clawdia7.0
npx vitest run tests/main/db.test.ts
```

Expected: all tests pass. If `better-sqlite3` import fails in vitest, check that the native rebuild completed (Task 1 Step 2).

- [ ] **Step 5: Commit**

```bash
git add src/main/db.ts tests/main/db.test.ts
git commit -m "feat: add db.ts — SQLite schema, init, and typed query functions"
```

---

## Task 3: Write runTracker.ts

**Files:**
- Create: `src/main/runTracker.ts`
- Create: `tests/main/runTracker.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/runTracker.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

process.env.CLAWDIA_DB_PATH_OVERRIDE = path.join(os.tmpdir(), `clawdia-tracker-test-${Date.now()}.sqlite`);

import { initDb, getRuns, getRunEvents, createConversation } from '../../src/main/db';
import { startRun, trackToolCall, trackToolResult, completeRun, failRun } from '../../src/main/runTracker';

const testDbPath = process.env.CLAWDIA_DB_PATH_OVERRIDE!;

beforeEach(() => {
  initDb();
  createConversation({ id: 'c1', title: 'Test', mode: 'chat', created_at: 1000, updated_at: 1000 });
});

afterEach(() => {
  try { fs.unlinkSync(testDbPath); } catch {}
});

describe('runTracker', () => {
  it('startRun creates a run with status running', () => {
    const runId = startRun('c1', 'anthropic', 'claude-sonnet-4-6');
    expect(typeof runId).toBe('string');
    expect(runId.length).toBeGreaterThan(0);
    const runs = getRuns('c1');
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('running');
    expect(runs[0].provider).toBe('anthropic');
    expect(runs[0].model).toBe('claude-sonnet-4-6');
  });

  it('trackToolCall appends a tool_call event', () => {
    const runId = startRun('c1', 'anthropic', 'claude-sonnet-4-6');
    const eventId = trackToolCall(runId, 'bash', 'ls -la');
    expect(typeof eventId).toBe('string');
    const events = getRunEvents(runId);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('tool_call');
    const payload = JSON.parse(events[0].payload);
    expect(payload.toolName).toBe('bash');
    expect(payload.argsSummary).toBe('ls -la');
  });

  it('trackToolResult appends a tool_result event', () => {
    const runId = startRun('c1', 'anthropic', 'claude-sonnet-4-6');
    const eventId = trackToolCall(runId, 'bash', 'ls');
    trackToolResult(runId, eventId, 'file.txt', 45);
    const events = getRunEvents(runId);
    expect(events).toHaveLength(2);
    expect(events[1].type).toBe('tool_result');
    const payload = JSON.parse(events[1].payload);
    expect(payload.duration_ms).toBe(45);
    expect(payload.resultSummary).toBe('file.txt');
  });

  it('completeRun updates status, tokens, cost', () => {
    const runId = startRun('c1', 'anthropic', 'claude-sonnet-4-6');
    completeRun(runId, 1200, 0.012);
    const runs = getRuns('c1');
    expect(runs[0].status).toBe('completed');
    expect(runs[0].total_tokens).toBe(1200);
    expect(runs[0].estimated_cost_usd).toBeCloseTo(0.012);
    expect(runs[0].completed_at).toBeGreaterThan(0);
  });

  it('failRun updates status to failed', () => {
    const runId = startRun('c1', 'anthropic', 'claude-sonnet-4-6');
    failRun(runId, 'API timeout');
    const runs = getRuns('c1');
    expect(runs[0].status).toBe('failed');
    expect(runs[0].completed_at).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /home/dp/Desktop/clawdia7.0
npx vitest run tests/main/runTracker.test.ts 2>&1 | head -20
```

Expected: error about missing module `../../src/main/runTracker`

- [ ] **Step 3: Create src/main/runTracker.ts**

```typescript
import { createRun, updateRun, appendRunEvent } from './db';

function uuid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Start a new run for a conversation.
 * Returns the runId — pass it to trackToolCall/completeRun/failRun.
 */
export function startRun(conversationId: string, provider: string, model: string): string {
  const runId = `run-${uuid()}`;
  createRun({
    id: runId,
    conversation_id: conversationId,
    status: 'running',
    provider,
    model,
    started_at: Date.now(),
  });
  return runId;
}

/**
 * Record a tool call starting. Returns an eventId for pairing with trackToolResult.
 */
export function trackToolCall(runId: string, toolName: string, argsSummary: string): string {
  const eventId = `evt-${uuid()}`;
  appendRunEvent({
    id: eventId,
    run_id: runId,
    type: 'tool_call',
    payload: JSON.stringify({ toolName, argsSummary }),
    created_at: Date.now(),
  });
  return eventId;
}

/**
 * Record a tool call result. Pass the eventId returned by trackToolCall.
 */
export function trackToolResult(runId: string, eventId: string, resultSummary: string, durationMs: number): void {
  appendRunEvent({
    id: `${eventId}-result`,
    run_id: runId,
    type: 'tool_result',
    payload: JSON.stringify({ callEventId: eventId, resultSummary, duration_ms: durationMs }),
    created_at: Date.now(),
  });
}

/**
 * Mark a run as completed with final token and cost counts.
 */
export function completeRun(runId: string, totalTokens: number, estimatedCostUsd: number): void {
  updateRun(runId, {
    status: 'completed',
    completed_at: Date.now(),
    total_tokens: totalTokens,
    estimated_cost_usd: estimatedCostUsd,
  });
}

/**
 * Mark a run as failed.
 */
export function failRun(runId: string, _error: string): void {
  updateRun(runId, {
    status: 'failed',
    completed_at: Date.now(),
  });
}
```

- [ ] **Step 4: Run the tests**

```bash
cd /home/dp/Desktop/clawdia7.0
npx vitest run tests/main/runTracker.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/runTracker.ts tests/main/runTracker.test.ts
git commit -m "feat: add runTracker.ts — run lifecycle wrapper for telemetry"
```

---

## Task 4: Initialize the database in main.ts

**Files:**
- Modify: `src/main/main.ts`

- [ ] **Step 1: Add initDb() call to app.whenReady()**

In `src/main/main.ts`, add the import and call:

```typescript
import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { ElectronBrowserService } from './core/browser/ElectronBrowserService';
import { TerminalSessionController } from './core/terminal/TerminalSessionController';
import { registerIpc } from './registerIpc';
import { registerTerminalIpc } from './registerTerminalIpc';
import { registerVideoExtractorIpc } from './ipc/videoExtractor';
import { initDb } from './db';

const isDev = process.env.NODE_ENV === 'development';

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0f0f0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    win.loadURL('http://127.0.0.1:5174');
  } else {
    win.loadFile(path.join(__dirname, '../../dist/renderer/index.html'));
  }
  return win;
}

app.whenReady().then(() => {
  initDb();
  const win = createWindow();
  const browserService = new ElectronBrowserService(win, app.getPath('userData'));
  void browserService.init();
  const terminalController = new TerminalSessionController();
  registerIpc(browserService);
  registerTerminalIpc(terminalController, win);
  registerVideoExtractorIpc(win, browserService);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 2: Build main process to check for TypeScript errors**

```bash
cd /home/dp/Desktop/clawdia7.0
npx tsc -p tsconfig.main.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/main.ts
git commit -m "feat: call initDb() on app startup before IPC registration"
```

---

## Task 5: Wire conversation IPC handlers to db.ts

**Files:**
- Modify: `src/main/registerIpc.ts`

The current `CHAT_NEW`, `CHAT_LIST`, `CHAT_LOAD`, `CHAT_DELETE` handlers are all stubs or return empty. Replace them with db-backed implementations. The `CHAT_SEND` handler needs to persist user and assistant messages.

- [ ] **Step 1: Replace the conversation and message handlers in registerIpc.ts**

At the top of `registerIpc.ts`, add the db imports:

```typescript
import {
  createConversation,
  listConversations,
  getConversation,
  updateConversation,
  deleteConversation,
  addMessage,
  getMessages,
} from './db';
```

Replace the `CHAT_NEW` handler (currently at line 168):

```typescript
ipcMain.handle(IPC.CHAT_NEW, () => {
  chatAbort?.abort();
  const now = Date.now();
  const id = `conv-${now}`;
  createConversation({ id, title: 'New conversation', mode: 'chat', created_at: now, updated_at: now });
  activeConversationId = id;
  sessions.set(id, []);
  return { id };
});
```

Replace the `CHAT_LIST` handler (currently at line 175):

```typescript
ipcMain.handle(IPC.CHAT_LIST, () => {
  return listConversations().map((row) => ({
    id: row.id,
    title: row.title,
    updatedAt: new Date(row.updated_at).toISOString(),
    mode: row.mode,
  }));
});
```

Replace the `CHAT_LOAD` handler (currently at lines 177–185):

```typescript
ipcMain.handle(IPC.CHAT_LOAD, (_e, id: string) => {
  activeConversationId = id;

  // Hydrate in-memory session from DB if not already loaded
  if (!sessions.has(id)) {
    const rows = getMessages(id);
    // Rebuild the Anthropic-format message array from persisted content
    const apiMessages: any[] = rows
      .filter((r) => r.role === 'user' || r.role === 'assistant')
      .map((r) => {
        try {
          const parsed = JSON.parse(r.content);
          return { role: r.role, content: parsed.content ?? r.content };
        } catch {
          return { role: r.role, content: r.content };
        }
      });
    sessions.set(id, apiMessages);
  }

  const rows = getMessages(id);
  const messages: Message[] = rows.map((r) => {
    try {
      return JSON.parse(r.content) as Message;
    } catch {
      return {
        id: r.id,
        role: r.role as 'user' | 'assistant',
        content: r.content,
        timestamp: new Date(r.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
      };
    }
  });

  return {
    messages,
    mode: 'chat' as const,
    claudeTerminalStatus: 'idle' as const,
  };
});
```

Replace the `CHAT_DELETE` handler (currently at line 269):

```typescript
ipcMain.handle(IPC.CHAT_DELETE, (_e, id: string) => {
  deleteConversation(id);
  sessions.delete(id);
  if (activeConversationId === id) activeConversationId = null;
});
```

- [ ] **Step 2: Wire message persistence in CHAT_SEND**

In `CHAT_SEND` (around line 194), after `ensureConversation()` and before the provider dispatch, persist the user message:

```typescript
ipcMain.handle(IPC.CHAT_SEND, async (event, payload: { text: string; attachments?: MessageAttachment[] }) => {
  const { text, attachments } = payload || { text: '' };
  const settings = loadSettings();
  if (settings.provider !== 'anthropic' && settings.provider !== 'gemini' && settings.provider !== 'openai') {
    return { response: '', error: 'Select a provider in Settings to use chat.' };
  }
  const apiKey = settings.providerKeys[settings.provider as keyof typeof settings.providerKeys]?.trim();
  if (!apiKey) {
    return { response: '', error: `Add a ${settings.provider} API key in Settings.` };
  }
  const model = settings.models[settings.provider as keyof typeof settings.models] ?? DEFAULT_MODEL_BY_PROVIDER[settings.provider as keyof typeof DEFAULT_MODEL_BY_PROVIDER];

  ensureConversation();
  const id = activeConversationId!;

  // Ensure conversation exists in DB (handles legacy in-memory-only convs)
  if (!getConversation(id)) {
    const now = Date.now();
    createConversation({ id, title: text.slice(0, 60) || 'New conversation', mode: 'chat', created_at: now, updated_at: now });
  }

  // Persist user message
  const userMsgId = `msg-u-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const userMsgTs = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const userMsg: Message = { id: userMsgId, role: 'user', content: text, timestamp: userMsgTs, attachments };
  addMessage({ id: userMsgId, conversation_id: id, role: 'user', content: JSON.stringify(userMsg), created_at: Date.now() });
  updateConversation(id, { updated_at: Date.now() });

  let sessionMessages = getOrCreateSession(id);
  const pruned = pruneSession(sessionMessages);
  if (pruned.length < sessionMessages.length) {
    sessions.set(id, pruned);
    sessionMessages = pruned;
  }

  chatAbort?.abort();
  chatAbort = new AbortController();

  let result: { response: string; error?: string };

  if (settings.provider === 'gemini') {
    result = await streamGeminiChat({
      webContents: event.sender,
      apiKey,
      modelRegistryId: model,
      userText: text,
      attachments,
      sessionMessages,
      signal: chatAbort.signal,
      browserService,
      unrestrictedMode: settings.unrestrictedMode,
    });
  } else if (settings.provider === 'openai') {
    result = await streamOpenAIChat({
      webContents: event.sender,
      apiKey,
      modelRegistryId: model,
      userText: text,
      attachments,
      sessionMessages,
      signal: chatAbort.signal,
      browserService,
      unrestrictedMode: settings.unrestrictedMode,
    });
  } else {
    result = await streamAnthropicChat({
      webContents: event.sender,
      apiKey,
      modelRegistryId: model,
      userText: text,
      attachments,
      sessionMessages,
      signal: chatAbort.signal,
      browserService,
      unrestrictedMode: settings.unrestrictedMode,
    });
  }

  // Persist assistant message after streaming completes
  if (result.response && !result.error) {
    const assistantMsgId = `msg-a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const assistantMsgTs = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const assistantMsg: Message = { id: assistantMsgId, role: 'assistant', content: result.response, timestamp: assistantMsgTs };
    addMessage({ id: assistantMsgId, conversation_id: id, role: 'assistant', content: JSON.stringify(assistantMsg), created_at: Date.now() });
    updateConversation(id, { updated_at: Date.now(), title: text.slice(0, 60) || 'New conversation' });
  }

  return result;
});
```

Note: Remove the old `streamGeminiChat`, `streamOpenAIChat`, `streamAnthropicChat` inline calls (they're now inside the new handler above). The old CHAT_SEND handler from lines 194–258 is fully replaced by the above.

- [ ] **Step 3: Wire RUN_LIST and RUN_EVENTS to db.ts**

Find the stub handlers for `IPC.RUN_LIST` and `IPC.RUN_EVENTS` — they don't exist yet, so add them after the `CHAT_RATE_TOOL` handler:

```typescript
ipcMain.handle(IPC.RUN_LIST, (_e, conversationId: string) => {
  return getRuns(conversationId);
});

ipcMain.handle(IPC.RUN_EVENTS, (_e, runId: string) => {
  return getRunEvents(runId);
});
```

Add `getRuns` and `getRunEvents` to the db import at the top of `registerIpc.ts`:

```typescript
import {
  createConversation,
  listConversations,
  getConversation,
  updateConversation,
  deleteConversation,
  addMessage,
  getMessages,
  getRuns,
  getRunEvents,
} from './db';
```

- [ ] **Step 4: Build to check for TypeScript errors**

```bash
cd /home/dp/Desktop/clawdia7.0
npx tsc -p tsconfig.main.json --noEmit
```

Expected: no errors. If you see errors about the replaced CHAT_SEND handler, ensure the old inline provider calls have been fully removed.

- [ ] **Step 5: Commit**

```bash
git add src/main/registerIpc.ts
git commit -m "feat: wire conversation IPC handlers to SQLite — CHAT_NEW, LIST, LOAD, DELETE, SEND persist to db"
```

---

## Task 6: Add run telemetry to anthropicChat.ts

**Files:**
- Modify: `src/main/anthropicChat.ts`

The `streamAnthropicChat` function needs a `conversationId` and `runId` threading through it. We pass `conversationId` in (new param), create the run at the top, track each tool call, and complete/fail the run at the end.

- [ ] **Step 1: Update StreamParams type and add runTracker calls**

In `src/main/anthropicChat.ts`, add to the imports at the top:

```typescript
import { startRun, trackToolCall, trackToolResult, completeRun, failRun } from './runTracker';
```

Add `conversationId` to the `StreamParams` type (around line 69):

```typescript
type StreamParams = {
  webContents: WebContents;
  apiKey: string;
  modelRegistryId: string;
  userText: string;
  attachments?: MessageAttachment[];
  sessionMessages: Anthropic.MessageParam[];
  signal: AbortSignal;
  browserService?: BrowserService;
  unrestrictedMode?: boolean;
  conversationId?: string;  // add this
};
```

At the start of `streamAnthropicChat`, after `const apiModelId = ...`, add:

```typescript
const runId = params.conversationId
  ? startRun(params.conversationId, 'anthropic', apiModelId)
  : null;
```

Note: update the function signature to destructure `conversationId` from params:

```typescript
export async function streamAnthropicChat({
  webContents,
  apiKey,
  modelRegistryId,
  userText,
  attachments,
  sessionMessages,
  signal,
  browserService,
  unrestrictedMode = false,
  conversationId,
}: StreamParams): Promise<{ response: string; error?: string }> {
```

Inside `executeTools`, wrap each tool call with tracking. Replace the inner loop body:

```typescript
for (const block of toolUseBlocks) {
  const startMs = Date.now();
  let resultContent: string;
  let isError = false;
  console.log(`[tool] ${block.name}`, JSON.stringify(block.input).slice(0, 120));

  // Track tool call start
  const argsSummary = JSON.stringify(block.input).slice(0, 120);
  const eventId = runId ? trackToolCall(runId, block.name, argsSummary) : '';

  try {
    if (SHELL_TOOL_NAMES.has(block.name)) {
      resultContent = await executeShellTool(block.name, block.input as Record<string, unknown>);
    } else {
      const output = await executeBrowserTool(block.name, block.input as Record<string, unknown>, browser);
      resultContent = truncateBrowserResult(JSON.stringify(output));
      isError = (output as { ok?: boolean }).ok === false;
    }
  } catch (err) {
    resultContent = JSON.stringify({ ok: false, error: (err as Error).message });
    isError = true;
  }
  const durationMs = Date.now() - startMs;

  // Track tool result
  if (runId && eventId) {
    trackToolResult(runId, eventId, resultContent.slice(0, 200), durationMs);
  }

  if (!webContents.isDestroyed()) {
    webContents.send(IPC_EVENTS.CHAT_TOOL_ACTIVITY, {
      id: block.id,
      name: block.name,
      status: isError ? 'error' : 'success',
      detail: resultContent.slice(0, 200),
      durationMs,
    });
  }
  results.push({
    type: 'tool_result',
    tool_use_id: block.id,
    content: resultContent,
  });
}
```

At the success return path (before `return { response: assistantText }`), add:

```typescript
if (runId) completeRun(runId, 0, 0); // token counts not available from streaming path yet
```

At the catch block where `err.name === 'AbortError'`, add:

```typescript
if (runId) failRun(runId, 'Cancelled by user');
```

At the other catch path (generic error), add:

```typescript
if (runId) failRun(runId, err.message);
```

- [ ] **Step 2: Build to check for TypeScript errors**

```bash
cd /home/dp/Desktop/clawdia7.0
npx tsc -p tsconfig.main.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/anthropicChat.ts
git commit -m "feat: add run telemetry to anthropicChat — startRun, trackToolCall, trackToolResult, completeRun/failRun"
```

---

## Task 7: Add run telemetry to openaiChat.ts and geminiChat.ts

**Files:**
- Modify: `src/main/openaiChat.ts`
- Modify: `src/main/geminiChat.ts`

- [ ] **Step 1: Read openaiChat.ts to understand its structure**

```bash
cat /home/dp/Desktop/clawdia7.0/src/main/openaiChat.ts
```

- [ ] **Step 2: Add runTracker to openaiChat.ts**

Add import at the top:

```typescript
import { startRun, trackToolCall, trackToolResult, completeRun, failRun } from './runTracker';
```

Add `conversationId?: string` to the StreamParams type in openaiChat.ts (same pattern as anthropicChat.ts).

Add to the destructured params in `streamOpenAIChat`:
```typescript
conversationId,
```

At the start of `streamOpenAIChat`, after provider/model setup:
```typescript
const runId = conversationId ? startRun(conversationId, 'openai', modelRegistryId) : null;
```

For each tool call executed in openaiChat.ts, wrap with:
```typescript
const eventId = runId ? trackToolCall(runId, toolName, argsSummary) : '';
// ... execute tool ...
if (runId && eventId) trackToolResult(runId, eventId, resultSummary, durationMs);
```

At success return:
```typescript
if (runId) completeRun(runId, 0, 0);
```

At error/abort returns:
```typescript
if (runId) failRun(runId, errorMessage);
```

- [ ] **Step 3: Add runTracker to geminiChat.ts**

Apply the identical pattern to `src/main/geminiChat.ts`:
- Import runTracker
- Add `conversationId?: string` to StreamParams
- `startRun` at function start
- `trackToolCall`/`trackToolResult` around each tool dispatch
- `completeRun` at success, `failRun` at abort/error

- [ ] **Step 4: Update registerIpc.ts to pass conversationId to all three providers**

In `registerIpc.ts`, in the CHAT_SEND handler (Task 5), add `conversationId: id` to each provider call:

```typescript
if (settings.provider === 'gemini') {
  result = await streamGeminiChat({
    // ... existing params ...
    conversationId: id,
  });
} else if (settings.provider === 'openai') {
  result = await streamOpenAIChat({
    // ... existing params ...
    conversationId: id,
  });
} else {
  result = await streamAnthropicChat({
    // ... existing params ...
    conversationId: id,
  });
}
```

- [ ] **Step 5: Build to check for TypeScript errors**

```bash
cd /home/dp/Desktop/clawdia7.0
npx tsc -p tsconfig.main.json --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/openaiChat.ts src/main/geminiChat.ts src/main/registerIpc.ts
git commit -m "feat: add run telemetry to openaiChat and geminiChat; pass conversationId from CHAT_SEND"
```

---

## Task 8: Smoke test end-to-end

**Files:** No code changes — verification only.

- [ ] **Step 1: Run all tests**

```bash
cd /home/dp/Desktop/clawdia7.0
npx vitest run
```

Expected: all tests pass (db.test.ts and runTracker.test.ts).

- [ ] **Step 2: Build the full project**

```bash
cd /home/dp/Desktop/clawdia7.0
npm run build:main && npm run build:renderer
```

Expected: no errors.

- [ ] **Step 3: Launch the app and verify persistence**

```bash
cd /home/dp/Desktop/clawdia7.0
npm run start
```

Manual checks:
1. Send a message to Claude
2. Quit the app (`Ctrl+Q` or close the window)
3. Relaunch the app
4. Open the conversation list — the previous conversation should appear
5. Click the conversation — messages should reload from the previous session
6. Confirm `~/.config/clawdia/data.sqlite` exists and is non-empty:

```bash
ls -lh ~/.config/clawdia/data.sqlite
sqlite3 ~/.config/clawdia/data.sqlite "SELECT id, title, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 5;"
sqlite3 ~/.config/clawdia/data.sqlite "SELECT COUNT(*) FROM messages;"
sqlite3 ~/.config/clawdia/data.sqlite "SELECT id, status, provider FROM runs ORDER BY started_at DESC LIMIT 5;"
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: conversation and run persistence — SQLite-backed, survives restart"
```
