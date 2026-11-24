import React from 'react';

interface WelcomeScreenProps {
  recentWorkspaces: string[];
  onNewWorkspace: () => void;
  onOpenRecent: (workspace: string) => void;
}

export function WelcomeScreen({ recentWorkspaces, onNewWorkspace, onOpenRecent }: WelcomeScreenProps) {
  return (
    <div className="welcome-screen">
      <div className="welcome-content">
        <div className="welcome-logo">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
            <path d="M2 17l10 5 10-5"></path>
            <path d="M2 12l10 5 10-5"></path>
          </svg>
        </div>
        <h1 className="welcome-title">Coded</h1>
        <p className="welcome-subtitle">An AI coding agent for your terminal and desktop</p>

        <div className="welcome-actions">
          <button className="btn btn-primary btn-lg" onClick={onNewWorkspace}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            Open Workspace
          </button>
          <button className="btn btn-secondary btn-lg" onClick={onNewWorkspace}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
            New Project
          </button>
        </div>

        {recentWorkspaces.length > 0 && (
          <div className="recent-workspaces">
            <h3>Recent Workspaces</h3>
            <ul>
              {recentWorkspaces.slice(0, 5).map((ws) => (
                <li key={ws} onClick={() => onOpenRecent(ws)}>
                  <span className="recent-name">{ws.split('/').pop()}</span>
                  <span className="recent-path">{ws}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="welcome-shortcuts">
          <h3>Quick Start</h3>
          <ul>
            <li><kbd>Ctrl+N</kbd> New workspace</li>
            <li><kbd>Ctrl+O</kbd> Open workspace</li>
            <li><kbd>Ctrl+,</kbd> Settings</li>
            <li><kbd>/</kbd> Commands in chat</li>
          </ul>
        </div>
      </div>
    </div>
  );
}