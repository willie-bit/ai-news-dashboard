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

const ROOM_W = 8;
const ROOM_D = 10;
const WALL_H = 2.2; // Lower walls so you can see inside
const EYE_H = 1.5;

/**
 * Build a composite floor texture from all photos.
 * Takes the bottom portion of each photo and maps it to a
 * wedge on the floor, creating a panoramic top-down view.
 */
function buildFloorTexture(
  images: { url: string; data: ImageData }[],
  numImages: number
): HTMLCanvasElement {
  const size = 2048;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, size, size);

  const angleStep = (Math.PI * 2) / numImages;
  const cx = size / 2;
  const cy = size / 2;

  images.forEach((img, i) => {
    const angle = i * angleStep - Math.PI / 2;
    const { width, height, data } = img.data;

    // Draw the bottom 65% of photo (floor area) into a wedge
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tctx = tempCanvas.getContext('2d')!;
    const imgData = tctx.createImageData(width, height);
    imgData.data.set(data);
    tctx.putImageData(imgData, 0, 0);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    // Draw the bottom portion as a fan/wedge shape
    ctx.beginPath();
    ctx.moveTo(0, 0);
    const fanRadius = size * 0.48;
    const halfAngle = angleStep * 0.55;
    ctx.arc(0, 0, fanRadius, -halfAngle, halfAngle);
    ctx.closePath();
    ctx.clip();

    // Draw photo's bottom half, stretched to fill the wedge
    const cropY = Math.floor(height * 0.35); // top 35% = walls/sky, bottom 65% = floor
    const cropH = height - cropY;
    ctx.drawImage(
      tempCanvas,
      0, cropY, width, cropH,  // source: bottom 65%
      -fanRadius * 0.7, -fanRadius * 0.5, fanRadius * 1.4, fanRadius  // destination
    );

    ctx.restore();
  });

  return canvas;
}

/**
 * Build wall texture strips from photos.
 * Returns data for textured wall planes.
 */
function buildWallSegments(
  images: { url: string; data: ImageData }[],
): { angle: number; imageUrl: string; width: number; height: number }[] {
  return images.map((img, i) => {
    const angle = (i / images.length) * Math.PI * 2;
    // Use the top 60% of the photo for walls
    const { width, height, data } = img.data;
    const c = document.createElement('canvas');
    const cropH = Math.floor(height * 0.6);
    c.width = width;
    c.height = cropH;
    const ctx = c.getContext('2d')!;
    const imgData = ctx.createImageData(width, cropH);
    // Copy top portion
    for (let y = 0; y < cropH; y++) {
      for (let x = 0; x < width; x++) {
        const si = (y * width + x) * 4;
        const di = (y * width + x) * 4;
        imgData.data[di] = data[si];
        imgData.data[di + 1] = data[si + 1];
        imgData.data[di + 2] = data[si + 2];
        imgData.data[di + 3] = data[si + 3];
      }
    }
    ctx.putImageData(imgData, 0, 0);
    return { angle, imageUrl: c.toDataURL('image/jpeg', 0.8), width, height: cropH };
  });
}

/**
 * Generate a sparse colored point cloud for depth/atmosphere.
 * Points are placed on floor and lower walls only (no ceiling).
 */
