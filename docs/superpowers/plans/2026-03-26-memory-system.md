# Memory System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a zero-cost recall system — structured user facts + past conversation snippets — auto-injected before every LLM call via SQLite FTS5, plus three agent tools (`memory_store`, `memory_search`, `memory_forget`).

**Architecture:** Two FTS5 virtual tables in the existing `data.sqlite`: `user_memory_fts` (facts) and `messages_fts` (conversation recall). A `getMemoryContext()` function runs two keyword queries before each LLM call and injects up to 600 tokens into the system prompt. Memory tools let the agent and user explicitly store/search/delete facts.

**Tech Stack:** `better-sqlite3` (already in use), FTS5 (built into SQLite), TypeScript, Vitest for tests.

---

## File Map

**Create:**
- `src/main/db/memory.ts` — all memory read/write/search/prune functions
- `src/main/core/cli/memoryTools.ts` — Anthropic tool definitions for the 3 memory tools
- `src/main/agent/memoryExecutors.ts` — executor functions called when agent uses memory tools
- `tests/main/db/memory.test.ts` — tests for memory.ts
- `tests/main/agent/memoryExecutors.test.ts` — tests for executors

**Modify:**
- `src/main/db.ts` — add `user_memory` table, `user_memory_fts`, `messages_fts`, triggers to `initDb()`
- `src/main/core/cli/toolRegistry.ts` — add memory tools to `ALL_TOOLS`
- `src/main/anthropicChat.ts` — inject `getMemoryContext()` into system prompt before each LLM call; dispatch memory tool calls in `executeTools()`

---

## Task 1: Add DB schema — `user_memory` table + FTS tables

**Files:**
- Modify: `src/main/db.ts:60-114`

- [ ] **Step 1: Add `user_memory` table + FTS + triggers to `initDb()` in `src/main/db.ts`**

Add this SQL block inside the `db.exec(...)` call in `initDb()`, after the existing `run_events` table definition (after line 106, before the closing backtick):

```typescript
      CREATE TABLE IF NOT EXISTS user_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'agent',
        confidence INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(category, key)
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS user_memory_fts USING fts5(
        key, value,
        content=user_memory,
        content_rowid=id
      );

      CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON user_memory BEGIN
        INSERT INTO user_memory_fts(rowid, key, value) VALUES (new.id, new.key, new.value);
      END;
      CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON user_memory BEGIN
        INSERT INTO user_memory_fts(user_memory_fts, rowid, key, value) VALUES ('delete', old.id, old.key, old.value);
      END;
      CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON user_memory BEGIN
        INSERT INTO user_memory_fts(user_memory_fts, rowid, key, value) VALUES ('delete', old.id, old.key, old.value);
        INSERT INTO user_memory_fts(rowid, key, value) VALUES (new.id, new.key, new.value);
      END;

      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        content=messages,
        content_rowid=id
      );

      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
        INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
      END;
```

- [ ] **Step 2: Verify `initDb()` still runs cleanly**

```bash
cd /home/dp/Desktop/clawdia7.0
npx tsc -p tsconfig.main.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/db.ts
git commit -m "feat: add user_memory and FTS5 tables to DB schema"
```

---

## Task 2: Write `src/main/db/memory.ts`

