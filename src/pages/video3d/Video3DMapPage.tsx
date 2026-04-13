import { useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { VideoUploader } from './VideoUploader';
import { ThreeDViewer } from './ThreeDViewer';
import { ObjectPanel } from './ObjectPanel';
import { analyzeVideo } from './objectDetector';
import { VideoAnalysis } from './types';

type Stage = 'upload' | 'analyzing' | 'viewing';

export function Video3DMapPage() {
  const [stage, setStage] = useState<Stage>('upload');
  const [analysis, setAnalysis] = useState<VideoAnalysis | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [progress, setProgress] = useState(0);
  const [fileName, setFileName] = useState('');
  const blobRef = useRef<string | null>(null);

  const onVideo = useCallback(async (url: string, file: File) => {
    if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    blobRef.current = url;
    setStage('analyzing');
    setFileName(file.name);
    setMsg('준비 중...');
    setProgress(0);

    try {
      const result = await analyzeVideo(url, (m, p) => { setMsg(m); setProgress(p); });
      setAnalysis(result);
      setStage('viewing');
    } catch {
      setMsg('분석 실패. 다시 시도해주세요.');
      setTimeout(() => setStage('upload'), 2000);
    } finally {
      if (blobRef.current) { URL.revokeObjectURL(blobRef.current); blobRef.current = null; }
    }
  }, []);

  const onUpdateDesc = useCallback((id: string, desc: string) => {
    if (!analysis) return;
    setAnalysis({
      ...analysis,
      allObjects: analysis.allObjects.map((o) => o.id === id ? { ...o, description: desc } : o),
      frames: analysis.frames.map((f) => ({
        ...f, objects: f.objects.map((o) => o.id === id ? { ...o, description: desc } : o),
      })),
    });
  }, [analysis]);

  const reset = () => { setStage('upload'); setAnalysis(null); setSelectedId(null); };

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <div className="header-title">
            <h1>Video 3D Map</h1>
            <p className="subtitle">영상을 3D 맵으로 시각화하고 객체를 인식합니다</p>
          </div>
          <div className="header-actions">
            {stage === 'viewing' && <button className="refresh-btn" onClick={reset}>새 영상</button>}
            <Link to="/" className="nav-link">뉴스 대시보드</Link>
          </div>
        </div>
      </header>

      <main className="main v3d-main">
        {stage === 'upload' && (
          <div className="v3d-upload-stage">
            <div className="v3d-intro">
              <h2>영상을 3D 맵으로 변환하세요</h2>
              <p>영상을 업로드하면 AI가 자동으로 객체를 인식하고, 3D 공간에서 시각화합니다.</p>
              <div className="v3d-features">
                <div className="v3d-feat"><span>🎬</span><h4>영상 업로드</h4><p>MP4, WebM 등 지원</p></div>
                <div className="v3d-feat"><span>🔍</span><h4>AI 객체 인식</h4><p>80+ 종류 자동 감지</p></div>
                <div className="v3d-feat"><span>🗺️</span><h4>3D 시각화</h4><p>3D 공간에서 탐색</p></div>
                <div className="v3d-feat"><span>📝</span><h4>설명 추가</h4><p>객체별 메모 첨부</p></div>
              </div>
            </div>
            <VideoUploader onVideoLoaded={onVideo} />
          </div>
        )}

        {stage === 'analyzing' && (
          <div className="v3d-analyzing">
            <div className="v3d-analyzing-card">
              <div className="spinner large" />
              <h3>{fileName} 분석 중</h3>
              <p>{msg}</p>
              <div className="v3d-progress"><div className="v3d-progress-fill" style={{ width: `${progress}%` }} /></div>
              <strong>{Math.round(progress)}%</strong>
            </div>
          </div>
        )}

        {stage === 'viewing' && analysis && (
          <div className="v3d-viewing">
            <div className="v3d-stats">
              <div className="stat-item"><span className="stat-value">{analysis.frames.length}</span><span className="stat-label">프레임</span></div>
              <div className="stat-item"><span className="stat-value">{analysis.allObjects.length}</span><span className="stat-label">객체</span></div>
              <div className="stat-item"><span className="stat-value">{new Set(analysis.allObjects.map((o) => o.label)).size}</span><span className="stat-label">종류</span></div>
              <div className="stat-item"><span className="stat-value">{analysis.duration.toFixed(1)}s</span><span className="stat-label">길이</span></div>
            </div>
            <div className="v3d-layout">
              <ThreeDViewer analysis={analysis} selectedId={selectedId} onSelect={setSelectedId} />
              <ObjectPanel objects={analysis.allObjects} frames={analysis.frames} selectedId={selectedId} onSelect={setSelectedId} onUpdateDesc={onUpdateDesc} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
