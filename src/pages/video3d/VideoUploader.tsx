import { useCallback, useRef, useState } from 'react';

interface Props {
  onVideoLoaded: (url: string, file: File) => void;
  disabled?: boolean;
}

export function VideoUploader({ onVideoLoaded, disabled }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('video/')) {
        alert('영상 파일만 업로드할 수 있습니다.');
        return;
      }
      onVideoLoaded(URL.createObjectURL(file), file);
    },
    [onVideoLoaded]
  );

  return (
    <div
      className={`v3d-upload ${dragOver ? 'drag-over' : ''} ${disabled ? 'disabled' : ''}`}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onClick={disabled ? undefined : () => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
        style={{ display: 'none' }}
        disabled={disabled}
      />
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="v3d-upload-icon">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      <h3>영상 파일을 업로드하세요</h3>
      <p>드래그 앤 드롭 또는 클릭하여 파일 선택</p>
      <span className="v3d-upload-hint">MP4, WebM, MOV 등 지원</span>
    </div>
  );
}
