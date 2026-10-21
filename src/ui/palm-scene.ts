import * as THREE from "three";

/** Small, procedural orchard. No images, external assets, shadows or postprocessing. */
export function createPalmScene(
  host: HTMLElement,
  onReady: (ready: boolean) => void,
) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", { alpha: true, antialias: true });
  if (!context) throw new Error("WebGL is unavailable");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    context,
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  canvas.tabIndex = -1;
  host.appendChild(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-5, 5, 4, -4, 0.1, 50);
  camera.position.set(8, 6.5, 10);
  camera.lookAt(0, 1.2, 0);
  scene.add(new THREE.HemisphereLight(0xfff7dd, 0x78905b, 2.8));
  const light = new THREE.DirectionalLight(0xffefcf, 3);
  light.position.set(-3, 8, 5);
  scene.add(light);
  const orchard = new THREE.Group();
  scene.add(orchard);
  const material = (color: number) =>
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.95,
      flatShading: true,
    });
  const soil = material(0xbeb28d),
    grass = material(0xc2d29a),
    trunkMaterial = material(0xa17a4e);
  const leafMaterials = [0x36794a, 0x478b52, 0x246743, 0x5b995c].map(
    (color) =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.9,
        side: THREE.DoubleSide,
        flatShading: true,
      }),
  );
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(3.6, 3.45, 0.38, 64),
    soil,
  );
  base.scale.z = 0.78;
  base.position.y = -0.22;
  orchard.add(base);
  const lawn = new THREE.Mesh(
    new THREE.CylinderGeometry(3.6, 3.6, 0.055, 64),
    grass,
  );
  lawn.scale.z = 0.78;
  lawn.position.y = -0.015;
  orchard.add(lawn);
  const crowns: THREE.Group[] = [];
  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x395b35,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
  });
  function palm(x: number, z: number, scale: number, twist: number) {
    const tree = new THREE.Group();
    tree.position.set(x, 0.02, z);
    tree.scale.setScalar(scale);
    tree.rotation.y = twist;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(-0.1, 0.85, 0),
      new THREE.Vector3(0.12, 1.6, 0.03),
      new THREE.Vector3(0.08, 2.5, 0),
    ]);
    tree.add(
      new THREE.Mesh(
        new THREE.TubeGeometry(curve, 14, 0.105, 7, false),
        trunkMaterial,
      ),
    );
    const crown = new THREE.Group();
    crown.position.set(0.08, 2.47, 0);
    crowns.push(crown);
    tree.add(crown);
    for (let frond = 0; frond < 9; frond++) {
      const angle = (frond * Math.PI * 2) / 9;
      const length = 1.35 + (frond % 3) * 0.12;
      const vertices: number[] = [];
      const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const side = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
      const point = (t: number) =>
        direction
          .clone()
          .multiplyScalar(t * length)
          .add(
            new THREE.Vector3(0, 0.65 * Math.sin(t * Math.PI) - t * 0.37, 0),
          );
      for (let j = 1; j < 10; j++) {
        const t = j / 11;
        for (const sign of [-1, 1]) {
          const root = point(t),
            next = point(Math.min(t + 0.13, 1));
          const tip = point(Math.min(t + 0.16, 1)).addScaledVector(
            side,
            sign * 0.4 * Math.sin(Math.PI * t),
          );
          tip.y -= 0.11;
          const middle = root.clone().lerp(tip, 0.55);
          middle.y += 0.06;
          for (const p of [root, middle, next, middle, tip, next])
            vertices.push(p.x, p.y, p.z);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(vertices, 3),
      );
      geometry.computeVertexNormals();
      crown.add(
        new THREE.Mesh(geometry, leafMaterials[frond % leafMaterials.length]),
      );
    }
    for (let i = 0; i < 3; i++) {
      const fruit = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 7, 5),
        trunkMaterial,
      );
      fruit.position.set(
        Math.cos(i * 2.1) * 0.12,
        -0.08,
        Math.sin(i * 2.1) * 0.12,
      );
      crown.add(fruit);
    }
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.75, 24),
      shadowMaterial,
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.025;
    shadow.scale.set(1.3, 0.6, 1);
    tree.add(shadow);
    orchard.add(tree);
  }
  palm(-1.4, -0.8, 1.05, 0.3);
  palm(1.25, -1, 1.1, 1);
  palm(0.05, 0.95, 1.22, 0.65);
  palm(-2, 0.9, 0.65, 2);
  palm(2.25, 0.8, 0.7, 1.5);
  const stoneMaterial = material(0xe8dcbc);
  for (let i = 0; i < 9; i++) {
    const pebble = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.2, 0.035, 8),
      stoneMaterial,
    );
    pebble.position.set(0.75 + Math.sin(i * 0.28) * 0.7, 0.04, 2.55 - i * 0.48);
    pebble.rotation.y = i * 0.6;
    orchard.add(pebble);
  }
  const shrubMaterial = material(0x809e59);
  for (const [x, z] of [
    [-2.8, 0],
    [2.7, -0.1],
    [-1.1, 2.1],
    [1.9, 1.8],
  ]) {
    for (let i = 0; i < 3; i++) {
      const shrub = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.22 + i * 0.04, 0),
        shrubMaterial,
      );
      shrub.position.set(x + i * 0.16, 0.16, z + (i % 2) * 0.1);
      shrub.scale.y = 0.8;
      orchard.add(shrub);
    }
  }
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0,
    visible = true,
    previous = 0,
    lost = false;
  let pointerX = 0,
    pointerY = 0;
  function render(time = 0) {
    if (lost) return;
    const seconds = time / 1000;
    orchard.rotation.y = motion.matches
      ? -0.12
      : -0.12 + Math.sin(seconds * 0.18) * 0.045 + pointerX * 0.05;
    orchard.rotation.x = motion.matches ? 0 : pointerY * 0.015;
    crowns.forEach((crown, i) => {
      crown.rotation.z = motion.matches
        ? 0
        : Math.sin(seconds * 0.7 + i) * 0.025;
    });
    renderer.render(scene, camera);
  }
  function tick(time: number) {
    if (time - previous >= 1000 / 30) {
      previous = time;
      render(time);
    }
    frame = window.requestAnimationFrame(tick);
  }
  function resume() {
    window.cancelAnimationFrame(frame);
    frame = 0;
    if (lost) return;
    render();
    if (visible && !document.hidden && !motion.matches)
      frame = window.requestAnimationFrame(tick);
  }
  const resize = new ResizeObserver(() => {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height);
    const aspect = width / height,
      span = aspect < 1.2 ? 7.9 : 6.8;
    camera.left = (-span * aspect) / 2;
    camera.right = (span * aspect) / 2;
    camera.top = span / 2;
    camera.bottom = -span / 2;
    camera.updateProjectionMatrix();
    render();
    if (!lost) onReady(true);
  });
  resize.observe(host);
  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    resume();
  });
  intersection.observe(host);
  const pointer = (event: PointerEvent) => {
    pointerX = event.clientX / window.innerWidth - 0.5;
    pointerY = event.clientY / window.innerHeight - 0.5;
  };
  const contextLost = (event: Event) => {
    event.preventDefault();
    lost = true;
    window.cancelAnimationFrame(frame);
    onReady(false);
  };
  const contextRestored = () => {
    lost = false;
    onReady(true);
    resume();
  };
  window.addEventListener("pointermove", pointer, { passive: true });
  document.addEventListener("visibilitychange", resume);
  motion.addEventListener("change", resume);
  canvas.addEventListener("webglcontextlost", contextLost);
  canvas.addEventListener("webglcontextrestored", contextRestored);
  resume();
  return () => {
    window.cancelAnimationFrame(frame);
    resize.disconnect();
    intersection.disconnect();
    window.removeEventListener("pointermove", pointer);
    document.removeEventListener("visibilitychange", resume);
    motion.removeEventListener("change", resume);
    canvas.removeEventListener("webglcontextlost", contextLost);
    canvas.removeEventListener("webglcontextrestored", contextRestored);
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>();
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        geometries.add(object.geometry);
        (Array.isArray(object.material)
          ? object.material
          : [object.material]
        ).forEach((m) => materials.add(m));
      }
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  };
}
