import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SceneAnalysis, ViewMode } from './types';

interface Props {
  scene: SceneAnalysis;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  viewMode: ViewMode;
  activeVP: number | null;
}

const ROOM_R = 4;    // cylinder radius
const WALL_H = 2.8;  // wall height
const FLOOR_R = 4.5;  // floor radius

function lerp3(cam: THREE.PerspectiveCamera, ctrl: OrbitControls, toP: THREE.Vector3, toL: THREE.Vector3, ms = 800) {
  const fP = cam.position.clone(), fL = ctrl.target.clone(), t0 = Date.now();
  const tick = () => {
    const t = Math.min((Date.now() - t0) / ms, 1);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    cam.position.lerpVectors(fP, toP, e);
    ctrl.target.lerpVectors(fL, toL, e);
    ctrl.update();
    if (t < 1) requestAnimationFrame(tick);
  };
  tick();
}

function label(text: string, color: string, s = 1): THREE.Sprite {
  const c = document.createElement('canvas'), ctx = c.getContext('2d')!;
  c.width = 512; c.height = 128;
  ctx.fillStyle = color;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(0, 0, 512, 128, 14);
  else { ctx.moveTo(14, 0); ctx.lineTo(498, 0); ctx.arcTo(512, 0, 512, 14, 14); ctx.lineTo(512, 114); ctx.arcTo(512, 128, 498, 128, 14); ctx.lineTo(14, 128); ctx.arcTo(0, 128, 0, 114, 14); ctx.lineTo(0, 14); ctx.arcTo(0, 0, 14, 0, 14); ctx.closePath(); }
  ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 36px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 64);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
  sp.scale.set(1.6 * s, 0.4 * s, 1);
  return sp;
}

