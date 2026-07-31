import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ProviderQuotaId,
  ProviderUsageHistory,
  UsageHistoryItem,
  UsageHistorySnapshot,
} from '../../shared/types';

type HistoryFilter = 'snapgen' | 'elevenlabs' | 'all';

function formatAmount(value: number, unit: 'credit' | 'character'): string {
  const n = value.toLocaleString('vi-VN');
  return unit === 'character' ? `${n} ký tự` : `${n} cr`;
}

function formatWhen(iso: string, compact = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (compact) {
    return d.toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return d.toLocaleString('vi-VN');
}

function providerLabel(id: ProviderQuotaId): string {
  return id === 'snapgen' ? 'Snap' : '11L';
}

function sortByNewest(items: UsageHistoryItem[]): UsageHistoryItem[] {
  return [...items].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

function mergeProvider(
  prev: ProviderUsageHistory | undefined,
  nextItems: UsageHistoryItem[],
  patch: Partial<ProviderUsageHistory>
): ProviderUsageHistory {
  const base: ProviderUsageHistory = prev ?? {
    provider: patch.provider || 'snapgen',
    label: patch.label || 'Snapgen',
    ok: true,
    message: '',
    totalAmount: 0,
    unit: patch.unit || 'credit',
    items: [],
  };
  const seen = new Set(base.items.map((i) => i.id));
  const appended = nextItems.filter((i) => !seen.has(i.id));
  const items = [...base.items, ...appended];
  return {
    ...base,
    ...patch,
    items,
    totalAmount: items.reduce((sum, i) => sum + (i.amount || 0), 0),
    message: `${items.length} mục đã tải`,
  };
}

export default function UsageHistoryPanel({
  snapshot,
  busy,
  error,
  onRefresh,
  onClose,
  onSnapshotChange,
  embedded = false,
  popover = false,
}: {
  snapshot: UsageHistorySnapshot | null;
  busy?: boolean;
  error?: string | null;
  onRefresh: () => void;
  onClose?: () => void;
  onSnapshotChange?: (next: UsageHistorySnapshot) => void;
  embedded?: boolean;
  popover?: boolean;
}) {
  const [filter, setFilter] = useState<HistoryFilter>('snapgen');
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);
  const snapshotRef = useRef(snapshot);
  const filterRef = useRef(filter);
  const onChangeRef = useRef(onSnapshotChange);

  snapshotRef.current = snapshot;
  filterRef.current = filter;
  onChangeRef.current = onSnapshotChange;

  useEffect(() => {
    if (!popover || !onClose) return;
    const onDoc = (event: MouseEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (event.target instanceof Node && !el.contains(event.target)) {
        const toggle = document.querySelector('.history-toggle');
        if (toggle && toggle.contains(event.target as Node)) return;
        onClose();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [popover, onClose]);

  const providers = snapshot?.providers ?? [];
  const snapgen = providers.find((p) => p.provider === 'snapgen');
  const eleven = providers.find((p) => p.provider === 'elevenlabs');

  const filtered = useMemo(() => {
    const all = providers.flatMap((p) => p.items);
    if (filter === 'snapgen') return sortByNewest(all.filter((i) => i.provider === 'snapgen'));
    if (filter === 'elevenlabs') {
      return sortByNewest(all.filter((i) => i.provider === 'elevenlabs'));
    }
    const snap = sortByNewest(all.filter((i) => i.provider === 'snapgen'));
    const el = sortByNewest(all.filter((i) => i.provider === 'elevenlabs'));
    return [...snap, ...el];
  }, [providers, filter]);

  const canLoadMore =
    filter === 'snapgen'
      ? !!snapgen?.hasMore
      : filter === 'elevenlabs'
        ? !!(eleven?.hasMore || (eleven && eleven.items.length === 0))
        : !!(
            snapgen?.hasMore ||
            eleven?.hasMore ||
            (eleven && eleven.items.length === 0)
          );

  const loadMore = useCallback(async () => {
    const current = snapshotRef.current;
    const onChange = onChangeRef.current;
    const activeFilter = filterRef.current;
    if (!current || !onChange || loadingRef.current) return;

    const pickTarget = (): ProviderQuotaId | null => {
      const snap = current.providers.find((p) => p.provider === 'snapgen');
      const el = current.providers.find((p) => p.provider === 'elevenlabs');
      if (activeFilter === 'snapgen') return snap?.hasMore ? 'snapgen' : null;
      if (activeFilter === 'elevenlabs') {
        // Chưa có item + hasMore → coi như trang đầu (cursor undefined)
        if (el && (el.hasMore || el.items.length === 0)) return 'elevenlabs';
        return null;
      }
      if (snap?.hasMore) return 'snapgen';
      if (el && (el.hasMore || el.items.length === 0)) return 'elevenlabs';
      return null;
    };

    const provider = pickTarget();
    if (!provider) return;

    const block = current.providers.find((p) => p.provider === provider);
    if (!block) return;
    // Trang đầu ElevenLabs: items rỗng nhưng vẫn cho load
    const isFirstEleven =
      provider === 'elevenlabs' && block.items.length === 0 && !block.nextCursor;
    if (!block.hasMore && !isFirstEleven) return;

    loadingRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const result = await window.studio.loadMoreUsageHistory({
        provider,
        page: provider === 'snapgen' ? block.nextPage : undefined,
        cursor: provider === 'elevenlabs' && !isFirstEleven ? block.nextCursor : undefined,
      });
      if (!result.ok) {
        setLoadMoreError(result.message);
        return;
      }
      const next: UsageHistorySnapshot = {
        ...current,
        updatedAt: new Date().toISOString(),
        providers: current.providers.map((p) =>
          p.provider !== provider
            ? p
            : mergeProvider(p, result.items, {
                provider,
                ok: true,
                hasMore: result.hasMore,
                nextPage: result.nextPage,
                nextCursor: result.nextCursor,
                totalCount: result.totalCount ?? p.totalCount,
                unit: p.unit,
                label: p.label,
              })
        ),
      };
      snapshotRef.current = next;
      onChange(next);
    } catch (err) {
      setLoadMoreError(err instanceof Error ? err.message : String(err));
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, []);

  // Đổi sang ElevenLabs / Tất cả mà chưa có data → tự tải trang đầu
  useEffect(() => {
    if (!onSnapshotChange || !snapshot) return;
    if (filter !== 'elevenlabs' && filter !== 'all') return;
    const el = snapshot.providers.find((p) => p.provider === 'elevenlabs');
    if (!el || el.items.length > 0 || loadingRef.current) return;
    void loadMore();
  }, [filter, snapshot, onSnapshotChange, loadMore]);

  // Infinite scroll: kéo gần cuối → tải thêm 1 trang
  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || !onSnapshotChange) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        void loadMore();
      },
      { root, rootMargin: '120px', threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, onSnapshotChange, filtered.length, filter, canLoadMore, popover]);

  const totalLine = useMemo(() => {
    if (!filtered.length) return null;
    if (filter === 'snapgen') {
      const sum = filtered.reduce((s, i) => s + i.amount, 0);
      return `${formatAmount(sum, 'credit')} · ${filtered.length}`;
    }
    if (filter === 'elevenlabs') {
      const sum = filtered.reduce((s, i) => s + i.amount, 0);
      return `${formatAmount(sum, 'character')} · ${filtered.length}`;
    }
    const snapSum = filtered
      .filter((i) => i.provider === 'snapgen')
      .reduce((s, i) => s + i.amount, 0);
    const elSum = filtered
      .filter((i) => i.provider === 'elevenlabs')
      .reduce((s, i) => s + i.amount, 0);
    return `${formatAmount(snapSum, 'credit')} · ${formatAmount(elSum, 'character')}`;
  }, [filtered, filter]);

  const filterError =
    filter === 'snapgen' && snapgen && !snapgen.ok
      ? snapgen.message
      : filter === 'elevenlabs' && eleven && !eleven.ok
        ? eleven.message
        : null;

  const filters = (
    <div className="usage-history-filters" role="tablist" aria-label="Lọc nguồn">
      {(
        [
          ['snapgen', 'Snapgen', snapgen?.items.length ?? 0],
          ['elevenlabs', 'ElevenLabs', eleven?.items.length ?? 0],
          ['all', 'Tất cả', (snapgen?.items.length ?? 0) + (eleven?.items.length ?? 0)],
        ] as const
      ).map(([id, label, count]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={filter === id}
          className={filter === id ? 'active' : ''}
          onClick={() => setFilter(id)}
        >
          {popover ? (id === 'snapgen' ? 'Snap' : id === 'elevenlabs' ? '11Labs' : 'All') : label}
          <span>{count}</span>
        </button>
      ))}
    </div>
  );

  const scrollFooter = (
    <div className="usage-history-scroll-footer" ref={sentinelRef}>
      {loadingMore ? <span className="hint">Đang tải thêm…</span> : null}
      {!loadingMore && canLoadMore ? (
        <span className="hint">Kéo xuống để tải thêm</span>
      ) : null}
      {!loadingMore && !canLoadMore && filtered.length > 0 ? (
        <span className="hint">Đã hết lịch sử</span>
      ) : null}
      {loadMoreError ? <span className="msg error">{loadMoreError}</span> : null}
    </div>
  );

  if (popover) {
    return (
      <section ref={rootRef} className="usage-history-popover" id="usage-history-global">
        <div className="usage-history-popover-head">
          <strong>Lịch sử</strong>
          <div className="usage-history-actions">
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={onRefresh}
              title="Làm mới"
            >
              {busy ? '…' : '↻'}
            </button>
            {onClose ? (
              <button type="button" className="btn ghost" onClick={onClose} title="Đóng">
                ✕
              </button>
            ) : null}
          </div>
        </div>
        <div className="usage-history-toolbar compact">
          {filters}
          {totalLine ? <span className="usage-history-total">{totalLine}</span> : null}
        </div>
        {error ? <p className="msg error">{error}</p> : null}
        {filterError ? <p className="msg error">{filterError}</p> : null}
        {!snapshot ? (
          <p className="muted pad">Đang tải…</p>
        ) : filtered.length === 0 && !filterError ? (
          <p className="muted pad">Chưa có mục nào.</p>
        ) : (
          <div className="usage-history-scroll" ref={scrollRef}>
            <ul className="usage-history-list flat">
              {filtered.map((item) => (
                <li key={item.id}>
                  <div className="usage-history-list-main">
                    {filter === 'all' ? (
                      <span className={`usage-src-tag ${item.provider}`}>
                        {providerLabel(item.provider)}
                      </span>
                    ) : null}
                    <span className="usage-history-list-title" title={item.detail || item.title}>
                      {item.title}
                    </span>
                    <strong>{formatAmount(item.amount, item.unit)}</strong>
                  </div>
                  <div className="usage-history-list-meta">
                    <span>{formatWhen(item.createdAt, true)}</span>
                    {item.status ? <span>{item.status}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
            {scrollFooter}
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      className={`settings-block usage-history-panel ${embedded ? 'embedded' : ''}`}
      id="usage-history"
    >
      <div className="quota-header">
        <div>
          <h2>Lịch sử sử dụng</h2>
          <p className="settings-note">
            Tải theo trang · kéo xuống để xem thêm · mặc định Snapgen.
          </p>
        </div>
        <div className="usage-history-actions">
          <button type="button" className="btn" disabled={busy} onClick={onRefresh}>
            {busy ? 'Đang lấy…' : 'Làm mới'}
          </button>
        </div>
      </div>

      <div className="usage-history-toolbar">
        {filters}
        {totalLine ? <span className="usage-history-total">{totalLine}</span> : null}
      </div>

      {error ? <p className="msg error">{error}</p> : null}
      {filterError ? <p className="msg error">{filterError}</p> : null}
      {snapshot?.updatedAt ? (
        <p className="hint">Cập nhật: {new Date(snapshot.updatedAt).toLocaleString('vi-VN')}</p>
      ) : null}

      {!snapshot ? (
        <p className="muted">Bấm “Làm mới” để tải lịch sử.</p>
      ) : filtered.length === 0 && !filterError ? (
        <p className="muted">Không có mục nào cho bộ lọc này.</p>
      ) : filtered.length > 0 ? (
        <div className="usage-history-table-wrap unified" ref={scrollRef}>
          <table className="usage-history-table">
            <thead>
              <tr>
                {filter === 'all' ? <th>Nguồn</th> : null}
                <th>Thời gian</th>
                <th>Chi tiết</th>
                <th>Trạng thái</th>
                <th className="num">Đã dùng</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  {filter === 'all' ? (
                    <td>
                      <span className={`usage-src-tag ${item.provider}`}>
                        {providerLabel(item.provider)}
                      </span>
                    </td>
                  ) : null}
                  <td className="when">{formatWhen(item.createdAt)}</td>
                  <td>
                    <div className="usage-history-title">{item.title}</div>
                    {item.detail ? (
                      <div className="usage-history-detail">{item.detail}</div>
                    ) : null}
                  </td>
                  <td>{item.status || '—'}</td>
                  <td className="num">{formatAmount(item.amount, item.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {scrollFooter}
        </div>
      ) : null}
    </section>
  );
}
