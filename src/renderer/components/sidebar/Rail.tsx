import React from 'react';

export type DrawerMode = 'chat' | 'agents' | 'browser' | 'files' | 'desktop' | 'wallet' | 'tasks';

interface RailProps {
  activeMode: DrawerMode | null; // null = drawer closed
  onModeChange: (mode: DrawerMode) => void;
  onSettings: () => void;
  runningTaskCount: number;
  completedTasksBadge: number;
}

function RailIcon({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`no-drag relative flex items-center justify-center w-[34px] h-[34px] rounded-lg transition-all cursor-pointer flex-shrink-0
        ${active
          ? 'bg-surface-1 text-text-primary'
          : 'text-text-muted hover:text-text-tertiary hover:bg-surface-1'
        }`}
    >
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-[16px] bg-accent rounded-r-[2px]" />
      )}
      {children}
    </button>
  );
}

// SVG icons
const icons = {
  chat: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
  agents: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  browser: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  files: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3h6l2 3h10a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    </svg>
  ),
  desktop: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  ),
  wallet: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  ),
  tasks: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <polyline points="9 16 11 18 15 14" />
    </svg>
  ),
  settings: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
};

const MODES: { mode: DrawerMode; title: string }[] = [
  { mode: 'chat', title: 'Conversations' },
  { mode: 'agents', title: 'Agents' },
  { mode: 'browser', title: 'Browser Sessions' },
  { mode: 'files', title: 'Files' },
  { mode: 'desktop', title: 'Desktop' },
  { mode: 'wallet', title: 'Wallet' },
  { mode: 'tasks', title: 'Automations' },
];

export default function Rail({ activeMode, onModeChange, onSettings, runningTaskCount, completedTasksBadge }: RailProps) {
  return (
    <div className="flex flex-col items-center w-[48px] flex-shrink-0 py-2.5 gap-1 bg-surface-0 border-r border-border">
      <div className="w-[18px] h-px bg-surface-1 flex-shrink-0" />

      {/* Mode icons */}
      {MODES.map(({ mode, title }) => (
        <RailIcon
          key={mode}
          active={activeMode === mode}
          onClick={() => onModeChange(mode)}
          title={title}
        >
          {icons[mode]}
          {mode === 'tasks' && runningTaskCount > 0 && (
            <span
              className="absolute top-0.5 right-0.5 flex h-[14px] w-[14px] items-center justify-center"
              title={runningTaskCount === 1 ? '1 automation running' : `${runningTaskCount} automations running`}
            >
              <span className="absolute h-[12px] w-[12px] rounded-full border border-[#64B5FF]/60 animate-ping" />
              <span className="relative h-[8px] w-[8px] rounded-full bg-[#64B5FF] shadow-[0_0_10px_rgba(100,181,255,0.75)]" />
            </span>
          )}
          {mode === 'tasks' && runningTaskCount === 0 && completedTasksBadge > 0 && (
            <span className="absolute top-0.5 right-0.5 min-w-[14px] h-[14px] rounded-full bg-accent text-white text-[9px] font-bold flex items-center justify-center px-[3px] leading-none">
              {completedTasksBadge > 9 ? '9+' : completedTasksBadge}
            </span>
          )}
        </RailIcon>
      ))}

      <div className="flex-1" />

      {/* Settings */}
      <RailIcon active={false} onClick={onSettings} title="Settings">
        {icons.settings}
      </RailIcon>
    </div>
  );
}
