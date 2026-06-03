const TARGET_PIXELS = 180;
const ORBIT_RADIUS = 10;
const FOCUS_CENTER = new THREE.Vector3(0, 0, 0.12);
const FOCUS_SCALE = 1.05;
const FOCUS_SPEED = 0.045;

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export function createVisualizer({ canvasHost, vinylImg, onTrackSelect }) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x050505, 0.035);

  const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000,
  );
  camera.position.z = 16;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.style.position = "fixed";
  renderer.domElement.style.inset = "0";
  renderer.domElement.style.zIndex = "0";
  canvasHost.insertBefore(renderer.domElement, canvasHost.firstChild);

  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2(999, 999);
  const textureCache = {};
  const hitBoxes = [];
  const particleSystems = [];
  let playlist = [];
  let vinylGroup;
  let centerAlbum;
  let focusedIndex = -1;
  let focusAnim = { active: false, t: 0, fromPos: new THREE.Vector3() };

  const vinylTexture = new THREE.TextureLoader().load(vinylImg);
  const vinylMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8),
    new THREE.MeshBasicMaterial({ map: vinylTexture, transparent: true, side: THREE.DoubleSide }),
  );
  vinylGroup = new THREE.Group();
  vinylGroup.add(vinylMesh);
  scene.add(vinylGroup);

  centerAlbum = new THREE.Mesh(
    new THREE.PlaneGeometry(5.2, 5.2),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide }),
  );
  centerAlbum.visible = false;
  centerAlbum.renderOrder = 2;
  scene.add(centerAlbum);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(5, 5, 20);
  scene.add(dirLight);

  function particleUniforms() {
    return {
      uTime: { value: 0 },
      uHover: { value: 0 },
      uAlpha: { value: 1 },
    };
  }

  function clearParticles() {
    highlightIndex(-1);
    for (const p of particleSystems) scene.remove(p);
    for (const h of hitBoxes) scene.remove(h);
    particleSystems.length = 0;
    hitBoxes.length = 0;
    Object.keys(textureCache).forEach((k) => delete textureCache[k]);
  }

  function releaseFocusParticle(i) {
    if (i < 0 || !particleSystems[i]) return;
    particleSystems[i].visible = true;
    if (hitBoxes[i]) hitBoxes[i].visible = true;
  }

  function highlightIndex(index) {
    if (index === focusedIndex) return;

    if (focusedIndex >= 0) releaseFocusParticle(focusedIndex);

    focusedIndex = index;

    if (index < 0 || !particleSystems[index]) {
      focusAnim.active = false;
      centerAlbum.visible = false;
      centerAlbum.material.opacity = 0;
      return;
    }

    const p = particleSystems[index];
    focusAnim.fromPos.copy(p.position);
    focusAnim.t = 0;
    focusAnim.active = true;

    if (textureCache[index]) {
      centerAlbum.material.map = textureCache[index];
      centerAlbum.material.needsUpdate = true;
    }
    centerAlbum.position.copy(focusAnim.fromPos);
    centerAlbum.scale.setScalar(0.32);
    centerAlbum.material.opacity = 1;
    centerAlbum.visible = true;

    p.visible = false;
    if (hitBoxes[index]) hitBoxes[index].visible = false;
  }

  function createParticlesFromImage(image, index, total) {
    const aspectRatio = image.width / image.height;
    let pWidth, pHeight;
    if (aspectRatio > 1) {
      pWidth = TARGET_PIXELS;
      pHeight = TARGET_PIXELS / aspectRatio;
    } else {
      pWidth = TARGET_PIXELS * aspectRatio;
      pHeight = TARGET_PIXELS;
    }

    const tex = new THREE.CanvasTexture(image);
    textureCache[index] = tex;

    const canvas = document.createElement("canvas");
    canvas.width = pWidth;
    canvas.height = pHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, pWidth, pHeight);
    const imgData = ctx.getImageData(0, 0, pWidth, pHeight).data;

    const positions = [];
    const colors = [];
    const sizes = [];
    for (let y = 0; y < pHeight; y++) {
      for (let x = 0; x < pWidth; x++) {
        const i = (y * pWidth + x) * 4;
        if (imgData[i + 3] / 255 > 0.3) {
          const scale = 0.04;
          positions.push((x - pWidth / 2) * scale, (-(y - pHeight / 2)) * scale, 0);
          colors.push(imgData[i] / 255, imgData[i + 1] / 255, imgData[i + 2] / 255);
          sizes.push(0.8 + Math.random() * 0.4);
        }
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("customColor", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute("size", new THREE.Float32BufferAttribute(sizes, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: particleUniforms(),
      vertexShader: document.getElementById("vertexShader").textContent,
      fragmentShader: document.getElementById("fragmentShader").textContent,
      transparent: true,
      depthTest: false,
      blending: THREE.NormalBlending,
    });

    const particles = new THREE.Points(geometry, material);
    const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
    particles.position.set(
      Math.cos(angle) * ORBIT_RADIUS,
      Math.sin(angle) * ORBIT_RADIUS,
      0,
    );
    particles.userData = { initialAngle: angle, id: index };

    const hitMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(pWidth * 0.04, pHeight * 0.04),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    );
    hitMesh.position.copy(particles.position);
    hitMesh.userData = { id: index };

    scene.add(particles);
    scene.add(hitMesh);
    particleSystems.push(particles);
    hitBoxes.push(hitMesh);
  }

  function setPlaylist(tracks, onReady) {
    playlist = tracks;
    clearParticles();
    if (!tracks.length) {
      onReady?.();
      return;
    }

    const manager = new THREE.LoadingManager();
    manager.onLoad = () => onReady?.();
    const loader = new THREE.ImageLoader(manager);
    loader.setCrossOrigin("anonymous");

    tracks.forEach((track, i) => {
      const url = track.img || track.image_url;
      if (!url) {
        if (i === tracks.length - 1) manager.onLoad();
        return;
      }
      loader.load(url, (image) => createParticlesFromImage(image, i, tracks.length));
    });
  }

  function selectIndex(index) {
    if (index < 0 || index >= playlist.length) return null;
    highlightIndex(index);
    onTrackSelect?.(playlist[index], index);
    return playlist[index];
  }

  function findIndexBySongId(songId) {
    return playlist.findIndex((t) => t.song_id === songId);
  }

  function findIndexByQuery(query) {
    const q = (query || "").toLowerCase();
    let idx = playlist.findIndex((t) => t.title.toLowerCase().includes(q));
    if (idx >= 0) return idx;
    idx = playlist.findIndex((t) => t.artist.toLowerCase().includes(q));
    return idx;
  }

  const clock = new THREE.Clock();
  let vinylSpinning = false;

  function updateFocusAnimation() {
    if (!focusAnim.active || focusedIndex < 0) return;

    focusAnim.t = Math.min(1, focusAnim.t + FOCUS_SPEED);
    const e = easeOutCubic(focusAnim.t);

    centerAlbum.position.lerpVectors(focusAnim.fromPos, FOCUS_CENTER, e);
    const s = 0.32 + (FOCUS_SCALE - 0.32) * e;
    centerAlbum.scale.setScalar(s);

    if (vinylSpinning) {
      centerAlbum.rotation.z -= 0.012;
    }
  }

  function animate() {
    requestAnimationFrame(animate);
    const time = clock.getElapsedTime();
    if (vinylSpinning) vinylGroup.rotation.z -= 0.015;

    updateFocusAnimation();

    const galleryDimmed = focusedIndex >= 0 && focusAnim.t > 0.15;
    const orbitFade = galleryDimmed ? 0.28 : 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(hitBoxes.filter((h) => h.visible));
    let hovered = -1;
    if (intersects.length) hovered = intersects[0].object.userData.id;

    for (let i = 0; i < particleSystems.length; i++) {
      const p = particleSystems[i];
      if (!p.visible) continue;

      p.material.uniforms.uTime.value = time;
      const angle = p.userData.initialAngle - time * 0.1;
      p.position.set(
        Math.cos(angle) * ORBIT_RADIUS,
        Math.sin(angle) * ORBIT_RADIUS,
        0,
      );
      if (hitBoxes[i]?.visible) hitBoxes[i].position.copy(p.position);

      const targetHover = galleryDimmed ? 0 : i === hovered ? 1 : 0;
      p.material.uniforms.uHover.value +=
        (targetHover - p.material.uniforms.uHover.value) * 0.1;
      p.material.uniforms.uAlpha.value +=
        (orbitFade - p.material.uniforms.uAlpha.value) * 0.08;
    }

    document.body.style.cursor = hovered > -1 && !galleryDimmed ? "pointer" : "default";
    renderer.render(scene, camera);
  }

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  window.addEventListener("mousemove", (e) => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  });

  window.addEventListener("click", (e) => {
    if (e.target.closest("button, a, #voice-panel, #transcript-panel, input, select, textarea")) return;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(hitBoxes.filter((h) => h.visible));
    if (!hits.length) return;
    selectIndex(hits[0].object.userData.id);
  });

  animate();

  return {
    setPlaylist,
    selectIndex,
    highlightIndex,
    findIndexBySongId,
    findIndexByQuery,
    setVinylSpinning: (on) => { vinylSpinning = on; },
    getPlaylist: () => playlist,
    remapPlaylist: (tracks) => setPlaylist(tracks),
  };
}
