import React, { useState, useEffect, Component } from 'react';

class DrawerErrorBoundary extends Component<{ children: React.ReactNode }, { error: boolean; msg: string }> {
  state = { error: false, msg: '' };
  static getDerivedStateFromError(e: any) { return { error: true, msg: String(e?.message || e) }; }
  componentDidCatch(e: any, info: any) { console.error('[DrawerErrorBoundary]', e, info?.componentStack); }
  render() {
    if (this.state.error) return <div className="p-3 text-[11px] text-[#FF5061]">Error: {this.state.msg}</div>;
    return this.props.children;
  }
}
import type { View } from '../App';
import Rail, { type DrawerMode } from './sidebar/Rail';
import ChatDrawer from './sidebar/drawers/ChatDrawer';
import AgentsDrawer from './sidebar/drawers/AgentsDrawer';
import BrowserDrawer from './sidebar/drawers/BrowserDrawer';
import FilesDrawer from './sidebar/drawers/FilesDrawer';
import DesktopDrawer from './sidebar/drawers/DesktopDrawer';
import WalletDrawer from './sidebar/drawers/WalletDrawer';
import TasksDrawer from './sidebar/drawers/TasksDrawer';

interface SidebarProps {
  onViewChange: (view: View) => void;
  onNewChat: () => void;
  onLoadConversation: (conversationId: string, buffer?: Array<{ type: string; data: any }> | null) => void;
  onOpenProcess: (processId: string) => void;
  onOpenAgent: (agentId: string) => void;
  onCreateAgent: () => void;
  onOpenFile: (filePath: string) => void;
  chatKey: number;
  runningTaskCount: number;
  completedTasksBadge: number;
}

export default function Sidebar({
  onViewChange, onNewChat, onLoadConversation, onOpenProcess, onOpenAgent, onCreateAgent, onOpenFile, chatKey, runningTaskCount, completedTasksBadge,
}: SidebarProps) {
  const [activeMode, setActiveMode] = useState<DrawerMode>('chat');
  const [drawerOpen, setDrawerOpen] = useState(true);

  // Ctrl+S toggles drawer
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && !e.shiftKey) {
        e.preventDefault();
        setDrawerOpen(v => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleModeChange = (mode: DrawerMode) => {
    if (activeMode === mode) {
      setDrawerOpen(v => !v); // toggle if clicking active
    } else {
      setActiveMode(mode);
      setDrawerOpen(true);
    }
  };

  const handleAddContext = async (text: string, _filePath: string) => {
    const api = (window as any).clawdia;
    if (!api) return;
    await api.chat.addContext(text).catch(() => {});
  };

  return (
    <nav className="flex h-full flex-shrink-0">
      <Rail
        activeMode={drawerOpen ? activeMode : null}
        onModeChange={handleModeChange}
        onSettings={() => onViewChange('settings')}
        runningTaskCount={runningTaskCount}
        completedTasksBadge={completedTasksBadge}
      />

      {drawerOpen && (
        <div className="w-[210px] flex-shrink-0 bg-surface-1 border-r border-border flex flex-col overflow-hidden">
          {activeMode === 'chat' && (
            <ChatDrawer
              onNewChat={onNewChat}
              onLoadConversation={onLoadConversation}
              onOpenProcess={onOpenProcess}
              chatKey={chatKey}
            />
          )}
          {activeMode === 'agents' && (
            <AgentsDrawer
              onCreateAgent={onCreateAgent}
              onOpenAgent={onOpenAgent}
            />
          )}
          {activeMode === 'browser' && <BrowserDrawer />}
          {activeMode === 'files' && <FilesDrawer onAddContext={handleAddContext} onOpenFile={onOpenFile} />}
          {activeMode === 'desktop' && <DesktopDrawer />}
          {activeMode === 'wallet' && <WalletDrawer />}
          {activeMode === 'tasks' && <DrawerErrorBoundary><TasksDrawer onLoadConversation={onLoadConversation} /></DrawerErrorBoundary>}
        </div>
      )}
    </nav>
  );
}
