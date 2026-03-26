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
    <div className="flex items-center px-2 h-[46px] flex-shrink-0 bg-surface-1 border-b border-white/[0.06]">
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTabId;
        const isOnly = tabs.length === 1;

        return (
          <div
            key={tab.id}
            onClick={() => { if (!isActive) onSwitch(tab.id); }}
            className={[
              'relative flex items-center gap-[7px] px-[18px] h-full cursor-pointer select-none text-[15px] font-medium transition-colors',
              isActive
                ? 'text-text-primary border-b-[2.5px] border-[#4a9eff]'
                : 'text-white/30 hover:text-white/60 border-b-[2.5px] border-transparent group',
            ].join(' ')}
          >
            {isActive && (
              <span className="w-2 h-2 rounded-full bg-[#4a9eff] flex-shrink-0" />
            )}
            <span>Chat {index + 1}</span>
            {!isOnly && (
              <span
                onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                className={[
                  'text-[15px] leading-none transition-colors cursor-pointer',
                  isActive
                    ? 'text-white/25 hover:text-text-primary'
                    : 'text-transparent group-hover:text-white/25 hover:!text-text-primary',
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
        className="flex items-center justify-center h-full px-[10px] text-[20px] text-text-muted hover:text-text-primary leading-none cursor-pointer transition-colors"
        title="New conversation"
      >
        +
      </button>
    </div>
  );
}
