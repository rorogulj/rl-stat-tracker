import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { api, fmtDur } from '../api.js';
import { OCTAGON, BIG_PADS, SMALL_PADS, FIELD as F } from '../field.js';

// RL coordinates → three.js (Y-up): tx = x, ty = z, tz = -y (with a flip for my team's orientation)
const FIELD = { X: 4096, Y: 5120, Z: 2044 };

/** Build the RL arena: octagon floor, walls with goal openings, recessed goals, boost pads. */
function buildArena(scene, myTeam) {
  const WALL_H = FIELD.Z;
  const wallMat = new THREE.MeshBasicMaterial({ color: 0x18264f, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false });
  const lineMat = new THREE.LineBasicMaterial({ color: 0x2e4a8f, transparent: true, opacity: 0.55 });

  // floor (octagon)
  const shape = new THREE.Shape();
  OCTAGON.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: 0x081234, roughness: 0.92 }));
  floor.rotation.x = -Math.PI / 2; // (x,y) → (x,0,-y)
  scene.add(floor);

  // floor lines: edge, midfield, circle
  const mkLine = (pts, loop = false) => {
    const g = new THREE.BufferGeometry().setFromPoints(pts.map(([x, z]) => new THREE.Vector3(x, 4, z)));
    scene.add(loop ? new THREE.LineLoop(g, lineMat) : new THREE.Line(g, lineMat));
  };
  const octXZ = OCTAGON.map(([x, y]) => [x, -y]);
  mkLine([[-FIELD.X, 0], [FIELD.X, 0]]);
  const circ = [];
  for (let a = 0; a <= 48; a++) circ.push([Math.cos((a / 48) * Math.PI * 2) * 1150, Math.sin((a / 48) * Math.PI * 2) * 1150]);
  mkLine(circ, true);

  // ---------- rounded walls (like in RL: the floor curves into the wall, the wall into the ceiling) ----------
  const R1 = 280, R2 = 220, SEG1 = 7, SEG2 = 4;
  // wall cross-section profile: [distance from the wall plane toward the field, height]
  const profile = [];
  for (let k = 0; k <= SEG1; k++) {
    const th = (k / SEG1) * (Math.PI / 2);
    profile.push([R1 - R1 * Math.sin(th), R1 - R1 * Math.cos(th)]); // bottom fillet: floor → wall
  }
  profile.push([0, WALL_H - R2]); // vertical section
  for (let k = 1; k <= SEG2; k++) {
    const ph = (k / SEG2) * (Math.PI / 2);
    profile.push([R2 - R2 * Math.cos(ph), WALL_H - R2 + R2 * Math.sin(ph)]); // top fillet: wall → ceiling
  }

  // inward edge normal (toward the center of the field)
  const inwardN = (ax, az, bx, bz) => {
    let dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz); dx /= len; dz /= len;
    let nx = -dz, nz = dx;
    if (nx * -(ax + bx) / 2 + nz * -(az + bz) / 2 < 0) { nx = -nx; nz = -nz; }
    return [nx, nz];
  };

  const mkMesh = (pos, idx) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    scene.add(new THREE.Mesh(g, wallMat));
  };

  // curved wall strip along one edge
  const mkCurvedWall = (ax, az, bx, bz) => {
    const [nx, nz] = inwardN(ax, az, bx, bz);
    const pos = [], idx = [];
    for (const [s, y] of profile) {
      pos.push(ax + nx * s, y, az + nz * s, bx + nx * s, y, bz + nz * s);
    }
    for (let j = 0; j < profile.length - 1; j++) {
      const a0 = j * 2, b0 = a0 + 1, a1 = a0 + 2, b1 = a0 + 3;
      idx.push(a0, b0, a1, b0, b1, a1);
    }
    mkMesh(pos, idx);
  };

  // corner patch: profile rotated between the normals of adjacent edges (fills the seam)
  const mkCorner = (vx, vz, n1, n2) => {
    const STEPS = 4;
    const a1 = Math.atan2(n1[1], n1[0]);
    let dA = Math.atan2(n2[1], n2[0]) - a1;
    while (dA > Math.PI) dA -= 2 * Math.PI;
    while (dA < -Math.PI) dA += 2 * Math.PI;
    const pos = [], idx = [];
    for (const [s, y] of profile) {
      for (let k = 0; k <= STEPS; k++) {
        const ang = a1 + dA * (k / STEPS);
        pos.push(vx + Math.cos(ang) * s, y, vz + Math.sin(ang) * s);
      }
    }
    for (let j = 0; j < profile.length - 1; j++) {
      for (let k = 0; k < STEPS; k++) {
        const r0 = j * (STEPS + 1) + k, r1 = r0 + STEPS + 1;
        idx.push(r0, r0 + 1, r1, r0 + 1, r1 + 1, r1);
      }
    }
    mkMesh(pos, idx);
  };

  // flat panel (above the goal)
  const panel = (x1, z1, x2, z2, y0, y1) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, y1 - y0), wallMat);
    m.position.set((x1 + x2) / 2, (y0 + y1) / 2, (z1 + z2) / 2);
    m.rotation.y = Math.atan2(-(z2 - z1), x2 - x1);
    scene.add(m);
  };

  const nEdges = octXZ.length;
  const edgeNormals = octXZ.map(([ax, az], i) => {
    const [bx, bz] = octXZ[(i + 1) % nEdges];
    return inwardN(ax, az, bx, bz);
  });
  for (let i = 0; i < nEdges; i++) {
    const [ax, az] = octXZ[i], [bx, bz] = octXZ[(i + 1) % nEdges];
    const isBack = Math.abs(az) === FIELD.Y && az === bz;
    if (!isBack) {
      mkCurvedWall(ax, az, bx, bz);
    } else {
      // back wall: curved left/right of the goal, flat above the opening
      const xs = Math.min(ax, bx), xe = Math.max(ax, bx);
      mkCurvedWall(xs, az, -F.GOAL_HALF_W, az);
      mkCurvedWall(F.GOAL_HALF_W, az, xe, az);
      panel(-F.GOAL_HALF_W, az, F.GOAL_HALF_W, az, F.GOAL_H, WALL_H);
    }
    // patch at the seam between this edge and the next
    mkCorner(bx, bz, edgeNormals[i], edgeNormals[(i + 1) % nEdges]);
  }

  // convex inset of the octagon (for the lines where the curve meets the floor / top)
  const insetOct = (inset) => {
    const lines = octXZ.map(([ax, az], i) => {
      const [bx, bz] = octXZ[(i + 1) % nEdges];
      const [nx, nz] = edgeNormals[i];
      let dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz); dx /= len; dz /= len;
      return { px: ax + nx * inset, pz: az + nz * inset, dx, dz };
    });
    return lines.map((L2, i) => {
      const L1 = lines[(i - 1 + nEdges) % nEdges];
      const det = L1.dx * L2.dz - L1.dz * L2.dx;
      const t = ((L2.px - L1.px) * L2.dz - (L2.pz - L1.pz) * L2.dx) / (det || 1e-9);
      return [L1.px + L1.dx * t, L1.pz + L1.dz * t];
    });
  };
  mkLine(insetOct(R1), true); // edge where the floor transitions into the curve
  const topRing = insetOct(R2).map(([x, z]) => new THREE.Vector3(x, WALL_H, z));
  scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(topRing), lineMat));

  // recessed goals (near +z = my goal)
  const mkGoal = (zSign, color) => {
    const zc = (FIELD.Y + F.GOAL_DEPTH / 2) * zSign;
    const box = new THREE.BoxGeometry(F.GOAL_HALF_W * 2, F.GOAL_H, F.GOAL_DEPTH);
    const fill = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.09, depthWrite: false }));
    fill.position.set(0, F.GOAL_H / 2, zc);
    scene.add(fill);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.75 }));
    edges.position.copy(fill.position);
    scene.add(edges);
    // glowing frame around the opening
    const fg = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-F.GOAL_HALF_W, 0, FIELD.Y * zSign), new THREE.Vector3(-F.GOAL_HALF_W, F.GOAL_H, FIELD.Y * zSign),
      new THREE.Vector3(F.GOAL_HALF_W, F.GOAL_H, FIELD.Y * zSign), new THREE.Vector3(F.GOAL_HALF_W, 0, FIELD.Y * zSign),
    ]);
    scene.add(new THREE.Line(fg, new THREE.LineBasicMaterial({ color, linewidth: 2 })));
  };
  const myCol = myTeam === 0 ? 0x55a3f5 : 0xf09a52;
  const oppCol = myTeam === 0 ? 0xf09a52 : 0x55a3f5;
  mkGoal(1, myCol);   // closer to the camera = my goal
  mkGoal(-1, oppCol);

  // boost pads
  const padMatBig = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.85 });
  const padMatSmall = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.35 });
  for (const [x, y] of BIG_PADS) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(150, 150, 14, 20), padMatBig);
    p.position.set(x, 8, -y);
    scene.add(p);
  }
  for (const [x, y] of SMALL_PADS) {
    const p = new THREE.Mesh(new THREE.CircleGeometry(55, 12), padMatSmall);
    p.rotation.x = -Math.PI / 2;
    p.position.set(x, 5, -y);
    scene.add(p);
  }
}

