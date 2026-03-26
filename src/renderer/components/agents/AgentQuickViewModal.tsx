import React from 'react';
import type { AgentDefinition } from '../../../shared/types';

interface AgentQuickViewModalProps {
  agent: AgentDefinition | null;
  onClose: () => void;
  onOpenFullView: (agentId: string) => void;
}

export default function AgentQuickViewModal({ agent, onClose, onOpenFullView }: AgentQuickViewModalProps) {
  if (!agent) return null;

  const handleRun = async () => {
    await window.clawdia.agent.run(agent.id).catch(() => {});
    onClose();
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 px-4" onClick={onClose}>
      <div
        className="w-full max-w-[560px] rounded-2xl border border-border bg-surface-0 p-5 shadow-[0_20px_80px_rgba(0,0,0,0.45)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[16px] font-semibold text-text-primary">{agent.name}</div>
            <div className="mt-1 text-[12px] text-text-muted">{agent.description}</div>
          </div>
          <button onClick={onClose} className="text-[12px] text-text-muted hover:text-text-primary">Close</button>
        </div>
        <div className="mt-5 grid gap-3 text-[12px] text-text-secondary sm:grid-cols-2">
          <div><span className="text-text-muted">Type:</span> {agent.agentType.replace(/_/g, ' ')}</div>
          <div><span className="text-text-muted">Status:</span> {agent.status}</div>
          <div><span className="text-text-muted">Output:</span> {agent.outputMode.replace(/_/g, ' ')}</div>
          <div><span className="text-text-muted">Launch:</span> {agent.launchModes.map((m) => m.replace(/_/g, ' ')).join(', ')}</div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={handleRun}
            className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-white hover:opacity-90"
          >
            Run
          </button>
          <button
            onClick={() => onOpenFullView(agent.id)}
            className="rounded-lg border border-border px-3 py-1.5 text-[11px] text-text-secondary hover:bg-border-subtle hover:text-text-primary"
          >
            Open Full View
          </button>
        </div>
      </div>
    </div>
  );
}
