export interface DetectedObject {
  id: string;
  label: string;
  score: number;
  bbox: [number, number, number, number];
  frameIndex: number;
  timestamp: number;
  description: string;
  color: string;
  position3D: { x: number; y: number; z: number };
}

export interface FrameData {
  index: number;
  timestamp: number;
  imageData: ImageData;
  imageUrl: string;
  objects: DetectedObject[];
}

export interface VideoAnalysis {
  frames: FrameData[];
  allObjects: DetectedObject[];
  videoWidth: number;
  videoHeight: number;
  duration: number;
}
