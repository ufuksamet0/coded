import React from 'react';

interface PermissionModalProps {
  request: {
    tool: string;
    category: string;
    summary: string;
    diff?: string;
    reason?: string;
    warning?: string;
  };
  onAnswer: (answer: 'allow' | 'always' | 'deny') => void;
}

export function PermissionModal({ request, onAnswer }: PermissionModalProps) {
  return (
    <div className="modal-overlay" onClick={() => onAnswer('deny')}>
      <div className="modal permission-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Permission Required</h3>
          <span className="category-badge">{request.category}</span>
        </div>
        <div className="modal-body">
          <div className="tool-info">
            <span className="tool-name">{request.tool}</span>
            <span className="tool-summary">{request.summary}</span>
          </div>
          {request.reason && (
            <div className="reason">
              <strong>Reason:</strong> {request.reason}
            </div>
          )}
          {request.warning && (
            <div className="warning">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
              {request.warning}
            </div>
          )}
          {request.diff && (
            <div className="diff-preview">
              <pre>{request.diff}</pre>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-danger" onClick={() => onAnswer('deny')}>Deny</button>
          <button className="btn btn-primary" onClick={() => onAnswer('allow')}>Allow Once</button>
          <button className="btn btn-accent" onClick={() => onAnswer('always')}>Always Allow</button>
        </div>
      </div>
    </div>
  );
}