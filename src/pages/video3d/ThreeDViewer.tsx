import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SceneAnalysis, DetectedObject, ViewMode } from './types';

interface Props {
  scene: SceneAnalysis;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  viewMode: ViewMode;
  activeVP: number | null;
}

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
  ctx.fillStyle = '#fff'; ctx.font = 'bold 38px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 64);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
  sp.scale.set(2 * s, 0.5 * s, 1);
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

    // Start in dollhouse view to see the whole model
    const wps = data.waypoints;
    const cx = wps.reduce((s, wp) => s + wp.position.x, 0) / wps.length;
    const cz = wps.reduce((s, wp) => s + wp.position.z, 0) / wps.length;

    const camera = new THREE.PerspectiveCamera(55, w / h, 0.05, 200);
    camera.position.set(cx + 6, 5, cz + 8);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(cx, -0.5, cz);
    controls.maxDistance = 60;
    controls.minDistance = 0.3;

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dl = new THREE.DirectionalLight(0xffffff, 0.5);
    dl.position.set(5, 10, 5);
    scene.add(dl);

    // Subtle ground grid
    const grid = new THREE.GridHelper(40, 40, 0x0e1425, 0x0e1425);
    grid.position.y = -3;
    scene.add(grid);

    // === UNIFIED POINT CLOUD — dense, solid appearance ===
    const { positions, colors, count } = data.pointCloud;
    if (count > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      scene.add(new THREE.Points(geo, new THREE.PointsMaterial({
        size: 0.035,  // Smaller but denser → solid look
        vertexColors: true,
        sizeAttenuation: true,
        transparent: false,
      })));
    }

    // === FLOOR HOTSPOTS (navigation) ===
    const hotspots: THREE.Mesh[] = [];
    const hsGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.03, 24);
    const ringGeo = new THREE.RingGeometry(0.2, 0.3, 32);

    data.waypoints.forEach((wp, i) => {
      const disc = new THREE.Mesh(hsGeo, new THREE.MeshPhongMaterial({
        color: 0x6366f1, emissive: 0x6366f1, emissiveIntensity: 0.7,
        transparent: true, opacity: 0.85,
      }));
      disc.position.set(wp.position.x, -2.8, wp.position.z);
      disc.userData = { type: 'hotspot', vpIndex: i };
      scene.add(disc);
      hotspots.push(disc);

      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: 0x6366f1, side: THREE.DoubleSide, transparent: true, opacity: 0.2,
      }));
      ring.position.set(wp.position.x, -2.78, wp.position.z);
      ring.rotation.x = -Math.PI / 2;
      scene.add(ring);
    });

    // Camera path line on floor
    if (data.waypoints.length >= 2) {
      const pts = data.waypoints.map((wp) => new THREE.Vector3(wp.position.x, -2.8, wp.position.z));
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts.length > 2 ? new THREE.CatmullRomCurve3(pts).getPoints(50) : pts),
        new THREE.LineDashedMaterial({ color: 0x6366f1, dashSize: 0.15, gapSize: 0.1, transparent: true, opacity: 0.2 })
      );
      line.computeLineDistances();
      scene.add(line);
    }

    // === DETECTED OBJECTS ===
    const objMeshes = new Map<string, THREE.Mesh>();
    data.allObjects.forEach((obj) => {
      const sz = Math.max(
        (obj.bbox[2] / data.imageWidth) * 2,
        (obj.bbox[3] / data.imageHeight) * 1.5,
        0.15
      );
      const geo = new THREE.BoxGeometry(sz, sz, sz);
      const mat = new THREE.MeshPhongMaterial({
        color: obj.color, transparent: true, opacity: 0.45,
        emissive: obj.color, emissiveIntensity: 0.35,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(obj.position3D.x, obj.position3D.y, obj.position3D.z);
      m.userData = { objectId: obj.id };
      m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: obj.color, transparent: true, opacity: 0.6 })));
      scene.add(m);
      objMeshes.set(obj.id, m);

      const lb = label(`${obj.label} ${Math.round(obj.score * 100)}%`, obj.color, 0.55);
      lb.position.set(obj.position3D.x, obj.position3D.y + sz / 2 + 0.25, obj.position3D.z);
      scene.add(lb);
    });

    // Trajectories
    const groups = new Map<string, DetectedObject[]>();
    data.allObjects.forEach((o) => { const g = groups.get(o.label) || []; g.push(o); groups.set(o.label, g); });
    groups.forEach((objs) => {
      if (objs.length < 2) return;
      const sorted = [...objs].sort((a, b) => a.viewpointIndex - b.viewpointIndex);
      const pts = sorted.map((o) => new THREE.Vector3(o.position3D.x, o.position3D.y, o.position3D.z));
      if (pts.length >= 2) {
        scene.add(new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts.length > 2 ? new THREE.CatmullRomCurve3(pts).getPoints(pts.length * 8) : pts),
          new THREE.LineBasicMaterial({ color: sorted[0].color, transparent: true, opacity: 0.3 })
        ));
      }
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
            new THREE.Vector3(wp.position.x, wp.position.y + 0.2, wp.position.z + 1),
            new THREE.Vector3(wp.lookAt.x, wp.lookAt.y, wp.lookAt.z)
          );
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

    // Animation
    const animate = () => {
      const id = requestAnimationFrame(animate);
      if (stateRef.current) stateRef.current.animId = id;
      controls.update();
      const t = Date.now() * 0.001;
      hotspots.forEach((hs, idx) => { hs.scale.set(1 + Math.sin(t * 2 + idx * 0.8) * 0.15, 1, 1 + Math.sin(t * 2 + idx * 0.8) * 0.15); });
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
    const wps = data.waypoints;
    const cx = wps.reduce((s, w) => s + w.position.x, 0) / wps.length;
    const cz = wps.reduce((s, w) => s + w.position.z, 0) / wps.length;

    switch (viewMode) {
      case 'walkthrough': {
        const wp = wps[activeVP ?? 0];
        lerp3(camera, controls,
          new THREE.Vector3(wp.position.x, wp.position.y + 0.2, wp.position.z + 1),
          new THREE.Vector3(wp.lookAt.x, wp.lookAt.y, wp.lookAt.z));
        break;
      }
      case 'orbit':
        lerp3(camera, controls, new THREE.Vector3(cx + 6, 4, cz + 8), new THREE.Vector3(cx, -0.5, cz));
        break;
      case 'dollhouse':
        lerp3(camera, controls, new THREE.Vector3(cx + 2, 10, cz + 4), new THREE.Vector3(cx, -0.5, cz));
        break;
      case 'floorplan':
        lerp3(camera, controls, new THREE.Vector3(cx, 18, cz), new THREE.Vector3(cx, 0, cz));
        break;
    }
  }, [viewMode, data.waypoints, activeVP]);

  // Active viewpoint
  useEffect(() => {
    if (!stateRef.current || activeVP === null || viewMode !== 'walkthrough') return;
    const wp = data.waypoints[activeVP];
    if (!wp) return;
    lerp3(stateRef.current.camera, stateRef.current.controls,
      new THREE.Vector3(wp.position.x, wp.position.y + 0.2, wp.position.z + 1),
      new THREE.Vector3(wp.lookAt.x, wp.lookAt.y, wp.lookAt.z), 600);
  }, [activeVP, viewMode, data.waypoints]);

  // Selection
  useEffect(() => {
    if (!stateRef.current) return;
    stateRef.current.objMeshes.forEach((m, id) => {
      const mat = m.material as THREE.MeshPhongMaterial;
      const sel = id === selectedId;
      mat.emissiveIntensity = sel ? 1.0 : 0.35;
      mat.opacity = sel ? 0.8 : 0.45;
      m.scale.setScalar(sel ? 1.4 : 1);
    });
    if (selectedId) {
      const m = stateRef.current.objMeshes.get(selectedId);
      if (m) lerp3(stateRef.current.camera, stateRef.current.controls,
        new THREE.Vector3(m.position.x + 1.5, m.position.y + 0.8, m.position.z + 2), m.position.clone(), 600);
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
