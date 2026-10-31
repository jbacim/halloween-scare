(() => {
  'use strict';

  const SCARE_MS = 5000;
  const COOLDOWN_MS = 3000;
  const WARMUP_MS = 1500;
  const STROBE_MS = 120;
  const SAMPLE_MS = 100;
  const W = 64, H = 48;
  const PIXEL_DIFF = 28;

  const $ = (id) => document.getElementById(id);
  const video = $('video'), strobe = $('strobe'), statusEl = $('status');
  const armBtn = $('arm'), testBtn = $('test'), flipBtn = $('flip'), camSelect = $('camera-select');
  const sens = $('sensitivity'), sensVal = $('sens-val');
  const optTorch = $('opt-torch'), optScreen = $('opt-screen'), optSound = $('opt-sound'), optPreview = $('opt-preview');
  const meterFill = $('meter-fill'), meterThreshold = $('meter-threshold'), torchInfo = $('torch-info');

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  let stream = null, track = null, torchSupported = false;
  let facing = 'environment', deviceId = null;
  let armed = false, scaring = false, ignoreUntil = 0, prevFrame = null;
  let sampleTimer = null, audioCtx = null, wakeLock = null;

  const prefs = JSON.parse(localStorage.getItem('scare-prefs') || '{}');
  for (const [el, key] of [[optTorch, 'torch'], [optScreen, 'screen'], [optSound, 'sound'], [optPreview, 'preview']]) {
    if (typeof prefs[key] === 'boolean') el.checked = prefs[key];
  }
  if (prefs.sens) sens.value = prefs.sens;
  if (prefs.facing) facing = prefs.facing;
  const savePrefs = () => localStorage.setItem('scare-prefs', JSON.stringify({
    torch: optTorch.checked, screen: optScreen.checked, sound: optSound.checked,
    preview: optPreview.checked, sens: sens.value, facing,
  }));

  const setStatus = (msg) => { statusEl.innerHTML = msg; };

  // Higher sensitivity -> smaller fraction of changed pixels needed to trigger.
  const thresholdFraction = () => 0.005 + 0.3 * Math.pow(1 - sens.value / 100, 2);

  function updateSensLabel() {
    sensVal.textContent = sens.value;
    meterThreshold.style.left = '50%';
  }

  // ---------- Camera ----------
  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('❌ Camera not available. Use HTTPS and a modern browser.');
      return false;
    }
    if (track) await setTorch(false);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = track = null;

    const video_ = deviceId
      ? { deviceId: { exact: deviceId } }
      : { facingMode: { ideal: facing } };
    Object.assign(video_, { width: { ideal: 640 }, height: { ideal: 480 } });

    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: video_, audio: false });
    } catch (err) {
      setStatus(`❌ Camera error: ${err.name}. Allow camera access and reload.`);
      return false;
    }
    track = stream.getVideoTracks()[0];
    video.srcObject = stream;
    await video.play().catch(() => {});

    const settings = track.getSettings ? track.getSettings() : {};
    deviceId = settings.deviceId || deviceId;
    if (settings.facingMode) facing = settings.facingMode === 'user' ? 'user' : 'environment';
    else if (/front|user|facetime/i.test(track.label)) facing = 'user';
    video.classList.toggle('mirror', facing === 'user');

    const caps = track.getCapabilities ? track.getCapabilities() : {};
    torchSupported = !!caps.torch;
    torchInfo.textContent = torchSupported
      ? '🔦 Flashlight supported on this camera.'
      : '🔦 Flashlight not available on this camera/browser. Screen strobe will be used instead.';

    await populateCameras();
    prevFrame = null;
    ignoreUntil = performance.now() + WARMUP_MS;
    savePrefs();
    return true;
  }

  async function populateCameras() {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    camSelect.innerHTML = '';
    devices.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Camera ${i + 1}`;
      if (d.deviceId === deviceId) opt.selected = true;
      camSelect.appendChild(opt);
    });
    camSelect.disabled = devices.length < 2;
    flipBtn.disabled = devices.length < 2;
  }

  async function setTorch(on) {
    if (!track || !torchSupported) return;
    try { await track.applyConstraints({ advanced: [{ torch: on }] }); } catch { /* ignore */ }
  }

  // ---------- Motion detection ----------
  function sample() {
    if (!track || video.readyState < 2) return;
    ctx.drawImage(video, 0, 0, W, H);
    const data = ctx.getImageData(0, 0, W, H).data;
    const gray = new Uint8ClampedArray(W * H);
    for (let i = 0, j = 0; j < gray.length; i += 4, j++) {
      gray[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
    }

    const now = performance.now();
    if (scaring || now < ignoreUntil || !prevFrame) {
      prevFrame = gray;
      meterFill.style.width = '0%';
      return;
    }

    let changed = 0;
    for (let j = 0; j < gray.length; j++) {
      if (Math.abs(gray[j] - prevFrame[j]) > PIXEL_DIFF) changed++;
    }
    prevFrame = gray;

    const frac = changed / gray.length;
    const thr = thresholdFraction();
    meterFill.style.width = `${Math.min(frac / (thr * 2), 1) * 100}%`;

    if (armed && frac >= thr) scare();
  }

  // ---------- Scare ----------
  async function scare() {
    if (scaring) return;
    scaring = true;
    document.body.classList.add('scaring');
    setStatus('👻 BOO! 👻');

    if (optSound.checked) playScream();

    const useTorch = optTorch.checked && torchSupported;
    const useScreen = optScreen.checked || (!useTorch && optTorch.checked);
    if (useScreen) strobe.classList.add('on');

    let on = false, torchBusy = false;
    const tick = () => {
      on = !on;
      if (useScreen) strobe.classList.toggle('white', on);
      if (useTorch && !torchBusy) {
        torchBusy = true;
        setTorch(on).finally(() => { torchBusy = false; });
      }
    };
    tick();
    const strobeTimer = setInterval(tick, STROBE_MS);

    await new Promise((r) => setTimeout(r, SCARE_MS));

    clearInterval(strobeTimer);
    strobe.classList.remove('on', 'white');
    await setTorch(false);
    // Let the torch fully settle before checking for motion again.
    setTimeout(() => setTorch(false), 300);

    prevFrame = null;
    ignoreUntil = performance.now() + COOLDOWN_MS;
    scaring = false;
    document.body.classList.remove('scaring');
    setStatus(armed ? '🎃 Armed — cooling down…' : 'Disarmed.');
    if (armed) setTimeout(() => { if (armed && !scaring) setStatus('🎃 Armed — watching for victims…'); }, COOLDOWN_MS);
  }

  // ---------- Sound (synthesized, no copyright concerns) ----------
  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }

  function playScream() {
    ensureAudio();
    if (!audioCtx) return;
    const ac = audioCtx, t0 = ac.currentTime, dur = SCARE_MS / 1000;

    const master = ac.createGain();
    master.gain.setValueAtTime(0.0001, t0);
    master.gain.exponentialRampToValueAtTime(0.9, t0 + 0.05);
    master.gain.setValueAtTime(0.9, t0 + dur - 0.8);
    master.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    master.connect(ac.destination);

    const shaper = ac.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / curve.length) * 2 - 1;
      curve[i] = ((Math.PI + 40) * x) / (Math.PI + 40 * Math.abs(x));
    }
    shaper.curve = curve;
    const band = ac.createBiquadFilter();
    band.type = 'bandpass'; band.frequency.value = 1500; band.Q.value = 0.8;
    shaper.connect(band).connect(master);

    // Screaming voices: detuned saws with a rising, wobbling pitch.
    [1, 1.007, 1.5].forEach((mult, i) => {
      const osc = ac.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(300 * mult, t0);
      osc.frequency.exponentialRampToValueAtTime(1100 * mult, t0 + 0.4);
      osc.frequency.linearRampToValueAtTime(900 * mult, t0 + dur * 0.6);
      osc.frequency.exponentialRampToValueAtTime(250 * mult, t0 + dur);
      const lfo = ac.createOscillator();
      const lfoGain = ac.createGain();
      lfo.frequency.value = 6 + i * 1.3;
      lfoGain.gain.value = 60 * mult;
      lfo.connect(lfoGain).connect(osc.frequency);
      const g = ac.createGain();
      g.gain.value = i === 2 ? 0.15 : 0.3;
      osc.connect(g).connect(shaper);
      osc.start(t0); lfo.start(t0);
      osc.stop(t0 + dur); lfo.stop(t0 + dur);
    });

    // Breathy noise.
    const noiseBuf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const noise = ac.createBufferSource();
    noise.buffer = noiseBuf;
    const nf = ac.createBiquadFilter();
    nf.type = 'highpass'; nf.frequency.value = 2500;
    const ng = ac.createGain(); ng.gain.value = 0.25;
    noise.connect(nf).connect(ng).connect(master);
    noise.start(t0);

    // Low rumble.
    const sub = ac.createOscillator();
    sub.type = 'triangle';
    sub.frequency.setValueAtTime(55, t0);
    sub.frequency.exponentialRampToValueAtTime(35, t0 + dur);
    const sg = ac.createGain(); sg.gain.value = 0.6;
    sub.connect(sg).connect(master);
    sub.start(t0); sub.stop(t0 + dur);
  }

  // ---------- Wake lock ----------
  async function requestWakeLock() {
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch { /* ignore */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && armed) requestWakeLock();
  });

  // ---------- UI ----------
  async function ensureRunning() {
    if (!track || track.readyState !== 'live') {
      if (!(await startCamera())) return false;
    }
    if (!sampleTimer) sampleTimer = setInterval(sample, SAMPLE_MS);
    return true;
  }

  armBtn.addEventListener('click', async () => {
    ensureAudio();
    if (armed) {
      armed = false;
      armBtn.textContent = 'Arm 🎃';
      armBtn.classList.remove('armed');
      if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
      setStatus('Disarmed.');
      return;
    }
    if (!(await ensureRunning())) return;
    armed = true;
    ignoreUntil = performance.now() + WARMUP_MS;
    prevFrame = null;
    armBtn.textContent = 'Disarm 💀';
    armBtn.classList.add('armed');
    requestWakeLock();
    setStatus('🎃 Armed — watching for victims…');
  });

  testBtn.addEventListener('click', async () => {
    ensureAudio();
    await ensureRunning();
    scare();
  });

  flipBtn.addEventListener('click', async () => {
    facing = facing === 'user' ? 'environment' : 'user';
    deviceId = null;
    await startCamera();
  });

  camSelect.addEventListener('change', async () => {
    deviceId = camSelect.value;
    await startCamera();
  });

  sens.addEventListener('input', () => { updateSensLabel(); savePrefs(); });
  [optTorch, optScreen, optSound].forEach((el) => el.addEventListener('change', savePrefs));
  const applyPreview = () => $('preview-wrap').classList.toggle('hidden', !optPreview.checked);
  optPreview.addEventListener('change', () => { applyPreview(); savePrefs(); });

  updateSensLabel();
  applyPreview();
})();
