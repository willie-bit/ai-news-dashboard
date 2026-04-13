import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { VideoAnalysis, DetectedObject } from './types';

interface Props {
  analysis: VideoAnalysis;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

function makeLabel(text: string, color: string): THREE.Sprite {
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
  ctx.fillStyle = '#fff'; ctx.font = 'bold 44px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height / 2);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
  sprite.scale.set(2.4, 0.6, 1);
  return sprite;
}

export function ThreeDViewer({ analysis, selectedId, onSelect }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{ meshes: Map<string, THREE.Mesh>; animId: number } | null>(null);

  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  useEffect(() => {
    const el = boxRef.current;
    if (!el || stateRef.current) return;

    const w = el.clientWidth, h = el.clientHeight;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0f1e);
    scene.fog = new THREE.Fog(0x0a0f1e, 20, 60);

    const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 100);
    camera.position.set(5, 3, 5);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 0, -5);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dl = new THREE.DirectionalLight(0xffffff, 0.8);
    dl.position.set(5, 10, 5);
    scene.add(dl);

    const grid = new THREE.GridHelper(40, 40, 0x1e293b, 0x1e293b);
    grid.position.y = -4;
    scene.add(grid);

    // Timeline axis
    const axLen = analysis.frames.length * 3 + 2;
    const axGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -3.5, 1), new THREE.Vector3(0, -3.5, -axLen),
    ]);
    scene.add(new THREE.Line(axGeo, new THREE.LineBasicMaterial({ color: 0x6366f1 })));

    // Frame planes
    analysis.frames.forEach((frame, i) => {
      const geo = new THREE.PlaneGeometry(6, 6 / (16 / 9));
      const tex = new THREE.TextureLoader().load(frame.imageUrl);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
      mesh.position.set(0, 0, -i * 3);
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x6366f1 })));

      // Time label
      const tc = document.createElement('canvas'); tc.width = 256; tc.height = 64;
      const tctx = tc.getContext('2d')!;
      tctx.fillStyle = 'rgba(0,0,0,0.7)'; tctx.fillRect(0, 0, 256, 64);
      tctx.fillStyle = '#fff'; tctx.font = '32px sans-serif'; tctx.textAlign = 'center'; tctx.textBaseline = 'middle';
      tctx.fillText(`${frame.timestamp.toFixed(1)}s`, 128, 32);
      const ts = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(tc) }));
      ts.scale.set(1.5, 0.375, 1);
      ts.position.set(0, -(6 / (16 / 9)) / 2 - 0.4, 0);
      mesh.add(ts);
      scene.add(mesh);
    });

    // Object cubes
    const meshes = new Map<string, THREE.Mesh>();
    analysis.allObjects.forEach((obj) => {
      const sz = Math.max((obj.bbox[2] / analysis.videoWidth) * 4, (obj.bbox[3] / analysis.videoHeight) * 3, 0.3);
      const geo = new THREE.BoxGeometry(sz, sz, sz);
      const mat = new THREE.MeshPhongMaterial({ color: obj.color, transparent: true, opacity: 0.7, emissive: obj.color, emissiveIntensity: 0.2 });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(obj.position3D.x, obj.position3D.y, obj.position3D.z);
      m.userData.objectId = obj.id;
      m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: obj.color })));
      scene.add(m);
      meshes.set(obj.id, m);

      const label = makeLabel(`${obj.label} ${Math.round(obj.score * 100)}%`, obj.color);
      label.position.set(obj.position3D.x, obj.position3D.y + sz / 2 + 0.5, obj.position3D.z);
      scene.add(label);
    });

    // Trajectory lines
    const groups = new Map<string, DetectedObject[]>();
    analysis.allObjects.forEach((o) => { const g = groups.get(o.label) || []; g.push(o); groups.set(o.label, g); });
    groups.forEach((objs) => {
      if (objs.length < 2) return;
      const sorted = [...objs].sort((a, b) => a.frameIndex - b.frameIndex);
      const pts = sorted.map((o) => new THREE.Vector3(o.position3D.x, o.position3D.y, o.position3D.z));
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineDashedMaterial({ color: sorted[0].color, dashSize: 0.3, gapSize: 0.15, transparent: true, opacity: 0.5 })
      );
      line.computeLineDistances();
      scene.add(line);
    });

    // Particles
    const pCount = 400;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount; i++) {
      pPos[i * 3] = (Math.random() - 0.5) * 30;
      pPos[i * 3 + 1] = (Math.random() - 0.5) * 15;
      pPos[i * 3 + 2] = -Math.random() * axLen;
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    scene.add(new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0x6366f1, size: 0.05, transparent: true, opacity: 0.4 })));

    // Raycaster click
    const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
    const onClick = (e: MouseEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(mouse, camera);
      const hits = ray.intersectObjects(Array.from(meshes.values()), false);
      selectRef.current(hits.length > 0 ? hits[0].object.userData.objectId : null);
    };
    renderer.domElement.addEventListener('click', onClick);

    stateRef.current = { meshes, animId: 0 };

    const animate = () => {
      const id = requestAnimationFrame(animate);
      if (stateRef.current) stateRef.current.animId = id;
      controls.update();
      const arr = pGeo.attributes.position.array as Float32Array;
      for (let i = 0; i < pCount; i++) arr[i * 3 + 1] += Math.sin(Date.now() * 0.001 + i) * 0.001;
      pGeo.attributes.position.needsUpdate = true;
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
      cancelAnimationFrame(stateRef.current?.animId || 0);
      renderer.dispose();
      if (renderer.domElement.parentNode === el) el.removeChild(renderer.domElement);
      stateRef.current = null;
    };
  }, [analysis]);

  // Selection highlight
  useEffect(() => {
    if (!stateRef.current) return;
    stateRef.current.meshes.forEach((mesh, id) => {
      const mat = mesh.material as THREE.MeshPhongMaterial;
      const selected = id === selectedId;
      mat.emissiveIntensity = selected ? 0.8 : 0.2;
      mat.opacity = selected ? 1 : 0.7;
      mesh.scale.setScalar(selected ? 1.3 : 1);
    });
  }, [selectedId]);

  return (
    <div className="v3d-viewer" ref={boxRef}>
      <div className="v3d-hints">
        <span>드래그: 회전</span>
        <span>스크롤: 줌</span>
        <span>우클릭: 이동</span>
        <span>클릭: 객체 선택</span>
      </div>
    </div>
  );
}