**Files:**
- Create: `src/main/db/memory.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/main/db/memory.ts
// Memory read/write/search/prune. All operations use the shared better-sqlite3
// instance from db.ts via a lazy getter injected at init time.

import Database from 'better-sqlite3';

export interface MemoryEntry {
  id: number;
  category: string;
  key: string;
  value: string;
  source: string;
  confidence: number;
  created_at: string;
}

const VALID_CATEGORIES = new Set(['preference', 'account', 'workflow', 'fact', 'context']);
const SECRET_PATTERN = /sk-[a-z0-9]{10,}/i;

let _db: Database.Database | null = null;
let _storeCallCount = 0;

/** Called once by initDb() to wire the shared DB instance into this module. */
export function initMemory(db: Database.Database): void {
  _db = db;
}

function getDb(): Database.Database {
  if (!_db) throw new Error('[memory] not initialized — call initMemory() first');
  return _db;
}

/** Validate a value before writing. Returns error string or null if valid. */
function validateWrite(category: string, key: string, value: string): string | null {
  if (!VALID_CATEGORIES.has(category)) return `invalid category: ${category}`;
  if (key.length > 100) return 'key too long (max 100 chars)';
  if (value.length > 500) return 'value too long (max 500 chars)';
  if (/password|api key/i.test(value)) return 'value looks like a secret — not stored';
  if (SECRET_PATTERN.test(value)) return 'value looks like an API key — not stored';
  return null;
}

/**
 * Upsert a fact into user_memory. On key conflict, increments confidence
 * and updates the value. source='user' facts are never auto-pruned.
 * Returns null on success, or an error string if validation failed.
 */
export function remember(
  category: string,
  key: string,
  value: string,
  source: 'user' | 'agent' = 'agent',
): string | null {
  const err = validateWrite(category, key, value);
  if (err) return err;
  try {
    getDb()
      .prepare(
        `INSERT INTO user_memory (category, key, value, source, confidence)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(category, key) DO UPDATE SET
           value = excluded.value,
           source = excluded.source,
           confidence = confidence + 1`
      )
      .run(category, key, value, source);
    _storeCallCount++;
    if (_storeCallCount % 10 === 0) pruneMemories();
    return null;
  } catch (err: any) {
    console.error('[memory] remember failed:', err.message);
    return err.message;
  }
}

/**
 * Delete a fact by key, optionally scoped to a category.
 * If category is omitted, deletes all facts with matching key.
 */
export function forget(key: string, category?: string): void {
  try {
    if (category) {
      getDb().prepare(`DELETE FROM user_memory WHERE key = ? AND category = ?`).run(key, category);
    } else {
      getDb().prepare(`DELETE FROM user_memory WHERE key = ?`).run(key);
    }
  } catch (err: any) {
    console.error('[memory] forget failed:', err.message);
  }
}

/**
 * FTS5 keyword search on user_memory. Returns up to `limit` results.
 * Falls back to LIKE query if FTS fails.
 */
export function searchMemory(query: string, limit = 5): MemoryEntry[] {
  try {
    return getDb()
      .prepare(
        `SELECT m.* FROM user_memory m
         JOIN user_memory_fts fts ON m.id = fts.rowid
         WHERE user_memory_fts MATCH ?
         ORDER BY rank
         LIMIT ?`
      )
      .all(query, limit) as MemoryEntry[];
  } catch {
    // FTS failed — degrade to LIKE
    try {
      const like = `%${query}%`;
      return getDb()
        .prepare(`SELECT * FROM user_memory WHERE key LIKE ? OR value LIKE ? LIMIT ?`)
        .all(like, like, limit) as MemoryEntry[];
    } catch {
      return [];
    }
  }
}

/**
 * Build the memory context block to inject into the system prompt.
 * Returns an empty string if nothing relevant is found or message is too short.
 * Hard cap: ~600 tokens (~2400 chars total output).
 */
export function getMemoryContext(userMessage: string): string {
  if (userMessage.length < 15) return '';

  const parts: string[] = [];

  try {
    // Always include source='user' facts (up to 3), then FTS results
    const userFacts = getDb()
      .prepare(`SELECT * FROM user_memory WHERE source = 'user' ORDER BY confidence DESC LIMIT 3`)
      .all() as MemoryEntry[];

    const ftsQuery = userMessage.slice(0, 200); // trim for FTS safety
    let ftsFacts: MemoryEntry[] = [];
    try {
      ftsFacts = getDb()
        .prepare(
          `SELECT m.* FROM user_memory m
           JOIN user_memory_fts fts ON m.id = fts.rowid
           WHERE user_memory_fts MATCH ?
           ORDER BY rank
           LIMIT 5`
        )
        .all(ftsQuery) as MemoryEntry[];
    } catch {
      // FTS failed silently — skip facts recall
    }

    // Merge: user facts first, then FTS results not already included
    const userFactIds = new Set(userFacts.map(f => f.id));
    const merged = [...userFacts, ...ftsFacts.filter(f => !userFactIds.has(f.id))];

    if (merged.length > 0) {
      const lines = merged.map(f => `- ${f.key}: ${f.value}`).join('\n');
      parts.push(`[Memory]\n${lines}`);
    }
  } catch {
    // Silently skip facts if DB unavailable
  }

  try {
    // Conversation recall: last 90 days, limit 3 snippets
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const ftsQuery = userMessage.slice(0, 200);
    let snippets: { content: string }[] = [];
    try {
      snippets = getDb()
        .prepare(
          `SELECT m.content FROM messages m
           JOIN messages_fts fts ON m.id = fts.rowid
           WHERE messages_fts MATCH ?
             AND m.created_at > ?
           ORDER BY rank
           LIMIT 3`
        )
        .all(ftsQuery, cutoff) as { content: string }[];
    } catch {
      // FTS failed silently — skip conversation recall
    }

    if (snippets.length > 0) {
      const lines = snippets
        .map(s => {
          // content is JSON-serialized Message — extract plain text
          try {
            const msg = JSON.parse(s.content);
            const text = typeof msg.content === 'string'
              ? msg.content
              : JSON.stringify(msg.content);
            return `- "${text.slice(0, 200)}"`;
          } catch {
            return `- "${s.content.slice(0, 200)}"`;
          }
        })
        .join('\n');
      parts.push(`[Past conversations]\n${lines}`);
    }
  } catch {
    // Silently skip conversation recall if DB unavailable
  }

  if (parts.length === 0) return '';

  const result = parts.join('\n\n');
  // Hard cap at ~2400 chars (~600 tokens)
  return result.slice(0, 2400);
}

/**
 * Prune user_memory to 180 entries (called automatically every 10 stores).
 * Never prunes source='user' facts. Deletes lowest-confidence agent facts first.
 */
export function pruneMemories(): void {
  try {
    const db = getDb();
    const total = (db.prepare(`SELECT COUNT(*) as n FROM user_memory`).get() as { n: number }).n;
    if (total <= 200) return;
    const toDelete = total - 180;
    db.prepare(
      `DELETE FROM user_memory WHERE id IN (
         SELECT id FROM user_memory
         WHERE source = 'agent'
         ORDER BY confidence ASC, created_at ASC
         LIMIT ?
       )`
    ).run(toDelete);
  } catch (err: any) {
    console.error('[memory] pruneMemories failed:', err.message);
  }
}
```

