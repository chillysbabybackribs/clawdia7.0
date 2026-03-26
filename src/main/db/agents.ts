// src/main/db/agents.ts
import type Database from 'better-sqlite3';
import type { AgentDefinition } from '../../shared/types';

let db: Database.Database | undefined;

function getDb(): Database.Database {
  if (!db) throw new Error('[db/agents] not initialized — call initAgents() first');
  return db;
}

export function initAgents(database: Database.Database): void {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL DEFAULT '',
      status       TEXT NOT NULL DEFAULT 'draft',
      agent_type   TEXT NOT NULL DEFAULT 'general',
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL,
      definition_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agents_updated ON agents(updated_at DESC);
  `);
}

export function createAgent(agent: AgentDefinition): void {
  try {
    getDb().prepare(`
      INSERT INTO agents (id, name, status, agent_type, created_at, updated_at, definition_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      agent.id,
      agent.name,
      agent.status,
      agent.agentType,
      agent.createdAt,
      agent.updatedAt,
      JSON.stringify(agent),
    );
  } catch (err) {
    console.error('[db/agents] createAgent failed:', err);
  }
}

export function getAgent(id: string): AgentDefinition | null {
  try {
    const row = getDb().prepare('SELECT definition_json FROM agents WHERE id = ?').get(id) as { definition_json: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.definition_json) as AgentDefinition;
  } catch (err) {
    console.error('[db/agents] getAgent failed:', err);
    return null;
  }
}

export function listAgents(): AgentDefinition[] {
  try {
    const rows = getDb().prepare('SELECT definition_json FROM agents ORDER BY updated_at DESC').all() as { definition_json: string }[];
    return rows.map(r => JSON.parse(r.definition_json) as AgentDefinition);
  } catch (err) {
    console.error('[db/agents] listAgents failed:', err);
    return [];
  }
}

export function updateAgent(id: string, patch: Partial<AgentDefinition>): AgentDefinition | null {
  try {
    const run = getDb().transaction(() => {
      const existing = getAgent(id);
      if (!existing) return null;
      const updated: AgentDefinition = {
        ...existing,
        ...patch,
        id,
        updatedAt: new Date().toISOString(),
      };
      getDb().prepare(`
        UPDATE agents SET name = ?, status = ?, agent_type = ?, updated_at = ?, definition_json = ? WHERE id = ?
      `).run(
        updated.name,
        updated.status,
        updated.agentType,
        updated.updatedAt,
        JSON.stringify(updated),
        id,
      );
      return updated;
    });
    return run();
  } catch (err) {
    console.error('[db/agents] updateAgent failed:', err);
    return null;
  }
}

export function deleteAgent(id: string): void {
  try {
    getDb().prepare('DELETE FROM agents WHERE id = ?').run(id);
  } catch (err) {
    console.error('[db/agents] deleteAgent failed:', err);
  }
}
