import { useCallback, useRef, useState } from 'react';
import { InputMode } from './types';

interface Props {
  onImagesReady: (images: { url: string; data: ImageData }[]) => void;
  disabled?: boolean;
}

function loadImage(url: string): Promise<{ url: string; data: ImageData }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      resolve({ url: c.toDataURL('image/jpeg', 0.85), data: ctx.getImageData(0, 0, c.width, c.height) });
    };
    img.src = url;
  });
}

function extractFramesFromVideo(videoUrl: string, onProgress: (p: number) => void): Promise<{ url: string; data: ImageData }[]> {
  return new Promise(async (resolve, reject) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = videoUrl;

    await new Promise<void>((res, rej) => {
      video.addEventListener('loadedmetadata', () => res(), { once: true });
      video.addEventListener('error', () => rej(new Error('영상 로딩 실패')), { once: true });
      video.load();
    });
    await new Promise<void>((res) => {
      if (video.readyState >= 4) return res();
      video.addEventListener('canplaythrough', () => res(), { once: true });
    });

    const numFrames = Math.min(Math.max(Math.floor(video.duration * 2), 4), 12);
    const interval = video.duration / (numFrames + 1);
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    const results: { url: string; data: ImageData }[] = [];

    for (let i = 1; i <= numFrames; i++) {
      onProgress(i / numFrames * 100);
      await new Promise<void>((res) => {
        video.currentTime = interval * i;
        video.addEventListener('seeked', () => {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          results.push({
            url: canvas.toDataURL('image/jpeg', 0.85),
            data: ctx.getImageData(0, 0, canvas.width, canvas.height),
          });
          res();
        }, { once: true });
      });
    }

    video.pause();
    video.removeAttribute('src');
    video.load();
    resolve(results);
  });
}

export function Uploader({ onImagesReady, disabled }: Props) {
  const [mode, setMode] = useState<InputMode>('photos');
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const handlePhotos = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) { alert('이미지 파일을 선택해주세요.'); return; }
    setProcessing(true);
    const images = await Promise.all(
      imageFiles.map((f) => loadImage(URL.createObjectURL(f)))
    );
    onImagesReady(images);
    setProcessing(false);
  }, [onImagesReady]);

  const handleVideo = useCallback(async (file: File) => {
    if (!file.type.startsWith('video/')) { alert('영상 파일을 선택해주세요.'); return; }
    setProcessing(true);
    const url = URL.createObjectURL(file);
    try {
      const images = await extractFramesFromVideo(url, setProgress);
      onImagesReady(images);
    } finally {
      URL.revokeObjectURL(url);
      setProcessing(false);
    }
  }, [onImagesReady]);

  const handleFiles = useCallback((files: FileList | File[]) => {
    const arr = Array.from(files);
    if (mode === 'photos') handlePhotos(arr);
    else if (arr[0]) handleVideo(arr[0]);
  }, [mode, handlePhotos, handleVideo]);

  if (processing) {
    return (
      <div className="v3d-upload processing">
        <div className="spinner large" />
        <h3>{mode === 'video' ? '영상에서 프레임 추출 중...' : '이미지 로딩 중...'}</h3>
        {mode === 'video' && (
          <div className="v3d-progress" style={{ width: '200px' }}>
            <div className="v3d-progress-fill" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Mode toggle */}
      <div className="v3d-input-toggle">
        <button className={mode === 'photos' ? 'active' : ''} onClick={() => setMode('photos')}>
          사진 업로드
        </button>
        <button className={mode === 'video' ? 'active' : ''} onClick={() => setMode('video')}>
          영상 업로드
        </button>
      </div>

      <div
        className={`v3d-upload ${dragOver ? 'drag-over' : ''} ${disabled ? 'disabled' : ''}`}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onClick={disabled ? undefined : () => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept={mode === 'photos' ? 'image/*' : 'video/*'}
          multiple={mode === 'photos'}
          onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files); }}
          style={{ display: 'none' }}
          disabled={disabled}
        />
        <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="v3d-upload-icon">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        {mode === 'photos' ? (
          <>
            <h3>공간 사진을 업로드하세요</h3>
            <p>여러 장의 사진을 드래그하거나 클릭하여 선택</p>
            <span className="v3d-upload-hint">JPG, PNG 등 | 여러 각도에서 촬영한 사진 권장</span>
          </>
        ) : (
          <>
            <h3>공간 영상을 업로드하세요</h3>
            <p>영상을 드래그하거나 클릭하여 선택</p>
            <span className="v3d-upload-hint">MP4, WebM 등 | 자동으로 프레임 추출</span>
          </>
        )}
      </div>
    </div>
  );
}
