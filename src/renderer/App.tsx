import { useState } from 'react';
import Studio from './pages/Studio';
import Settings from './pages/Settings';

type Page = 'studio' | 'settings';

export default function App() {
  const [page, setPage] = useState<Page>('studio');

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          SnapGen <span>AI Studio</span>
        </div>
        <nav className="nav">
          <button
            type="button"
            className={page === 'studio' ? 'active' : ''}
            onClick={() => setPage('studio')}
          >
            Studio
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
      <main className="content">{page === 'studio' ? <Studio /> : <Settings />}</main>
    </div>
  );
}
