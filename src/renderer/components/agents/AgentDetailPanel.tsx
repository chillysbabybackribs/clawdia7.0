import React, { useEffect, useState } from 'react';
import type { AgentDefinition, AgentRunHistoryItem } from '../../../shared/types';
import AgentBuilderShell from './AgentBuilderShell';

interface AgentDetailPanelProps {
  agentId: string | null;
  onBack: () => void;
  onDeleted: () => void;
}

function formatLaunchModes(modes: AgentDefinition['launchModes']): string {
  return modes.map((mode) => mode.replace(/_/g, ' ')).join(' · ');
}

function formatTimestamp(value?: string | number) {
  if (!value) return 'Unknown';
  return new Date(value).toLocaleString();
}

export default function AgentDetailPanel({ agentId, onBack, onDeleted }: AgentDetailPanelProps) {
  const [agent, setAgent] = useState<AgentDefinition | null>(null);
  const [history, setHistory] = useState<AgentRunHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [activeSessionDomains, setActiveSessionDomains] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!agentId) {
        setAgent(null);
        setHistory([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const [record, runs] = await Promise.all([
          window.clawdia.agent.get(agentId),
          window.clawdia.agent.history(agentId),
        ]);
        if (cancelled) return;
        setAgent(record);
        setHistory(runs || []);
        setEditing(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [agentId]);

  useEffect(() => {
    window.clawdia.browser.listSessions().then((domains) => {
      setActiveSessionDomains(Array.isArray(domains) ? domains : []);
    }).catch(() => setActiveSessionDomains([]));
  }, []);

  const refresh = async () => {
    if (!agentId) return;
    const [record, runs] = await Promise.all([
      window.clawdia.agent.get(agentId),
      window.clawdia.agent.history(agentId),
    ]);
    setAgent(record);
    setHistory(runs || []);
  };

  const handleRun = async (mode: 'manual' | 'browser_context') => {
    if (!agent) return;
    setRunning(true);
    setMessage(null);
    const result = mode === 'browser_context'
      ? await window.clawdia.agent.runOnCurrentPage(agent.id)
      : await window.clawdia.agent.run(agent.id);
    setRunning(false);
    setMessage(
      result.ok
        ? `Started ${mode === 'browser_context' ? 'browser-context' : 'manual'} run.`
        : result.error || 'Failed to start run.',
    );
    await refresh();
  };

  const handleDelete = async () => {
    if (!agentId) return;
    const confirmed = window.confirm('Delete this agent?');
    if (!confirmed) return;
    await window.clawdia.agent.delete(agentId).catch(() => {});
    onDeleted();
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center text-[12px] text-text-muted">Loading agent...</div>;
  }

  if (!agent) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <div className="text-[15px] font-semibold text-text-primary">Agent not found</div>
        <button
          onClick={onBack}
          className="rounded border border-border px-3 py-1.5 text-[11px] text-text-secondary hover:bg-border-subtle"
        >
          Back
        </button>
      </div>
    );
  }

  if (agent.status === 'draft' || editing) {
    return (
      <AgentBuilderShell
        agent={agent}
        onBack={() => {
          if (editing && agent.status !== 'draft') {
            setEditing(false);
            setMessage(null);
            void refresh();
            return;
          }
          onBack();
        }}
        onDeleted={onDeleted}
        onUpdated={(updated) => {
          setAgent(updated);
          if (updated.status === 'ready') setEditing(false);
        }}
      />
    );
  }

  const scopeSummary = [
    ...(agent.resourceScope.browserDomains || []).slice(0, 3),
    ...(agent.resourceScope.folders || []).slice(0, 2),
    ...(agent.resourceScope.urls || []).slice(0, 2),
    ...(agent.blueprint?.scope || []).slice(0, 2),
  ].filter(Boolean);
  const normalizedSessions = new Set(activeSessionDomains.map((domain) => domain.replace(/^www\./, '').toLowerCase()));
  const missingSessionDomains = (agent.resourceScope.browserDomains || [])
    .map((domain) => domain.replace(/^www\./, '').toLowerCase())
    .filter((domain) => !normalizedSessions.has(domain));

  return (
    <div className="flex h-full flex-col bg-surface-0">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="no-drag rounded border border-border px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-border-subtle hover:text-text-primary"
          >
            Back
          </button>
          <div>
            <div className="text-[16px] font-semibold text-text-primary">{agent.name}</div>
            <div className="text-[11px] text-text-muted">{agent.description}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleRun('manual')}
            disabled={running}
            className="no-drag rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? 'Starting...' : 'Run Agent'}
          </button>
          {agent.launchModes.includes('browser_context') && (
            <button
              onClick={() => void handleRun('browser_context')}
              disabled={running}
              className="no-drag rounded-lg border border-border px-3 py-1.5 text-[11px] text-text-secondary transition-colors hover:bg-border-subtle hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Run on Current Page
            </button>
          )}
          <button
            onClick={() => setEditing(true)}
            className="no-drag rounded-lg border border-border px-3 py-1.5 text-[11px] text-text-secondary transition-colors hover:bg-border-subtle hover:text-text-primary"
          >
            Edit Agent
          </button>
          <button
            onClick={handleDelete}
            className="no-drag rounded-lg border border-border px-3 py-1.5 text-[11px] text-[#FF5061] transition-colors hover:bg-[#FF5061]/10"
          >
            Delete Agent
          </button>
        </div>
      </div>

      {message && (
        <div className="border-b border-border px-5 py-2 text-[11px] text-text-secondary">
          {message}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 py-5">
        <section className="max-w-[760px]">
          <div className="text-[14px] leading-relaxed text-text-primary">{agent.blueprint?.objective || agent.goal}</div>
          <div className="mt-3 text-[12px] text-text-secondary">
            Saved agent. Run it now, reopen the builder to tune it, or inspect recent history below.
          </div>
        </section>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-2xl border border-border bg-surface-0 p-5">
            <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">Configuration</div>
            <div className="mt-4 space-y-3 text-[12px] text-text-secondary">
              <div><span className="text-text-muted">Output:</span> {agent.outputMode.replace(/_/g, ' ')}</div>
              <div><span className="text-text-muted">Launch modes:</span> {formatLaunchModes(agent.launchModes)}</div>
              <div><span className="text-text-muted">Approvals:</span> {agent.approvalPolicy.replace(/_/g, ' ')}</div>
              <div><span className="text-text-muted">Operating mode:</span> {agent.operationMode.replace(/_/g, ' ')}</div>
              {scopeSummary.length > 0 && (
                <div><span className="text-text-muted">Scope:</span> {scopeSummary.join(', ')}</div>
              )}
              {agent.outputTarget && (
                <div><span className="text-text-muted">Output target:</span> {agent.outputTarget}</div>
              )}
              <div><span className="text-text-muted">Last test:</span> {agent.lastTestStatus}</div>
              {agent.lastTestSummary && (
                <div><span className="text-text-muted">Test summary:</span> {agent.lastTestSummary}</div>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-surface-0 p-5">
            <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">Status</div>
            <div className="mt-4 space-y-3 text-[12px] text-text-secondary">
              <div><span className="text-text-muted">Status:</span> {agent.status}</div>
              <div><span className="text-text-muted">Last run:</span> {agent.lastRunAt ? formatTimestamp(agent.lastRunAt) : 'Not run yet'}</div>
              <div><span className="text-text-muted">Last run status:</span> {agent.lastRunStatus || 'idle'}</div>
              <div><span className="text-text-muted">Updated:</span> {formatTimestamp(agent.updatedAt)}</div>
            </div>
          </section>
        </div>

        {missingSessionDomains.length > 0 && (
          <section className="mt-6 rounded-2xl border border-[rgba(255,184,77,0.28)] bg-[rgba(255,184,77,0.08)] p-5">
            <div className="text-[10px] uppercase tracking-[0.18em] text-[rgba(255,184,77,0.95)]">Session Check</div>
            <div className="mt-3 text-[12px] leading-relaxed text-text-secondary">
              No active browser sessions detected for: {missingSessionDomains.join(', ')}. Log into those sites in the browser panel before running this agent for better results.
            </div>
          </section>
        )}

        {agent.blueprint && (
          <section className="mt-6 rounded-2xl border border-border bg-surface-0 p-5">
            <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">Blueprint</div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="text-[12px] text-text-secondary">
                <div className="text-text-muted">How it works</div>
                <div className="mt-2 space-y-2">
                  {agent.blueprint.steps.map((step, index) => (
                    <div key={`${step}-${index}`}>{index + 1}. {step}</div>
                  ))}
                </div>
              </div>
              <div className="text-[12px] text-text-secondary">
                <div className="text-text-muted">Success criteria</div>
                <div className="mt-2 space-y-2">
                  {agent.blueprint.successCriteria.map((item, index) => (
                    <div key={`${item}-${index}`}>• {item}</div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        <section className="mt-6 rounded-2xl border border-border bg-surface-0 p-5">
          <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">Recent Activity</div>
          <div className="mt-4 space-y-3">
            {history.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-4 py-5 text-[12px] text-text-secondary">
                No runs yet. Run the agent to start building history.
              </div>
            ) : (
              history.map((run) => (
                <div key={run.runId} className="rounded-xl border border-border px-4 py-3">
                  <div className="flex items-center justify-between gap-3 text-[11px]">
                    <span className="font-semibold text-text-primary">{run.status}</span>
                    <span className="text-text-muted">{formatTimestamp(run.startedAt)}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-text-secondary">{run.title}</div>
                  <div className="mt-1 text-[10px] text-text-muted">
                    {run.launchMode.replace(/_/g, ' ')} · {run.toolCallCount} tools
                    {run.error ? ` · ${run.error}` : ''}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
