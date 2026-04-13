import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import { DetectedObject, ViewpointData, SceneAnalysis, UnifiedPointCloud, Waypoint } from './types';

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

/**
 * Stitch all photos into one seamless panorama with edge blending.
 * Each photo overlaps ~25% with its neighbor, alpha feathering in overlap zone.
 */
function stitchPanorama(images: { data: ImageData }[]): HTMLCanvasElement {
  const imgW = images[0].data.width;
  const imgH = images[0].data.height;
  const overlapFrac = 0.25;
  const overlapPx = Math.floor(imgW * overlapFrac);
  const step = imgW - overlapPx;
  const totalW = step * images.length + overlapPx; // wraps around

  const canvas = document.createElement('canvas');
  canvas.width = totalW;
  canvas.height = imgH;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, totalW, imgH);

  images.forEach((img, i) => {
    const tmp = document.createElement('canvas');
    tmp.width = imgW;
    tmp.height = imgH;
    const tc = tmp.getContext('2d')!;
    tc.putImageData(img.data, 0, 0);

    // Create alpha-masked version with feathered edges
    const masked = document.createElement('canvas');
    masked.width = imgW;
    masked.height = imgH;
    const mc = masked.getContext('2d')!;

    // Gradient mask: fade in left edge, fade out right edge
    const grad = mc.createLinearGradient(0, 0, imgW, 0);
    const fadeIn = i > 0 ? overlapFrac : 0;
    const fadeOut = i < images.length - 1 ? 1 - overlapFrac : 1;

    grad.addColorStop(0, i > 0 ? 'rgba(255,255,255,0)' : 'rgba(255,255,255,1)');
    if (fadeIn > 0) grad.addColorStop(fadeIn, 'rgba(255,255,255,1)');
    if (fadeOut < 1) grad.addColorStop(fadeOut, 'rgba(255,255,255,1)');
    grad.addColorStop(1, i < images.length - 1 ? 'rgba(255,255,255,0)' : 'rgba(255,255,255,1)');

    mc.fillStyle = grad;
    mc.fillRect(0, 0, imgW, imgH);
    mc.globalCompositeOperation = 'source-in';
    mc.drawImage(tmp, 0, 0);

    ctx.drawImage(masked, i * step, 0);
  });

  return canvas;
}

/**
 * Build floor texture from the bottom portions of all photos,
 * arranged as a radial panoramic composite.
 */
function buildFloorTexture(images: { data: ImageData }[]): HTMLCanvasElement {
  const size = 2048;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, size, size);

  const n = images.length;
  const angleStep = (Math.PI * 2) / n;

  images.forEach((img, i) => {
    const { width, height, data } = img.data;
    const tmp = document.createElement('canvas');
    tmp.width = width;
    tmp.height = height;
    tmp.getContext('2d')!.putImageData(img.data, 0, 0);

    const angle = i * angleStep - Math.PI / 2;
    const fan = size * 0.48;

    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(angle);

    // Clip to fan wedge
    ctx.beginPath();
    ctx.moveTo(0, 0);
    const half = angleStep * 0.55;
    ctx.arc(0, 0, fan, -half, half);
    ctx.closePath();
    ctx.clip();

    // Draw bottom 60% of photo (floor area)
    const cropY = Math.floor(height * 0.4);
    ctx.drawImage(tmp, 0, cropY, width, height - cropY, -fan * 0.7, -fan * 0.5, fan * 1.4, fan);
    ctx.restore();
  });

  return c;
}

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

  // Object detection
  const viewpoints: ViewpointData[] = [];
  const allObjects: DetectedObject[] = [];
  let objId = 0;
  const canvas = document.createElement('canvas');
  const n = images.length;
  const angleStep = (Math.PI * 2) / n;

  for (let i = 0; i < n; i++) {
    onProgress?.(`뷰포인트 ${i + 1}/${n} 객체 인식 중...`, 5 + (i / n) * 40);
    const { url, data: imgData } = images[i];
    canvas.width = imgData.width;
    canvas.height = imgData.height;
    canvas.getContext('2d')!.putImageData(imgData, 0, 0);

    const preds = await det.detect(canvas);
    const angle = i * angleStep;
    const radius = 3.5;

    const objects: DetectedObject[] = preds.filter((p) => p.score >= 0.35).map((p) => {
      const [bx, by, bw, bh] = p.bbox;
      const cx = (bx + bw / 2) / imgData.width;
      const cy = (by + bh / 2) / imgData.height;
      // Position object in the room at the wall it's seen on
      const objAngle = angle + (cx - 0.5) * 0.7;
      const objR = radius * 0.9;
      return {
        id: `obj-${objId++}`, label: p.class, score: p.score,
        bbox: p.bbox as [number, number, number, number],
        viewpointIndex: i, description: '',
        color: COLORS[p.class] || COLORS.default,
        position3D: {
          x: Math.sin(objAngle) * objR,
          y: (0.5 - cy) * 2.5 + 1,
          z: Math.cos(objAngle) * objR,
        },
      };
    });

    viewpoints.push({ index: i, imageUrl: url, imageData: imgData, objects });
    allObjects.push(...objects);
  }

  // Stitch panorama
  onProgress?.('파노라마 스티칭 중...', 55);
  const panoramaCanvas = stitchPanorama(images);
  const panoramaUrl = panoramaCanvas.toDataURL('image/jpeg', 0.85);

  // Build floor
  onProgress?.('바닥 텍스처 생성 중...', 70);
  const floorCanvas = buildFloorTexture(images);
  const floorUrl = floorCanvas.toDataURL('image/jpeg', 0.85);

  // Waypoints
  const waypoints: Waypoint[] = images.map((_, i) => {
    const a = i * angleStep;
    return {
      position: { x: 0, y: 1.5, z: 0 },
      lookAt: { x: Math.sin(a) * 5, y: 1.2, z: Math.cos(a) * 5 },
      viewpointIndex: i,
    };
  });

  // Store texture URLs
  (viewpoints as any).__panoramaUrl = panoramaUrl;
  (viewpoints as any).__floorUrl = floorUrl;

  onProgress?.('완료!', 100);

  return {
    viewpoints, allObjects,
    pointCloud: { positions: new Float32Array(0), colors: new Float32Array(0), count: 0 },
    waypoints,
    imageWidth: images[0]?.data.width || 0,
    imageHeight: images[0]?.data.height || 0,
  };
}
