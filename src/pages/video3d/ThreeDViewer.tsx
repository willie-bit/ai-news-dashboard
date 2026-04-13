import { useEffect, useRef, useCallback } from 'react';
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

// Smooth camera animation helper
function animateCamera(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  targetPos: THREE.Vector3,
  targetLook: THREE.Vector3,
  duration: number = 800
) {
  const startPos = camera.position.clone();
  const startTarget = controls.target.clone();
  const startTime = Date.now();

  const tick = () => {
    const elapsed = Date.now() - startTime;
    const t = Math.min(elapsed / duration, 1);
    // Ease-in-out cubic
    const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    camera.position.lerpVectors(startPos, targetPos, ease);
    controls.target.lerpVectors(startTarget, targetLook, ease);
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
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
  sprite.scale.set(2.2 * scale, 0.55 * scale, 1);
  return sprite;
}

export function ThreeDViewer({ analysis, selectedId, onSelect, viewMode, activeFrame }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    meshes: Map<string, THREE.Mesh>;
    pointClouds: THREE.Points[];
    hotspots: THREE.Mesh[];
    animId: number;
  } | null>(null);

  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  // Build scene
  useEffect(() => {
    const el = boxRef.current;
    if (!el || stateRef.current) return;

    const w = el.clientWidth, h = el.clientHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080c18);

    const camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 200);
    camera.position.set(6, 4, 8);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, -8);
    controls.maxDistance = 80;

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dl = new THREE.DirectionalLight(0xffffff, 0.7);
    dl.position.set(10, 15, 10);
    scene.add(dl);
    const dl2 = new THREE.DirectionalLight(0x6366f1, 0.3);
    dl2.position.set(-10, 5, -10);
    scene.add(dl2);

    // Subtle grid
    const grid = new THREE.GridHelper(60, 60, 0x151a2e, 0x151a2e);
    grid.position.y = -5;
    scene.add(grid);

    // === POINT CLOUDS from frames ===
    const pointClouds: THREE.Points[] = [];
    analysis.frames.forEach((frame) => {
      const { positions, colors, count } = frame.pointCloud;
      if (count === 0) return;

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const mat = new THREE.PointsMaterial({
        size: 0.07,
        vertexColors: true,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.85,
      });

      const pts = new THREE.Points(geo, mat);
      scene.add(pts);
      pointClouds.push(pts);
    });

    // === VIEWPOINT HOTSPOTS (Matterport-style navigation dots) ===
    const hotspots: THREE.Mesh[] = [];
    const hotspotGeo = new THREE.SphereGeometry(0.2, 16, 16);
    const hotspotRingGeo = new THREE.RingGeometry(0.3, 0.45, 32);

    analysis.frames.forEach((frame, i) => {
      const z = -i * 5 - 1.5;

      // Hotspot sphere
      const mat = new THREE.MeshPhongMaterial({
        color: 0x6366f1, emissive: 0x6366f1, emissiveIntensity: 0.5,
        transparent: true, opacity: 0.9,
      });
      const sphere = new THREE.Mesh(hotspotGeo, mat);
      sphere.position.set(0, -4.2, z);
      sphere.userData = { type: 'hotspot', frameIndex: i };
      scene.add(sphere);
      hotspots.push(sphere);

      // Ring around hotspot
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x6366f1, side: THREE.DoubleSide, transparent: true, opacity: 0.3 });
      const ring = new THREE.Mesh(hotspotRingGeo, ringMat);
      ring.position.copy(sphere.position);
      ring.rotation.x = -Math.PI / 2;
      scene.add(ring);

      // Time label
      const label = makeLabel(`${frame.timestamp.toFixed(1)}s`, 'rgba(0,0,0,0.7)', 0.7);
      label.position.set(0, -4.8, z);
      scene.add(label);
    });

    // === DETECTED OBJECTS as 3D markers ===
    const meshes = new Map<string, THREE.Mesh>();
    analysis.allObjects.forEach((obj) => {
      const sz = Math.max(
        (obj.bbox[2] / analysis.videoWidth) * 5,
        (obj.bbox[3] / analysis.videoHeight) * 4,
        0.25
      );

      // Translucent cube with glow
      const geo = new THREE.BoxGeometry(sz, sz, sz);
      const mat = new THREE.MeshPhongMaterial({
        color: obj.color, transparent: true, opacity: 0.6,
        emissive: obj.color, emissiveIntensity: 0.3,
        shininess: 80,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(obj.position3D.x, obj.position3D.y, obj.position3D.z);
      m.userData = { objectId: obj.id };

      // Wireframe
      m.add(new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: obj.color, transparent: true, opacity: 0.8 })
      ));
      scene.add(m);
      meshes.set(obj.id, m);

      // Floating label
      const confidence = Math.round(obj.score * 100);
      const label = makeLabel(`${obj.label} ${confidence}%`, obj.color, 0.8);
      label.position.set(obj.position3D.x, obj.position3D.y + sz / 2 + 0.45, obj.position3D.z);
      scene.add(label);
    });

    // === TRAJECTORY LINES ===
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

      // Smooth curve through points
      if (pts.length >= 2) {
        const curve = new THREE.CatmullRomCurve3(pts);
        const curvePoints = curve.getPoints(pts.length * 10);
        const lineGeo = new THREE.BufferGeometry().setFromPoints(curvePoints);
        const lineMat = new THREE.LineBasicMaterial({
          color: sorted[0].color, transparent: true, opacity: 0.4,
        });
        scene.add(new THREE.Line(lineGeo, lineMat));
      }
    });

    // === AMBIENT PARTICLES ===
    const pCount = 600;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(pCount * 3);
    const pCol = new Float32Array(pCount * 3);
    const totalDepth = analysis.frames.length * 5 + 5;
    for (let i = 0; i < pCount; i++) {
      pPos[i * 3] = (Math.random() - 0.5) * 30;
      pPos[i * 3 + 1] = (Math.random() - 0.5) * 15;
      pPos[i * 3 + 2] = -Math.random() * totalDepth;
      // Subtle blue/purple tint
      pCol[i * 3] = 0.3 + Math.random() * 0.1;
      pCol[i * 3 + 1] = 0.35 + Math.random() * 0.1;
      pCol[i * 3 + 2] = 0.85 + Math.random() * 0.15;
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
    scene.add(new THREE.Points(pGeo, new THREE.PointsMaterial({
      size: 0.04, vertexColors: true, transparent: true, opacity: 0.35, sizeAttenuation: true,
    })));

    // === RAYCASTER ===
    const ray = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const clickTargets = [...Array.from(meshes.values()), ...hotspots];

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
          // Navigate to frame viewpoint
          const fi = ud.frameIndex;
          const z = -fi * 5 - 1.5;
          animateCamera(camera, controls, new THREE.Vector3(0, 0, z + 6), new THREE.Vector3(0, 0, z));
        }
      } else {
        selectRef.current(null);
      }
    };
    renderer.domElement.addEventListener('click', onClick);
    renderer.domElement.style.cursor = 'grab';

    // Hover cursor
    const onMouseMove = (e: MouseEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(mouse, camera);
      const hits = ray.intersectObjects(clickTargets, false);
      renderer.domElement.style.cursor = hits.length > 0 ? 'pointer' : 'grab';
    };
    renderer.domElement.addEventListener('mousemove', onMouseMove);

    stateRef.current = { scene, camera, renderer, controls, meshes, pointClouds, hotspots, animId: 0 };

    // Animation loop
    const animate = () => {
      const id = requestAnimationFrame(animate);
      if (stateRef.current) stateRef.current.animId = id;
      controls.update();

      // Animate particles
      const arr = pGeo.attributes.position.array as Float32Array;
      const t = Date.now() * 0.0008;
      for (let i = 0; i < pCount; i++) {
        arr[i * 3 + 1] += Math.sin(t + i * 0.5) * 0.0008;
      }
      pGeo.attributes.position.needsUpdate = true;

      // Pulse hotspots
      hotspots.forEach((hs, idx) => {
        const scale = 1 + Math.sin(t * 2 + idx) * 0.15;
        hs.scale.setScalar(scale);
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
      renderer.domElement.removeEventListener('mousemove', onMouseMove);
      cancelAnimationFrame(stateRef.current?.animId || 0);
      renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
      stateRef.current = null;
    };
  }, [analysis]);

  // View mode transitions
  useEffect(() => {
    if (!stateRef.current) return;
    const { camera, controls } = stateRef.current;
    const centerZ = -(analysis.frames.length * 5) / 2;

    switch (viewMode) {
      case 'orbit':
        animateCamera(camera, controls,
          new THREE.Vector3(6, 4, 8),
          new THREE.Vector3(0, 0, centerZ)
        );
        break;
      case 'dollhouse':
        animateCamera(camera, controls,
          new THREE.Vector3(0, 20, centerZ + 10),
          new THREE.Vector3(0, 0, centerZ)
        );
        break;
      case 'floorplan':
        animateCamera(camera, controls,
          new THREE.Vector3(0, 30, centerZ),
          new THREE.Vector3(0, 0, centerZ)
        );
        break;
      case 'walkthrough': {
        const z = -(activeFrame ?? 0) * 5 - 1.5;
        animateCamera(camera, controls,
          new THREE.Vector3(0, 0, z + 5),
          new THREE.Vector3(0, 0, z)
        );
        break;
      }
    }
  }, [viewMode, analysis.frames.length, activeFrame]);

  // Navigate to active frame
  useEffect(() => {
    if (!stateRef.current || activeFrame === null || viewMode !== 'walkthrough') return;
    const { camera, controls } = stateRef.current;
    const z = -activeFrame * 5 - 1.5;
    animateCamera(camera, controls,
      new THREE.Vector3(0, 0, z + 5),
      new THREE.Vector3(0, 0, z),
      600
    );
  }, [activeFrame, viewMode]);

  // Selection highlight
  useEffect(() => {
    if (!stateRef.current) return;
    stateRef.current.meshes.forEach((mesh, id) => {
      const mat = mesh.material as THREE.MeshPhongMaterial;
      const sel = id === selectedId;
      mat.emissiveIntensity = sel ? 1.0 : 0.3;
      mat.opacity = sel ? 0.9 : 0.6;
      mesh.scale.setScalar(sel ? 1.4 : 1);
    });

    // Fly to selected object
    if (selectedId && stateRef.current) {
      const mesh = stateRef.current.meshes.get(selectedId);
      if (mesh) {
        const { camera, controls } = stateRef.current;
        const pos = mesh.position.clone();
        animateCamera(camera, controls,
          new THREE.Vector3(pos.x + 3, pos.y + 2, pos.z + 4),
          pos, 600
        );
      }
    }
  }, [selectedId]);

  return (
    <div className="v3d-viewer" ref={boxRef}>
      <div className="v3d-hints">
        <span>드래그: 회전</span>
        <span>스크롤: 줌</span>
        <span>바닥 점: 뷰포인트 이동</span>
        <span>큐브 클릭: 객체 선택</span>
      </div>
    </div>
  );
}