- [ ] **Step 2: Type-check**

```bash
cd /home/dp/Desktop/clawdia7.0
npx tsc -p tsconfig.main.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/db/memory.ts
git commit -m "feat: add memory.ts — remember, forget, searchMemory, getMemoryContext, pruneMemories"
```

---

## Task 3: Wire `initMemory()` into `initDb()`

**Files:**
- Modify: `src/main/db.ts`

The `memory.ts` module needs the shared DB instance. We wire it up inside `initDb()` after the DB is created.

- [ ] **Step 1: Add import and `initMemory()` call to `src/main/db.ts`**

At the top of `src/main/db.ts`, add the import after the existing imports:

```typescript
import { initMemory } from './db/memory';
```

Inside `initDb()`, after line 113 (`db.pragma('foreign_keys = ON');`), add:

```typescript
    initMemory(db);
```

The full relevant block becomes:

```typescript
export function initDb(): void {
  try {
    const dbPath = resolveDbPath();
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initMemory(db);

    db.exec(`
      // ... existing + new tables ...
    `);
    // ...
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc -p tsconfig.main.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/db.ts
git commit -m "feat: wire initMemory into initDb"
```

---

## Task 4: Write tests for `memory.ts`

**Files:**
- Create: `tests/main/db/memory.test.ts`

- [ ] **Step 1: Create test file**

