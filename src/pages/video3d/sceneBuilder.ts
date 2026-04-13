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
  onProgress?.('모델 준비 완료');
  return model;
}

/**
 * Build waypoints with TIGHT spacing so point clouds overlap heavily.
 */
function buildWaypoints(numPoints: number): Waypoint[] {
  const waypoints: Waypoint[] = [];
  const spacing = 1.2; // TIGHT spacing for heavy overlap

  for (let i = 0; i < numPoints; i++) {
    const t = numPoints > 1 ? i / (numPoints - 1) : 0.5;
    const angle = (t - 0.5) * 0.5;
    const x = Math.sin(angle) * spacing * numPoints * 0.1;
    const z = -t * spacing * (numPoints - 1);

    const nextT = Math.min(t + 0.15, 1);
    const nextAngle = (nextT - 0.5) * 0.5;
    const lx = Math.sin(nextAngle) * spacing * numPoints * 0.1;
    const lz = -nextT * spacing * (numPoints - 1) - 1.5;

    waypoints.push({
      position: { x, y: 0, z },
      lookAt: { x: lx, y: 0, z: lz },
      viewpointIndex: i,
    });
  }
  return waypoints;
}

/**
 * Project image pixels into 3D with COMPACT depth (not spread out).
 * Creates a dense, room-like structure instead of a fan shape.
 */
function projectImageToPointCloud(
  imageData: ImageData,
  waypoint: Waypoint
): { positions: number[]; colors: number[] } {
  const { width, height, data } = imageData;
  const aspect = height / width;
  const positions: number[] = [];
  const colors: number[] = [];
  const fov = 0.55;

  const cam = waypoint.position;
  const look = waypoint.lookAt;

  const dx = look.x - cam.x, dz = look.z - cam.z;
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  const fwdX = dx / len, fwdZ = dz / len;
  const rX = fwdZ, rZ = -fwdX;

  // MUCH denser sampling
  const stepX = Math.max(1, Math.floor(width / 280));
  const stepY = Math.max(1, Math.floor(height / 160));

  for (let py = 0; py < height; py += stepY) {
    for (let px = 0; px < width; px += stepX) {
      const idx = (py * width + px) * 4;
      const r = data[idx] / 255;
      const g = data[idx + 1] / 255;
      const b = data[idx + 2] / 255;

      const sx = (px / width - 0.5) * 2;
      const sy = -(py / height - 0.5) * 2 * aspect;

      // COMPACT depth: narrow range (1.5 ~ 3.5) instead of (1.8 ~ 7.3)
      const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
      const vertDepth = (py / height);
      const depth = 1.5 + vertDepth * 1.5 + brightness * 0.5;

      const wx = cam.x + fwdX * depth + rX * sx * depth * fov;
      const wy = cam.y + sy * depth * fov;
      const wz = cam.z + fwdZ * depth + rZ * sx * depth * fov;

      positions.push(wx, wy, wz);
      colors.push(r, g, b);
    }
  }

  return { positions, colors };
}

function captureFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  timestamp: number
): Promise<{ imageData: ImageData; imageUrl: string }> {
  return new Promise((resolve) => {
    video.currentTime = timestamp;
    video.addEventListener('seeked', () => {
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      resolve({
        imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
        imageUrl: canvas.toDataURL('image/jpeg', 0.85),
      });
    }, { once: true });
  });
}

export async function buildScene(
  images: { url: string; data: ImageData }[],
  onProgress?: (msg: string, pct: number) => void
): Promise<SceneAnalysis> {
  const det = await loadModel((msg) => onProgress?.(msg, 0));

  const waypoints = buildWaypoints(images.length);
  const viewpoints: ViewpointData[] = [];
  const allObjects: DetectedObject[] = [];
  const allPos: number[] = [];
  const allCol: number[] = [];
  let objId = 0;

  const canvas = document.createElement('canvas');

  for (let i = 0; i < images.length; i++) {
    const pct = 5 + (i / images.length) * 80;
    onProgress?.(`뷰포인트 ${i + 1}/${images.length} 처리 중...`, pct);

    const { url, data: imageData } = images[i];
    const wp = waypoints[i];

    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(imageData, 0, 0);
    const predictions = await det.detect(canvas);

    const fov = 0.55;
    const objects: DetectedObject[] = predictions
      .filter((p) => p.score >= 0.35)
      .map((p) => {
        const [bx, by, bw, bh] = p.bbox;
        const cx = (bx + bw / 2) / imageData.width;
        const cy = (by + bh / 2) / imageData.height;
        const sx = (cx - 0.5) * 2;
        const sy = -(cy - 0.5) * 2 * (imageData.height / imageData.width);
        const brightness = 0.5;
        const depth = 1.5 + cy * 1.5 + brightness * 0.5;

        const dx = wp.lookAt.x - wp.position.x, dz = wp.lookAt.z - wp.position.z;
        const len = Math.sqrt(dx * dx + dz * dz) || 1;
        const fwdX = dx / len, fwdZ = dz / len;
        const rX = fwdZ;

        return {
          id: `obj-${objId++}`,
          label: p.class,
          score: p.score,
          bbox: p.bbox as [number, number, number, number],
          viewpointIndex: i,
          description: '',
          color: COLORS[p.class] || COLORS.default,
          position3D: {
            x: wp.position.x + fwdX * depth + rX * sx * depth * fov,
            y: wp.position.y + sy * depth * fov,
            z: wp.position.z + fwdZ * depth,
          },
        };
      });

    viewpoints.push({ index: i, imageUrl: url, imageData, objects });
    allObjects.push(...objects);

    onProgress?.(`뷰포인트 ${i + 1}/${images.length} 포인트 클라우드...`, pct + 3);
    const { positions, colors } = projectImageToPointCloud(imageData, wp);
    allPos.push(...positions);
    allCol.push(...colors);
  }

  onProgress?.('3D 공간 구축 완료!', 100);

  return {
    viewpoints,
    allObjects,
    pointCloud: {
      positions: new Float32Array(allPos),
      colors: new Float32Array(allCol),
      count: allPos.length / 3,
    },
    waypoints,
    imageWidth: images[0]?.data.width || 0,
    imageHeight: images[0]?.data.height || 0,
  };
}
