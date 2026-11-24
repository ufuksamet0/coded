import React from 'react';

interface ModelPickerModalProps {
  config: any;
  current: string;
  onSelect: (model: string) => void;
  onClose: () => void;
}

export function ModelPickerModal({ config, current, onSelect, onClose }: ModelPickerModalProps) {
  const [providers] = React.useState(() => {
    const providers: Record<string, Array<{ id: string; label: string; recommended?: boolean }>> = {};
    const catalog = [
      { id: 'claude-opus-4-1', provider: 'anthropic', label: 'Claude Opus 4.1', recommended: true },
      { id: 'claude-sonnet-4-5', provider: 'anthropic', label: 'Claude Sonnet 4.5', recommended: true },
      { id: 'claude-haiku-4-5', provider: 'anthropic', label: 'Claude Haiku 4.5' },
      { id: 'gpt-5', provider: 'openai', label: 'GPT-5', recommended: true },
      { id: 'gpt-5-mini', provider: 'openai', label: 'GPT-5 mini' },
      { id: 'gpt-4.1', provider: 'openai', label: 'GPT-4.1', recommended: true },
      { id: 'gpt-4.1-mini', provider: 'openai', label: 'GPT-4.1 mini' },
      { id: 'gemini-2.5-pro', provider: 'google', label: 'Gemini 2.5 Pro', recommended: true },
      { id: 'gemini-2.5-flash', provider: 'google', label: 'Gemini 2.5 Flash' },
      { id: 'qwen2.5-coder:32b', provider: 'local', label: 'Qwen2.5 Coder 32B', local: true },
      { id: 'qwen2.5-coder:7b', provider: 'local', label: 'Qwen2.5 Coder 7B', local: true },
    ];

    for (const model of catalog) {
      if (!config?.providers?.[model.provider]) continue;
      if (!providers[model.provider]) providers[model.provider] = [];
      providers[model.provider].push(model);
    }
    return providers;
  });

  const [currentProvider] = React.useState(() => current.split('/')[0]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal model-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Select Model</h3>
          <button className="close-button" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div className="modal-body">
          <div className="provider-tabs">
            {Object.keys(providers).map((provider) => (
              <button
                key={provider}
                className={`provider-tab ${provider === currentProvider ? 'active' : ''}`}
                onClick={() => {}}
              >
                {provider.charAt(0).toUpperCase() + provider.slice(1)}
              </button>
            ))}
          </div>
          <div className="model-list">
            {providers[currentProvider]?.map((model) => (
              <button
                key={model.id}
                className={`model-item ${`${currentProvider}/${model.id}` === current ? 'selected' : ''}`}
                onClick={() => onSelect(`${currentProvider}/${model.id}`)}
              >
                <div className="model-info">
                  <span className="model-label">{model.label}</span>
                  <span className="model-id">{model.id}</span>
                </div>
                {model.recommended && <span className="recommended-badge">Recommended</span>}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}