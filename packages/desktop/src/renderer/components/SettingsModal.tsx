import React, { useState, useEffect } from 'react';

interface SettingsModalProps {
  config: any;
  workspace: string;
  onClose: () => void;
  onEncrypt: (data: string) => Promise<string>;
  onDecrypt: (encryptedBase64: string) => Promise<string>;
}

export function SettingsModal({ config, workspace, onClose, onEncrypt, onDecrypt }: SettingsModalProps) {
  const [providers, setProviders] = useState<Record<string, { apiKey: string; baseURL: string }>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loaded: Record<string, { apiKey: string; baseURL: string }> = {};
    for (const [id, provider] of Object.entries(config?.providers || {})) {
      loaded[id] = {
        apiKey: (provider as any).apiKey || '',
        baseURL: (provider as any).baseURL || '',
      };
    }
    setProviders(loaded);
  }, [config]);

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const [id, provider] of Object.entries(providers)) {
        if (provider.apiKey) {
          const encrypted = await onEncrypt(provider.apiKey);
          // In a real app, save to config
          console.log(`Saving encrypted key for ${id}`);
        }
      }
      onClose();
    } catch (error) {
      console.error('Failed to save settings:', error);
    } finally {
      setSaving(false);
    }
  };

  const toggleKeyVisibility = (providerId: string) => {
    setShowKeys((prev) => ({ ...prev, [providerId]: !prev[providerId] }));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Settings</h3>
          <button className="close-button" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div className="modal-body">
          <div className="settings-tabs">
            <button className="tab active">API Keys</button>
            <button className="tab">Appearance</button>
            <button className="tab">Advanced</button>
          </div>
          <div className="settings-content">
            {Object.entries(providers).map(([id, provider]) => (
              <div key={id} className="provider-settings">
                <h4>{id.charAt(0).toUpperCase() + id.slice(1)}</h4>
                <div className="setting-row">
                  <label>API Key</label>
                  <div className="key-input-wrapper">
                    <input
                      type={showKeys[id] ? 'text' : 'password'}
                      value={provider.apiKey}
                      onChange={(e) => setProviders((prev) => ({ ...prev, [id]: { ...prev[id], apiKey: e.target.value } }))}
                      placeholder="Enter API key"
                    />
                    <button
                      type="button"
                      className="icon-button small"
                      onClick={() => toggleKeyVisibility(id)}
                    >
                      {showKeys[id] ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                          <line x1="1" y1="1" x2="23" y2="23"></line>
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                          <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                <div className="setting-row">
                  <label>Base URL</label>
                  <input
                    type="text"
                    value={provider.baseURL}
                    onChange={(e) => setProviders((prev) => ({ ...prev, [id]: { ...prev[id], baseURL: e.target.value } }))}
                    placeholder="https://api.example.com/v1"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}