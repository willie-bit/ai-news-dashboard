export interface DetectedObject {
  id: string;
  label: string;
  score: number;
  bbox: [number, number, number, number];
  viewpointIndex: number;
  description: string;
  color: string;
  position3D: { x: number; y: number; z: number };
}

export interface ViewpointData {
  index: number;
  imageUrl: string;
  imageData: ImageData;
  objects: DetectedObject[];
}

export interface UnifiedPointCloud {
  positions: Float32Array;
  colors: Float32Array;
  count: number;
}

export interface Waypoint {
  position: { x: number; y: number; z: number };
  lookAt: { x: number; y: number; z: number };
  viewpointIndex: number;
}

export interface SceneAnalysis {
  viewpoints: ViewpointData[];
  allObjects: DetectedObject[];
  pointCloud: UnifiedPointCloud;
  waypoints: Waypoint[];
  imageWidth: number;
  imageHeight: number;
}

export type ViewMode = 'walkthrough' | 'orbit' | 'dollhouse' | 'floorplan';

export type InputMode = 'video' | 'photos';