/** 3D replay viewer — field, cars, ball; camera: free / follows the ball / behind the car. */
export default function Replay3D({ matchId, goals = [], myTeam = 0, myKey = null }) {
  const [tl, setTl] = useState(null);
  const [err, setErr] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(2);
  const [pos, setPos] = useState(0);
  const [camMode, setCamMode] = useState('ball'); // 'free' | 'ball' | 'chase'
  const [highlights, setHighlights] = useState(false);
  const mountRef = useRef(null);
  const stateRef = useRef({ pos: 0, playing: true, speed: 2, cam: 'ball', theta: 0, phi: 0.42, dist: 9000 });
  const hlRef = useRef(0); // index of the current goal in highlights mode
  const threeRef = useRef(null);

  useEffect(() => { api.timeline(matchId).then(setTl).catch(() => setErr(true)); }, [matchId]);

  const seekToGoal = (g) => {
    if (!tl) return;
    const idx = tl.samples.findIndex((s) => s[0] >= g.time - 6);
    if (idx >= 0) { stateRef.current.pos = idx; setPos(idx); }
  };

  const startHighlights = () => {
    if (!goals.length) return;
    hlRef.current = 0;
    setHighlights(true);
    setSpeed(1);
    seekToGoal(goals[0]);
    setPlaying(true);
  };

  // highlights: once we pass 2.5 s after a goal, jump to the next one; stop after the last
  useEffect(() => {
    if (!highlights || !tl) return;
    const i = Math.max(0, Math.min(tl.samples.length - 1, Math.floor(pos)));
    const curT = tl.samples[i][0];
    const g = goals[hlRef.current];
    if (!g) { setHighlights(false); return; }
    if (curT > g.time + 2.5) {
      const next = hlRef.current + 1;
      if (next >= goals.length) { setHighlights(false); setPlaying(false); }
      else { hlRef.current = next; seekToGoal(goals[next]); }
    }
  }, [pos, highlights, tl]); // eslint-disable-line

  stateRef.current.playing = playing;
  stateRef.current.speed = speed;
  stateRef.current.cam = camMode;
  const myIdx = tl ? Math.max(0, tl.players.findIndex((p) => p.key === myKey)) : 0;

  const flipSign = myTeam === 1 ? -1 : 1; // my goal always "toward the camera"

  // ---------- scene ----------
  useEffect(() => {
    if (!tl || !mountRef.current) return;
    const W = mountRef.current.clientWidth, H = 560;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); // preserve: for full-page PNG export
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    mountRef.current.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x010828);
    scene.fog = new THREE.Fog(0x010828, 12000, 26000);

    const camera = new THREE.PerspectiveCamera(55, W / H, 10, 60000);

    // lights
    scene.add(new THREE.AmbientLight(0x8899cc, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1);
    sun.position.set(2000, 6000, 3000);
    scene.add(sun);

    // RL arena: octagon floor, walls with openings, recessed goals, boost pads
    buildArena(scene, myTeam);

    // ball
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(93, 24, 18),
      new THREE.MeshStandardMaterial({ color: 0xf1f5f9, emissive: 0x8877cc, emissiveIntensity: 0.35, roughness: 0.4 })
    );
    scene.add(ball);
    const ballGlow = new THREE.PointLight(0xd8b4fe, 1.4, 2600);
    ball.add(ballGlow);
    // ball shadow (circle on the floor)
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(80, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 3;
    scene.add(shadow);

    // cars + names
    const cars = tl.players.map((p) => {
      const col = p.team === 0 ? 0x55a3f5 : 0xf09a52;
      const grp = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(84, 36, 118),
        new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.25, roughness: 0.5 })
      );
      body.position.y = 18;
      grp.add(body);
      const nose = new THREE.Mesh(new THREE.BoxGeometry(40, 20, 40), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      nose.position.set(0, 24, -70); // nose toward -z locally
      grp.add(nose);
      // name as a sprite
      const nCv = document.createElement('canvas');
      nCv.width = 256; nCv.height = 64;
      const nc = nCv.getContext('2d');
      nc.font = '600 30px "Cascadia Mono", Consolas, monospace';
      nc.textAlign = 'center';
      nc.fillStyle = '#fff';
      nc.strokeStyle = 'rgba(0,0,0,0.8)'; nc.lineWidth = 6;
      nc.strokeText(p.name.slice(0, 14), 128, 42);
      nc.fillText(p.name.slice(0, 14), 128, 42);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(nCv), depthTest: false }));
      sprite.scale.set(900, 225, 1);
      sprite.position.y = 220;
      grp.add(sprite);
      scene.add(grp);
      return grp;
    });

    threeRef.current = { renderer, scene, camera, ball, shadow, cars, W, H };

    // orbit controls (drag + wheel)
    const el = renderer.domElement;
    let dragging = false, lastX = 0, lastY = 0;
    const onDown = (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; };
    const onMove = (e) => {
      if (!dragging) return;
      stateRef.current.theta -= (e.clientX - lastX) * 0.005;
      stateRef.current.phi = Math.max(0.12, Math.min(1.35, stateRef.current.phi + (e.clientY - lastY) * 0.004));
      lastX = e.clientX; lastY = e.clientY;
    };
    const onUp = () => { dragging = false; };
    const onWheel = (e) => {
      e.preventDefault();
      stateRef.current.dist = Math.max(2500, Math.min(22000, stateRef.current.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
    };
    el.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.style.cursor = 'grab';

    // ---------- animation ----------
    let last = performance.now();
    let raf;
    const loop = (now) => {
      const dt = Math.max(0, (now - last) / 1000); last = now; // the rAF timestamp can be earlier than performance.now()
      const st = stateRef.current;
      const samples = tl.samples;
      if (!samples.length) { raf = requestAnimationFrame(loop); return; }
      if (st.playing) {
        st.pos += dt * 10 * st.speed;
        if (st.pos >= samples.length - 1) { st.pos = samples.length - 1; setPlaying(false); }
        setPos(st.pos);
      }
      st.pos = Math.max(0, Math.min(samples.length - 1, st.pos));
      const i = Math.max(0, Math.min(samples.length - 1, Math.floor(st.pos)));
      const frac = Math.min(1, st.pos - i);
      const s0 = samples[i], s1 = samples[Math.min(samples.length - 1, i + 1)];
      const lerp = (a, b) => (a == null || b == null) ? (a ?? b ?? 0) : a + (b - a) * frac;

      // RL → three (flip by my team)
      const toX = (x) => x * flipSign;
      const toZ = (y) => -y * flipSign;

      const bx = toX(lerp(s0[1], s1[1])), bz = toZ(lerp(s0[2], s1[2])), by = Math.max(93, lerp(s0[3], s1[3]));
      ball.position.set(bx, by, bz);
      shadow.position.set(bx, 3, bz);
      const sc = Math.max(0.3, 1 - by / 4000);
      shadow.scale.set(sc, sc, 1);

      cars.forEach((grp, pi) => {
        const off = 4 + pi * 5;
        const x = s0[off], y = s0[off + 1];
        if (x == null || y == null) { grp.visible = false; return; }
        grp.visible = true;
        grp.position.set(toX(lerp(s0[off], s1[off])), Math.max(0, lerp(s0[off + 2], s1[off + 2]) - 17), toZ(lerp(s0[off + 1], s1[off + 1])));
        const yaw = s0[off + 3] ?? 0;
        // direction (cos yaw, sin yaw) in RL xy → three (x, -y*z-axis); nose faces -z locally
        grp.rotation.y = Math.atan2(Math.cos(yaw) * flipSign, -Math.sin(yaw) * flipSign) + Math.PI / 2;
      });

      // camera
      const st2 = stateRef.current;
      const myCar = cars[myIdx];
      if (st2.cam === 'chase' && myCar && myCar.visible) {
        // behind my car, looking at the ball (in-game ball-cam)
        const dir = new THREE.Vector3().subVectors(myCar.position, ball.position);
        dir.y = 0;
        if (dir.lengthSq() < 1) dir.set(0, 0, 1);
        dir.normalize();
        const desired = new THREE.Vector3()
          .copy(myCar.position)
          .addScaledVector(dir, 950)
          .add(new THREE.Vector3(0, 380, 0));
        camera.position.lerp(desired, 0.12); // smooth follow
        camera.lookAt(ball.position.x, ball.position.y + 60, ball.position.z);
      } else {
        const target = st2.cam === 'ball' ? ball.position : new THREE.Vector3(0, 200, 0);
        const cx = target.x + st2.dist * Math.sin(st2.theta) * Math.cos(st2.phi);
        const cz = target.z + st2.dist * Math.cos(st2.theta) * Math.cos(st2.phi) + (st2.cam === 'ball' ? 1500 : 0);
        const cy = 400 + st2.dist * Math.sin(st2.phi);
        camera.position.set(cx, cy, Math.min(FIELD.Y * 2.4, Math.max(-FIELD.Y * 2.4, cz)));
        camera.lookAt(target.x, Math.min(1200, target.y + 150), target.z);
      }

      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      el.removeEventListener('wheel', onWheel);
      renderer.dispose();
      if (mountRef.current) mountRef.current.innerHTML = '';
    };
  }, [tl, flipSign, myTeam, myIdx]);

  if (err) return <div className="empty"><h3>Timeline not available</h3></div>;
  if (!tl) return <div className="empty"><h3>Loading 3D replay…</h3></div>;

  const samples = tl.samples;
  if (!samples.length) return <div className="empty"><h3>Timeline is empty</h3></div>;
  const i = Math.max(0, Math.min(samples.length - 1, Math.floor(pos)));
  const curT = samples[i][0];
  const score = goals.reduce((acc, g) => { if (g.time <= curT) acc[g.team]++; return acc; }, [0, 0]);

  return (
    <div className="viewer card">
      <div className="viewer-head">
        <div className="viewer-score">
          <span style={{ color: '#55a3f5' }}>{score[0]}</span>
          <span style={{ color: '#4d5678', margin: '0 8px' }}>:</span>
          <span style={{ color: '#f09a52' }}>{score[1]}</span>
        </div>
        <div className="viewer-time">{fmtDur(curT - samples[0][0])} / {fmtDur(samples[samples.length - 1][0] - samples[0][0])}</div>
      </div>
      <div ref={mountRef} style={{ width: '100%', borderRadius: 12, overflow: 'hidden' }} />
      <div className="viewer-controls">
        <button className="vc-btn" onClick={() => { stateRef.current.pos = 0; setPos(0); }}>⏮</button>
        <button className="vc-btn main" onClick={() => setPlaying(!playing)}>{playing ? '⏸' : '▶'}</button>
        {[['free', 'Free'], ['ball', 'Ball'], ['chase', 'Chase cam']].map(([v, label]) => (
          <button key={v} className={`vc-btn speed ${camMode === v ? 'active' : ''}`} onClick={() => setCamMode(v)}>{label}</button>
        ))}
        {[1, 2, 4, 8].map((s) => (
          <button key={s} className={`vc-btn speed ${speed === s ? 'active' : ''}`} onClick={() => setSpeed(s)}>{s}×</button>
        ))}
        <input type="range" min={0} max={samples.length - 1} step={0.5} value={pos} className="vc-scrub"
          onChange={(e) => { const v = Number(e.target.value); stateRef.current.pos = v; setPos(v); setHighlights(false); }} />
      </div>
      <div className="viewer-goals">
        {goals.length > 0 && (
          <button className={`vc-btn speed ${highlights ? 'active' : ''}`}
            onClick={() => (highlights ? setHighlights(false) : startHighlights())}>
            {highlights ? `■ Highlights (${hlRef.current + 1}/${goals.length})` : '★ Highlights'}
          </button>
        )}
        {goals.map((g, k) => (
          <button key={k} className={`vg t${g.team}`} title={g.player}
            onClick={() => { setHighlights(false); seekToGoal(g); setPlaying(true); }}>
            Goal {fmtDur(g.time)}
          </button>
        ))}
      </div>
      <div className="footnote">Drag to rotate camera · scroll to zoom · your goal is nearest the camera</div>
    </div>
  );
}
