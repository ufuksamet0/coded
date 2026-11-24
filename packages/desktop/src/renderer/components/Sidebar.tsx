import React from 'react';

interface SidebarProps {
  workspace: string;
  modelRef: string;
  mode: { id: string; name: string; description: string } | null;
  onModelChange: (model: string) => void;
  onModeChange: (mode: { id: string; name: string; description: string }) => void;
  onNewWorkspace: () => void;
  onOpenSettings: () => void;
  onOpenSessions: () => void;
  onOpenModels: () => void;
  onOpenModes: () => void;
}

export function Sidebar({
  workspace,
  modelRef,
  mode,
  onModelChange,
  onModeChange,
  onNewWorkspace,
  onOpenSettings,
  onOpenSessions,
  onOpenModels,
  onOpenModes,
}: SidebarProps) {
  const workspaceName = workspace.split('/').pop() || workspace;

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1 className="app-title">Coded</h1>
        <button className="icon-button" onClick={onNewWorkspace} title="New Workspace">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
            <line x1="16" y1="13" x2="8" y2="13"></line>
            <line x1="16" y1="17" x2="8" y2="17"></line>
            <polyline points="10 9 9 9 8 9"></polyline>
          </svg>
        </button>
      </div>

      <div className="workspace-info">
        <span className="workspace-name">{workspaceName}</span>
        <span className="workspace-path">{workspace}</span>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-row">
          <span className="sidebar-label">Model</span>
          <button className="sidebar-value" onClick={onOpenModels}>
            {modelRef}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
        </div>
        <div className="sidebar-row">
          <span className="sidebar-label">Mode</span>
          <button className="sidebar-value" onClick={onOpenModes}>
            {mode?.name || 'Build'}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
        </div>
      </div>

      <div className="sidebar-divider"></div>

      <nav className="sidebar-nav">
        <button className="nav-item" onClick={onOpenSessions}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
            <circle cx="9" cy="7" r="4"></circle>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
          </svg>
          <span>Sessions</span>
        </button>
        <button className="nav-item" onClick={onOpenSettings}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 1 4.6 9a1.65 1.65 0 0 1 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 1-.33 1.82V15a2 2 0 0 1 2 2 2 2 0 0 1-2 2h.09a1.65 1.65 0 0 1 1.82.33l.06.06a2 2 0 0 0 2.83 0 2 2 0 0 0 0-2.83l.06-.06a1.65 1.65 0 0 1 1.51-1H21a2 2 0 0 0 2-2 2 2 0 0 0-2-2h-.09a1.65 1.65 0 0 0-1.82-.33l-.06-.06a2 2 0 0 0-2.83 0 2 2 0 0 0 0 2.83l.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 1-1.82-.33l-.06-.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 1 1.51-1H15a2 2 0 0 0 2-2 2 2 0 0 0-2-2z"></path>
          </svg>
          <span>Settings</span>
        </button>
      </nav>
    </aside>
  );
}