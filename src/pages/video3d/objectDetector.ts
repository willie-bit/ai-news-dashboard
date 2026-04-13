import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import { DetectedObject, FrameData, VideoAnalysis } from './types';

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
 * Generate a colored point cloud from frame pixel data.
 * Uses brightness + vertical position for pseudo-depth estimation.
 */
function generatePointCloud(
  imageData: ImageData,
  frameIndex: number,
  spacing: number = 4
): { positions: Float32Array; colors: Float32Array; count: number } {
  const { width, height, data } = imageData;
  const stepX = Math.max(spacing, Math.floor(width / 160));
  const stepY = Math.max(spacing, Math.floor(height / 90));
  const capacity = Math.ceil(width / stepX) * Math.ceil(height / stepY);

  const positions = new Float32Array(capacity * 3);
  const colors = new Float32Array(capacity * 3);
  let count = 0;

  const frameZ = -frameIndex * 5;
  const scaleX = 8;
  const scaleY = 8 * (height / width);

  for (let py = 0; py < height; py += stepY) {
    for (let px = 0; px < width; px += stepX) {
      const i = (py * width + px) * 4;
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const a = data[i + 3] / 255;
      if (a < 0.5) continue;

      // Normalize coordinates to [-0.5, 0.5]
      const nx = px / width - 0.5;
      const ny = -(py / height - 0.5);

      // Pseudo-depth: combine vertical position, brightness, and edge distance
      const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
      const edgeDist = 1 - Math.sqrt(nx * nx + ny * ny) * 1.2;
      const verticalDepth = (py / height) * 0.6; // lower = closer
      const depthOffset = (verticalDepth + brightness * 0.25 + edgeDist * 0.15) * 2.5;

      const idx = count * 3;
      positions[idx] = nx * scaleX;
      positions[idx + 1] = ny * scaleY;
      positions[idx + 2] = frameZ - depthOffset;
      colors[idx] = r;
      colors[idx + 1] = g;
      colors[idx + 2] = b;
      count++;
    }
  }

  return {
    positions: positions.slice(0, count * 3),
    colors: colors.slice(0, count * 3),
    count,
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
    const pct = 10 + (i / timestamps.length) * 70;
    onProgress?.(`프레임 ${i + 1}/${timestamps.length} 분석 중...`, pct);

    const { imageData, imageUrl } = await captureFrame(video, canvas, timestamps[i]);

    // Object detection
    const predictions = await detectionModel.detect(canvas);
    const frameObjects: DetectedObject[] = predictions
      .filter((p) => p.score >= 0.35)
      .map((p) => {
        const [bx, by, bw, bh] = p.bbox;
        const cx = (bx + bw / 2) / video.videoWidth;
        const cy = (by + bh / 2) / video.videoHeight;
        const depth = cy * 0.6 + 0.2; // lower in frame = closer

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
          position3D: {
            x: (cx - 0.5) * 8,
            y: -(cy - 0.5) * (8 * video.videoHeight / video.videoWidth),
            z: -i * 5 - depth * 2.5,
          },
        };
      });

    // Generate point cloud
    onProgress?.(`프레임 ${i + 1}/${timestamps.length} 포인트 클라우드 생성 중...`, pct + 5);
    const pointCloud = generatePointCloud(imageData, i);

    frames.push({
      index: i,
      timestamp: timestamps[i],
      imageData,
      imageUrl,
      objects: frameObjects,
      pointCloud,
    });
    allObjects.push(...frameObjects);
  }

  onProgress?.('분석 완료!', 100);

  const result: VideoAnalysis = {
    frames, allObjects,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    duration: video.duration,
  };

  video.pause();
  video.removeAttribute('src');
  video.load();

  return result;
}
