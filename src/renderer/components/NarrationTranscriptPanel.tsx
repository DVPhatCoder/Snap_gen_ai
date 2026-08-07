import { useMemo, useState } from 'react';
import type { SceneDraft } from '../../shared/types';
import {
  buildContinuousNarrationTranscript,
  buildSceneNarrationTranscript,
} from '../../shared/narration';

type TranscriptMode = 'continuous' | 'scenes';

export default function NarrationTranscriptPanel({
  scenes,
  language,
  disabled,
}: {
  scenes: SceneDraft[] | null | undefined;
  language: string;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<TranscriptMode>('continuous');
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const transcript = useMemo(() => {
    if (mode === 'scenes') return buildSceneNarrationTranscript(scenes);
    return buildContinuousNarrationTranscript(scenes);
  }, [mode, scenes]);

  const empty = !transcript.trim();
  const charCount = transcript.length;
  const wordCount = empty ? 0 : transcript.split(/\s+/).filter(Boolean).length;

  const copyText = async () => {
    setCopyError(null);
    if (empty) {
      setCopyError('Chưa có narration — Generate script trước.');
      return;
    }
    try {
      await navigator.clipboard.writeText(transcript);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="nt-panel">
      <header className="nt-header">
        <div>
          <span className="panel-kicker">TRANSCRIPT</span>
          <h3 className="nt-title">Narration</h3>
        </div>
        <div className="nt-meta">
          <span className="nt-chip">{language || '—'}</span>
          <span className="nt-stat">
            {wordCount} từ · {charCount}
          </span>
        </div>
      </header>

      <p className="nt-sub">Copy narration để dùng với TTS / voiceover bên ngoài.</p>

      <div className="media-switch nt-switch" role="tablist" aria-label="Định dạng transcript">
        <button
          type="button"
          role="tab"
          className={mode === 'continuous' ? 'active' : ''}
          disabled={disabled}
          onClick={() => setMode('continuous')}
        >
          Liền mạch
        </button>
        <button
          type="button"
          role="tab"
          className={mode === 'scenes' ? 'active' : ''}
          disabled={disabled}
          onClick={() => setMode('scenes')}
        >
          Theo scene
        </button>
      </div>

      <div className="nt-box-wrap">
        <textarea
          className="nt-box"
          readOnly
          disabled={disabled}
          value={empty ? '' : transcript}
          placeholder="Chưa có narration trong kịch bản."
          aria-label="Narration transcript"
        />
      </div>

      <div className="nt-actions">
        <button
          type="button"
          className="editor-primary"
          disabled={disabled || empty}
          onClick={() => void copyText()}
        >
          {copied ? 'Đã copy' : 'Copy text'}
        </button>
      </div>

      {copyError ? <p className="nt-error">{copyError}</p> : null}
    </section>
  );
}
