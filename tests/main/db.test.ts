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
    createConversation({ id: 'c1', title: 'Test', mode: 'chat', created_at: 1000, updated_at: 1000 });
    createRun({ id: 'r1', conversation_id: 'c1', status: 'running', provider: 'anthropic', model: 'claude-sonnet-4-6', started_at: 1000 });
    // Simulate re-init (app restart)
    initDb();
    const runs = getRuns('c1');
    expect(runs[0].status).toBe('failed');
  });
});
