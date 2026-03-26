// src/renderer/components/TabStrip.tsx
import React from 'react';
import type { ConversationTab } from '../tabLogic';

interface TabStripProps {
  tabs: ConversationTab[];
  activeTabId: string;
  onSwitch: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNew: () => void;
}

export default function TabStrip({ tabs, activeTabId, onSwitch, onClose, onNew }: TabStripProps) {
  return (
    <div className="flex items-end px-2 h-6 flex-shrink-0 bg-surface-1 relative">
      {/* bottom border of the strip — active tab will sit above this */}
      <div className="absolute inset-x-0 bottom-0 h-px bg-border-subtle" />

      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTabId;
        const isOnly = tabs.length === 1;

        return (
          <div
            key={tab.id}
            onClick={() => { if (!isActive) onSwitch(tab.id); }}
            className={[
              'relative flex items-center gap-1 px-2.5 h-[22px] rounded-t cursor-pointer select-none text-[11px] transition-colors',
              isActive
                ? 'bg-surface-1 border border-b-0 border-white/[0.10] text-text-primary z-10'
                : 'text-text-muted hover:text-text-secondary group',
            ].join(' ')}
          >
            <span>{index + 1}</span>
            {!isOnly && (
              <span
                onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                className={[
                  'leading-none transition-colors cursor-pointer',
                  isActive
                    ? 'text-text-muted hover:text-text-primary'
                    : 'text-transparent group-hover:text-text-muted hover:!text-text-primary',
                ].join(' ')}
                title="Close tab"
              >
                ×
              </span>
            )}
          </div>
        );
      })}

      <button
        onClick={onNew}
        className="relative z-10 flex items-center justify-center w-5 h-[22px] text-text-muted hover:text-text-primary text-[14px] leading-none cursor-pointer transition-colors"
        title="New conversation"
      >
        +
      </button>
    </div>
  );
}
