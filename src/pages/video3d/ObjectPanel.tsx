import { useState } from 'react';
import { DetectedObject, FrameData } from './types';

interface Props {
  objects: DetectedObject[];
  frames: FrameData[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUpdateDesc: (id: string, desc: string) => void;
}

export function ObjectPanel({ objects, frames, selectedId, onSelect, onUpdateDesc }: Props) {
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [filter, setFilter] = useState('all');

  const labels = [...new Set(objects.map((o) => o.label))].sort();
  const filtered = filter === 'all' ? objects : objects.filter((o) => o.label === filter);
  const counts = new Map<string, number>();
  objects.forEach((o) => counts.set(o.label, (counts.get(o.label) || 0) + 1));

  const selected = objects.find((o) => o.id === selectedId);

  const startEdit = (obj: DetectedObject) => { setEditId(obj.id); setEditText(obj.description); };
  const saveEdit = (id: string) => { onUpdateDesc(id, editText); setEditId(null); };

  return (
    <div className="v3d-panel">
      <div className="v3d-panel-head">
        <h3>감지된 객체</h3>
        <span className="v3d-badge">{objects.length}개</span>
      </div>

      <div className="v3d-tags">
        {Array.from(counts.entries()).map(([label, count]) => (
          <span key={label} className="v3d-tag">
            <i className="v3d-dot" style={{ background: objects.find((o) => o.label === label)?.color }} />
            {label} ({count})
          </span>
        ))}
      </div>

      <div className="v3d-filter">
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">전체 보기</option>
          {labels.map((l) => <option key={l} value={l}>{l} ({counts.get(l)})</option>)}
        </select>
      </div>

      {selected && (
        <div className="v3d-detail">
          <div className="v3d-detail-head">
            <i className="v3d-dot" style={{ background: selected.color, width: 12, height: 12 }} />
            <div>
              <strong>{selected.label}</strong>
              <small>{Math.round(selected.score * 100)}% 확신도</small>
            </div>
          </div>
          <div className="v3d-detail-grid">
            <span>프레임: {selected.frameIndex + 1}</span>
            <span>시간: {selected.timestamp.toFixed(1)}s</span>
            <span>위치: ({selected.bbox[0].toFixed(0)}, {selected.bbox[1].toFixed(0)})</span>
            <span>크기: {selected.bbox[2].toFixed(0)}x{selected.bbox[3].toFixed(0)}</span>
          </div>
          {frames[selected.frameIndex] && (
            <div className="v3d-preview">
              <img src={frames[selected.frameIndex].imageUrl} alt="" />
              <div className="v3d-bbox" style={{
                left: `${(selected.bbox[0] / frames[selected.frameIndex].imageData.width) * 100}%`,
                top: `${(selected.bbox[1] / frames[selected.frameIndex].imageData.height) * 100}%`,
                width: `${(selected.bbox[2] / frames[selected.frameIndex].imageData.width) * 100}%`,
                height: `${(selected.bbox[3] / frames[selected.frameIndex].imageData.height) * 100}%`,
                borderColor: selected.color,
              }} />
            </div>
          )}
        </div>
      )}

      <div className="v3d-list">
        {filtered.map((obj) => (
          <div key={obj.id}
            className={`v3d-item ${obj.id === selectedId ? 'active' : ''}`}
            onClick={() => onSelect(obj.id === selectedId ? null : obj.id)}
          >
            <div className="v3d-item-top">
              <span className="v3d-item-label">
                <i className="v3d-dot" style={{ background: obj.color }} />
                {obj.label}
                <small>{Math.round(obj.score * 100)}%</small>
              </span>
              <span className="v3d-frame-tag">F{obj.frameIndex + 1}</span>
            </div>

            {editId === obj.id ? (
              <div className="v3d-edit" onClick={(e) => e.stopPropagation()}>
                <textarea value={editText} onChange={(e) => setEditText(e.target.value)} placeholder="설명 입력..." rows={3} autoFocus />
                <div className="v3d-edit-btns">
                  <button className="v3d-btn-save" onClick={() => saveEdit(obj.id)}>저장</button>
                  <button className="v3d-btn-cancel" onClick={() => setEditId(null)}>취소</button>
                </div>
              </div>
            ) : (
              <div className="v3d-desc">
                <p className={obj.description ? '' : 'muted'}>{obj.description || '설명 없음'}</p>
                <button className="v3d-btn-edit" onClick={(e) => { e.stopPropagation(); startEdit(obj); }}>
                  {obj.description ? '수정' : '추가'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