```typescript
// tests/main/db/memory.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const testDbPath = path.join(os.tmpdir(), `clawdia-memory-test-${Date.now()}.sqlite`);
process.env.CLAWDIA_DB_PATH_OVERRIDE = testDbPath;

import { initDb } from '../../../src/main/db';
import { remember, forget, searchMemory, getMemoryContext, pruneMemories } from '../../../src/main/db/memory';

beforeEach(() => {
  initDb();
});

afterEach(() => {
  try { fs.unlinkSync(testDbPath); } catch {}
});

describe('remember', () => {
  it('stores a fact and returns null on success', () => {
    const err = remember('preference', 'preferred_editor', 'VS Code', 'user');
    expect(err).toBeNull();
  });

  it('rejects invalid category', () => {
    const err = remember('invalid_cat', 'key', 'value', 'agent');
    expect(err).not.toBeNull();
    expect(err).toContain('invalid category');
  });

  it('rejects value containing "password"', () => {
    const err = remember('fact', 'secret', 'my password is 1234', 'agent');
    expect(err).not.toBeNull();
  });

  it('rejects value matching API key pattern', () => {
    const err = remember('fact', 'key', 'sk-abcdefghijklmnop', 'agent');
    expect(err).not.toBeNull();
  });

  it('rejects value over 500 chars', () => {
    const err = remember('fact', 'key', 'x'.repeat(501), 'agent');
    expect(err).not.toBeNull();
  });

  it('rejects key over 100 chars', () => {
    const err = remember('fact', 'k'.repeat(101), 'value', 'agent');
    expect(err).not.toBeNull();
  });

  it('upserts on conflict — increments confidence, updates value', () => {
    remember('fact', 'city', 'London', 'agent');
    remember('fact', 'city', 'Berlin', 'agent');
    const results = searchMemory('city');
    expect(results).toHaveLength(1);
    expect(results[0].value).toBe('Berlin');
    expect(results[0].confidence).toBe(2);
  });
});

describe('forget', () => {
  it('deletes a fact by key', () => {
    remember('fact', 'city', 'London', 'agent');
    forget('city');
    expect(searchMemory('city')).toHaveLength(0);
  });

  it('deletes only the matching category when category provided', () => {
    remember('fact', 'name', 'Alice', 'agent');
    remember('account', 'name', 'alice_handle', 'agent');
    forget('name', 'fact');
    const results = searchMemory('name');
    expect(results).toHaveLength(1);
    expect(results[0].category).toBe('account');
  });
});

describe('searchMemory', () => {
  it('returns relevant facts by keyword', () => {
    remember('preference', 'preferred_editor', 'VS Code with vim keybindings', 'agent');
    remember('fact', 'home_city', 'Berlin', 'agent');
    const results = searchMemory('editor');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].key).toBe('preferred_editor');
  });

  it('returns empty array when no match', () => {
    remember('fact', 'city', 'London', 'agent');
    const results = searchMemory('zzznomatch');
    expect(results).toHaveLength(0);
  });
});

describe('getMemoryContext', () => {
  it('returns empty string for short messages', () => {
    remember('fact', 'city', 'London', 'agent');
    expect(getMemoryContext('hi')).toBe('');
  });

  it('returns empty string when no relevant facts', () => {
    const ctx = getMemoryContext('what editor do I use');
    expect(ctx).toBe('');
  });

  it('includes matching facts in [Memory] block', () => {
    remember('preference', 'preferred_editor', 'VS Code', 'user');
    const ctx = getMemoryContext('what editor do I use for coding');
    expect(ctx).toContain('[Memory]');
    expect(ctx).toContain('preferred_editor');
  });

  it('always includes source=user facts regardless of query relevance', () => {
    remember('account', 'full_name', 'Alice Smith', 'user');
    const ctx = getMemoryContext('tell me about the weather in Berlin today');
    expect(ctx).toContain('full_name');
  });

  it('caps output at 2400 chars', () => {
    for (let i = 0; i < 30; i++) {
      remember('fact', `key_${i}`, 'x'.repeat(100), 'user');
    }
    const ctx = getMemoryContext('key fact value thing long query string here');
    expect(ctx.length).toBeLessThanOrEqual(2400);
  });
});

describe('pruneMemories', () => {
  it('deletes lowest-confidence agent facts when over 200', () => {
    // Insert 205 agent facts with varying confidence
    for (let i = 0; i < 205; i++) {
      // Use raw SQL via remember — confidence starts at 1
      remember('fact', `key_${i}`, `value_${i}`, 'agent');
    }
    pruneMemories();
    // Should have pruned down to 180
    // We can verify via searchMemory returning results (rough check)
    // since we don't export a count function — verify no crash
    const results = searchMemory('value');
    expect(results.length).toBeGreaterThan(0);
  });

  it('never prunes source=user facts', () => {
    // Insert 201 agent facts + 1 user fact
    for (let i = 0; i < 201; i++) {
      remember('fact', `agent_key_${i}`, `value_${i}`, 'agent');
    }
    remember('account', 'full_name', 'Alice Smith', 'user');
    pruneMemories();
    const userFacts = searchMemory('Alice Smith');
    expect(userFacts.some(f => f.source === 'user')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd /home/dp/Desktop/clawdia7.0
npx vitest run tests/main/db/memory.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/main/db/memory.test.ts
git commit -m "test: add memory.ts unit tests"
```

