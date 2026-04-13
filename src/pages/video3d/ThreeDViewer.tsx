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

function lerp3(camera: THREE.PerspectiveCamera, controls: OrbitControls, toP: THREE.Vector3, toL: THREE.Vector3, ms = 800) {
  const fP = camera.position.clone(), fL = controls.target.clone(), t0 = Date.now();
  const tick = () => {
    const t = Math.min((Date.now() - t0) / ms, 1);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    camera.position.lerpVectors(fP, toP, e);
    controls.target.lerpVectors(fL, toL, e);
    controls.update();
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
    photoDomes: THREE.Mesh[];
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

    const wp0 = data.waypoints[0];
    const camera = new THREE.PerspectiveCamera(70, w / h, 0.05, 200);
    camera.position.set(wp0.position.x, wp0.position.y + 0.3, wp0.position.z + 1.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(wp0.lookAt.x, wp0.lookAt.y, wp0.lookAt.z);
    controls.maxDistance = 80;
    controls.minDistance = 0.3;

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dl = new THREE.DirectionalLight(0xffffff, 0.5);
    dl.position.set(5, 10, 5);
    scene.add(dl);

    // Ground grid
    const grid = new THREE.GridHelper(80, 80, 0x0e1425, 0x0e1425);
    grid.position.y = -5;
    scene.add(grid);

    // === UNIFIED POINT CLOUD ===
    const { positions, colors, count } = data.pointCloud;
    if (count > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      scene.add(new THREE.Points(geo, new THREE.PointsMaterial({
        size: 0.055, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.88,
      })));
    }

    // === PHOTO DOMES: project photo onto a hemisphere at each viewpoint ===
    const photoDomes: THREE.Mesh[] = [];
    data.viewpoints.forEach((vp, i) => {
      const wp = data.waypoints[i];
      // Create hemisphere facing the look direction
      const domeGeo = new THREE.SphereGeometry(6, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.55);
      const tex = new THREE.TextureLoader().load(vp.imageUrl);
      tex.colorSpace = THREE.SRGBColorSpace;

      const domeMat = new THREE.MeshBasicMaterial({
        map: tex, side: THREE.BackSide, transparent: true, opacity: 0.35,
      });
      const dome = new THREE.Mesh(domeGeo, domeMat);
      dome.position.set(wp.position.x, wp.position.y, wp.position.z);

      // Rotate to face look direction
      const angle = Math.atan2(
        wp.lookAt.x - wp.position.x,
        wp.lookAt.z - wp.position.z
      );
      dome.rotation.y = angle;
      scene.add(dome);
      photoDomes.push(dome);
    });

    // === FLOOR HOTSPOTS ===
    const hotspots: THREE.Mesh[] = [];
    const hsGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.04, 28);
    const ringGeo = new THREE.RingGeometry(0.4, 0.55, 32);

    data.waypoints.forEach((wp, i) => {
      const mat = new THREE.MeshPhongMaterial({
        color: 0x6366f1, emissive: 0x6366f1, emissiveIntensity: 0.7,
        transparent: true, opacity: 0.85,
      });
      const disc = new THREE.Mesh(hsGeo, mat);
      disc.position.set(wp.position.x, -4.5, wp.position.z);
      disc.userData = { type: 'hotspot', vpIndex: i };
      scene.add(disc);
      hotspots.push(disc);

      // Ring
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: 0x6366f1, side: THREE.DoubleSide, transparent: true, opacity: 0.2,
      }));
      ring.position.set(wp.position.x, -4.48, wp.position.z);
      ring.rotation.x = -Math.PI / 2;
      scene.add(ring);

      // Viewpoint number
      const lb = label(`${i + 1}`, 'rgba(0,0,0,0.6)', 0.45);
      lb.position.set(wp.position.x, -4.85, wp.position.z);
      scene.add(lb);
    });

    // Camera path line
    if (data.waypoints.length >= 2) {
      const pts = data.waypoints.map((wp) => new THREE.Vector3(wp.position.x, -4.5, wp.position.z));
      const curve = new THREE.CatmullRomCurve3(pts);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(curve.getPoints(50)),
        new THREE.LineDashedMaterial({ color: 0x6366f1, dashSize: 0.3, gapSize: 0.2, transparent: true, opacity: 0.25 })
      );
      line.computeLineDistances();
      scene.add(line);
    }

    // === DETECTED OBJECTS ===
    const objMeshes = new Map<string, THREE.Mesh>();
    data.allObjects.forEach((obj) => {
      const sz = Math.max(
        (obj.bbox[2] / data.imageWidth) * 3,
        (obj.bbox[3] / data.imageHeight) * 2.5,
        0.2
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

      const lb = label(`${obj.label} ${Math.round(obj.score * 100)}%`, obj.color, 0.65);
      lb.position.set(obj.position3D.x, obj.position3D.y + sz / 2 + 0.3, obj.position3D.z);
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
        const curve = new THREE.CatmullRomCurve3(pts);
        scene.add(new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(curve.getPoints(pts.length * 8)),
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
            new THREE.Vector3(wp.position.x, wp.position.y + 0.3, wp.position.z + 1.5),
            new THREE.Vector3(wp.lookAt.x, wp.lookAt.y, wp.lookAt.z)
          );
          // Fade in nearby dome, fade out others
          photoDomes.forEach((d, idx) => {
            (d.material as THREE.MeshBasicMaterial).opacity = idx === ud.vpIndex ? 0.5 : 0.2;
          });
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

    stateRef.current = { camera, controls, renderer, objMeshes, photoDomes, hotspots, animId: 0 };

    const animate = () => {
      const id = requestAnimationFrame(animate);
      if (stateRef.current) stateRef.current.animId = id;
      controls.update();
      // Pulse hotspots
      const t = Date.now() * 0.001;
      hotspots.forEach((hs, idx) => { const s = 1 + Math.sin(t * 2 + idx * 0.8) * 0.18; hs.scale.set(s, 1, s); });
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
    const { camera, controls, photoDomes } = stateRef.current;
    const wps = data.waypoints;
    const cx = wps.reduce((s, w) => s + w.position.x, 0) / wps.length;
    const cz = wps.reduce((s, w) => s + w.position.z, 0) / wps.length;

    switch (viewMode) {
      case 'walkthrough': {
        const wp = wps[activeVP ?? 0];
        lerp3(camera, controls,
          new THREE.Vector3(wp.position.x, wp.position.y + 0.3, wp.position.z + 1.5),
          new THREE.Vector3(wp.lookAt.x, wp.lookAt.y, wp.lookAt.z)
        );
        photoDomes.forEach((d) => { (d.material as THREE.MeshBasicMaterial).opacity = 0.4; });
        break;
      }
      case 'orbit':
        lerp3(camera, controls, new THREE.Vector3(cx + 10, 6, cz + 12), new THREE.Vector3(cx, 0, cz));
        photoDomes.forEach((d) => { (d.material as THREE.MeshBasicMaterial).opacity = 0.15; });
        break;
      case 'dollhouse':
        lerp3(camera, controls, new THREE.Vector3(cx, 20, cz + 6), new THREE.Vector3(cx, 0, cz));
        photoDomes.forEach((d) => { (d.material as THREE.MeshBasicMaterial).opacity = 0.1; });
        break;
      case 'floorplan':
        lerp3(camera, controls, new THREE.Vector3(cx, 35, cz), new THREE.Vector3(cx, 0, cz));
        photoDomes.forEach((d) => { (d.material as THREE.MeshBasicMaterial).opacity = 0.05; });
        break;
    }
  }, [viewMode, data.waypoints, activeVP]);

  // Active viewpoint navigation
  useEffect(() => {
    if (!stateRef.current || activeVP === null || viewMode !== 'walkthrough') return;
    const wp = data.waypoints[activeVP];
    if (!wp) return;
    lerp3(stateRef.current.camera, stateRef.current.controls,
      new THREE.Vector3(wp.position.x, wp.position.y + 0.3, wp.position.z + 1.5),
      new THREE.Vector3(wp.lookAt.x, wp.lookAt.y, wp.lookAt.z), 600);
    stateRef.current.photoDomes.forEach((d, i) => {
      (d.material as THREE.MeshBasicMaterial).opacity = i === activeVP ? 0.5 : 0.2;
    });
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
        new THREE.Vector3(m.position.x + 2, m.position.y + 1, m.position.z + 3), m.position.clone(), 600);
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
