import { useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { VideoUploader } from './VideoUploader';
import { ThreeDViewer } from './ThreeDViewer';
import { ObjectPanel } from './ObjectPanel';
import { analyzeVideo } from './objectDetector';
import { VideoAnalysis, ViewMode } from './types';

type Stage = 'upload' | 'analyzing' | 'viewing';

export function Video3DMapPage() {
  const [stage, setStage] = useState<Stage>('upload');
  const [analysis, setAnalysis] = useState<VideoAnalysis | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [progress, setProgress] = useState(0);
  const [fileName, setFileName] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('orbit');
  const [activeFrame, setActiveFrame] = useState<number | null>(null);
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

  const reset = () => { setStage('upload'); setAnalysis(null); setSelectedId(null); setActiveFrame(null); setViewMode('orbit'); };

  const viewModes: { mode: ViewMode; label: string; icon: string }[] = [
    { mode: 'orbit', label: '3D 궤도', icon: '🌐' },
    { mode: 'dollhouse', label: '돌하우스', icon: '🏠' },
    { mode: 'floorplan', label: '평면도', icon: '📐' },
    { mode: 'walkthrough', label: '워크스루', icon: '🚶' },
  ];

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <div className="header-title">
            <h1>Video 3D Map</h1>
            <p className="subtitle">Matterport-style 3D 공간 복원 + AI 객체 인식</p>
          </div>
          <div className="header-actions">
            {stage === 'viewing' && <button className="refresh-btn" onClick={reset}>새 영상</button>}
            <Link to="/" className="nav-link">뉴스 대시보드</Link>
          </div>
        </div>
      </header>

      <main className="main v3d-main">
        {/* Upload */}
        {stage === 'upload' && (
          <div className="v3d-upload-stage">
            <div className="v3d-intro">
              <h2>영상을 3D 공간으로 변환하세요</h2>
              <p>영상을 업로드하면 AI가 프레임별 포인트 클라우드를 생성하고 객체를 인식합니다.</p>
              <div className="v3d-features">
                <div className="v3d-feat"><span>☁️</span><h4>포인트 클라우드</h4><p>프레임 → 컬러 3D 점군 변환</p></div>
                <div className="v3d-feat"><span>🔍</span><h4>AI 객체 인식</h4><p>COCO-SSD 80+ 종류 감지</p></div>
                <div className="v3d-feat"><span>🏠</span><h4>뷰 모드</h4><p>궤도/돌하우스/평면도/워크스루</p></div>
                <div className="v3d-feat"><span>📍</span><h4>공간 네비게이션</h4><p>뷰포인트 클릭으로 이동</p></div>
              </div>
            </div>
            <VideoUploader onVideoLoaded={onVideo} />
          </div>
        )}

        {/* Analyzing */}
        {stage === 'analyzing' && (
          <div className="v3d-analyzing">
            <div className="v3d-analyzing-card">
              <div className="spinner large" />
              <h3>{fileName}</h3>
              <p>{msg}</p>
              <div className="v3d-progress"><div className="v3d-progress-fill" style={{ width: `${progress}%` }} /></div>
              <strong>{Math.round(progress)}%</strong>
            </div>
          </div>
        )}

        {/* Viewing */}
        {stage === 'viewing' && analysis && (
          <div className="v3d-viewing">
            {/* Stats */}
            <div className="v3d-stats">
              <div className="stat-item"><span className="stat-value">{analysis.frames.length}</span><span className="stat-label">프레임</span></div>
              <div className="stat-item"><span className="stat-value">{analysis.allObjects.length}</span><span className="stat-label">객체</span></div>
              <div className="stat-item">
                <span className="stat-value">
                  {analysis.frames.reduce((sum, f) => sum + f.pointCloud.count, 0).toLocaleString()}
                </span>
                <span className="stat-label">포인트</span>
              </div>
              <div className="stat-item"><span className="stat-value">{analysis.duration.toFixed(1)}s</span><span className="stat-label">길이</span></div>
            </div>

            {/* View Mode Toolbar */}
            <div className="v3d-toolbar">
              <div className="v3d-mode-btns">
                {viewModes.map(({ mode, label, icon }) => (
                  <button
                    key={mode}
                    className={`v3d-mode-btn ${viewMode === mode ? 'active' : ''}`}
                    onClick={() => setViewMode(mode)}
                  >
                    <span>{icon}</span> {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Main layout */}
            <div className="v3d-layout">
              <div className="v3d-viewer-wrap">
                <ThreeDViewer
                  analysis={analysis}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  viewMode={viewMode}
                  activeFrame={activeFrame}
                />

                {/* Frame Strip */}
                <div className="v3d-framestrip">
                  {analysis.frames.map((frame, i) => (
                    <button
                      key={i}
                      className={`v3d-frame-thumb ${activeFrame === i ? 'active' : ''}`}
                      onClick={() => { setActiveFrame(i); setViewMode('walkthrough'); }}
                      title={`${frame.timestamp.toFixed(1)}s`}
                    >
                      <img src={frame.imageUrl} alt={`F${i + 1}`} />
                      <span className="v3d-thumb-label">
                        {frame.timestamp.toFixed(1)}s
                        {frame.objects.length > 0 && (
                          <span className="v3d-thumb-count">{frame.objects.length}</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <ObjectPanel
                objects={analysis.allObjects}
                frames={analysis.frames}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onUpdateDesc={onUpdateDesc}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