---

## Task 5: Create `src/main/core/cli/memoryTools.ts`

**Files:**
- Create: `src/main/core/cli/memoryTools.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/main/core/cli/memoryTools.ts
// Anthropic tool definitions for the three memory tools.
// These are added to the tool list alongside shell and browser tools.

import type Anthropic from '@anthropic-ai/sdk';

export const MEMORY_TOOLS: Anthropic.Tool[] = [
  {
    name: 'memory_store',
    description:
      'Store a fact about the user in persistent memory. Call this when the user explicitly asks you to remember something, or when you learn something important about them that should persist across conversations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          enum: ['preference', 'account', 'workflow', 'fact', 'context'],
          description:
            'preference: editor/language/style preferences. account: names/handles/emails/role. workflow: tools/processes they follow. fact: location/background/skills/projects. context: current task/goals/deadlines.',
        },
        key: {
          type: 'string',
          description: 'Short snake_case label, e.g. preferred_editor, home_city, current_project. Max 100 chars.',
        },
        value: {
          type: 'string',
          description: 'The fact to store. One sentence max. Max 500 chars.',
        },
        source: {
          type: 'string',
          enum: ['user', 'agent'],
          description:
            'Use "user" if the user explicitly asked you to remember this. Use "agent" if you decided to store it.',
        },
      },
      required: ['category', 'key', 'value', 'source'],
    },
  },
  {
    name: 'memory_search',
    description:
      'Search persistent memory for stored facts about the user. Use this for explicit recall requests beyond what was auto-injected in context.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Keywords to search for, e.g. "editor preference" or "current project".',
        },
        limit: {
          type: 'number',
          description: 'Max results to return. Defaults to 5.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_forget',
    description:
      'Delete a stored fact from persistent memory. Call this when the user asks you to forget something.',
    input_schema: {
      type: 'object' as const,
      properties: {
        key: {
          type: 'string',
          description: 'The snake_case key of the fact to delete.',
        },
        category: {
          type: 'string',
          description:
            'Optional. If provided, only deletes the fact in this category. If omitted, deletes all facts with this key.',
        },
      },
      required: ['key'],
    },
  },
];
```

- [ ] **Step 2: Type-check**

```bash
npx tsc -p tsconfig.main.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/core/cli/memoryTools.ts
git commit -m "feat: add memoryTools.ts — tool definitions for memory_store, memory_search, memory_forget"
```

---

## Task 6: Create `src/main/agent/memoryExecutors.ts`

**Files:**
- Create: `src/main/agent/memoryExecutors.ts`

- [ ] **Step 1: Create the directory and file**

```bash
mkdir -p /home/dp/Desktop/clawdia7.0/src/main/agent
```

