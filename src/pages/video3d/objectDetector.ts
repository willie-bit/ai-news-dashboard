import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import { DetectedObject, FrameData, VideoAnalysis } from './types';

let model: cocoSsd.ObjectDetection | null = null;

const OBJECT_COLORS: Record<string, string> = {
  person: '#ef4444',
  car: '#3b82f6',
  truck: '#6366f1',
  bus: '#8b5cf6',
  bicycle: '#06b6d4',
  motorcycle: '#14b8a6',
  dog: '#f59e0b',
  cat: '#ec4899',
  bird: '#84cc16',
  chair: '#f97316',
  couch: '#a855f7',
  'potted plant': '#22c55e',
  tv: '#0ea5e9',
  laptop: '#6366f1',
  'cell phone': '#d946ef',
  book: '#eab308',
  bottle: '#64748b',
  cup: '#78716c',
  default: '#94a3b8',
};

function getObjectColor(label: string): string {
  return OBJECT_COLORS[label] || OBJECT_COLORS.default;
}

export async function loadModel(
  onProgress?: (msg: string) => void
): Promise<cocoSsd.ObjectDetection> {
  if (model) return model;
  onProgress?.('TensorFlow.js 백엔드 초기화 중...');
  await tf.ready();
  onProgress?.('COCO-SSD 객체 인식 모델 로딩 중...');
  try {
    model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
  } catch (err) {
    throw new Error(
      `객체 인식 모델 로딩 실패: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  onProgress?.('모델 로딩 완료!');
  return model;
}

function captureFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  timestamp: number
): Promise<{ imageData: ImageData; imageUrl: string }> {
  return new Promise((resolve) => {
    video.currentTime = timestamp;
    video.addEventListener(
      'seeked',
      () => {
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const imageUrl = canvas.toDataURL('image/jpeg', 0.8);
        resolve({ imageData, imageUrl });
      },
      { once: true }
    );
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
  const duration = video.duration;
  const interval = duration / (numFrames + 1);
  const timestamps: number[] = [];
  for (let i = 1; i <= numFrames; i++) timestamps.push(interval * i);

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const frames: FrameData[] = [];
  const allObjects: DetectedObject[] = [];
  let objectId = 0;

  for (let i = 0; i < timestamps.length; i++) {
    const progress = 10 + (i / timestamps.length) * 80;
    onProgress?.(`프레임 ${i + 1}/${timestamps.length} 분석 중...`, progress);

    const { imageData, imageUrl } = await captureFrame(video, canvas, timestamps[i]);
    const predictions = await detectionModel.detect(canvas);

    const frameObjects: DetectedObject[] = predictions
      .filter((p) => p.score >= 0.4)
      .map((p) => {
        const [bx, by, bw, bh] = p.bbox;
        const cx = (bx + bw / 2) / video.videoWidth;
        const cy = (by + bh / 2) / video.videoHeight;
        const depth = 1 - cy;

        return {
          id: `obj-${objectId++}`,
          label: p.class,
          score: p.score,
          bbox: p.bbox as [number, number, number, number],
          frameIndex: i,
          timestamp: timestamps[i],
          description: '',
          color: getObjectColor(p.class),
          position3D: {
            x: (cx - 0.5) * 10,
            y: (0.5 - cy) * 6,
            z: -i * 3 - depth * 2,
          },
        };
      });

    frames.push({ index: i, timestamp: timestamps[i], imageData, imageUrl, objects: frameObjects });
    allObjects.push(...frameObjects);
  }

  onProgress?.('분석 완료!', 100);

  const result: VideoAnalysis = {
    frames,
    allObjects,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    duration: video.duration,
  };

  // Cleanup video element
  video.pause();
  video.removeAttribute('src');
  video.load();

  return result;
}