export function ThreeDViewer({ scene: data, selectedId, onSelect, viewMode, activeVP }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    renderer: THREE.WebGLRenderer;
    objMeshes: Map<string, THREE.Mesh>;
    hotspots: THREE.Mesh[];
    animId: number;
  } | null>(null);
  const selRef = useRef(onSelect);
  selRef.current = onSelect;

  useEffect(() => {
    const el = boxRef.current;
    if (!el || stateRef.current) return;

    const w = el.clientWidth, h = el.clientHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050910);

    const camera = new THREE.PerspectiveCamera(50, w / h, 0.05, 200);
    camera.position.set(4, 6, 6);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0.8, 0);
    controls.maxDistance = 30;
    controls.minDistance = 0.2;

    scene.add(new THREE.AmbientLight(0xffffff, 1.0));

    // === PANORAMA CYLINDER (the connected room wall) ===
    const panoramaUrl = (data.viewpoints as any).__panoramaUrl;
    if (panoramaUrl) {
      // Open-ended cylinder, textured on INSIDE
      const cylGeo = new THREE.CylinderGeometry(ROOM_R, ROOM_R, WALL_H, 64, 1, true);
      const cylTex = new THREE.TextureLoader().load(panoramaUrl);
      cylTex.colorSpace = THREE.SRGBColorSpace;
      cylTex.wrapS = THREE.RepeatWrapping;

      const cylMat = new THREE.MeshBasicMaterial({
        map: cylTex,
        side: THREE.BackSide, // Render on inside
      });
      const cylinder = new THREE.Mesh(cylGeo, cylMat);
      cylinder.position.y = WALL_H / 2;
      scene.add(cylinder);

      // Also show a faint outer shell for dollhouse visibility
      const outerMat = new THREE.MeshBasicMaterial({
        map: cylTex,
        side: THREE.FrontSide,
        transparent: true,
        opacity: 0.6,
      });
      const outerCyl = new THREE.Mesh(cylGeo.clone(), outerMat);
      outerCyl.position.y = WALL_H / 2;
      scene.add(outerCyl);
    }

    // === TEXTURED FLOOR ===
    const floorUrl = (data.viewpoints as any).__floorUrl;
    if (floorUrl) {
      const floorGeo = new THREE.CircleGeometry(FLOOR_R, 64);
      const floorTex = new THREE.TextureLoader().load(floorUrl);
      floorTex.colorSpace = THREE.SRGBColorSpace;
      const floorMat = new THREE.MeshBasicMaterial({ map: floorTex, side: THREE.DoubleSide });
      const floor = new THREE.Mesh(floorGeo, floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = 0.01;
      scene.add(floor);
    }

    // Subtle grid
    const grid = new THREE.GridHelper(20, 20, 0x0e1425, 0x0e1425);
    grid.position.y = 0;
    scene.add(grid);

    // Room edge ring at top of walls
    const ringGeo = new THREE.RingGeometry(ROOM_R - 0.02, ROOM_R + 0.02, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x2a2a4a, side: THREE.DoubleSide });
    const topRing = new THREE.Mesh(ringGeo, ringMat);
    topRing.rotation.x = -Math.PI / 2;
    topRing.position.y = WALL_H;
    scene.add(topRing);

    // === HOTSPOTS ===
    const hotspots: THREE.Mesh[] = [];
    const hsGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.02, 24);
    data.waypoints.forEach((wp, i) => {
      const angle = (i / data.waypoints.length) * Math.PI * 2;
      const r = 1.0;
      const disc = new THREE.Mesh(hsGeo, new THREE.MeshPhongMaterial({
        color: 0x6366f1, emissive: 0x6366f1, emissiveIntensity: 0.7,
        transparent: true, opacity: 0.85,
      }));
      disc.position.set(Math.sin(angle) * r, 0.04, Math.cos(angle) * r);
      disc.userData = { type: 'hotspot', vpIndex: i };
      scene.add(disc);
      hotspots.push(disc);
    });

    // === DETECTED OBJECTS ===
    const objMeshes = new Map<string, THREE.Mesh>();
    data.allObjects.forEach((obj) => {
      const sz = Math.max(0.15, Math.min(0.5,
        (obj.bbox[2] / data.imageWidth) * 2));
      const geo = new THREE.BoxGeometry(sz, sz, sz);
      const mat = new THREE.MeshPhongMaterial({
        color: obj.color, transparent: true, opacity: 0.55,
        emissive: obj.color, emissiveIntensity: 0.35,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(obj.position3D.x, obj.position3D.y, obj.position3D.z);
      m.userData = { objectId: obj.id };
      m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: obj.color, transparent: true, opacity: 0.6 })));
      scene.add(m);
      objMeshes.set(obj.id, m);

      const lb = label(`${obj.label} ${Math.round(obj.score * 100)}%`, obj.color, 0.5);
      lb.position.set(obj.position3D.x, obj.position3D.y + sz / 2 + 0.2, obj.position3D.z);
      scene.add(lb);
    });

    // Raycaster
    const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
    const targets = [...Array.from(objMeshes.values()), ...hotspots];

    const onClick = (e: MouseEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(mouse, camera);
      const hits = ray.intersectObjects(targets, false);
      if (hits.length > 0) {
        const ud = hits[0].object.userData;
        if (ud.objectId) selRef.current(ud.objectId);
        else if (ud.type === 'hotspot') {
          const wp = data.waypoints[ud.vpIndex];
          lerp3(camera, controls,
            new THREE.Vector3(wp.position.x, wp.position.y, wp.position.z),
            new THREE.Vector3(wp.lookAt.x, wp.lookAt.y, wp.lookAt.z));
        }
      } else selRef.current(null);
    };
    renderer.domElement.addEventListener('click', onClick);
    renderer.domElement.style.cursor = 'grab';

    const onMove = (e: MouseEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(mouse, camera);
      renderer.domElement.style.cursor = ray.intersectObjects(targets, false).length > 0 ? 'pointer' : 'grab';
    };
    renderer.domElement.addEventListener('mousemove', onMove);

    stateRef.current = { camera, controls, renderer, objMeshes, hotspots, animId: 0 };

    const animate = () => {
      const id = requestAnimationFrame(animate);
      if (stateRef.current) stateRef.current.animId = id;
      controls.update();
      const t = Date.now() * 0.001;
      hotspots.forEach((hs, i) => { hs.scale.set(1 + Math.sin(t * 2 + i) * 0.15, 1, 1 + Math.sin(t * 2 + i) * 0.15); });
      renderer.render(scene, camera);
    };
    stateRef.current.animId = requestAnimationFrame(animate);

    const onResize = () => {
      const nw = el.clientWidth, nh = el.clientHeight;
      camera.aspect = nw / nh; camera.updateProjectionMatrix();
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
  }, [data]);

  // View mode
  useEffect(() => {
    if (!stateRef.current) return;
    const { camera, controls } = stateRef.current;
    switch (viewMode) {
      case 'walkthrough': {
        const wp = data.waypoints[activeVP ?? 0];
        lerp3(camera, controls,
          new THREE.Vector3(wp.position.x, wp.position.y, wp.position.z),
          new THREE.Vector3(wp.lookAt.x, wp.lookAt.y, wp.lookAt.z));
        break;
      }
      case 'orbit':
        lerp3(camera, controls, new THREE.Vector3(5, 4, 6), new THREE.Vector3(0, 0.8, 0));
        break;
      case 'dollhouse':
        lerp3(camera, controls, new THREE.Vector3(2, 8, 4), new THREE.Vector3(0, 0.5, 0));
        break;
      case 'floorplan':
        lerp3(camera, controls, new THREE.Vector3(0, 15, 0.1), new THREE.Vector3(0, 0, 0));
        break;
    }
  }, [viewMode, data.waypoints, activeVP]);

  useEffect(() => {
    if (!stateRef.current || activeVP === null || viewMode !== 'walkthrough') return;
    const wp = data.waypoints[activeVP];
    if (!wp) return;
    lerp3(stateRef.current.camera, stateRef.current.controls,
      new THREE.Vector3(wp.position.x, wp.position.y, wp.position.z),
      new THREE.Vector3(wp.lookAt.x, wp.lookAt.y, wp.lookAt.z), 600);
  }, [activeVP, viewMode, data.waypoints]);

  useEffect(() => {
    if (!stateRef.current) return;
    stateRef.current.objMeshes.forEach((m, id) => {
      const mat = m.material as THREE.MeshPhongMaterial;
      const sel = id === selectedId;
      mat.emissiveIntensity = sel ? 1.0 : 0.35;
      mat.opacity = sel ? 0.8 : 0.55;
      m.scale.setScalar(sel ? 1.4 : 1);
    });
    if (selectedId) {
      const m = stateRef.current.objMeshes.get(selectedId);
      if (m) lerp3(stateRef.current.camera, stateRef.current.controls,
        new THREE.Vector3(m.position.x * 0.5, m.position.y + 0.5, m.position.z * 0.5 + 1), m.position.clone(), 600);
    }
  }, [selectedId]);

  return (
    <div className="v3d-viewer" ref={boxRef}>
      <div className="v3d-hints">
        <span>드래그: 회전</span>
        <span>스크롤: 줌</span>
        <span>바닥 원: 뷰 전환</span>
        <span>큐브: 객체</span>
      </div>
    </div>
  );
}