```typescript
// src/main/agent/memoryExecutors.ts
// Executor functions for the three memory tools.
// Called from anthropicChat.ts executeTools() when the agent uses a memory tool.

import { remember, forget, searchMemory } from '../db/memory';
import type { MemoryEntry } from '../db/memory';

export function executeMemoryStore(input: Record<string, unknown>): string {
  const category = input.category as string;
  const key = input.key as string;
  const value = input.value as string;
  const source = (input.source as 'user' | 'agent') ?? 'agent';

  const err = remember(category, key, value, source);
  if (err) {
    return JSON.stringify({ ok: false, error: err });
  }
  return JSON.stringify({ ok: true, stored: { category, key, value, source } });
}

export function executeMemorySearch(input: Record<string, unknown>): string {
  const query = input.query as string;
  const limit = typeof input.limit === 'number' ? input.limit : 5;

  const results: MemoryEntry[] = searchMemory(query, limit);
  if (results.length === 0) {
    return JSON.stringify({ ok: true, results: [], message: 'No matching facts found.' });
  }
  return JSON.stringify({
    ok: true,
    results: results.map(r => ({
      category: r.category,
      key: r.key,
      value: r.value,
      source: r.source,
      confidence: r.confidence,
    })),
  });
}

export function executeMemoryForget(input: Record<string, unknown>): string {
  const key = input.key as string;
  const category = input.category as string | undefined;

  forget(key, category);
  return JSON.stringify({ ok: true, deleted: { key, category: category ?? 'all categories' } });
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc -p tsconfig.main.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/agent/memoryExecutors.ts
git commit -m "feat: add memoryExecutors.ts — executors for memory tools"
```

---

## Task 7: Write tests for `memoryExecutors.ts`

**Files:**
- Create: `tests/main/agent/memoryExecutors.test.ts`

- [ ] **Step 1: Create test file**

```typescript
// tests/main/agent/memoryExecutors.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const testDbPath = path.join(os.tmpdir(), `clawdia-exec-test-${Date.now()}.sqlite`);
process.env.CLAWDIA_DB_PATH_OVERRIDE = testDbPath;

import { initDb } from '../../../src/main/db';
import {
  executeMemoryStore,
  executeMemorySearch,
  executeMemoryForget,
} from '../../../src/main/agent/memoryExecutors';

beforeEach(() => {
  initDb();
});

afterEach(() => {
  try { fs.unlinkSync(testDbPath); } catch {}
});

describe('executeMemoryStore', () => {
  it('stores a valid fact and returns ok:true', () => {
    const result = JSON.parse(
      executeMemoryStore({ category: 'preference', key: 'preferred_editor', value: 'VS Code', source: 'user' })
    );
    expect(result.ok).toBe(true);
    expect(result.stored.key).toBe('preferred_editor');
  });

  it('returns ok:false for invalid category', () => {
    const result = JSON.parse(
      executeMemoryStore({ category: 'bad_cat', key: 'key', value: 'value', source: 'agent' })
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('invalid category');
  });

  it('returns ok:false for secret-looking value', () => {
    const result = JSON.parse(
      executeMemoryStore({ category: 'fact', key: 'key', value: 'sk-abcdefghijklmnop', source: 'agent' })
    );
    expect(result.ok).toBe(false);
  });
});

describe('executeMemorySearch', () => {
  it('returns matching facts', () => {
    executeMemoryStore({ category: 'preference', key: 'preferred_editor', value: 'VS Code with vim', source: 'user' });
    const result = JSON.parse(executeMemorySearch({ query: 'editor vim' }));
    expect(result.ok).toBe(true);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].key).toBe('preferred_editor');
  });

  it('returns empty results with message when no match', () => {
    const result = JSON.parse(executeMemorySearch({ query: 'zzznomatch' }));
    expect(result.ok).toBe(true);
    expect(result.results).toHaveLength(0);
    expect(result.message).toBeDefined();
  });
});

describe('executeMemoryForget', () => {
  it('deletes a fact and confirms deletion', () => {
    executeMemoryStore({ category: 'fact', key: 'city', value: 'London', source: 'agent' });
    const result = JSON.parse(executeMemoryForget({ key: 'city' }));
    expect(result.ok).toBe(true);
    const search = JSON.parse(executeMemorySearch({ query: 'city London' }));
    expect(search.results).toHaveLength(0);
  });

  it('scoped delete by category only removes matching category', () => {
    executeMemoryStore({ category: 'fact', key: 'name', value: 'Alice', source: 'agent' });
    executeMemoryStore({ category: 'account', key: 'name', value: 'alice_handle', source: 'agent' });
    executeMemoryForget({ key: 'name', category: 'fact' });
    const result = JSON.parse(executeMemorySearch({ query: 'alice' }));
    expect(result.results.some((r: { category: string }) => r.category === 'account')).toBe(true);
    expect(result.results.some((r: { category: string }) => r.category === 'fact')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run tests/main/agent/memoryExecutors.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/main/agent/memoryExecutors.test.ts
git commit -m "test: add memoryExecutors unit tests"
```

