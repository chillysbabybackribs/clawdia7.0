import React, { useEffect, useState } from 'react';

export interface TaskToastItem {
  id: string;
  taskName: string;
  result: string;
  conversationId: string;
  ts: number;
}

interface TaskToastProps {
  toasts: TaskToastItem[];
  onDismiss: (id: string) => void;
  onOpen: (conversationId: string) => void;
}

const AUTO_DISMISS_MS = 12_000;

function SingleToast({
  toast,
  onDismiss,
  onOpen,
}: {
  toast: TaskToastItem;
  onDismiss: (id: string) => void;
  onOpen: (conversationId: string) => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger enter animation
    const t = setTimeout(() => setVisible(true), 10);
    // Auto-dismiss
    const d = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => { clearTimeout(t); clearTimeout(d); };
  }, [toast.id, onDismiss]);

  const preview = toast.result.replace(/[#*`]/g, '').trim().slice(0, 160);

  return (
    <div
      className="relative w-[320px] bg-surface-3 border border-border rounded-lg overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.6)]"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(8px)',
        transition: 'opacity 0.2s ease, transform 0.2s ease',
      }}
    >
      {/* progress bar */}
      <div
        className="absolute bottom-0 left-0 h-[2px] bg-white/10"
        style={{
          width: '100%',
          animation: `toast-shrink ${AUTO_DISMISS_MS}ms linear forwards`,
        }}
      />

      <div className="p-3 pb-4">
        {/* header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-white/40 flex-shrink-0" />
            <span className="text-[10px] uppercase tracking-widest text-muted font-mono">
              Automation complete
            </span>
          </div>
          <button
            onClick={() => onDismiss(toast.id)}
            className="text-muted hover:text-text-secondary transition-colors p-0.5"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* task name */}
        <div className="text-text-primary text-[12px] font-medium mb-1 truncate">
          {toast.taskName}
        </div>

        {/* result preview */}
        <div className="text-text-secondary text-[11px] leading-relaxed line-clamp-3 mb-3">
          {preview || 'Task completed.'}
        </div>

        {/* action */}
        <button
          onClick={() => { onOpen(toast.conversationId); onDismiss(toast.id); }}
          className="text-[11px] text-text-primary bg-white/[0.06] hover:bg-white/[0.10] px-2.5 py-1 rounded transition-colors font-medium"
        >
          Open in chat →
        </button>
      </div>
    </div>
  );
}

export default function TaskToast({ toasts, onDismiss, onOpen }: TaskToastProps) {
  if (toasts.length === 0) return null;

  return (
    <>
      <style>{`
        @keyframes toast-shrink {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
      <div
        className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 items-end"
        style={{ pointerEvents: 'auto' }}
      >
        {toasts.map(t => (
          <SingleToast key={t.id} toast={t} onDismiss={onDismiss} onOpen={onOpen} />
        ))}
      </div>
    </>
  );
}
