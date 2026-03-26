import React, { useEffect, useState } from 'react';
import type { AgentDefinition, AgentRunHistoryItem } from '../../../shared/types';

interface AgentHistoryModalProps {
  agent: AgentDefinition | null;
  onClose: () => void;
}

export default function AgentHistoryModal({ agent, onClose }: AgentHistoryModalProps) {
  const [history, setHistory] = useState<AgentRunHistoryItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!agent) {
      setHistory([]);
      return;
    }
    window.clawdia.agent.history(agent.id).then((runs) => {
      if (!cancelled) setHistory(runs || []);
    }).catch(() => {
      if (!cancelled) setHistory([]);
    });
    return () => { cancelled = true; };
  }, [agent]);

  if (!agent) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 px-4" onClick={onClose}>
      <div
        className="w-full max-w-[620px] rounded-2xl border border-border bg-surface-0 p-5 shadow-[0_20px_80px_rgba(0,0,0,0.45)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[16px] font-semibold text-text-primary">{agent.name} History</div>
            <div className="mt-1 text-[12px] text-text-muted">Agent-linked run history will appear here as run wiring lands.</div>
          </div>
          <button onClick={onClose} className="text-[12px] text-text-muted hover:text-text-primary">Close</button>
        </div>
        {history.length === 0 ? (
          <div className="mt-5 rounded-xl border border-dashed border-border px-4 py-8 text-center text-[12px] text-text-muted">
            No agent-specific run history yet.
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {history.map((run) => (
              <div key={run.runId} className="rounded-xl border border-border px-4 py-3">
                <div className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="font-semibold text-text-primary">{run.status}</span>
                  <span className="text-text-muted">{new Date(run.startedAt).toLocaleString()}</span>
                </div>
                <div className="mt-1 text-[11px] text-text-secondary">{run.title}</div>
                <div className="mt-1 text-[10px] text-text-muted">
                  {run.launchMode.replace(/_/g, ' ')} · {run.toolCallCount} tools
                  {run.error ? ` · ${run.error}` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
