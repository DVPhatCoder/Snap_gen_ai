import type { GenerateJobResult } from '../../shared/types';

export default function VideoPreview({ result }: { result: GenerateJobResult }) {
  const fileUrl = `file:///${result.videoPath.replace(/\\/g, '/')}`;

  return (
    <div>
      <video className="video-frame" controls src={fileUrl} />
      <p className="muted" style={{ marginTop: 10 }}>
        {result.videoPath}
      </p>
      <div className="row-actions">
        <button
          type="button"
          className="btn primary"
          onClick={() => void window.studio.exportVideo(result.videoPath)}
        >
          Export / Save As...
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void window.studio.showItemInFolder(result.videoPath)}
        >
          Mở thư mục
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void window.studio.openPath(result.srtPath)}
        >
          Mở file SRT
        </button>
      </div>
    </div>
  );
}
