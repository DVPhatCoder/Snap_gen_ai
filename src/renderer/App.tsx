import { useState } from 'react';
import Studio from './pages/Studio';
import Settings from './pages/Settings';
import Projects from './pages/Projects';

type Page = 'projects' | 'studio' | 'settings';

export default function App() {
  const [page, setPage] = useState<Page>('projects');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [studioKey, setStudioKey] = useState(0);

  const openProject = (id: string) => {
    setActiveProjectId(id);
    setStudioKey((k) => k + 1);
    setPage('studio');
  };

  const newBlankStudio = () => {
    setActiveProjectId(null);
    setStudioKey((k) => k + 1);
    setPage('studio');
  };

  return (
    <div className="app-shell">
      {page !== 'studio' && (
        <header className="topbar">
          <button type="button" className="brand" onClick={() => setPage('projects')}>
            <span className="brand-mark" aria-hidden>✦</span>
            <div className="brand-text">
              <strong>SnapGen</strong>
              <span>AI Video Editor</span>
            </div>
          </button>
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
        </header>
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
