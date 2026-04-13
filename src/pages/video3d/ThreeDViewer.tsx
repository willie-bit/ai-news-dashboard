import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VideoAnalysis, DetectedObject, ViewMode } from './types';

interface Props {
  analysis: VideoAnalysis;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  viewMode: ViewMode;
  activeFrame: number | null;
}

function animateCamera(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  toPos: THREE.Vector3,
  toLook: THREE.Vector3,
  ms: number = 800
) {
  const fromPos = camera.position.clone();
  const fromLook = controls.target.clone();
  const t0 = Date.now();
  const tick = () => {
    const t = Math.min((Date.now() - t0) / ms, 1);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    camera.position.lerpVectors(fromPos, toPos, e);
    controls.target.lerpVectors(fromLook, toLook, e);
    controls.update();
    if (t < 1) requestAnimationFrame(tick);
  };
  tick();
}

function makeLabel(text: string, color: string, scale: number = 1): THREE.Sprite {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  c.width = 512; c.height = 128;
  ctx.fillStyle = color;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(0, 0, c.width, c.height, 16);
  } else {
    const r = 16, w = c.width, h = c.height;
    ctx.moveTo(r, 0); ctx.lineTo(w - r, 0); ctx.arcTo(w, 0, w, r, r);
    ctx.lineTo(w, h - r); ctx.arcTo(w, h, w - r, h, r);
    ctx.lineTo(r, h); ctx.arcTo(0, h, 0, h - r, r);
    ctx.lineTo(0, r); ctx.arcTo(0, 0, r, 0, r); ctx.closePath();
  }
  ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 40px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height / 2);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c), transparent: true, depthTest: false,
  }));
  sprite.scale.set(2 * scale, 0.5 * scale, 1);
  return sprite;
}

