import type { ProviderQuota, UsageSnapshot } from '../../shared/types';

const PLACEHOLDER_PROVIDERS: ProviderQuota[] = [
  { id: 'snapgen', label: 'Snapgen', ok: true, message: 'Đang tải…' },
  { id: 'elevenlabs', label: 'ElevenLabs', ok: true, message: 'Đang tải…' },
];

function formatAmount(value: number | undefined, unit?: string): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toLocaleString('vi-VN');
}

function unitShort(unit?: string): string {
  if (unit === 'character') return 'ký tự';
  if (unit === 'credit') return 'credit';
  return '';
}

function progressPercent(q: ProviderQuota): number | null {
  if (q.limit != null && q.limit > 0 && q.used != null) {
    return Math.min(100, Math.max(0, (q.used / q.limit) * 100));
  }
  if (q.limit != null && q.limit > 0 && q.remaining != null) {
    return Math.min(100, Math.max(0, ((q.limit - q.remaining) / q.limit) * 100));
  }
  return null;
}

function remainingLine(q: ProviderQuota): string {
  if (!q.ok) return 'Lỗi';
  if (q.remaining != null) {
    const unit = unitShort(q.unit);
    return unit ? `${formatAmount(q.remaining, q.unit)} ${unit}` : formatAmount(q.remaining, q.unit);
  }
  if (q.used != null && q.limit != null) {
    return `${formatAmount(q.limit - q.used, q.unit)} còn`;
  }
  return q.message.length > 42 ? `${q.message.slice(0, 40)}…` : q.message;
}

function summaryLine(q: ProviderQuota): string {
  if (!q.ok) return q.message;
  if (q.remaining != null || q.limit != null || q.used != null) {
    const unit = unitShort(q.unit);
    if (q.remaining != null && q.limit != null) {
      return `Còn ${formatAmount(q.remaining, q.unit)} / ${formatAmount(q.limit, q.unit)} ${unit}`.trim();
    }
    if (q.remaining != null) {
      return `Còn ${formatAmount(q.remaining, q.unit)} ${unit}`.trim();
    }
    if (q.used != null && q.limit != null) {
      return `Đã dùng ${formatAmount(q.used, q.unit)} / ${formatAmount(q.limit, q.unit)} ${unit}`.trim();
    }
  }
  return q.message;
}

export default function UsageQuotaPanel({
  snapshot,
  busy,
  error,
  onRefresh,
  compact = false,
}: {
  snapshot: UsageSnapshot | null;
  busy?: boolean;
  error?: string | null;
  onRefresh: () => void;
  compact?: boolean;
}) {
  // Luôn lọc bỏ openai nếu IPC cũ còn trả về.
  const raw = snapshot?.providers?.length ? snapshot.providers : PLACEHOLDER_PROVIDERS;
  const providers = raw.filter((q) => q.id === 'snapgen' || q.id === 'elevenlabs');
  const loaded = !!snapshot?.providers?.length;

  if (compact) {
    return (
      <div className={`quota-strip ${error ? 'has-error' : ''}`} title={error || undefined}>
        {providers.map((q) => (
          <span
            key={q.id}
            className={`quota-chip ${!loaded || busy ? 'loading' : q.ok ? 'ok' : 'bad'}`}
            title={
              loaded
                ? `${q.label}: ${summaryLine(q)}${q.detail ? `\n${q.detail}` : ''}`
                : 'Đang tải quota…'
            }
          >
            <strong>{q.label}</strong>
            <em>{busy && !loaded ? '…' : remainingLine(q)}</em>
          </span>
        ))}
        <button
          type="button"
          className="btn ghost quota-refresh"
          disabled={busy}
          onClick={onRefresh}
          title={error || 'Làm mới số dư'}
        >
          {busy ? '…' : '↻'}
        </button>
      </div>
    );
  }

  return (
    <section className="settings-block" id="usage-quota">
      <div className="quota-header">
        <div>
          <h2>Số dư / Quota</h2>
          <p className="settings-note">Theo dõi Snapgen credit và ElevenLabs ký tự còn lại.</p>
        </div>
        <button type="button" className="btn" disabled={busy} onClick={onRefresh}>
          {busy ? 'Đang lấy…' : 'Làm mới quota'}
        </button>
      </div>
      {error ? <p className="msg error">{error}</p> : null}
      {snapshot?.updatedAt ? (
        <p className="hint">Cập nhật: {new Date(snapshot.updatedAt).toLocaleString('vi-VN')}</p>
      ) : null}
      <div className="quota-grid">
        {providers.map((q) => {
          const pct = progressPercent(q);
          const big = q.remaining != null ? formatAmount(q.remaining, q.unit) : !q.ok ? '!' : '—';
          return (
            <div key={q.id} className={`quota-card ${q.ok ? 'ok' : 'bad'}`}>
              <div className="quota-card-top">
                <strong>{q.label}</strong>
                {q.plan ? <span className="quota-plan">{q.plan}</span> : null}
              </div>
              <p className="quota-big">
                {big}
                {q.remaining != null && unitShort(q.unit) ? (
                  <span className="quota-unit"> {unitShort(q.unit)}</span>
                ) : null}
              </p>
              <p className="quota-main">{summaryLine(q)}</p>
              {pct != null ? (
                <div className="quota-bar" title={`${pct.toFixed(0)}% đã dùng`}>
                  <span style={{ width: `${pct}%` }} />
                </div>
              ) : null}
              {q.resetAt ? (
                <p className="hint">Reset: {new Date(q.resetAt).toLocaleString('vi-VN')}</p>
              ) : null}
              {q.detail ? <p className="hint">{q.detail}</p> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
