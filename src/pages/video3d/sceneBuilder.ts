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

// Room dimensions
const ROOM_W = 8;   // width (X)
const ROOM_D = 10;  // depth (Z)
const ROOM_H = 3.5; // height (Y)
const EYE_H = 1.6;  // camera eye height

/**
 * Project image pixels onto room surfaces (floor, walls, ceiling)
 * using ray-box intersection. Creates a cohesive room-shaped point cloud.
 */
function projectToRoom(
  imageData: ImageData,
  viewAngle: number, // radians: direction this photo looks toward
): { positions: number[]; colors: number[] } {
  const { width, height, data } = imageData;
  const positions: number[] = [];
  const colors: number[] = [];

  const hfov = Math.PI * 0.38;
  const vfov = hfov * (height / width);

  const cosA = Math.cos(viewAngle);
  const sinA = Math.sin(viewAngle);

  const stepX = Math.max(2, Math.floor(width / 220));
  const stepY = Math.max(2, Math.floor(height / 130));

  const halfW = ROOM_W / 2;
  const halfD = ROOM_D / 2;

  for (let py = 0; py < height; py += stepY) {
    for (let px = 0; px < width; px += stepX) {
      const idx = (py * width + px) * 4;
      const r = data[idx] / 255;
      const g = data[idx + 1] / 255;
      const b = data[idx + 2] / 255;

      // Pixel → ray angles
      const ha = (px / width - 0.5) * hfov * 2;
      const va = -(py / height - 0.5) * vfov * 2;

      // Local ray direction (looking along +Z in camera space)
      const lx = Math.tan(ha);
      const ly = Math.tan(va);
      const lz = 1.0;
      const rLen = Math.sqrt(lx * lx + ly * ly + lz * lz);
      const nlx = lx / rLen, nly = ly / rLen, nlz = lz / rLen;

      // Rotate by viewAngle around Y
      const wx = nlx * cosA + nlz * sinA;
      const wz = -nlx * sinA + nlz * cosA;
      const wy = nly;

      // Ray from (0, EYE_H, 0) in direction (wx, wy, wz)
      // Find closest intersection with room box surfaces
      let tMin = Infinity;
      let hx = 0, hy = 0, hz = 0;

      // Floor (y = 0)
      if (wy < -0.001) {
        const t = -EYE_H / wy;
        if (t > 0.1 && t < tMin) {
          const ix = wx * t, iz = wz * t;
          if (Math.abs(ix) <= halfW && Math.abs(iz) <= halfD) {
            tMin = t; hx = ix; hy = 0; hz = iz;
          }
        }
      }

      // Ceiling (y = ROOM_H)
      if (wy > 0.001) {
        const t = (ROOM_H - EYE_H) / wy;
        if (t > 0.1 && t < tMin) {
          const ix = wx * t, iz = wz * t;
          if (Math.abs(ix) <= halfW && Math.abs(iz) <= halfD) {
            tMin = t; hx = ix; hy = ROOM_H; hz = iz;
          }
        }
      }

      // +X wall
      if (wx > 0.001) {
        const t = halfW / wx;
        if (t > 0.1 && t < tMin) {
          const iy = EYE_H + wy * t, iz = wz * t;
          if (iy >= 0 && iy <= ROOM_H && Math.abs(iz) <= halfD) {
            tMin = t; hx = halfW; hy = iy; hz = iz;
          }
        }
      }
      // -X wall
      if (wx < -0.001) {
        const t = -halfW / wx;
        if (t > 0.1 && t < tMin) {
          const iy = EYE_H + wy * t, iz = wz * t;
          if (iy >= 0 && iy <= ROOM_H && Math.abs(iz) <= halfD) {
            tMin = t; hx = -halfW; hy = iy; hz = iz;
          }
        }
      }
      // +Z wall
      if (wz > 0.001) {
        const t = halfD / wz;
        if (t > 0.1 && t < tMin) {
          const ix = wx * t, iy = EYE_H + wy * t;
          if (Math.abs(ix) <= halfW && iy >= 0 && iy <= ROOM_H) {
            tMin = t; hx = ix; hy = iy; hz = halfD;
          }
        }
      }
      // -Z wall
      if (wz < -0.001) {
        const t = -halfD / wz;
        if (t > 0.1 && t < tMin) {
          const ix = wx * t, iy = EYE_H + wy * t;
          if (Math.abs(ix) <= halfW && iy >= 0 && iy <= ROOM_H) {
            tMin = t; hx = ix; hy = iy; hz = -halfD;
          }
        }
      }

      if (tMin < Infinity) {
        // Add slight depth relief: brighter areas pull inward (furniture sticks up)
        const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
        const relief = brightness * 0.15; // subtle depth
        const pullX = -wx * relief;
        const pullY = hy > 0.1 && hy < ROOM_H - 0.1 ? 0 : (hy < 0.1 ? relief * 0.5 : -relief * 0.3);
        const pullZ = -wz * relief;

        positions.push(hx + pullX, hy + pullY, hz + pullZ);
        colors.push(r, g, b);
      }
    }
  }

  return { positions, colors };
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

  // Distribute view angles evenly around 360°
  const angleStep = (Math.PI * 2) / images.length;

  // Waypoints: all at center, looking outward in different directions
  const waypoints: Waypoint[] = images.map((_, i) => {
    const angle = i * angleStep;
    return {
      position: { x: 0, y: EYE_H, z: 0 },
      lookAt: { x: Math.sin(angle) * 5, y: EYE_H, z: Math.cos(angle) * 5 },
      viewpointIndex: i,
    };
  });

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
    const viewAngle = i * angleStep;

    // Object detection
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext('2d')!.putImageData(imageData, 0, 0);
    const predictions = await det.detect(canvas);

    const cosA = Math.cos(viewAngle), sinA = Math.sin(viewAngle);
    const hfov = Math.PI * 0.38;
    const vfov = hfov * (imageData.height / imageData.width);

    const objects: DetectedObject[] = predictions
      .filter((p) => p.score >= 0.35)
      .map((p) => {
        const [bx, by, bw, bh] = p.bbox;
        const cx = (bx + bw / 2) / imageData.width;
        const cy = (by + bh / 2) / imageData.height;
        const ha = (cx - 0.5) * hfov * 2;
        const va = -(cy - 0.5) * vfov * 2;
        const lx = Math.tan(ha), ly = Math.tan(va);
        const rl = Math.sqrt(lx * lx + ly * ly + 1);
        const wx = (lx / rl) * cosA + (1 / rl) * sinA;
        const wz = -(lx / rl) * sinA + (1 / rl) * cosA;
        const wy = ly / rl;
        const depth = wy < -0.01 ? -EYE_H / wy : 3;

        return {
          id: `obj-${objId++}`,
          label: p.class,
          score: p.score,
          bbox: p.bbox as [number, number, number, number],
          viewpointIndex: i,
          description: '',
          color: COLORS[p.class] || COLORS.default,
          position3D: {
            x: Math.max(-ROOM_W / 2, Math.min(ROOM_W / 2, wx * depth)),
            y: Math.max(0, Math.min(ROOM_H, EYE_H + wy * depth)),
            z: Math.max(-ROOM_D / 2, Math.min(ROOM_D / 2, wz * depth)),
          },
        };
      });

    viewpoints.push({ index: i, imageUrl: url, imageData, objects });
    allObjects.push(...objects);

    // Project onto room surfaces
    onProgress?.(`뷰포인트 ${i + 1}/${images.length} 공간 투영 중...`, pct + 3);
    const { positions, colors } = projectToRoom(imageData, viewAngle);
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
