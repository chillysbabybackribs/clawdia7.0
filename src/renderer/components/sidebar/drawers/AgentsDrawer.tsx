import React, { useEffect, useMemo, useState } from 'react';
import type { AgentDefinition } from '../../../../shared/types';
import AgentHistoryModal from '../../agents/AgentHistoryModal';
import AgentQuickViewModal from '../../agents/AgentQuickViewModal';

interface AgentsDrawerProps {
  onCreateAgent: () => void;
  onOpenAgent: (id: string) => void;
}

type MenuState = {
  agent: AgentDefinition;
  top: number;
  left: number;
} | null;

function statusLabel(agent: AgentDefinition): string {
  if (agent.lastRunStatus === 'running') return 'Running';
  if (agent.schedule) return 'Scheduled';
  if (agent.lastRunStatus === 'failed') return 'Attention';
  if (agent.status === 'draft') return 'Needs Setup';
  if (agent.status === 'disabled') return 'Disabled';
  return 'Ready';
}

export default function AgentsDrawer({ onCreateAgent, onOpenAgent }: AgentsDrawerProps) {
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [search, setSearch] = useState('');
  const [menu, setMenu] = useState<MenuState>(null);
  const [quickViewAgent, setQuickViewAgent] = useState<AgentDefinition | null>(null);
  const [historyAgent, setHistoryAgent] = useState<AgentDefinition | null>(null);

  const loadAgents = async () => {
    try {
      setAgents(await window.clawdia.agent.list());
    } catch {
      setAgents([]);
    }
  };

  useEffect(() => {
    loadAgents();
  }, []);

  useEffect(() => {
    if (!menu) return;
    const handler = () => setMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [menu]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((agent) =>
      agent.name.toLowerCase().includes(q) ||
      agent.description.toLowerCase().includes(q) ||
      agent.goal.toLowerCase().includes(q),
    );
  }, [agents, search]);

  const counts = useMemo(() => ({
    ready: agents.filter((agent) => statusLabel(agent) === 'Ready').length,
    scheduled: agents.filter((agent) => statusLabel(agent) === 'Scheduled').length,
    running: agents.filter((agent) => statusLabel(agent) === 'Running').length,
  }), [agents]);

  const handleDelete = async (id: string) => {
    const confirmed = window.confirm('Delete this agent?');
    if (!confirmed) return;
    await window.clawdia.agent.delete(id).catch(() => {});
    setMenu(null);
    loadAgents();
  };

  const handleRun = async (agent: AgentDefinition, mode: 'manual' | 'browser_context') => {
    setMenu(null);
    if (mode === 'browser_context') await window.clawdia.agent.runOnCurrentPage(agent.id).catch(() => {});
    else await window.clawdia.agent.run(agent.id).catch(() => {});
    loadAgents();
  };

  return (
    <>
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border px-3 py-3">
          <span className="text-[11px] font-semibold text-text-primary">Agents</span>
          <button
            onClick={onCreateAgent}
            className="no-drag rounded border border-accent/20 bg-accent/[0.06] px-2 py-0.5 text-[10px] text-accent transition-colors hover:bg-accent/10"
          >
            + Create
          </button>
        </div>

        <div className="border-b border-border px-2.5 py-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search agents"
            className="w-full rounded bg-border-subtle border border-border px-2.5 py-1.5 text-[11px] text-text-primary outline-none placeholder:text-text-tertiary focus:border-accent/30"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <div className="text-[12px] font-semibold text-text-primary">
                {agents.length === 0 ? 'No agents yet' : 'No matching agents'}
              </div>
              <div className="mt-2 text-[11px] leading-relaxed text-text-muted">
                Create reusable workers that can later run from context or on a schedule.
              </div>
              {agents.length === 0 && (
                <button
                  onClick={onCreateAgent}
                  className="mt-4 rounded-lg border border-border px-3 py-1.5 text-[11px] text-text-secondary hover:bg-border-subtle hover:text-text-primary"
                >
                  Create Agent
                </button>
              )}
            </div>
          ) : (
            filtered.map((agent) => (
              <button
                key={agent.id}
                onClick={() => onOpenAgent(agent.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ agent, top: e.clientY, left: e.clientX });
                }}
                className="no-drag flex w-full items-start gap-3 border-b border-border/60 px-3 py-3 text-left transition-colors hover:bg-border-subtle"
              >
                <div className="mt-0.5 h-2 w-2 rounded-full bg-accent/70" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <div className="truncate text-[11px] font-semibold text-text-primary">{agent.name}</div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                        setMenu({ agent, top: rect.bottom + 6, left: rect.right - 168 });
                      }}
                      className="no-drag flex h-5 w-5 items-center justify-center rounded text-[12px] text-text-muted hover:bg-surface-1 hover:text-text-primary"
                    >
                      ⋯
                    </button>
                  </div>
                  <div className="mt-1 truncate text-[10px] text-text-secondary">{agent.description || agent.goal}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[9px] uppercase tracking-wide text-text-muted">
                    <span>{agent.agentType.replace(/_/g, ' ')}</span>
                    <span>•</span>
                    <span>{agent.launchModes[0].replace(/_/g, ' ')}</span>
                    <span>•</span>
                    <span>{statusLabel(agent)}</span>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="border-t border-border px-3 py-2 text-[10px] text-text-muted">
          {counts.ready} Ready · {counts.scheduled} Scheduled · {counts.running} Running
        </div>
      </div>

      {menu && (
        <div
          className="fixed z-30 min-w-[168px] rounded-xl border border-border bg-surface-0 p-1 shadow-[0_18px_50px_rgba(0,0,0,0.45)]"
          style={{ top: menu.top, left: menu.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => handleRun(menu.agent, 'manual')}
            className="block w-full rounded-lg px-3 py-2 text-left text-[11px] text-text-secondary hover:bg-border-subtle hover:text-text-primary"
          >
            Run Agent
          </button>
          {menu.agent.launchModes.includes('browser_context') && (
            <button
              onClick={() => handleRun(menu.agent, 'browser_context')}
              className="block w-full rounded-lg px-3 py-2 text-left text-[11px] text-text-secondary hover:bg-border-subtle hover:text-text-primary"
            >
              Run on Current Page
            </button>
          )}
          <button
            onClick={() => { onOpenAgent(menu.agent.id); setMenu(null); }}
            className="block w-full rounded-lg px-3 py-2 text-left text-[11px] text-text-secondary hover:bg-border-subtle hover:text-text-primary"
          >
            Details
          </button>
          <button
            onClick={() => { setQuickViewAgent(menu.agent); setMenu(null); }}
            className="block w-full rounded-lg px-3 py-2 text-left text-[11px] text-text-secondary hover:bg-border-subtle hover:text-text-primary"
          >
            Quick view
          </button>
          <button
            onClick={() => { setHistoryAgent(menu.agent); setMenu(null); }}
            className="block w-full rounded-lg px-3 py-2 text-left text-[11px] text-text-secondary hover:bg-border-subtle hover:text-text-primary"
          >
            History
          </button>
          <button
            onClick={() => handleDelete(menu.agent.id)}
            className="block w-full rounded-lg px-3 py-2 text-left text-[11px] text-[#FF5061] hover:bg-[#FF5061]/10"
          >
            Delete
          </button>
        </div>
      )}

      <AgentQuickViewModal
        agent={quickViewAgent}
        onClose={() => setQuickViewAgent(null)}
        onOpenFullView={(agentId) => {
          setQuickViewAgent(null);
          onOpenAgent(agentId);
        }}
      />
      <AgentHistoryModal
        agent={historyAgent}
        onClose={() => setHistoryAgent(null)}
      />
    </>
  );
}