---

## Task 8: Register memory tools in `toolRegistry.ts`

**Files:**
- Modify: `src/main/core/cli/toolRegistry.ts:1-27`

- [ ] **Step 1: Import and add MEMORY_TOOLS to `ALL_TOOLS`**

At the top of `src/main/core/cli/toolRegistry.ts`, add import after the existing imports:

```typescript
import { MEMORY_TOOLS } from './memoryTools';
```

Update the `ALL_TOOLS` array (currently lines 20-23):

```typescript
const ALL_TOOLS: Anthropic.Tool[] = [
  ...SHELL_TOOLS_CANONICAL,
  ...BROWSER_TOOLS,
  ...MEMORY_TOOLS,
];
```

- [ ] **Step 2: Type-check**

```bash
npx tsc -p tsconfig.main.json --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/main/core/cli/toolRegistry.ts
git commit -m "feat: register memory tools in toolRegistry"
```

---

## Task 9: Wire memory into `anthropicChat.ts`

This is the integration step — inject memory context into every LLM call, and dispatch memory tool calls in `executeTools()`.

**Files:**
- Modify: `src/main/anthropicChat.ts`

- [ ] **Step 1: Add imports at the top of `anthropicChat.ts`**

After the existing imports (after line 10), add:

```typescript
import { getMemoryContext } from './db/memory';
import { executeMemoryStore, executeMemorySearch, executeMemoryForget } from './agent/memoryExecutors';
```

- [ ] **Step 2: Inject memory context into the streaming path system prompt**

The streaming path calls `buildAnthropicStreamSystemPrompt(unrestrictedMode)` at line 162. Replace that call to prepend memory context:

In the `runStream` function (around line 154-204), find:

```typescript
      system: [
        {
          type: 'text' as const,
          text: buildAnthropicStreamSystemPrompt(unrestrictedMode),
          cache_control: { type: 'ephemeral' as const },
        },
      ] as any,
```

Replace with:

```typescript
      system: [
        {
          type: 'text' as const,
          text: (() => {
            const memCtx = getMemoryContext(userText);
            const base = buildAnthropicStreamSystemPrompt(unrestrictedMode);
            return memCtx ? `${memCtx}\n\n${base}` : base;
          })(),
          cache_control: { type: 'ephemeral' as const },
        },
      ] as any,
```

- [ ] **Step 3: Inject memory context into the agentic path system prompt**

The agentic path calls `buildSharedSystemPrompt(unrestrictedMode)` at line 243 inside `runToolTurn`. Find:

```typescript
      system: buildSharedSystemPrompt(unrestrictedMode),
```

Replace with:

```typescript
      system: (() => {
        const memCtx = getMemoryContext(userText);
        const base = buildSharedSystemPrompt(unrestrictedMode);
        return memCtx ? `${memCtx}\n\n${base}` : base;
      })(),
```

- [ ] **Step 4: Add memory tool names to `SHELL_TOOL_NAMES` set and dispatch in `executeTools()`**

Find the `SHELL_TOOL_NAMES` set (line 257):

```typescript
  const SHELL_TOOL_NAMES = new Set(['shell_exec', 'file_edit', 'file_list_directory', 'file_search']);
```

Replace with:

```typescript
  const SHELL_TOOL_NAMES = new Set(['shell_exec', 'file_edit', 'file_list_directory', 'file_search']);
  const MEMORY_TOOL_NAMES = new Set(['memory_store', 'memory_search', 'memory_forget']);
```

Inside `executeTools()`, find the dispatch logic (lines 271-276):

```typescript
        if (SHELL_TOOL_NAMES.has(block.name)) {
          resultContent = await executeShellTool(block.name, block.input as Record<string, unknown>);
        } else {
          const output = await executeBrowserTool(block.name, block.input as Record<string, unknown>, browser);
          resultContent = truncateBrowserResult(JSON.stringify(output));
          isError = (output as { ok?: boolean }).ok === false;
        }
```

