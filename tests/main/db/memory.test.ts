// tests/main/db/memory.test.ts
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const testDbPath = path.join(os.tmpdir(), `clawdia-memory-test-${Date.now()}.sqlite`);
process.env.CLAWDIA_DB_PATH_OVERRIDE = testDbPath;

import { initDb } from '../../../src/main/db';
import { remember, forget, searchMemory, getMemoryContext, pruneMemories, countMemories } from '../../../src/main/db/memory';

beforeEach(() => {
  initDb();
});

afterEach(() => {
  try { fs.unlinkSync(testDbPath); } catch {}
});

afterAll(() => {
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
  it('prunes agent facts down to 180 when over 200', () => {
    for (let i = 0; i < 205; i++) {
      remember('fact', `key_${i}`, `value_${i}`, 'agent');
    }
    pruneMemories();
    expect(countMemories()).toBeLessThanOrEqual(180);
  });

  it('never prunes source=user facts', () => {
    for (let i = 0; i < 201; i++) {
      remember('fact', `agent_key_${i}`, `value_${i}`, 'agent');
    }
    remember('account', 'full_name', 'Alice Smith', 'user');
    pruneMemories();
    const userFacts = searchMemory('Alice Smith');
    expect(userFacts.some(f => f.source === 'user')).toBe(true);
    // Also verify count is actually reduced
    expect(countMemories()).toBeLessThan(202);
  });
});
