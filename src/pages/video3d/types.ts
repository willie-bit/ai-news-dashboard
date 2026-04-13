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
  depth: number; // estimated depth 0~1
}

export interface FrameData {
  index: number;
  timestamp: number;
  imageData: ImageData;
  imageUrl: string;
  objects: DetectedObject[];
  // Point cloud data for this frame
  pointCloud: {
    positions: Float32Array;
    colors: Float32Array;
    count: number;
  };
}

export interface VideoAnalysis {
  frames: FrameData[];
  allObjects: DetectedObject[];
  videoWidth: number;
  videoHeight: number;
  duration: number;
}

export type ViewMode = 'orbit' | 'dollhouse' | 'floorplan' | 'walkthrough';