export function ThreeDViewer({ analysis, selectedId, onSelect, viewMode, activeFrame }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    objMeshes: Map<string, THREE.Mesh>;
    hotspots: THREE.Mesh[];
    animId: number;
  } | null>(null);

  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  useEffect(() => {
    const el = boxRef.current;
    if (!el || stateRef.current) return;

    const w = el.clientWidth, h = el.clientHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060a14);

    // Camera starts at first waypoint, INSIDE the space
    const firstCam = analysis.cameraPath[0];
    const camera = new THREE.PerspectiveCamera(65, w / h, 0.05, 150);
    camera.position.set(firstCam.position.x, firstCam.position.y + 0.5, firstCam.position.z + 2);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(firstCam.lookAt.x, firstCam.lookAt.y, firstCam.lookAt.z);
    controls.maxDistance = 60;
    controls.minDistance = 0.5;

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const dl = new THREE.DirectionalLight(0xffffff, 0.5);
    dl.position.set(5, 10, 5);
    scene.add(dl);

    // Subtle ground grid
    const grid = new THREE.GridHelper(80, 80, 0x111828, 0x111828);
    grid.position.y = -5;
    scene.add(grid);

    // === UNIFIED POINT CLOUD (single continuous 3D space) ===
    const { positions, colors, count } = analysis.pointCloud;
    if (count > 0) {
      const pcGeo = new THREE.BufferGeometry();
      pcGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      pcGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const pcMat = new THREE.PointsMaterial({
        size: 0.06,
        vertexColors: true,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.9,
      });
      scene.add(new THREE.Points(pcGeo, pcMat));
    }

    // === NAVIGATION HOTSPOTS on floor (Matterport-style) ===
    const hotspots: THREE.Mesh[] = [];
    const hsGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.05, 24);

    analysis.cameraPath.forEach((wp, i) => {
      // Floor disc
      const mat = new THREE.MeshPhongMaterial({
        color: 0x6366f1, emissive: 0x6366f1, emissiveIntensity: 0.6,
        transparent: true, opacity: 0.8,
      });
      const disc = new THREE.Mesh(hsGeo, mat);
      disc.position.set(wp.position.x, -4.5, wp.position.z);
      disc.userData = { type: 'hotspot', frameIndex: i };
      scene.add(disc);
      hotspots.push(disc);

      // Pulsing ring
      const ringGeo = new THREE.RingGeometry(0.35, 0.5, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x6366f1, side: THREE.DoubleSide, transparent: true, opacity: 0.25,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(wp.position.x, -4.48, wp.position.z);
      ring.rotation.x = -Math.PI / 2;
      ring.userData = { pulseRing: true, idx: i };
      scene.add(ring);

      // Frame number label
      const label = makeLabel(`${analysis.frames[i].timestamp.toFixed(1)}s`, 'rgba(0,0,0,0.6)', 0.5);
      label.position.set(wp.position.x, -4.9, wp.position.z);
      scene.add(label);
    });

    // === DETECTED OBJECTS ===
    const objMeshes = new Map<string, THREE.Mesh>();
    analysis.allObjects.forEach((obj) => {
      const sz = Math.max(
        (obj.bbox[2] / analysis.videoWidth) * 3,
        (obj.bbox[3] / analysis.videoHeight) * 2.5,
        0.2
      );
      const geo = new THREE.BoxGeometry(sz, sz, sz);
      const mat = new THREE.MeshPhongMaterial({
        color: obj.color, transparent: true, opacity: 0.5,
        emissive: obj.color, emissiveIntensity: 0.3, shininess: 60,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(obj.position3D.x, obj.position3D.y, obj.position3D.z);
      m.userData = { objectId: obj.id };
      m.add(new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: obj.color, transparent: true, opacity: 0.7 })
      ));
      scene.add(m);
      objMeshes.set(obj.id, m);

      // Label
      const label = makeLabel(`${obj.label} ${Math.round(obj.score * 100)}%`, obj.color, 0.7);
      label.position.set(obj.position3D.x, obj.position3D.y + sz / 2 + 0.35, obj.position3D.z);
      scene.add(label);
    });

    // === OBJECT TRAJECTORY CURVES ===
    const groups = new Map<string, DetectedObject[]>();
    analysis.allObjects.forEach((o) => {
      const g = groups.get(o.label) || [];
      g.push(o);
      groups.set(o.label, g);
    });
    groups.forEach((objs) => {
      if (objs.length < 2) return;
      const sorted = [...objs].sort((a, b) => a.frameIndex - b.frameIndex);
      const pts = sorted.map((o) => new THREE.Vector3(o.position3D.x, o.position3D.y, o.position3D.z));
      if (pts.length >= 2) {
        const curve = new THREE.CatmullRomCurve3(pts);
        const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(pts.length * 8));
        scene.add(new THREE.Line(geo, new THREE.LineBasicMaterial({
          color: sorted[0].color, transparent: true, opacity: 0.35,
        })));
      }
    });

    // === CAMERA PATH LINE (subtle) ===
    const pathPts = analysis.cameraPath.map((wp) => new THREE.Vector3(wp.position.x, -4.5, wp.position.z));
    if (pathPts.length >= 2) {
      const pathCurve = new THREE.CatmullRomCurve3(pathPts);
      const pathGeo = new THREE.BufferGeometry().setFromPoints(pathCurve.getPoints(50));
      scene.add(new THREE.Line(pathGeo, new THREE.LineDashedMaterial({
        color: 0x6366f1, dashSize: 0.3, gapSize: 0.2, transparent: true, opacity: 0.3,
      })));
      const pathLine = scene.children[scene.children.length - 1] as THREE.Line;
      pathLine.computeLineDistances();
    }

    // === RAYCASTER ===
    const ray = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const clickTargets = [...Array.from(objMeshes.values()), ...hotspots];

    const onClick = (e: MouseEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(mouse, camera);
      const hits = ray.intersectObjects(clickTargets, false);
      if (hits.length > 0) {
        const ud = hits[0].object.userData;
        if (ud.objectId) {
          selectRef.current(ud.objectId);
        } else if (ud.type === 'hotspot') {
          const wp = analysis.cameraPath[ud.frameIndex];
          animateCamera(camera, controls,
            new THREE.Vector3(wp.position.x, wp.position.y + 0.5, wp.position.z + 2),
            new THREE.Vector3(wp.lookAt.x, wp.lookAt.y, wp.lookAt.z)
          );
        }
      } else {
        selectRef.current(null);
      }
    };
    renderer.domElement.addEventListener('click', onClick);
    renderer.domElement.style.cursor = 'grab';

    const onMove = (e: MouseEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(mouse, camera);
      renderer.domElement.style.cursor = ray.intersectObjects(clickTargets, false).length > 0 ? 'pointer' : 'grab';
    };
    renderer.domElement.addEventListener('mousemove', onMove);

    stateRef.current = { scene, camera, renderer, controls, objMeshes, hotspots, animId: 0 };

    // Animation loop
    const animate = () => {
      const id = requestAnimationFrame(animate);
      if (stateRef.current) stateRef.current.animId = id;
      controls.update();

      // Pulse hotspots
      const t = Date.now() * 0.001;
      hotspots.forEach((hs, idx) => {
        const s = 1 + Math.sin(t * 2 + idx * 0.7) * 0.2;
        hs.scale.set(s, 1, s);
      });

      renderer.render(scene, camera);
    };
    stateRef.current.animId = requestAnimationFrame(animate);

    const onResize = () => {
      const nw = el.clientWidth, nh = el.clientHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('click', onClick);
      renderer.domElement.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(stateRef.current?.animId || 0);
      renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
      stateRef.current = null;
    };
  }, [analysis]);

  // View mode changes
  useEffect(() => {
    if (!stateRef.current) return;
    const { camera, controls } = stateRef.current;
    const path = analysis.cameraPath;
    const midIdx = Math.floor(path.length / 2);
    const mid = path[midIdx];
    const first = path[0];
    const last = path[path.length - 1];
    const centerX = (first.position.x + last.position.x) / 2;
    const centerZ = (first.position.z + last.position.z) / 2;

    switch (viewMode) {
      case 'orbit':
        animateCamera(camera, controls,
          new THREE.Vector3(centerX + 8, 6, centerZ + 10),
          new THREE.Vector3(centerX, 0, centerZ)
        );
        break;
      case 'dollhouse':
        animateCamera(camera, controls,
          new THREE.Vector3(centerX, 18, centerZ + 5),
          new THREE.Vector3(centerX, 0, centerZ)
        );
        break;
      case 'floorplan':
        animateCamera(camera, controls,
          new THREE.Vector3(centerX, 30, centerZ),
          new THREE.Vector3(centerX, 0, centerZ)
        );
        break;
      case 'walkthrough': {
        const wp = path[activeFrame ?? 0];
        animateCamera(camera, controls,
          new THREE.Vector3(wp.position.x, wp.position.y + 0.5, wp.position.z + 2),
          new THREE.Vector3(wp.lookAt.x, wp.lookAt.y, wp.lookAt.z)
        );
        break;
      }
    }
  }, [viewMode, analysis.cameraPath, activeFrame]);

  // Navigate to frame
  useEffect(() => {
    if (!stateRef.current || activeFrame === null || viewMode !== 'walkthrough') return;
    const wp = analysis.cameraPath[activeFrame];
    if (!wp) return;
    const { camera, controls } = stateRef.current;
    animateCamera(camera, controls,
      new THREE.Vector3(wp.position.x, wp.position.y + 0.5, wp.position.z + 2),
      new THREE.Vector3(wp.lookAt.x, wp.lookAt.y, wp.lookAt.z),
      600
    );
  }, [activeFrame, viewMode, analysis.cameraPath]);

  // Selection highlight + fly-to
  useEffect(() => {
    if (!stateRef.current) return;
    stateRef.current.objMeshes.forEach((mesh, id) => {
      const mat = mesh.material as THREE.MeshPhongMaterial;
      const sel = id === selectedId;
      mat.emissiveIntensity = sel ? 1.0 : 0.3;
      mat.opacity = sel ? 0.85 : 0.5;
      mesh.scale.setScalar(sel ? 1.4 : 1);
    });
    if (selectedId) {
      const mesh = stateRef.current.objMeshes.get(selectedId);
      if (mesh) {
        const p = mesh.position;
        animateCamera(stateRef.current.camera, stateRef.current.controls,
          new THREE.Vector3(p.x + 2, p.y + 1, p.z + 3), p.clone(), 600);
      }
    }
  }, [selectedId]);

  return (
    <div className="v3d-viewer" ref={boxRef}>
      <div className="v3d-hints">
        <span>드래그: 회전</span>
        <span>스크롤: 줌</span>
        <span>바닥 원: 이동</span>
        <span>큐브: 객체 선택</span>
      </div>
    </div>
  );
}
