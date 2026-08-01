import { useEffect, useMemo, useRef, useState } from 'react';
import type { ElevenLabsVoice } from '../../shared/types';
import {
  ELEVENLABS_ACCENTS,
  ELEVENLABS_LANGUAGES,
  accentMatchTokens,
  languageMatchTokens,
} from '../../shared/elevenlabs-languages';
import SearchableFilterSelect, { type FilterOption } from './SearchableFilterSelect';

function voiceBlob(v: ElevenLabsVoice): string {
  return [
    v.name,
    v.category,
    v.voiceId,
    ...Object.entries(v.labels || {}).flatMap(([k, val]) => [k, val]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function voiceMeta(v: ElevenLabsVoice): string {
  const parts = [
    v.labels?.language || v.labels?.accent || v.labels?.locale,
    v.labels?.gender,
    v.labels?.age,
    v.labels?.description || v.labels?.descriptive,
    v.category,
  ].filter(Boolean);
  return parts.join(' · ');
}

function voiceMatchesLanguage(v: ElevenLabsVoice, languageId: string): boolean {
  if (languageId === 'all') return true;
  const lang = ELEVENLABS_LANGUAGES.find((l) => l.id === languageId);
  if (!lang) return false;
  const blob = voiceBlob(v);
  const tokens = languageMatchTokens(lang);
  return tokens.some((t) => {
    if (t.length <= 2) return new RegExp(`(?:^|[^a-z0-9])${t}(?:[^a-z0-9]|$)`, 'i').test(blob);
    return blob.includes(t);
  });
}

function voiceMatchesAccent(v: ElevenLabsVoice, accentId: string): boolean {
  if (accentId === 'all') return true;
  const accent = ELEVENLABS_ACCENTS.find((a) => a.id === accentId);
  if (!accent) {
    // Accent lấy từ label voice (không nằm trong list chuẩn)
    const raw = (v.labels?.accent || '').toLowerCase();
    return raw === accentId || raw.replace(/\s+/g, '-') === accentId;
  }
  const blob = voiceBlob(v);
  return accentMatchTokens(accent).some((t) => {
    if (t.length <= 2) return new RegExp(`(?:^|[^a-z0-9])${t}(?:[^a-z0-9]|$)`, 'i').test(blob);
    return blob.includes(t);
  });
}

const LangIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
    <path
      d="M5 8h8M9 8c0 6-4 10-8 11M12 8c0 4.5-1.8 7.8-4.5 10"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    />
    <path d="M13 16l2.2-6h.6L18 16M14 14h3.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

const LANGUAGE_OPTIONS: FilterOption[] = ELEVENLABS_LANGUAGES.map((l) => ({
  id: l.id,
  label: l.label,
  flag: l.flag,
})).sort((a, b) => a.label.localeCompare(b.label, 'en'));

const BASE_ACCENT_OPTIONS: FilterOption[] = ELEVENLABS_ACCENTS.map((a) => ({
  id: a.id,
  label: a.label,
  flag: a.flag,
})).sort((a, b) => a.label.localeCompare(b.label, 'en'));

export default function ElevenLabsVoicePicker({
  voices,
  value,
  disabled,
  modelId,
  onChange,
}: {
  voices: ElevenLabsVoice[];
  value: string;
  disabled?: boolean;
  modelId?: string;
  onChange: (voiceId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [langFilter, setLangFilter] = useState('all');
  const [accentFilter, setAccentFilter] = useState('all');
  const [includeLibrary, setIncludeLibrary] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const selected = voices.find((v) => v.voiceId === value);
  const selectedIsLibrary = (selected?.category || '').toLowerCase() === 'library';
  const libraryHidden = useMemo(
    () => voices.filter((v) => (v.category || '').toLowerCase() === 'library').length,
    [voices]
  );

  /** Accent chuẩn + accent thực tế có trên voice list (nếu khác). */
  const accentOptions = useMemo(() => {
    const map = new Map(BASE_ACCENT_OPTIONS.map((o) => [o.id, o]));
    for (const v of voices) {
      const raw = v.labels?.accent?.trim();
      if (!raw) continue;
      const known = ELEVENLABS_ACCENTS.find((a) =>
        accentMatchTokens(a).includes(raw.toLowerCase())
      );
      if (known) {
        map.set(known.id, { id: known.id, label: known.label, flag: known.flag });
        continue;
      }
      const id = raw.toLowerCase().replace(/\s+/g, '-');
      if (!map.has(id)) {
        map.set(id, {
          id,
          label: raw.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        });
      }
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'en'));
  }, [voices]);

  // Hiện cả Voice Library (đã Add). Free API có thể 402 — cảnh báo bên dưới, không ẩn.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return voices.filter((v) => {
      const isLib = (v.category || '').toLowerCase() === 'library';
      if (isLib && !includeLibrary) return false;
      if (!voiceMatchesLanguage(v, langFilter)) return false;
      if (!voiceMatchesAccent(v, accentFilter)) return false;
      if (!q) return true;
      return voiceBlob(v).includes(q);
    });
  }, [voices, query, langFilter, accentFilter, includeLibrary]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  const stopPreview = () => {
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.currentTime = 0;
    setPlayingId(null);
  };

  const playUrl = async (voiceId: string, url: string) => {
    stopPreview();
    const audio = new Audio(url);
    audioRef.current = audio;
    setPlayingId(voiceId);
    audio.onended = () => setPlayingId(null);
    audio.onerror = () => {
      setPlayingId(null);
      setPreviewError('Không phát được file preview.');
    };
    await audio.play();
  };

  const previewVoice = async (voice: ElevenLabsVoice) => {
    setPreviewError(null);
    if (playingId === voice.voiceId) {
      stopPreview();
      return;
    }
    try {
      if (voice.previewUrl) {
        await playUrl(voice.voiceId, voice.previewUrl);
        return;
      }
      setPreviewBusy(true);
      const { dataUrl } = await window.studio.previewElevenLabsVoice({
        voiceId: voice.voiceId,
        modelId,
      });
      await playUrl(voice.voiceId, dataUrl);
    } catch (err) {
      setPlayingId(null);
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewBusy(false);
    }
  };

  return (
    <div className={`el-voice-picker ${disabled ? 'disabled' : ''}`}>
      <div className="el-voice-selected">
        <div>
          <strong>{selected?.name || 'Chưa chọn giọng'}</strong>
          <p className="hint">
            {selected ? voiceMeta(selected) || selected.voiceId : 'Tải danh sách giọng để chọn'}
          </p>
        </div>
        {selected ? (
          <button
            type="button"
            className="btn ghost"
            disabled={disabled || previewBusy}
            onClick={() => void previewVoice(selected)}
            title="Nghe thử"
          >
            {playingId === selected.voiceId ? '⏸ Dừng' : previewBusy ? '…' : '▶ Nghe thử'}
          </button>
        ) : null}
      </div>

      <div className="el-voice-tools">
        <div className="el-voice-filter-bar">
          <SearchableFilterSelect
            label="Language"
            icon={LangIcon}
            value={langFilter}
            options={LANGUAGE_OPTIONS}
            disabled={disabled}
            allLabel="All languages"
            searchPlaceholder="Search..."
            onChange={setLangFilter}
          />
          <SearchableFilterSelect
            label="Accent"
            value={accentFilter}
            options={accentOptions}
            disabled={disabled}
            allLabel="All accents"
            searchPlaceholder="Search..."
            onChange={setAccentFilter}
          />
        </div>
        <label className="el-voice-library-toggle">
          <input
            type="checkbox"
            checked={includeLibrary}
            disabled={disabled}
            onChange={(e) => setIncludeLibrary(e.target.checked)}
          />
          <span>Hiện Voice Library đã Add ({libraryHidden})</span>
        </label>
        <input
          type="search"
          value={query}
          disabled={disabled}
          placeholder="Tìm theo tên giọng…"
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Tìm giọng ElevenLabs"
        />
      </div>

      <div className="el-voice-list" role="listbox" aria-label="Danh sách giọng">
        {filtered.length === 0 ? (
          <p className="muted pad">
            Không có giọng khớp bộ lọc. Bật «Hiện Voice Library» hoặc xóa ô tìm kiếm.
          </p>
        ) : (
          filtered.map((voice) => {
            const active = voice.voiceId === value;
            const playing = playingId === voice.voiceId;
            const isLib = (voice.category || '').toLowerCase() === 'library';
            return (
              <div
                key={voice.voiceId}
                className={`el-voice-row ${active ? 'active' : ''}`}
                role="option"
                aria-selected={active}
              >
                <button
                  type="button"
                  className="el-voice-pick"
                  disabled={disabled}
                  onClick={() => onChange(voice.voiceId)}
                >
                  <strong>
                    {voice.name}
                    {isLib ? ' · Library' : ''}
                  </strong>
                  <span>{voiceMeta(voice) || voice.voiceId}</span>
                </button>
                <button
                  type="button"
                  className="btn ghost el-voice-play"
                  disabled={disabled || previewBusy}
                  title={voice.previewUrl ? 'Nghe sample' : 'Tạo audio thử (tốn ký tự)'}
                  onClick={() => void previewVoice(voice)}
                >
                  {playing ? '⏸' : '▶'}
                </button>
              </div>
            );
          })
        )}
      </div>
      {selectedIsLibrary ? (
        <p className="hint voice-library-warn">
          Giọng Library: khi hết token, app tự Add cùng giọng sang API key mới rồi TTS tiếp (có thể
          khác voice_id trên account đó). Gói Free vẫn có thể bị ElevenLabs 402.
        </p>
      ) : null}
      <p className="hint">
        {filtered.length} giọng
        {previewError ? ` · ${previewError}` : ''}
        {!selected?.previewUrl && selected
          ? ' · Giọng này không có sample sẵn — nghe thử sẽ gọi TTS ngắn.'
          : ''}
      </p>
    </div>
  );
}