function buildSparsePointCloud(
  images: { url: string; data: ImageData }[]
): { positions: Float32Array; colors: Float32Array; count: number } {
  const positions: number[] = [];
  const colors: number[] = [];
  const angleStep = (Math.PI * 2) / images.length;
  const halfW = ROOM_W / 2;
  const halfD = ROOM_D / 2;

  images.forEach((img, fi) => {
    const { width, height, data } = img.data;
    const viewAngle = fi * angleStep;
    const cosA = Math.cos(viewAngle), sinA = Math.sin(viewAngle);
    const hfov = Math.PI * 0.35;
    const vfov = hfov * (height / width);

    // Sparser sampling - just for depth effect
    const stepX = Math.max(4, Math.floor(width / 100));
    const stepY = Math.max(4, Math.floor(height / 60));

    for (let py = 0; py < height; py += stepY) {
      for (let px = 0; px < width; px += stepX) {
        const idx = (py * width + px) * 4;
        const r = data[idx] / 255;
        const g = data[idx + 1] / 255;
        const b = data[idx + 2] / 255;

        const ha = (px / width - 0.5) * hfov * 2;
        const va = -(py / height - 0.5) * vfov * 2;
        const lx = Math.tan(ha), ly = Math.tan(va), lz = 1;
        const rl = Math.sqrt(lx * lx + ly * ly + lz * lz);
        const wx = (lx / rl) * cosA + (lz / rl) * sinA;
        const wz = -(lx / rl) * sinA + (lz / rl) * cosA;
        const wy = ly / rl;

        // Floor only (looking down) + low walls
        let tMin = Infinity, hx = 0, hy = 0, hz = 0;

        // Floor
        if (wy < -0.01) {
          const t = -EYE_H / wy;
          if (t > 0.1 && t < tMin) {
            const ix = wx * t, iz = wz * t;
            if (Math.abs(ix) <= halfW && Math.abs(iz) <= halfD) {
              tMin = t; hx = ix; hy = 0; hz = iz;
            }
          }
        }

        // Walls up to WALL_H only (no ceiling)
        const wallChecks: [number, number, (ix: number, iy: number, iz: number) => boolean][] = [
          [halfW, wx, (_, iy, iz) => iy >= 0 && iy <= WALL_H && Math.abs(iz) <= halfD],
          [-halfW, wx, (_, iy, iz) => iy >= 0 && iy <= WALL_H && Math.abs(iz) <= halfD],
          [halfD, wz, (ix, iy, _) => Math.abs(ix) <= halfW && iy >= 0 && iy <= WALL_H],
          [-halfD, wz, (ix, iy, _) => Math.abs(ix) <= halfW && iy >= 0 && iy <= WALL_H],
        ];

        for (const [boundary, rayComp, check] of wallChecks) {
          if (Math.abs(rayComp) > 0.01) {
            const t = boundary / rayComp;
            if (t > 0.1 && t < tMin) {
              const ix = wx * t, iy = EYE_H + wy * t, iz = wz * t;
              if (check(ix, iy, iz)) {
                tMin = t; hx = ix; hy = iy; hz = iz;
              }
            }
          }
        }

        if (tMin < Infinity) {
          // Depth relief for objects on the floor
          const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
          const relief = hy < 0.1 ? brightness * 0.3 : 0; // Only on floor
          positions.push(hx, hy + relief, hz);
          colors.push(r, g, b);
        }
      }
    }
  });

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    count: positions.length / 3,
  };
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

  const angleStep = (Math.PI * 2) / images.length;

  const waypoints: Waypoint[] = images.map((_, i) => {
    const angle = i * angleStep;
    return {
      position: { x: 0, y: EYE_H, z: 0 },
      lookAt: { x: Math.sin(angle) * 5, y: EYE_H * 0.8, z: Math.cos(angle) * 5 },
      viewpointIndex: i,
    };
  });

  const viewpoints: ViewpointData[] = [];
  const allObjects: DetectedObject[] = [];
  let objId = 0;
  const canvas = document.createElement('canvas');

  for (let i = 0; i < images.length; i++) {
    const pct = 5 + (i / images.length) * 50;
    onProgress?.(`뷰포인트 ${i + 1}/${images.length} 객체 인식 중...`, pct);

    const { url, data: imageData } = images[i];
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext('2d')!.putImageData(imageData, 0, 0);
    const predictions = await det.detect(canvas);

    const viewAngle = i * angleStep;
    const cosA = Math.cos(viewAngle), sinA = Math.sin(viewAngle);
    const hfov = Math.PI * 0.35;

    const objects: DetectedObject[] = predictions
      .filter((p) => p.score >= 0.35)
      .map((p) => {
        const [bx, by, bw, bh] = p.bbox;
        const cx = (bx + bw / 2) / imageData.width;
        const cy = (by + bh / 2) / imageData.height;
        const ha = (cx - 0.5) * hfov * 2;
        const depth = 2 + cy * 3;
        const wx = Math.tan(ha) * cosA + sinA;
        const wz = -Math.tan(ha) * sinA + cosA;
        return {
          id: `obj-${objId++}`, label: p.class, score: p.score,
          bbox: p.bbox as [number, number, number, number],
          viewpointIndex: i, description: '',
          color: COLORS[p.class] || COLORS.default,
          position3D: {
            x: Math.max(-ROOM_W / 2, Math.min(ROOM_W / 2, wx * depth * 0.5)),
            y: Math.max(0, (0.5 - cy) * 2),
            z: Math.max(-ROOM_D / 2, Math.min(ROOM_D / 2, wz * depth * 0.5)),
          },
        };
      });

    viewpoints.push({ index: i, imageUrl: url, imageData, objects });
    allObjects.push(...objects);
  }

  // Build floor texture
  onProgress?.('바닥 텍스처 생성 중...', 65);
  const floorCanvas = buildFloorTexture(images, images.length);
  const floorTextureUrl = floorCanvas.toDataURL('image/jpeg', 0.9);

  // Build wall segments
  onProgress?.('벽면 텍스처 생성 중...', 75);
  const wallSegments = buildWallSegments(images);

  // Build sparse point cloud for depth
  onProgress?.('포인트 클라우드 생성 중...', 85);
  const pointCloud = buildSparsePointCloud(images);

  onProgress?.('3D 공간 구축 완료!', 100);

  // Store floor and wall textures in the first viewpoint's data for access in viewer
  // (we'll pass them via a workaround since we can't change the type easily)
  (viewpoints as any).__floorTextureUrl = floorTextureUrl;
  (viewpoints as any).__wallSegments = wallSegments;

  return {
    viewpoints,
    allObjects,
    pointCloud,
    waypoints,
    imageWidth: images[0]?.data.width || 0,
    imageHeight: images[0]?.data.height || 0,
  };
}