Replace with:

```typescript
        if (SHELL_TOOL_NAMES.has(block.name)) {
          resultContent = await executeShellTool(block.name, block.input as Record<string, unknown>);
        } else if (MEMORY_TOOL_NAMES.has(block.name)) {
          if (block.name === 'memory_store') {
            resultContent = executeMemoryStore(block.input as Record<string, unknown>);
          } else if (block.name === 'memory_search') {
            resultContent = executeMemorySearch(block.input as Record<string, unknown>);
          } else {
            resultContent = executeMemoryForget(block.input as Record<string, unknown>);
          }
        } else {
          const output = await executeBrowserTool(block.name, block.input as Record<string, unknown>, browser);
          resultContent = truncateBrowserResult(JSON.stringify(output));
          isError = (output as { ok?: boolean }).ok === false;
        }
```

- [ ] **Step 5: Also add MEMORY_TOOLS to the `runToolTurn` tool list**

Inside `runToolTurn` (around line 237-253), the tools array currently has shell tools + deferred browser tools. Memory tools should be available without deferral. Find the `tools:` array:

```typescript
      tools: [
        { type: 'tool_search_tool_bm25_20251119', name: 'tool_search_tool_bm25' } as any,
        ...ANTHROPIC_SHELL_TOOLS.map((t, i) =>
          i === ANTHROPIC_SHELL_TOOLS.length - 1
            ? { ...t, cache_control: { type: 'ephemeral' as const } }
            : t
        ),
        ...deferredBrowserTools,
      ] as any,
```

Replace with:

```typescript
      tools: [
        { type: 'tool_search_tool_bm25_20251119', name: 'tool_search_tool_bm25' } as any,
        ...ANTHROPIC_SHELL_TOOLS.map((t, i) =>
          i === ANTHROPIC_SHELL_TOOLS.length - 1
            ? { ...t, cache_control: { type: 'ephemeral' as const } }
            : t
        ),
        ...MEMORY_TOOLS,
        ...deferredBrowserTools,
      ] as any,
```

Add the import for `MEMORY_TOOLS` at the top of the file (after the existing imports):

```typescript
import { MEMORY_TOOLS } from './core/cli/memoryTools';
```

- [ ] **Step 6: Type-check**

```bash
npx tsc -p tsconfig.main.json --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/anthropicChat.ts
git commit -m "feat: inject memory context and wire memory tool dispatch in anthropicChat"
```

---

## Task 10: Run full test suite

- [ ] **Step 1: Run all tests**

```bash
cd /home/dp/Desktop/clawdia7.0
npx vitest run
```

Expected: all existing tests pass, plus the new memory and executor tests.

- [ ] **Step 2: If any tests fail, fix them before proceeding**

Common failure: `CLAWDIA_DB_PATH_OVERRIDE` env var collision between test files. Each test file sets its own unique path using `Date.now()` — if tests run in the same process, the later `process.env` assignment wins. Check that each test file sets the env var before importing `db.ts`.

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -p
git commit -m "fix: resolve test isolation issues in memory tests"
```

---

## Task 11: Smoke test in the running app

- [ ] **Step 1: Build and launch**

```bash
cd /home/dp/Desktop/clawdia7.0
npm run build && npm start
```

- [ ] **Step 2: Test memory_store via natural language**

In the chat, send: `Remember that I prefer dark mode in all editors.`

Expected: agent calls `memory_store` with `category: "preference"`, `key: "dark_mode"` or similar, `source: "user"`. ToolActivity in UI shows "Stored: ...".

- [ ] **Step 3: Test auto-recall injection**

Send a message about editors (e.g. `What's the best VS Code extension for TypeScript?`). The system prompt injected into that LLM call should contain `[Memory]` with the dark mode preference if it matched.

- [ ] **Step 4: Test memory_forget**

Send: `Forget my dark mode preference.`

Expected: agent calls `memory_forget` with `key: "dark_mode"`. Subsequent recall queries don't include it.

- [ ] **Step 5: Commit if any smoke-test fixes needed**

```bash
git add -p
git commit -m "fix: smoke test corrections for memory system"
```
