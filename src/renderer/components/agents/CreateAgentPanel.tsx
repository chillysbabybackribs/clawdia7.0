import React, { useEffect, useRef, useState } from 'react';
import type { AgentDefinition } from '../../../shared/types';

interface CreateAgentPanelProps {
  onBack: () => void;
  onCreated: (agent: AgentDefinition) => void;
}

const CARD_WIDTH = 'w-[720px]';
const CARD_HEIGHT = 'h-[560px]';

export default function CreateAgentPanel({ onBack, onCreated }: CreateAgentPanelProps) {
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    window.clawdia.agent.create({
      goal: '',
      name: 'New Agent',
    })
      .then((agent) => {
        onCreated(agent);
      })
      .catch((err: any) => {
        setError(err?.message || 'Failed to open the builder.');
      });
  }, [onCreated]);

  return (
    <div className="flex h-full flex-col bg-surface-0">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <button
          onClick={onBack}
          className="no-drag rounded border border-border px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-border-subtle hover:text-text-primary"
        >
          Back
        </button>
        <div>
          <div className="text-[14px] font-semibold text-text-primary">Create Agent</div>
          <div className="text-[11px] text-text-muted">Opening the fixed builder…</div>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center px-6 py-6">
        <div className={`${CARD_WIDTH} ${CARD_HEIGHT} rounded-2xl border border-border bg-surface-0 shadow-[0_24px_80px_rgba(0,0,0,0.28)]`}>
          <div className="border-b border-border px-6 py-5">
            <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">Step 1 of 6</div>
            <div className="mt-2 text-[20px] font-semibold text-text-primary">Describe your agent</div>
            <div className="mt-1 text-[12px] text-text-secondary">Preparing a fresh draft so the wizard can open in one consistent flow.</div>
          </div>

          <div className="flex h-[396px] items-center justify-center px-6 py-5">
            <div className="max-w-[420px] text-center">
              <div className="text-[14px] font-semibold text-text-primary">
                {error ? 'Could not open the builder' : 'Creating a blank draft agent…'}
              </div>
              <div className="mt-2 text-[12px] leading-relaxed text-text-secondary">
                {error
                  ? error
                  : 'You should only see this for a moment before the fixed-size agent wizard opens.'}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-border px-6 py-4">
            <button
              onClick={onBack}
              className="no-drag rounded-lg border border-border px-3 py-1.5 text-[11px] text-text-secondary transition-colors hover:bg-border-subtle hover:text-text-primary"
            >
              Cancel
            </button>
            <div className="text-[11px] text-text-muted">Bootstrapping builder…</div>
          </div>
        </div>
      </div>
    </div>
  );
}
