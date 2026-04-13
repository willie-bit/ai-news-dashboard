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

const SPHERE_R = 5;

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

function makeLabel(text: string, color: string, s = 1): THREE.Sprite {
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
    sphere: THREE.Mesh;
    clipPlane: THREE.Plane;
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

    const camera = new THREE.PerspectiveCamera(60, w / h, 0.05, 200);
    // Start inside the sphere (walkthrough)
    camera.position.set(0, 1.5, 0.1);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.localClippingEnabled = true;
    el.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.target.set(0, 1.2, -1);
    controls.maxDistance = 25;
    controls.minDistance = 0.1;
    controls.rotateSpeed = 0.5; // Slower rotation inside sphere

    scene.add(new THREE.AmbientLight(0xffffff, 1.0));

    // Clipping plane: used in dollhouse mode to cut top half of sphere
    const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 3.5);

    // === PANORAMIC SPHERE ===
    const panoUrl = (data.viewpoints as any).__panoUrl;
    const sphereGeo = new THREE.SphereGeometry(SPHERE_R, 64, 48);
    let sphere: THREE.Mesh;

    if (panoUrl) {
      const tex = new THREE.TextureLoader().load(panoUrl);
      tex.colorSpace = THREE.SRGBColorSpace;
      // Flip the texture for inside viewing
      tex.wrapS = THREE.RepeatWrapping;
      tex.repeat.x = -1;

      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        side: THREE.BackSide,
        clippingPlanes: [], // Will be set in dollhouse mode
      });
      sphere = new THREE.Mesh(sphereGeo, mat);
      sphere.position.set(0, SPHERE_R * 0.3, 0); // Offset so "eye level" is natural
      scene.add(sphere);

      // Outer view for dollhouse (slightly visible from outside)
      const outerMat = new THREE.MeshBasicMaterial({
        map: tex,
        side: THREE.FrontSide,
        transparent: true,
        opacity: 0.5,
        clippingPlanes: [clipPlane], // Cut top half
      });
      const outer = new THREE.Mesh(sphereGeo.clone(), outerMat);
      outer.position.copy(sphere.position);
      scene.add(outer);
    } else {
      sphere = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: 0x333 }));
    }

    // === FLOOR HOTSPOTS ===
    const hotspots: THREE.Mesh[] = [];
    const hsGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.015, 20);
    data.waypoints.forEach((wp, i) => {
      const angle = (i / data.waypoints.length) * Math.PI * 2;
      const disc = new THREE.Mesh(hsGeo, new THREE.MeshBasicMaterial({
        color: 0x6366f1, transparent: true, opacity: 0.9,
      }));
      disc.position.set(Math.sin(angle) * 0.8, 0.02, Math.cos(angle) * 0.8);
      disc.userData = { type: 'hotspot', vpIndex: i };
      scene.add(disc);
      hotspots.push(disc);
    });

    // === DETECTED OBJECTS ===
    const objMeshes = new Map<string, THREE.Mesh>();
    data.allObjects.forEach((obj) => {
      const sz = Math.max(0.12, Math.min(0.4, (obj.bbox[2] / data.imageWidth) * 2));
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

      const lb = makeLabel(`${obj.label} ${Math.round(obj.score * 100)}%`, obj.color, 0.45);
      lb.position.set(obj.position3D.x, obj.position3D.y + sz / 2 + 0.15, obj.position3D.z);
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
            new THREE.Vector3(0, wp.position.y, 0),
            new THREE.Vector3(wp.lookAt.x, wp.lookAt.y, wp.lookAt.z));
        }
      } else selRef.current(null);
    };
    renderer.domElement.addEventListener('click', onClick);

    const onMove = (e: MouseEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(mouse, camera);
      renderer.domElement.style.cursor = ray.intersectObjects(targets, false).length > 0 ? 'pointer' : 'grab';
    };
    renderer.domElement.addEventListener('mousemove', onMove);

    stateRef.current = { camera, controls, renderer, objMeshes, sphere, clipPlane, hotspots, animId: 0 };

    const animate = () => {
      const id = requestAnimationFrame(animate);
      if (stateRef.current) stateRef.current.animId = id;
      controls.update();
      const t = Date.now() * 0.001;
      hotspots.forEach((hs, i) => {
        const s = 1 + Math.sin(t * 2 + i) * 0.2;
        hs.scale.set(s, 1, s);
      });
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

  // View mode switching
  useEffect(() => {
    if (!stateRef.current) return;
    const { camera, controls, sphere } = stateRef.current;
    const mat = sphere.material as THREE.MeshBasicMaterial;

    switch (viewMode) {
      case 'walkthrough': {
        // Inside the sphere
        controls.rotateSpeed = 0.5;
        controls.minDistance = 0.1;
        mat.clippingPlanes = [];
        const wp = data.waypoints[activeVP ?? 0];
        lerp3(camera, controls,
          new THREE.Vector3(0, 1.5, 0.1),
          new THREE.Vector3(wp.lookAt.x, wp.lookAt.y, wp.lookAt.z));
        break;
      }
      case 'orbit':
        controls.rotateSpeed = 1;
        controls.minDistance = 2;
        mat.clippingPlanes = [];
        lerp3(camera, controls, new THREE.Vector3(5, 4, 6), new THREE.Vector3(0, 1, 0));
        break;
      case 'dollhouse':
        controls.rotateSpeed = 1;
        controls.minDistance = 3;
        mat.clippingPlanes = [stateRef.current.clipPlane]; // Cut top half
        lerp3(camera, controls, new THREE.Vector3(3, 8, 4), new THREE.Vector3(0, 0, 0));
        break;
      case 'floorplan':
        controls.rotateSpeed = 1;
        controls.minDistance = 5;
        mat.clippingPlanes = [stateRef.current.clipPlane];
        lerp3(camera, controls, new THREE.Vector3(0, 14, 0.1), new THREE.Vector3(0, 0, 0));
        break;
    }
  }, [viewMode, data.waypoints, activeVP]);

  // Active viewpoint navigation (walkthrough)
  useEffect(() => {
    if (!stateRef.current || activeVP === null || viewMode !== 'walkthrough') return;
    const wp = data.waypoints[activeVP];
    if (!wp) return;
    lerp3(stateRef.current.camera, stateRef.current.controls,
      new THREE.Vector3(0, 1.5, 0.1),
      new THREE.Vector3(wp.lookAt.x, wp.lookAt.y, wp.lookAt.z), 600);
  }, [activeVP, viewMode, data.waypoints]);

  // Selection
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
        new THREE.Vector3(m.position.x * 0.3, m.position.y, m.position.z * 0.3),
        m.position.clone(), 600);
    }
  }, [selectedId]);

  return (
    <div className="v3d-viewer" ref={boxRef}>
      <div className="v3d-hints">
        <span>드래그: 둘러보기</span>
        <span>스크롤: 줌</span>
        <span>바닥 원: 뷰 전환</span>
        <span>큐브: 객체</span>
      </div>
    </div>
  );
}
