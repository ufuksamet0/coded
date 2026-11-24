import React from 'react';

interface ModePickerModalProps {
  config: any;
  current: string | undefined;
  onSelect: (mode: { id: string; name: string; description: string }) => void;
  onClose: () => void;
}

export function ModePickerModal({ config, current, onSelect, onClose }: ModePickerModalProps) {
  const builtinModes = [
    {
      id: 'build',
      name: 'Build',
      description: 'Full agent: reads, writes and runs commands',
    },
    {
      id: 'plan',
      name: 'Plan',
      description: 'Read-only analysis; asks before commands',
    },
  ];

  const customModes = config?.modes ? Object.entries(config.modes).map(([id, mode]: [string, any]) => ({
    id,
    name: mode.name,
    description: mode.description,
  })) : [];

  const allModes = [...builtinModes, ...customModes];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal mode-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Select Mode</h3>
          <button className="close-button" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div className="modal-body">
          <div className="mode-list">
            {allModes.map((mode) => (
              <button
                key={mode.id}
                className={`mode-item ${mode.id === current ? 'selected' : ''}`}
                onClick={() => onSelect(mode)}
              >
                <div className="mode-info">
                  <span className="mode-name">{mode.name}</span>
                  <span className="mode-description">{mode.description}</span>
                </div>
                {mode.id === current && <span className="current-badge">Current</span>}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}