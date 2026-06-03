const TARGET_PIXELS = 180;

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

  const vinylTexture = new THREE.TextureLoader().load(vinylImg);
  const vinylMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8),
    new THREE.MeshBasicMaterial({ map: vinylTexture, transparent: true, side: THREE.DoubleSide }),
  );
  vinylGroup = new THREE.Group();
  vinylGroup.add(vinylMesh);
  scene.add(vinylGroup);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(5, 5, 20);
  scene.add(dirLight);

  function clearParticles() {
    for (const p of particleSystems) scene.remove(p);
    for (const h of hitBoxes) scene.remove(h);
    particleSystems.length = 0;
    hitBoxes.length = 0;
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
      uniforms: { uTime: { value: 0 }, uHover: { value: 0 } },
      vertexShader: document.getElementById("vertexShader").textContent,
      fragmentShader: document.getElementById("fragmentShader").textContent,
      transparent: true,
      depthTest: false,
      blending: THREE.NormalBlending,
    });

    const particles = new THREE.Points(geometry, material);
    const angle = (index / total) * Math.PI * 2;
    const orbitRadius = 10;
    particles.position.set(Math.cos(angle) * orbitRadius, Math.sin(angle) * orbitRadius, 0);
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

  function animate() {
    requestAnimationFrame(animate);
    const time = clock.getElapsedTime();
    if (vinylSpinning) vinylGroup.rotation.z -= 0.015;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(hitBoxes);
    let hovered = -1;
    if (intersects.length) hovered = intersects[0].object.userData.id;

    for (let i = 0; i < particleSystems.length; i++) {
      const p = particleSystems[i];
      p.material.uniforms.uTime.value = time;
      const angle = p.userData.initialAngle - time * 0.1;
      const r = 10;
      p.position.set(Math.cos(angle) * r, Math.sin(angle) * r, 0);
      hitBoxes[i]?.position.copy(p.position);
      const target = i === hovered ? 1 : 0;
      p.material.uniforms.uHover.value += (target - p.material.uniforms.uHover.value) * 0.1;
    }

    document.body.style.cursor = hovered > -1 ? "pointer" : "default";
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
    const hits = raycaster.intersectObjects(hitBoxes);
    if (!hits.length) return;
    selectIndex(hits[0].object.userData.id);
  });

  animate();

  return {
    setPlaylist,
    selectIndex,
    findIndexBySongId,
    findIndexByQuery,
    setVinylSpinning: (on) => { vinylSpinning = on; },
    getPlaylist: () => playlist,
    remapPlaylist: (tracks) => setPlaylist(tracks),
  };
}
