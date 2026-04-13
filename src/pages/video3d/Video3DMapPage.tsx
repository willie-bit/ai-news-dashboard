import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Uploader } from './Uploader';
import { ThreeDViewer } from './ThreeDViewer';
import { ObjectPanel } from './ObjectPanel';
import { buildScene } from './sceneBuilder';
import { SceneAnalysis, ViewMode } from './types';

type Stage = 'upload' | 'building' | 'viewing';

export function Video3DMapPage() {
  const [stage, setStage] = useState<Stage>('upload');
  const [scene, setScene] = useState<SceneAnalysis | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('walkthrough');
  const [activeVP, setActiveVP] = useState<number | null>(0);
  const [msg, setMsg] = useState('');
  const [pct, setPct] = useState(0);

  const onImages = useCallback(async (images: { url: string; data: ImageData }[]) => {
    setStage('building');
    setMsg('준비 중...');
    setPct(0);
    try {
      const result = await buildScene(images, (m, p) => { setMsg(m); setPct(p); });
      setScene(result);
      setStage('viewing');
    } catch (e) {
      console.error(e);
      setMsg('분석 실패');
      setTimeout(() => setStage('upload'), 2000);
    }
  }, []);

  const onUpdateDesc = useCallback((id: string, desc: string) => {
    if (!scene) return;
    setScene({
      ...scene,
      allObjects: scene.allObjects.map((o) => o.id === id ? { ...o, description: desc } : o),
      viewpoints: scene.viewpoints.map((v) => ({
        ...v, objects: v.objects.map((o) => o.id === id ? { ...o, description: desc } : o),
      })),
    });
  }, [scene]);

  const reset = () => { setStage('upload'); setScene(null); setSelectedId(null); setActiveVP(0); setViewMode('walkthrough'); };

  const modes: { m: ViewMode; l: string; i: string }[] = [
    { m: 'walkthrough', l: '워크스루', i: '🚶' },
    { m: 'orbit', l: '3D 궤도', i: '🌐' },
    { m: 'dollhouse', l: '돌하우스', i: '🏠' },
    { m: 'floorplan', l: '평면도', i: '📐' },
  ];

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <div className="header-title">
            <h1>3D Space Viewer</h1>
            <p className="subtitle">사진/영상으로 Matterport 스타일 3D 공간을 만듭니다</p>
          </div>
          <div className="header-actions">
            {stage === 'viewing' && <button className="refresh-btn" onClick={reset}>새로 만들기</button>}
            <Link to="/" className="nav-link">뉴스 대시보드</Link>
          </div>
        </div>
      </header>

      <main className="main v3d-main">
        {stage === 'upload' && (
          <div className="v3d-upload-stage">
            <div className="v3d-intro">
              <h2>공간을 3D로 체험하세요</h2>
              <p>여러 각도에서 촬영한 사진이나 영상을 업로드하면 하나의 3D 공간으로 재구성합니다.</p>
              <div className="v3d-features">
                <div className="v3d-feat"><span>📷</span><h4>사진/영상 업로드</h4><p>여러 장의 사진 또는 영상</p></div>
                <div className="v3d-feat"><span>☁️</span><h4>포인트 클라우드</h4><p>통합 3D 공간 생성</p></div>
                <div className="v3d-feat"><span>🚶</span><h4>공간 워크스루</h4><p>Matterport 스타일 탐색</p></div>
                <div className="v3d-feat"><span>🔍</span><h4>AI 객체 인식</h4><p>80+ 종류 자동 감지</p></div>
              </div>
            </div>
            <Uploader onImagesReady={onImages} />
          </div>
        )}

        {stage === 'building' && (
          <div className="v3d-analyzing">
            <div className="v3d-analyzing-card">
              <div className="spinner large" />
              <h3>3D 공간 구축 중</h3>
              <p>{msg}</p>
              <div className="v3d-progress"><div className="v3d-progress-fill" style={{ width: `${pct}%` }} /></div>
              <strong>{Math.round(pct)}%</strong>
            </div>
          </div>
        )}

        {stage === 'viewing' && scene && (
          <div className="v3d-viewing">
            <div className="v3d-stats">
              <div className="stat-item"><span className="stat-value">{scene.viewpoints.length}</span><span className="stat-label">뷰포인트</span></div>
              <div className="stat-item"><span className="stat-value">{scene.allObjects.length}</span><span className="stat-label">객체</span></div>
              <div className="stat-item"><span className="stat-value">{scene.pointCloud.count.toLocaleString()}</span><span className="stat-label">포인트</span></div>
            </div>

            {/* View mode toolbar */}
            <div className="v3d-toolbar">
              <div className="v3d-mode-btns">
                {modes.map(({ m, l, i }) => (
                  <button key={m} className={`v3d-mode-btn ${viewMode === m ? 'active' : ''}`}
                    onClick={() => setViewMode(m)}>
                    <span>{i}</span> {l}
                  </button>
                ))}
              </div>
            </div>

            <div className="v3d-layout">
              <div className="v3d-viewer-wrap">
                <ThreeDViewer
                  scene={scene}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  viewMode={viewMode}
                  activeVP={activeVP}
                />
                {/* Viewpoint thumbnails */}
                <div className="v3d-framestrip">
                  {scene.viewpoints.map((vp, i) => (
                    <button key={i}
                      className={`v3d-frame-thumb ${activeVP === i ? 'active' : ''}`}
                      onClick={() => { setActiveVP(i); setViewMode('walkthrough'); }}
                    >
                      <img src={vp.imageUrl} alt={`VP ${i + 1}`} />
                      <span className="v3d-thumb-label">
                        {i + 1}
                        {vp.objects.length > 0 && <span className="v3d-thumb-count">{vp.objects.length}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <ObjectPanel
                objects={scene.allObjects}
                viewpoints={scene.viewpoints}
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
