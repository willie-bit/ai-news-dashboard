import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import { DetectedObject, FrameData, VideoAnalysis, UnifiedPointCloud, CameraWaypoint } from './types';

let model: cocoSsd.ObjectDetection | null = null;

const OBJECT_COLORS: Record<string, string> = {
  person: '#ef4444', car: '#3b82f6', truck: '#6366f1', bus: '#8b5cf6',
  bicycle: '#06b6d4', motorcycle: '#14b8a6', dog: '#f59e0b', cat: '#ec4899',
  bird: '#84cc16', chair: '#f97316', couch: '#a855f7', 'potted plant': '#22c55e',
  tv: '#0ea5e9', laptop: '#6366f1', 'cell phone': '#d946ef', book: '#eab308',
  bottle: '#64748b', cup: '#78716c', default: '#94a3b8',
};

function getObjectColor(label: string): string {
  return OBJECT_COLORS[label] || OBJECT_COLORS.default;
}

export async function loadModel(onProgress?: (msg: string) => void): Promise<cocoSsd.ObjectDetection> {
  if (model) return model;
  onProgress?.('TensorFlow.js 백엔드 초기화 중...');
  await tf.ready();
  onProgress?.('COCO-SSD 객체 인식 모델 로딩 중...');
  try {
    model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
  } catch (err) {
    throw new Error(`모델 로딩 실패: ${err instanceof Error ? err.message : String(err)}`);
  }
  onProgress?.('모델 로딩 완료!');
  return model;
}

/**
 * Build a unified 3D point cloud from all frames.
 * Simulates camera moving along a path; each frame's pixels
 * are projected into a shared 3D space via pseudo-depth estimation.
 */
function buildUnifiedPointCloud(
  frames: FrameData[],
  videoWidth: number,
  videoHeight: number
): { pointCloud: UnifiedPointCloud; cameraPath: CameraWaypoint[] } {
  const numFrames = frames.length;
  const aspect = videoHeight / videoWidth;
  const fov = 0.6; // field of view factor

  // Camera moves along a gentle forward path with slight arc
  const pathLength = numFrames * 2;
  const cameraPath: CameraWaypoint[] = [];

  for (let i = 0; i < numFrames; i++) {
    const t = i / Math.max(numFrames - 1, 1);
    // Gentle forward + slight horizontal sweep
    const angle = (t - 0.5) * 0.4; // slight arc
    const cx = Math.sin(angle) * pathLength * 0.3;
    const cy = 0;
    const cz = -t * pathLength;

    // Look direction: forward with slight inward turn
    const lx = -Math.sin(angle) * 2;
    const ly = 0;
    const lz = cz - 3;

    cameraPath.push({
      position: { x: cx, y: cy, z: cz },
      lookAt: { x: cx + lx, y: ly, z: lz },
      frameIndex: i,
    });
  }

  // Collect all points
  const allPos: number[] = [];
  const allCol: number[] = [];

  frames.forEach((frame, fi) => {
    const { imageData } = frame;
    const { width, height, data } = imageData;
    const cam = cameraPath[fi];

    // Camera basis vectors
    const dx = cam.lookAt.x - cam.position.x;
    const dy = cam.lookAt.y - cam.position.y;
    const dz = cam.lookAt.z - cam.position.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const fwdX = dx / len, fwdY = dy / len, fwdZ = dz / len;

    // Right = forward x up(0,1,0)
    const rightX = fwdZ, rightZ = -fwdX;
    const rightLen = Math.sqrt(rightX * rightX + rightZ * rightZ) || 1;
    const rX = rightX / rightLen, rZ = rightZ / rightLen;

    // Up = right x forward
    const uX = fwdZ * 0 - fwdY * rZ;
    const uY = fwdX * rZ - fwdZ * rX;
    const uZ = fwdY * rX - fwdX * 0;
    const uLen = Math.sqrt(uX * uX + uY * uY + uZ * uZ) || 1;
    const upX = uX / uLen, upY = uY / uLen, upZ = uZ / uLen;

    // Sample pixels
    const stepX = Math.max(2, Math.floor(width / 180));
    const stepY = Math.max(2, Math.floor(height / 100));

    for (let py = 0; py < height; py += stepY) {
      for (let px = 0; px < width; px += stepX) {
        const idx = (py * width + px) * 4;
        const r = data[idx] / 255;
        const g = data[idx + 1] / 255;
        const b = data[idx + 2] / 255;

        // Normalized screen coords [-1, 1]
        const sx = (px / width - 0.5) * 2;
        const sy = -(py / height - 0.5) * 2 * aspect;

        // Pseudo-depth estimation
        const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
        const verticalDepth = (py / height); // lower = closer
        const depth = 1.5 + verticalDepth * 4 + brightness * 1.2;

        // Project into world space:  cam + forward*depth + right*sx*depth*fov + up*sy*depth*fov
        const wx = cam.position.x + fwdX * depth + rX * sx * depth * fov + upX * sy * depth * fov;
        const wy = cam.position.y + fwdY * depth + 0 * sx * depth * fov + upY * sy * depth * fov;
        const wz = cam.position.z + fwdZ * depth + rZ * sx * depth * fov + upZ * sy * depth * fov;

        allPos.push(wx, wy, wz);
        allCol.push(r, g, b);
      }
    }
  });

  return {
    pointCloud: {
      positions: new Float32Array(allPos),
      colors: new Float32Array(allCol),
      count: allPos.length / 3,
    },
    cameraPath,
  };
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
        imageUrl: canvas.toDataURL('image/jpeg', 0.8),
      });
    }, { once: true });
  });
}

