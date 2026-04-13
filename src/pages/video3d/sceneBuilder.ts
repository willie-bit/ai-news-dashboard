import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import { DetectedObject, ViewpointData, SceneAnalysis, Waypoint } from './types';

let model: cocoSsd.ObjectDetection | null = null;

const COLORS: Record<string, string> = {
  person: '#ef4444', car: '#3b82f6', truck: '#6366f1', bus: '#8b5cf6',
  bicycle: '#06b6d4', motorcycle: '#14b8a6', dog: '#f59e0b', cat: '#ec4899',
  bird: '#84cc16', chair: '#f97316', couch: '#a855f7', 'potted plant': '#22c55e',
  tv: '#0ea5e9', laptop: '#6366f1', 'cell phone': '#d946ef', book: '#eab308',
  bottle: '#64748b', cup: '#78716c', default: '#94a3b8',
};

async function loadModel(onProgress?: (msg: string) => void) {
  if (model) return model;
  onProgress?.('TensorFlow.js 초기화 중...');
  await tf.ready();
  onProgress?.('AI 객체 인식 모델 로딩 중...');
  model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
  return model;
}

// ─── Photo Analysis ───────────────────────────────────────────

/**
 * Compare a vertical strip of photo A (right edge) with photo B (left edge).
 * Returns similarity score 0~1. Higher = more similar = more overlap.
 */
function edgeSimilarity(a: ImageData, b: ImageData): number {
  const stripFrac = 0.12;
  const sampleStep = 4; // sample every 4th pixel for speed
  const wA = a.width, hA = a.height;
  const wB = b.width, hB = b.height;
  const stripA = Math.floor(wA * stripFrac);
  const stripB = Math.floor(wB * stripFrac);
  const h = Math.min(hA, hB);

  let totalDiff = 0;
  let count = 0;

  for (let y = 0; y < h; y += sampleStep) {
    for (let dx = 0; dx < Math.min(stripA, stripB); dx += sampleStep) {
      const xA = wA - stripA + dx;
      const xB = dx;
      const iA = (y * wA + xA) * 4;
      const iB = (y * wB + xB) * 4;

      const dr = a.data[iA] - b.data[iB];
      const dg = a.data[iA + 1] - b.data[iB + 1];
      const db = a.data[iA + 2] - b.data[iB + 2];
      totalDiff += Math.sqrt(dr * dr + dg * dg + db * db);
      count++;
    }
  }

  // Normalize: 0 = identical, 441 = max diff (sqrt(255²*3))
  const avgDiff = count > 0 ? totalDiff / count : 441;
  return Math.max(0, 1 - avgDiff / 200); // 0~1
}

/**
 * Find the best circular ordering of photos by maximizing
 * edge similarity between consecutive pairs (greedy).
 */
function findBestOrder(images: ImageData[]): number[] {
  const n = images.length;
  if (n <= 2) return images.map((_, i) => i);

  // Compute pairwise similarity (right edge of i → left edge of j)
  const sim: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j) sim[i][j] = edgeSimilarity(images[i], images[j]);
    }
  }

  // Greedy: start from 0, always pick the most similar next
  const used = new Set([0]);
  const order = [0];
  for (let step = 1; step < n; step++) {
    const last = order[order.length - 1];
    let bestJ = -1, bestS = -1;
    for (let j = 0; j < n; j++) {
      if (!used.has(j) && sim[last][j] > bestS) {
        bestS = sim[last][j];
        bestJ = j;
      }
    }
    order.push(bestJ);
    used.add(bestJ);
  }
  return order;
}

/**
 * Compute per-pair overlap ratio based on edge similarity.
 * Higher similarity → more overlap for smoother blending.
 */
function computeOverlaps(images: ImageData[], order: number[]): number[] {
  const overlaps: number[] = [];
  for (let i = 0; i < order.length; i++) {
    const next = (i + 1) % order.length;
    const sim = edgeSimilarity(images[order[i]], images[order[next]]);
    // More similar = more overlap (0.15 ~ 0.40)
    overlaps.push(0.15 + sim * 0.25);
  }
  return overlaps;
}

// ─── Panorama Construction ────────────────────────────────────

/**
 * Stitch photos into an equirectangular panorama (2:1 ratio).
 * Covers full 360° horizontally and ~150° vertically (walls + floor + partial ceiling).
 * Uses adaptive overlap and multi-pass alpha blending.
 */
