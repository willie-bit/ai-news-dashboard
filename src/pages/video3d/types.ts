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
  depth: number;
}

export interface FrameData {
  index: number;
  timestamp: number;
  imageData: ImageData;
  imageUrl: string;
  objects: DetectedObject[];
}

export interface UnifiedPointCloud {
  positions: Float32Array;
  colors: Float32Array;
  count: number;
}

export interface CameraWaypoint {
  position: { x: number; y: number; z: number };
  lookAt: { x: number; y: number; z: number };
  frameIndex: number;
}

export interface VideoAnalysis {
  frames: FrameData[];
  allObjects: DetectedObject[];
  pointCloud: UnifiedPointCloud;
  cameraPath: CameraWaypoint[];
  videoWidth: number;
  videoHeight: number;
  duration: number;
}

export type ViewMode = 'orbit' | 'dollhouse' | 'floorplan' | 'walkthrough';
