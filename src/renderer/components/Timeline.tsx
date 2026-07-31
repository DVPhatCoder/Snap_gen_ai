import { useEffect, useRef, useState } from 'react';
import type { ScriptDraft } from '../../shared/types';

interface Props {
  script: ScriptDraft | null;
  selectedScene: number;
  timelineZoom: number;
  playheadTime: number;
  onSelect: (index: number) => void;
  onReorder: (from: number, to: number) => void;
  onDurationChange: (index: number, duration: number) => void;
  /** Fired once when the user finishes resizing a clip — remux should run here. */
  onDurationCommit?: (index: number, duration: number) => void;
  onSeek?: (seconds: number) => void;
}

// Clips are laid out with a minimum width and a gap, so pixel position can't be
// derived from time alone — every ruler mark and the playhead map through the
// same per-clip geometry to stay aligned.
const TRACK_PAD = 7;
const CLIP_GAP = 3;
const MIN_CLIP_WIDTH = 96;

function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export default function Timeline({
  script,
  selectedScene,
  timelineZoom,
  playheadTime,
  onSelect,
  onReorder,
  onDurationChange,
  onDurationCommit,
  onSeek,
}: Props) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const resizing = useRef<{ index: number; startX: number; startDur: number } | null>(null);
  const lastDuration = useRef<number | null>(null);

  const scenes = script?.scenes ?? [];
  const totalDuration = scenes.reduce((sum, scene) => sum + scene.duration_hint, 0);
  const clipWidths = scenes.map((scene) =>
    Math.max(scene.duration_hint * timelineZoom, MIN_CLIP_WIDTH)
  );
  const clipStarts: number[] = [];
  let cursor = TRACK_PAD;
  for (const width of clipWidths) {
    clipStarts.push(cursor);
    cursor += width + CLIP_GAP;
  }
  const contentWidth = scenes.length ? cursor - CLIP_GAP + TRACK_PAD : TRACK_PAD * 2;

  const timeToX = (seconds: number): number => {
    if (!scenes.length) return TRACK_PAD;
    let elapsed = 0;
    for (let i = 0; i < scenes.length; i++) {
      const duration = scenes[i].duration_hint;
      if (seconds < elapsed + duration || i === scenes.length - 1) {
        const ratio = duration > 0 ? Math.min(1, Math.max(0, (seconds - elapsed) / duration)) : 0;
        return clipStarts[i] + ratio * clipWidths[i];
      }
      elapsed += duration;
    }
    return TRACK_PAD;
  };

  const xToTime = (x: number): number => {
    if (!scenes.length) return 0;
    let elapsed = 0;
    for (let i = 0; i < scenes.length; i++) {
      const duration = scenes[i].duration_hint;
      if (x < clipStarts[i] + clipWidths[i] || i === scenes.length - 1) {
        const ratio = Math.min(1, Math.max(0, (x - clipStarts[i]) / clipWidths[i]));
        return elapsed + ratio * duration;
      }
      elapsed += duration;
    }
    return totalDuration;
  };

  const rulerMarks = Array.from(
    { length: Math.max(2, Math.floor(totalDuration / 5) + 1) },
    (_, i) => i * 5
  ).filter((time) => time <= totalDuration);

  const playheadX = timeToX(playheadTime);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || playheadTime <= 0) return;
    const margin = 48;
    if (playheadX < el.scrollLeft + margin || playheadX > el.scrollLeft + el.clientWidth - margin) {
      el.scrollLeft = Math.max(0, playheadX - el.clientWidth / 2);
    }
  }, [playheadX, playheadTime]);

  const onResizeStart = (
    event: React.MouseEvent,
    index: number,
    duration: number
  ) => {
    event.preventDefault();
    event.stopPropagation();
    resizing.current = { index, startX: event.clientX, startDur: duration };
    lastDuration.current = duration;

    const onMove = (moveEvent: MouseEvent) => {
      if (!resizing.current) return;
      const delta = (moveEvent.clientX - resizing.current.startX) / timelineZoom;
      const next = Math.max(1, Math.round((resizing.current.startDur + delta) * 10) / 10);
      lastDuration.current = next;
      onDurationChange(resizing.current.index, next);
    };

    const onUp = () => {
      if (resizing.current && lastDuration.current != null) {
        onDurationCommit?.(resizing.current.index, lastDuration.current);
      }
      resizing.current = null;
      lastDuration.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="timeline-body">
      <div className="track-labels">
        <div><span>▣</span> Video</div>
        <div><span>♫</span> Voice</div>
        <div><span>CC</span> Captions</div>
      </div>
      <div className="tracks-scroll" ref={scrollRef}>
        <div
          className="time-ruler"
          style={{ width: Math.max(contentWidth, 1000) }}
          onClick={(event) => {
            if (!onSeek || !scenes.length) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            onSeek(xToTime(event.clientX - bounds.left));
          }}
        >
          {rulerMarks.map((time) => (
            <span key={time} style={{ left: timeToX(time) }}>
              {formatTime(time)}
            </span>
          ))}
        </div>
        <div className="timeline-playhead" style={{ left: playheadX }} />

        <div
          className="track video-track"
          onDragOver={(event) => {
            event.preventDefault();
          }}
        >
          {scenes.map((scene, index) => (
            <div
              key={scene.id}
              className={[
                'timeline-clip',
                selectedScene === index ? 'selected' : '',
                dragFrom === index ? 'dragging' : '',
                dropAt === index ? 'drop-target' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ width: clipWidths[index] }}
              draggable
              onDragStart={(event) => {
                setDragFrom(index);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', String(index));
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setDropAt(null);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDropAt(index);
              }}
              onDrop={(event) => {
                event.preventDefault();
                const from = Number(event.dataTransfer.getData('text/plain'));
                if (!Number.isNaN(from) && from !== index) onReorder(from, index);
                setDragFrom(null);
                setDropAt(null);
              }}
              onClick={() => onSelect(index)}
            >
              <span className="clip-number">{index + 1}</span>
              <span className="clip-content">
                <strong>Scene {index + 1}</strong>
                <small>{scene.visual_prompt || 'Untitled scene'}</small>
              </span>
              <span className="clip-duration">{scene.duration_hint.toFixed(1)}s</span>
              <span
                className="clip-resize-handle"
                title="Kéo để đổi thời lượng"
                onMouseDown={(event) => onResizeStart(event, index, scene.duration_hint)}
              />
            </div>
          ))}
          {!scenes.length && (
            <span className="track-placeholder">Generate a script to add scenes</span>
          )}
        </div>

        <div className="track audio-track">
          {scenes.length > 0 && (
            <div
              className="audio-clip"
              style={{ width: contentWidth - TRACK_PAD * 2 }}
            >
              <span>Voiceover</span>
              <div className="waveform">▂▄▆▃▅▇▂▅▃▆▄▇▃▅▂▆▄▇▃▅▂▆▄▇</div>
            </div>
          )}
        </div>

        <div className="track captions-track">
          {scenes.map((scene, index) => (
            <div
              key={scene.id}
              className="caption-clip"
              style={{ width: clipWidths[index] }}
            >
              {scene.narration_segment || `Caption ${index + 1}`}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
