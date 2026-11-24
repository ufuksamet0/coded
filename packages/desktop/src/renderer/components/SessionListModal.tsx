import React, { useState, useEffect } from 'react';

interface SessionListModalProps {
  workspace: string;
  onClose: () => void;
}

export function SessionListModal({ workspace, onClose }: SessionListModalProps) {
  const [sessions, setSessions] = useState<Array<{ id: string; title: string; updatedAt: string; model: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSessions();
  }, [workspace]);

  const loadSessions = async () => {
    try {
      // In a real app, this would call the main process to load sessions
      setSessions([]);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal session-list-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Sessions</h3>
          <button className="close-button" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div className="modal-body">
          {loading ? (
            <div className="loading">Loading sessions...</div>
          ) : sessions.length === 0 ? (
            <div className="empty-state">No sessions yet</div>
          ) : (
            <ul className="session-list">
              {sessions.map((session) => (
                <li key={session.id} className="session-item">
                  <div className="session-info">
                    <span className="session-title">{session.title}</span>
                    <span className="session-meta">
                      {new Date(session.updatedAt).toLocaleString()} · {session.model}
                    </span>
                  </div>
                  <button className="btn btn-sm btn-primary">Resume</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}