import { useCallback, useRef, useState } from 'react';
import { InputMode } from './types';

interface Props {
  onImagesReady: (images: { url: string; data: ImageData }[]) => void;
  disabled?: boolean;
}

const MAX_SIZE = 1024; // Downscale images to max 1024px

function loadImage(url: string): Promise<{ url: string; data: ImageData }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        // Downscale to prevent memory issues
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (w > MAX_SIZE || h > MAX_SIZE) {
          const ratio = Math.min(MAX_SIZE / w, MAX_SIZE / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        if (!ctx) { reject(new Error('Canvas 생성 실패')); return; }
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h);
        const dataUrl = c.toDataURL('image/jpeg', 0.8);
        resolve({ url: dataUrl, data });
      } catch (err) {
        reject(new Error(`이미지 처리 실패: ${err instanceof Error ? err.message : String(err)}`));
      }
    };
    img.onerror = () => reject(new Error('이미지 로딩 실패'));
    img.src = url;
  });
}

function extractFramesFromVideo(videoUrl: string, onProgress: (p: number) => void): Promise<{ url: string; data: ImageData }[]> {
  return new Promise(async (resolve, reject) => {
    try {
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

      // Downscale video frames too
      let w = video.videoWidth;
      let h = video.videoHeight;
      if (w > MAX_SIZE || h > MAX_SIZE) {
        const ratio = Math.min(MAX_SIZE / w, MAX_SIZE / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }

      const numFrames = Math.min(Math.max(Math.floor(video.duration * 2), 4), 12);
      const interval = video.duration / (numFrames + 1);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      const results: { url: string; data: ImageData }[] = [];

      for (let i = 1; i <= numFrames; i++) {
        onProgress(i / numFrames * 100);
        await new Promise<void>((res) => {
          video.currentTime = interval * i;
          video.addEventListener('seeked', () => {
            ctx.drawImage(video, 0, 0, w, h);
            results.push({
              url: canvas.toDataURL('image/jpeg', 0.8),
              data: ctx.getImageData(0, 0, w, h),
            });
            res();
          }, { once: true });
        });
      }

      video.pause();
      video.removeAttribute('src');
      video.load();
      resolve(results);
    } catch (err) {
      reject(err);
    }
  });
}

export function Uploader({ onImagesReady, disabled }: Props) {
  const [mode, setMode] = useState<InputMode>('photos');
  const [dragOver, setDragOver] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handlePhotos = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) { alert('이미지 파일을 선택해주세요.'); return; }
    setProcessing(true);
    setError('');
    try {
      const blobUrls = imageFiles.map((f) => URL.createObjectURL(f));
      const images: { url: string; data: ImageData }[] = [];
      for (let i = 0; i < blobUrls.length; i++) {
        setProgress(((i + 1) / blobUrls.length) * 100);
        try {
          images.push(await loadImage(blobUrls[i]));
        } catch (err) {
          console.warn(`Image ${i + 1} skipped:`, err);
        } finally {
          URL.revokeObjectURL(blobUrls[i]);
        }
      }
      if (images.length === 0) throw new Error('로딩 가능한 이미지가 없습니다.');
      onImagesReady(images);
    } catch (err) {
      setError(err instanceof Error ? err.message : '이미지 로딩 실패');
    } finally {
      setProcessing(false);
    }
  }, [onImagesReady]);

  const handleVideo = useCallback(async (file: File) => {
    if (!file.type.startsWith('video/')) { alert('영상 파일을 선택해주세요.'); return; }
    setProcessing(true);
    setError('');
    const url = URL.createObjectURL(file);
    try {
      const images = await extractFramesFromVideo(url, setProgress);
      onImagesReady(images);
    } catch (err) {
      setError(err instanceof Error ? err.message : '영상 처리 실패');
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
        <h3>{mode === 'video' ? '영상에서 프레임 추출 중...' : `이미지 처리 중... ${Math.round(progress)}%`}</h3>
        <div className="v3d-progress" style={{ width: '200px' }}>
          <div className="v3d-progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="v3d-input-toggle">
        <button className={mode === 'photos' ? 'active' : ''} onClick={() => setMode('photos')}>사진 업로드</button>
        <button className={mode === 'video' ? 'active' : ''} onClick={() => setMode('video')}>영상 업로드</button>
      </div>

      {error && (
        <div style={{ color: '#fca5a5', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

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
            <span className="v3d-upload-hint">JPG, PNG 등 | 자동으로 1024px로 리사이즈됩니다</span>
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
