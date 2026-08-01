import { useEffect, useState } from 'react';
import type { ProviderApiKeyPublic, ProviderApiKeyStatus } from '../../shared/provider-api-keys';

const STATUS_LABEL: Record<ProviderApiKeyStatus, string> = {
  ready: 'Ready',
  active: 'Active',
  busy: 'Busy',
  exhausted: 'Exhausted',
  rate_limited: 'Rate Limited',
  invalid: 'Invalid',
  disabled: 'Disabled',
};

interface Props {
  disabled?: boolean;
  onChanged?: () => void;
}

export default function ElevenLabsApiKeysPanel({ disabled, onChanged }: Props) {
  const [keys, setKeys] = useState<ProviderApiKeyPublic[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [draftKey, setDraftKey] = useState('');
  const [draftName, setDraftName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editName, setEditName] = useState('');

  const refresh = async () => {
    const list = await window.studio.listElevenLabsApiKeys();
    setKeys(list);
  };

  useEffect(() => {
    void refresh().catch((err) =>
      setMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) })
    );
  }, []);

  const run = async (fn: () => Promise<ProviderApiKeyPublic[] | void>) => {
    setBusy(true);
    setMsg(null);
    try {
      const next = await fn();
      if (next) setKeys(next);
      else await refresh();
      onChanged?.();
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const copyMasked = async (masked: string) => {
    try {
      await navigator.clipboard.writeText(masked);
      setMsg({ type: 'ok', text: 'Đã copy (dạng đã che).' });
    } catch {
      setMsg({ type: 'error', text: 'Không copy được.' });
    }
  };

  return (
    <div className="el-keys-panel">
      <div className="el-keys-head">
        <div>
          <h3>ElevenLabs API Keys</h3>
          <p className="hint">
            Thêm nhiều key — hết quota/token sẽ tự chuyển sang key tiếp theo (failover).
          </p>
        </div>
        <button type="button" className="btn" disabled={busy || disabled} onClick={() => void refresh()}>
          Làm mới
        </button>
      </div>

      <div className="el-keys-add">
        <input
          type="text"
          placeholder="Tên (tuỳ chọn)"
          value={draftName}
          disabled={busy || disabled}
          onChange={(e) => setDraftName(e.target.value)}
        />
        <input
          type="password"
          placeholder="sk_… hoặc xi_…"
          value={draftKey}
          disabled={busy || disabled}
          onChange={(e) => setDraftKey(e.target.value)}
          autoComplete="off"
        />
        <button
          type="button"
          className="btn primary"
          disabled={busy || disabled || !draftKey.trim()}
          onClick={() =>
            void run(async () => {
              const list = await window.studio.addElevenLabsApiKey({
                apiKey: draftKey.trim(),
                name: draftName.trim() || undefined,
              });
              setDraftKey('');
              setDraftName('');
              setMsg({ type: 'ok', text: 'Đã thêm API key.' });
              return list;
            })
          }
        >
          + Add API Key
        </button>
      </div>

      <ul className="el-keys-list">
        {keys.length === 0 ? (
          <li className="el-keys-empty">Chưa có API key. Thêm ít nhất một key để dùng ElevenLabs TTS.</li>
        ) : (
          keys.map((key) => (
            <li key={key.id} className={`el-key-card status-${key.status}`}>
              <div className="el-key-top">
                <div>
                  <strong>
                    {key.isPrimary ? '● Primary · ' : ''}
                    {key.name || `Priority ${key.priority}`}
                  </strong>
                  <p className="el-key-masked" title={key.maskedKey}>
                    Key: {key.maskedKey}
                  </p>
                </div>
                <div className="el-key-badges">
                  <span className={`el-key-status status-${key.status}`}>
                    {STATUS_LABEL[key.status]}
                  </span>
                  <span className="el-key-priority">Priority: {key.priority}</span>
                </div>
              </div>

              {editId === key.id ? (
                <div className="el-key-edit">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Tên"
                    disabled={busy}
                  />
                  <input
                    type="password"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    placeholder="API key mới (để trống nếu giữ nguyên)"
                    disabled={busy}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const list = await window.studio.updateElevenLabsApiKey({
                          id: key.id,
                          name: editName,
                          apiKey: editValue.trim() || undefined,
                        });
                        setEditId(null);
                        setEditValue('');
                        return list;
                      })
                    }
                  >
                    Lưu
                  </button>
                  <button type="button" className="btn" disabled={busy} onClick={() => setEditId(null)}>
                    Huỷ
                  </button>
                </div>
              ) : (
                <div className="el-key-actions">
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy || disabled}
                    onClick={() => {
                      setEditId(key.id);
                      setEditName(key.name || '');
                      setEditValue('');
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy || disabled}
                    onClick={() => void copyMasked(key.maskedKey)}
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy || disabled}
                    onClick={() =>
                      void run(() =>
                        window.studio.updateElevenLabsApiKey({
                          id: key.id,
                          enabled: !key.enabled,
                        })
                      )
                    }
                  >
                    {key.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy || disabled}
                    onClick={() =>
                      void run(async () => {
                        const result = await window.studio.testElevenLabsApiKey(key.id);
                        setMsg({
                          type: result.ok ? 'ok' : 'error',
                          text: result.message,
                        });
                        return window.studio.listElevenLabsApiKeys();
                      })
                    }
                  >
                    Test
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy || disabled || key.priority <= 1}
                    onClick={() =>
                      void run(() =>
                        window.studio.moveElevenLabsApiKey({ id: key.id, direction: 'up' })
                      )
                    }
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy || disabled || key.priority >= keys.length}
                    onClick={() =>
                      void run(() =>
                        window.studio.moveElevenLabsApiKey({ id: key.id, direction: 'down' })
                      )
                    }
                  >
                    ↓
                  </button>
                  {(key.status === 'exhausted' ||
                    key.status === 'invalid' ||
                    key.status === 'rate_limited') && (
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={busy || disabled}
                      onClick={() =>
                        void run(() => window.studio.resetElevenLabsApiKeyStatus(key.id))
                      }
                    >
                      Reset Status
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn ghost danger"
                    disabled={busy || disabled}
                    onClick={() =>
                      void run(async () => {
                        if (!window.confirm('Xóa API key này?')) return keys;
                        return window.studio.deleteElevenLabsApiKey(key.id);
                      })
                    }
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))
        )}
      </ul>

      {msg && <div className={`msg ${msg.type === 'ok' ? 'ok' : 'error'}`}>{msg.text}</div>}
    </div>
  );
}
