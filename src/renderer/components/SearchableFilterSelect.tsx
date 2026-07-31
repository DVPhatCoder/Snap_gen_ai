import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import * as Flags from 'country-flag-icons/react/3x2';

export type FilterOption = {
  id: string;
  label: string;
  /** ISO 3166-1 alpha-2 for flag, e.g. VN, US */
  flag?: string;
};

function FlagBadge({ code }: { code?: string }) {
  if (!code) {
    return <span className="sf-flag sf-flag-empty" aria-hidden />;
  }
  const Comp = (Flags as Record<string, ComponentType<{ className?: string; title?: string }>>)[
    code.toUpperCase()
  ];
  if (!Comp) {
    return <span className="sf-flag sf-flag-empty" aria-hidden />;
  }
  return (
    <span className="sf-flag" aria-hidden>
      <Comp className="sf-flag-svg" title={code} />
    </span>
  );
}

/**
 * Dropdown filter kiểu ElevenLabs (Language / Accent).
 * Dùng input thường — không dùng Headless Combobox (ô Search bị khóa).
 */
export default function SearchableFilterSelect({
  label,
  icon,
  value,
  options,
  disabled,
  allLabel = 'Tất cả',
  searchPlaceholder = 'Search...',
  onChange,
}: {
  label: string;
  icon?: ReactNode;
  value: string;
  options: FilterOption[];
  disabled?: boolean;
  allLabel?: string;
  searchPlaceholder?: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => {
    if (value === 'all') return { id: 'all', label: allLabel } as FilterOption;
    return options.find((o) => o.id === value) ?? { id: 'all', label: allLabel };
  }, [value, options, allLabel]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all: FilterOption = { id: 'all', label: allLabel };
    const list = [all, ...options];
    if (!q) return list;
    return list.filter(
      (o) => o.label.toLowerCase().includes(q) || o.id.toLowerCase().includes(q)
    );
  }, [options, query, allLabel]);

  const triggerText = value === 'all' ? label : selected.label;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
    };
  }, [open]);

  return (
    <div className={`sf-select ${disabled ? 'disabled' : ''}`} ref={rootRef}>
      <button
        type="button"
        className={`sf-trigger ${value !== 'all' ? 'active' : ''} ${open ? 'open' : ''}`}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
          setQuery('');
        }}
      >
        {icon ? <span className="sf-trigger-icon">{icon}</span> : null}
        <span className="sf-trigger-label">{triggerText}</span>
        <span className="sf-caret" aria-hidden>
          {open ? '▴' : '▾'}
        </span>
      </button>

      {open ? (
        <div className="sf-panel" role="listbox" aria-label={label}>
          <div className="sf-search-wrap">
            <input
              ref={searchRef}
              type="search"
              className="sf-search"
              value={query}
              placeholder={searchPlaceholder}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <div className="sf-options">
            {filtered.length === 0 ? (
              <p className="sf-empty">Không có kết quả</p>
            ) : (
              filtered.map((opt) => {
                const isSelected = opt.id === value || (value === 'all' && opt.id === 'all');
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`sf-option-inner ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      onChange(opt.id);
                      setOpen(false);
                      setQuery('');
                    }}
                  >
                    {opt.id === 'all' ? (
                      <span className="sf-flag sf-flag-all" aria-hidden>
                        ✦
                      </span>
                    ) : (
                      <FlagBadge code={opt.flag} />
                    )}
                    <span>{opt.label}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