export async function analyzeVideo(
  videoUrl: string,
  onProgress?: (msg: string, progress: number) => void
): Promise<VideoAnalysis> {
  const detectionModel = await loadModel((msg) => onProgress?.(msg, 0));

  onProgress?.('영상 로딩 중...', 5);
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = videoUrl;

  await new Promise<void>((resolve, reject) => {
    video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    video.addEventListener('error', () => reject(new Error('영상 로딩 실패')), { once: true });
    video.load();
  });
  await new Promise<void>((resolve) => {
    if (video.readyState >= 4) return resolve();
    video.addEventListener('canplaythrough', () => resolve(), { once: true });
  });

  const numFrames = Math.min(Math.max(Math.floor(video.duration * 2), 4), 12);
  const interval = video.duration / (numFrames + 1);
  const timestamps: number[] = [];
  for (let i = 1; i <= numFrames; i++) timestamps.push(interval * i);

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const frames: FrameData[] = [];
  const allObjects: DetectedObject[] = [];
  let objectId = 0;

  for (let i = 0; i < timestamps.length; i++) {
    const pct = 10 + (i / timestamps.length) * 60;
    onProgress?.(`프레임 ${i + 1}/${timestamps.length} 분석 중...`, pct);

    const { imageData, imageUrl } = await captureFrame(video, canvas, timestamps[i]);
    const predictions = await detectionModel.detect(canvas);

    const frameObjects: DetectedObject[] = predictions
      .filter((p) => p.score >= 0.35)
      .map((p) => {
        const [bx, by, bw, bh] = p.bbox;
        const cx = (bx + bw / 2) / video.videoWidth;
        const cy = (by + bh / 2) / video.videoHeight;
        const depth = cy * 0.6 + 0.2;

        return {
          id: `obj-${objectId++}`,
          label: p.class,
          score: p.score,
          bbox: p.bbox as [number, number, number, number],
          frameIndex: i,
          timestamp: timestamps[i],
          description: '',
          color: getObjectColor(p.class),
          depth,
          // position3D will be recalculated after camera path is built
          position3D: { x: 0, y: 0, z: 0 },
        };
      });

    frames.push({ index: i, timestamp: timestamps[i], imageData, imageUrl, objects: frameObjects });
    allObjects.push(...frameObjects);
  }

  // Build unified point cloud
  onProgress?.('3D 공간 구축 중...', 80);
  const { pointCloud, cameraPath } = buildUnifiedPointCloud(frames, video.videoWidth, video.videoHeight);

  // Recalculate object positions using camera path
  const aspect = video.videoHeight / video.videoWidth;
  const fov = 0.6;
  allObjects.forEach((obj) => {
    const cam = cameraPath[obj.frameIndex];
    if (!cam) return;

    const cx = (obj.bbox[0] + obj.bbox[2] / 2) / video.videoWidth;
    const cy = (obj.bbox[1] + obj.bbox[3] / 2) / video.videoHeight;
    const sx = (cx - 0.5) * 2;
    const sy = -(cy - 0.5) * 2 * aspect;
    const d = 1.5 + cy * 4 + 0.5; // match depth formula

    const dx = cam.lookAt.x - cam.position.x;
    const dz = cam.lookAt.z - cam.position.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    const fwdX = dx / len, fwdZ = dz / len;
    const rX = fwdZ, rZ = -fwdX;

    obj.position3D = {
      x: cam.position.x + fwdX * d + rX * sx * d * fov,
      y: cam.position.y + sy * d * fov,
      z: cam.position.z + fwdZ * d + (-fwdX) * sx * d * fov * 0 + rZ * 0,
    };
    // Simplified: just project along z
    obj.position3D.z = cam.position.z + fwdZ * d;
    obj.position3D.x = cam.position.x + rX * sx * d * fov;
    obj.position3D.y = sy * d * fov;
  });

  onProgress?.('분석 완료!', 100);

  const result: VideoAnalysis = {
    frames, allObjects, pointCloud, cameraPath,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    duration: video.duration,
  };

  video.pause();
  video.removeAttribute('src');
  video.load();

  return result;
}
