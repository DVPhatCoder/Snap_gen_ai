import { useCallback, useEffect, useState } from 'react';
import type { UsageHistorySnapshot, UsageSnapshot } from '../shared/types';
import UsageQuotaPanel from './components/UsageQuotaPanel';
import UsageHistoryPanel from './components/UsageHistoryPanel';
import Studio from './pages/Studio';
import Settings from './pages/Settings';
import Projects from './pages/Projects';

type Page = 'projects' | 'studio' | 'settings';

export default function App() {
  const [page, setPage] = useState<Page>('projects');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [studioKey, setStudioKey] = useState(0);
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [usageBusy, setUsageBusy] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [history, setHistory] = useState<UsageHistorySnapshot | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const refreshUsage = useCallback(async () => {
    setUsageBusy(true);
    try {
      const snap = await window.studio.getUsageQuotas();
      setUsage(snap);
      setUsageError(null);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setUsageError(
        text.includes('No handler') || text.includes('usage:getQuotas')
          ? 'Main chưa reload — gõ rs trong terminal Forge rồi bấm ↻.'
          : text
      );
    } finally {
      setUsageBusy(false);
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    setHistoryBusy(true);
    try {
      setHistory(await window.studio.getUsageHistory());
      setHistoryError(null);
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      setHistoryError(
        text.includes('No handler') || text.includes('usage:getHistory')
          ? 'Main chưa reload — gõ rs trong terminal Forge rồi bấm Làm mới.'
          : text
      );
    } finally {
      setHistoryBusy(false);
    }
  }, []);

  const toggleHistory = () => {
    setHistoryOpen((open) => {
      const next = !open;
      if (next) void refreshHistory();
      return next;
    });
  };

  useEffect(() => {
    void refreshUsage();
    const timer = window.setInterval(() => void refreshUsage(), 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [refreshUsage]);

  useEffect(() => {
    if (page !== 'studio') void refreshUsage();
  }, [page, refreshUsage]);

  const openProject = (id: string) => {
    setActiveProjectId(id);
    setStudioKey((k) => k + 1);
    setPage('studio');
    setHistoryOpen(false);
  };

  const newBlankStudio = () => {
    setActiveProjectId(null);
    setStudioKey((k) => k + 1);
    setPage('studio');
    setHistoryOpen(false);
  };

  return (
    <div className="app-shell">
      {page !== 'studio' && (
        <>
          <header className="topbar">
            <button type="button" className="brand" onClick={() => setPage('projects')}>
              <span className="brand-mark" aria-hidden>
                ✦
              </span>
              <div className="brand-text">
                <strong>SnapGen</strong>
                <span>AI Video Editor</span>
              </div>
            </button>
            <div className="topbar-right">
              <div className="quota-bar-row">
                <div className="quota-toolbar">
                  <UsageQuotaPanel
                    snapshot={usage}
                    busy={usageBusy}
                    error={usageError}
                    onRefresh={() => void refreshUsage()}
                    compact
                  />
                  <div className="history-anchor">
                    <button
                      type="button"
                      className={`btn ghost history-toggle ${historyOpen ? 'active' : ''}`}
                      onClick={toggleHistory}
                      aria-expanded={historyOpen}
                      aria-label="Xem lịch sử sử dụng"
                      title="Lịch sử sử dụng"
                    >
                      <span aria-hidden>☰</span>
                      <span className="history-toggle-label">Lịch sử</span>
                    </button>
                    {historyOpen ? (
                      <UsageHistoryPanel
                        snapshot={history}
                        busy={historyBusy}
                        error={historyError}
                        onRefresh={() => void refreshHistory()}
                        onClose={() => setHistoryOpen(false)}
                        onSnapshotChange={setHistory}
                        popover
                      />
                    ) : null}
                  </div>
                </div>
                {usageError ? <span className="quota-error-hint">{usageError}</span> : null}
              </div>
              <nav className="nav">
                <button
                  type="button"
                  className={page === 'projects' ? 'active' : ''}
                  onClick={() => setPage('projects')}
                >
                  Projects
                </button>
                <button type="button" onClick={newBlankStudio}>
                  New project
                </button>
                <button
                  type="button"
                  className={page === 'settings' ? 'active' : ''}
                  onClick={() => setPage('settings')}
                >
                  Settings
                </button>
              </nav>
            </div>
          </header>
        </>
      )}
      <main className={`content ${page === 'studio' ? 'editor-content' : ''}`}>
        {page === 'projects' && (
          <Projects onOpenProject={openProject} onCreateAndOpen={openProject} />
        )}
        {page === 'studio' && (
          <Studio
            key={studioKey}
            projectId={activeProjectId}
            onProjectReady={setActiveProjectId}
            onNeedProject={() => {
              setActiveProjectId(null);
              setPage('projects');
            }}
          />
        )}
        {page === 'settings' && <Settings />}
      </main>
    </div>
  );
}