function buildEquirectangular(
  images: { data: ImageData }[],
  order: number[],
  overlaps: number[]
): HTMLCanvasElement {
  const panoW = 4096;
  const panoH = 2048;
  const c = document.createElement('canvas');
  c.width = panoW;
  c.height = panoH;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, panoW, panoH);

  const n = order.length;
  // Calculate horizontal positions with variable overlap
  const totalWeight = overlaps.reduce((s, o) => s + (1 - o), 0);
  let xPos = 0;

  for (let idx = 0; idx < n; idx++) {
    const imgIdx = order[idx];
    const img = images[imgIdx].data;
    const overlap = overlaps[idx];
    const sliceW = ((1 - overlap) / totalWeight) * panoW;

    // Create temp canvas for this photo
    const tmp = document.createElement('canvas');
    tmp.width = img.width;
    tmp.height = img.height;
    tmp.getContext('2d')!.putImageData(img, 0, 0);

    // Create masked version with feathered edges
    const masked = document.createElement('canvas');
    const drawW = sliceW + sliceW * overlap * 2; // wider to include blend zones
    masked.width = Math.ceil(drawW);
    masked.height = panoH;
    const mc = masked.getContext('2d')!;

    // Draw photo stretched to fill
    mc.drawImage(tmp, 0, 0, masked.width, panoH);

    // Apply alpha gradient at edges
    mc.globalCompositeOperation = 'destination-in';
    const grad = mc.createLinearGradient(0, 0, masked.width, 0);
    const fadeZone = overlap * 0.8;
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(Math.min(fadeZone, 0.3), 'rgba(255,255,255,1)');
    grad.addColorStop(Math.max(1 - fadeZone, 0.7), 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    mc.fillStyle = grad;
    mc.fillRect(0, 0, masked.width, panoH);

    // Also fade top/bottom for natural ceiling/floor transition
    mc.globalCompositeOperation = 'destination-in';
    const vGrad = mc.createLinearGradient(0, 0, 0, panoH);
    vGrad.addColorStop(0, 'rgba(255,255,255,0.3)'); // slight ceiling
    vGrad.addColorStop(0.15, 'rgba(255,255,255,1)');
    vGrad.addColorStop(0.85, 'rgba(255,255,255,1)');
    vGrad.addColorStop(1, 'rgba(255,255,255,0.5)'); // floor fades
    mc.fillStyle = vGrad;
    mc.fillRect(0, 0, masked.width, panoH);

    // Draw onto panorama
    const drawX = xPos - sliceW * overlap;
    ctx.drawImage(masked, drawX, 0);

    // Also wrap around for seamless 360°
    if (drawX < 0) ctx.drawImage(masked, drawX + panoW, 0);
    if (drawX + masked.width > panoW) ctx.drawImage(masked, drawX - panoW, 0);

    xPos += sliceW;
  }

  return c;
}

// ─── Main Build ───────────────────────────────────────────────

export async function buildScene(
  images: { url: string; data: ImageData }[],
  onProgress?: (msg: string, pct: number) => void
): Promise<SceneAnalysis> {
  if (images.length === 0) throw new Error('이미지가 없습니다.');

  let det: cocoSsd.ObjectDetection;
  try {
    det = await loadModel((msg) => onProgress?.(msg, 0));
  } catch (err) {
    throw new Error(`AI 모델 로딩 실패: ${err instanceof Error ? err.message : String(err)}`);
  }

  const n = images.length;

  // Step 1: Analyze photo relationships
  onProgress?.('사진 관계 분석 중...', 5);
  const imageDataArr = images.map((i) => i.data);
  const order = findBestOrder(imageDataArr);
  const overlaps = computeOverlaps(imageDataArr, order);
  const avgOverlap = overlaps.reduce((s, o) => s + o, 0) / overlaps.length;
  onProgress?.(`사진 정렬 완료 (평균 겹침: ${Math.round(avgOverlap * 100)}%)`, 15);

  // Step 2: Object detection
  const viewpoints: ViewpointData[] = [];
  const allObjects: DetectedObject[] = [];
  let objId = 0;
  const canvas = document.createElement('canvas');

  for (let idx = 0; idx < n; idx++) {
    const i = order[idx];
    onProgress?.(`뷰포인트 ${idx + 1}/${n} 객체 인식 중...`, 15 + (idx / n) * 35);

    const { url, data: imgData } = images[i];
    canvas.width = imgData.width;
    canvas.height = imgData.height;
    canvas.getContext('2d')!.putImageData(imgData, 0, 0);
    const preds = await det.detect(canvas);

    const angle = (idx / n) * Math.PI * 2;
    const radius = 3.5;

    const objects: DetectedObject[] = preds.filter((p) => p.score >= 0.35).map((p) => {
      const [bx, by, bw, bh] = p.bbox;
      const cx = (bx + bw / 2) / imgData.width;
      const cy = (by + bh / 2) / imgData.height;
      const objAngle = angle + (cx - 0.5) * (Math.PI * 2 / n);
      const r = radius * (0.5 + cy * 0.5);
      return {
        id: `obj-${objId++}`, label: p.class, score: p.score,
        bbox: p.bbox as [number, number, number, number],
        viewpointIndex: idx, description: '',
        color: COLORS[p.class] || COLORS.default,
        position3D: {
          x: Math.sin(objAngle) * r,
          y: (0.5 - cy) * 3 + 1.5,
          z: Math.cos(objAngle) * r,
        },
      };
    });

    viewpoints.push({ index: idx, imageUrl: url, imageData: imgData, objects });
    allObjects.push(...objects);
  }

  // Step 3: Build equirectangular panorama
  onProgress?.('파노라마 구축 중 (스티칭 + 블렌딩)...', 55);
  const panoCanvas = buildEquirectangular(images, order, overlaps);
  const panoUrl = panoCanvas.toDataURL('image/jpeg', 0.9);

  // Waypoints based on analyzed order
  const waypoints: Waypoint[] = order.map((origIdx, idx) => {
    const angle = (idx / n) * Math.PI * 2;
    return {
      position: { x: 0, y: 1.5, z: 0 },
      lookAt: { x: Math.sin(angle) * 5, y: 1.2, z: Math.cos(angle) * 5 },
      viewpointIndex: idx,
    };
  });

  // Store panorama URL
  (viewpoints as any).__panoUrl = panoUrl;
  (viewpoints as any).__order = order;
  (viewpoints as any).__overlaps = overlaps;

  onProgress?.('완료!', 100);

  return {
    viewpoints, allObjects,
    pointCloud: { positions: new Float32Array(0), colors: new Float32Array(0), count: 0 },
    waypoints,
    imageWidth: images[0]?.data.width || 0,
    imageHeight: images[0]?.data.height || 0,
  };
}
