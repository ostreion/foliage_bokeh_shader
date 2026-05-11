const canvas = document.getElementById('glcanvas');
const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

if (!gl) {
    alert('Unable to initialize WebGL. Your browser may not support it.');
}

const vsSource = `
    attribute vec4 aVertexPosition;
    void main() {
        gl_Position = aVertexPosition;
    }
`;

async function loadShaderSource(url) {
    const response = await fetch(url);
    return await response.text();
}

function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compile error: ' + gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function initShaderProgram(gl, vsSource, fsSource) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Program link error: ' + gl.getProgramInfoLog(program));
        return null;
    }
    return program;
}

// Slider id -> { uiKey, valId }
const SLIDERS = [
    ['u_zoom',           'zoom',           'val-zoom'],
    ['u_density',        'density',        'val-density'],
    ['u_sharpness',      'sharpness',      'val-sharpness'],
    ['u_diskSize',       'diskSize',       'val-diskSize'],
    ['u_sizeVar',        'sizeVar',        'val-sizeVar'],
    ['u_diskBrightness', 'diskBrightness', 'val-diskBrightness'],
    ['u_bgMix',          'bgMix',          'val-bgMix'],
    ['u_rimChance',       'rimChance',       'val-rimChance'],
    ['u_rimStrength',     'rimStrength',     'val-rimStrength'],
    ['u_rimThickness',    'rimThickness',    'val-rimThickness'],
    ['u_rimCoverageMin',  'rimCoverageMin',  'val-rimCoverageMin'],
    ['u_rimCoverageMax',  'rimCoverageMax',  'val-rimCoverageMax'],
    ['u_rimSpeckle',      'rimSpeckle',      'val-rimSpeckle'],
    ['u_rimSpeckleScale', 'rimSpeckleScale', 'val-rimSpeckleScale'],
    ['u_innerOpacity',    'innerOpacity',    'val-innerOpacity'],
    ['u_skyAmount',      'skyAmount',      'val-skyAmount'],
    ['u_skyThresh',      'skyThresh',      'val-skyThresh'],
    ['u_greenScale',     'greenScale',     'val-greenScale'],
    ['u_windSpeed',      'windSpeed',      'val-windSpeed'],
    ['u_windAmp',        'windAmp',        'val-windAmp'],
    ['u_flickerDepth',   'flickerDepth',   'val-flickerDepth'],
    ['u_flickerSpeed',   'flickerSpeed',   'val-flickerSpeed'],
    ['u_warmth',         'warmth',         'val-warmth'],
    ['u_exposure',       'exposure',       'val-exposure'],
    ['u_saturation',     'saturation',     'val-saturation'],
    ['u_vignette',       'vignette',       'val-vignette'],
    ['u_grainAmount',    'grainAmount',    'val-grainAmount'],
    ['u_grainSize',      'grainSize',      'val-grainSize'],
    ['u_grainColor',     'grainColor',     'val-grainColor'],
    ['u_mute',           'mute',           'val-mute'],
    ['u_renderScale',    'renderScale',    'val-renderScale'],
    ['u_maxFps',         'maxFps',         'val-maxFps'],
    ['u_sunX',           'sunX',           'val-sunX'],
    ['u_sunY',           'sunY',           'val-sunY'],
    ['u_sunSize',        'sunSize',        'val-sunSize'],
    ['u_sunBloom',       'sunBloom',       'val-sunBloom'],
    ['u_sunReach',       'sunReach',       'val-sunReach'],
    ['u_rayIntensity',   'rayIntensity',   'val-rayIntensity'],
    ['u_rayCount',       'rayCount',       'val-rayCount']
];

const ui = {};
const STORAGE_KEY = 'foliage-bokeh-ui-v1';

// Phone detection (not tablet) for dprCap and perf defaults. Tablets
// get desktop-class perf settings since they have more capable GPUs.
// Slider presets are seeded into localStorage by the head script in
// index.html before this file loads, so loadCachedUI just reads them.
const _ua = navigator.userAgent;
const _hasTouch = matchMedia('(pointer: coarse)').matches
               || (navigator.maxTouchPoints || 0) > 0;
const IS_MOBILE = /iPhone|iPod/.test(_ua)
               || (/Android/.test(_ua) && /Mobile/.test(_ua))
               || (_hasTouch && Math.min(window.innerWidth, window.innerHeight) < 768);

function loadCachedUI() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
}

function saveCachedUI() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(ui));
    } catch (e) {}
}

// ---------- GPU tier classification ----------
// Touch-vs-not picks the *visual* preset (zoom, sharpness, ...) in
// index.html. Tier picks the *perf* ceilings (renderScale, dprCap,
// maxFps). They are orthogonal concerns: an iPad Pro is a touch
// device with a HIGH-tier GPU; a 2014 ThinkPad with Intel HD is
// non-touch with a LOW-tier GPU.
const TIER_CAPS = {
    high: { renderScale: 1.00, dprCap: 1.5,  maxFps: 60 },
    med:  { renderScale: 0.75, dprCap: 1.5,  maxFps: 60 },
    low:  { renderScale: 0.50, dprCap: 1.25, maxFps: 30 }
};

function detectGpuTier(gl) {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = ext ? (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '') : '';
    const s = String(r);
    // HIGH: Apple silicon, recent A-series, discrete NVIDIA/AMD
    if (/Apple M[0-9]/.test(s)) return 'high';
    if (/Apple A1[4-9]/.test(s) || /Apple A2[0-9]/.test(s)) return 'high';
    if (/RTX |GTX 1[6-9]\d{2}|GTX 20\d{2}/.test(s)) return 'high';
    if (/Radeon Pro|RX 5[5-9]\d{2}|RX [6-9]\d{3}/.test(s)) return 'high';
    // MED: mid mobile (A10-A13, recent Adreno/Mali) and Intel Iris
    if (/Apple A1[0-3]/.test(s)) return 'med';
    if (/Adreno \(?7\d{2}\)?/.test(s)) return 'med';
    if (/Mali-G7\d/.test(s) || /Mali-G[89]\d/.test(s)) return 'med';
    if (/Intel.*(Iris|UHD Graphics ([67-9]\d{2}|1\d{3}))/.test(s)) return 'med';
    if (/Radeon|GeForce/.test(s)) return 'med'; // older/unknown discrete
    // LOW: explicit older mobile / weak integrated
    if (/Adreno \(?[345]\d{2}\)?|Adreno \(?6[0-3]\d\)?/.test(s)) return 'low';
    if (/Mali-[GT][3-6]\d/.test(s)) return 'low';
    if (/PowerVR/.test(s)) return 'low';
    if (/Intel.*HD Graphics ([23-5]\d{2,3})?/.test(s)) return 'low';
    // Unknown / masked renderer (Firefox masks by default, some
    // Safari versions too). Default to MED, governor handles the
    // rest at runtime.
    return 'med';
}

function applyTierDemotions(tier) {
    const order = ['high', 'med', 'low'];
    const demote = (t) => order[Math.min(order.indexOf(t) + 1, order.length - 1)];
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
        if (conn.saveData === true) tier = demote(tier);
        else if (/^(slow-)?2g$/.test(conn.effectiveType || '')) tier = demote(tier);
    }
    if (typeof navigator.deviceMemory === 'number' && navigator.deviceMemory <= 4) {
        tier = demote(tier);
    }
    return tier;
}

const TOGGLES = [];

function setupUI() {
    const cached = loadCachedUI();

    SLIDERS.forEach(([id, key, valId]) => {
        const el = document.getElementById(id);
        const valEl = document.getElementById(valId);
        // Apply cached value if it parses and is within slider bounds
        if (typeof cached[key] === 'number' && isFinite(cached[key])) {
            const min = parseFloat(el.min), max = parseFloat(el.max);
            const c = Math.max(min, Math.min(max, cached[key]));
            el.value = String(c);
        }
        ui[key] = parseFloat(el.value);
        valEl.innerText = parseFloat(el.value).toFixed(2);
        el.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            ui[key] = v;
            valEl.innerText = v.toFixed(2);
            saveCachedUI();
        });
    });

    // Optional: double-click any value to reset that slider to its HTML default
    SLIDERS.forEach(([id, key, valId]) => {
        const valEl = document.getElementById(valId);
        const el = document.getElementById(id);
        valEl.style.cursor = 'pointer';
        valEl.title = 'Double-click to reset';
        valEl.addEventListener('dblclick', () => {
            const def = el.getAttribute('value');
            el.value = def;
            ui[key] = parseFloat(def);
            valEl.innerText = parseFloat(def).toFixed(2);
            saveCachedUI();
        });
    });
}

async function init() {
    setupUI();

    const fsSource = await loadShaderSource('shader.frag');
    const program = initShaderProgram(gl, vsSource, fsSource);

    const attribs = {
        vertexPosition: gl.getAttribLocation(program, 'aVertexPosition')
    };

    const uniforms = {
        resolution: gl.getUniformLocation(program, 'u_resolution'),
        time:       gl.getUniformLocation(program, 'u_time'),
        pan:        gl.getUniformLocation(program, 'u_pan')
    };
    SLIDERS.forEach(([id, key]) => {
        uniforms[key] = gl.getUniformLocation(program, id);
    });

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1.0,  1.0,
         1.0,  1.0,
        -1.0, -1.0,
         1.0, -1.0
    ]), gl.STATIC_DRAW);

    let baseTime = 0;
    let lastNow = 0;

    // GPU tier sets the perf ceilings (renderScale, dprCap, maxFps).
    // Detected once from WEBGL_debug_renderer_info, then demoted on
    // Save-Data / weak network / low deviceMemory.
    const tier = applyTierDemotions(detectGpuTier(gl));
    const caps = TIER_CAPS[tier];
    const dprCap = caps.dprCap;
    console.log('[bokeh] GPU tier:', tier, 'caps:', caps);

    // Cap the seeded renderScale and maxFps to tier ceilings once, at
    // startup. Sliders (if present) reflect the clamped value so the
    // UI is honest. Users can still drag higher than the cap in dev
    // mode — the adaptive governor (next commit) will pull it back.
    function reflectSlider(key, value) {
        const id = 'u_' + key;
        const el = document.getElementById(id);
        if (el) el.value = String(value);
        const valEl = document.getElementById('val-' + key);
        if (valEl) valEl.innerText = (typeof value === 'number' ? value : 0).toFixed(2);
    }
    if (typeof ui.renderScale === 'number' && ui.renderScale > caps.renderScale) {
        ui.renderScale = caps.renderScale;
        reflectSlider('renderScale', ui.renderScale);
        saveCachedUI();
    }
    if (typeof ui.maxFps === 'number' && ui.maxFps > caps.maxFps) {
        ui.maxFps = caps.maxFps;
        reflectSlider('maxFps', ui.maxFps);
        saveCachedUI();
    }

    // Pause render loop when canvas is off-screen or tab is hidden.
    // Saves battery / GPU when the shader is in a section the user
    // has scrolled past or another tab is in front.
    let visible = true;
    let tabActive = !document.hidden;
    let playing = true;

    const ppBtn = document.getElementById('playpause');
    function syncPlayPause() {
        ppBtn.textContent = playing ? '⏸' : '▶';
        ppBtn.title = playing ? 'Pause animation' : 'Play animation';
    }
    ppBtn.addEventListener('click', () => {
        playing = !playing;
        syncPlayPause();
        if (playing && visible && tabActive) requestAnimationFrame(render);
    });
    syncPlayPause();

    // Copy / Paste current settings as JSON. Useful for tuning the
    // shader on one device and porting the tuned values to another.
    const PRESET_VERSION = 1;

    function flashBtn(btn, cls, label) {
        const orig = btn.textContent;
        btn.textContent = label;
        btn.classList.add(cls);
        setTimeout(() => {
            btn.textContent = orig;
            btn.classList.remove(cls);
        }, 1200);
    }

    document.getElementById('btn-copy').addEventListener('click', async () => {
        const preset = { version: PRESET_VERSION, ui: { ...ui } };
        const txt = JSON.stringify(preset, null, 2);
        const btn = document.getElementById('btn-copy');
        try {
            await navigator.clipboard.writeText(txt);
            flashBtn(btn, 'ok', 'Copied');
        } catch (_) {
            const ta = document.createElement('textarea');
            ta.value = txt;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); flashBtn(btn, 'ok', 'Copied'); }
            catch (__) { flashBtn(btn, 'err', 'Copy failed'); }
            document.body.removeChild(ta);
        }
    });

    function applyPreset(preset) {
        if (!preset || typeof preset !== 'object' || !preset.ui) return false;
        const next = preset.ui;
        for (const [id, key] of SLIDERS) {
            if (typeof next[key] !== 'number' || !isFinite(next[key])) continue;
            const el = document.getElementById(id);
            if (!el) continue;
            const min = parseFloat(el.min), max = parseFloat(el.max);
            const v = Math.max(min, Math.min(max, next[key]));
            el.value = String(v);
            el.dispatchEvent(new Event('input'));
        }
        for (const [id, key] of TOGGLES) {
            if (typeof next[key] !== 'boolean') continue;
            const el = document.getElementById(id);
            if (!el) continue;
            el.checked = next[key];
            el.dispatchEvent(new Event('change'));
        }
        return true;
    }

    document.getElementById('btn-defaults').addEventListener('click', () => {
        const btn = document.getElementById('btn-defaults');
        const preset = window.__BOKEH_PRESET__;
        if (!preset) { flashBtn(btn, 'err', 'No preset'); return; }
        if (applyPreset({ ui: preset })) flashBtn(btn, 'ok', 'Loaded');
        else flashBtn(btn, 'err', 'Failed');
    });

    document.getElementById('btn-paste').addEventListener('click', async () => {
        const btn = document.getElementById('btn-paste');
        let txt = '';
        try { txt = await navigator.clipboard.readText(); }
        catch (_) { txt = window.prompt('Paste settings JSON:') || ''; }
        if (!txt.trim()) return;
        try {
            const preset = JSON.parse(txt);
            if (applyPreset(preset)) flashBtn(btn, 'ok', 'Applied');
            else flashBtn(btn, 'err', 'Bad format');
        } catch (_) {
            flashBtn(btn, 'err', 'Bad JSON');
        }
    });

    // ---- Pan-interactive toggle ----
    // The canvas has `pointer-events: none` by default so wheel /
    // touch / mouse never reach it - the page scrolls normally even
    // when the cursor is over the hero. The pill flips a class to
    // `pointer-events: auto`, letting the handlers below activate.
    const interactBtn = document.getElementById('interact-toggle');
    if (interactBtn) {
        let interactive = false;
        const syncInteract = () => {
            canvas.classList.toggle('interactive', interactive);
            interactBtn.classList.toggle('active', interactive);
            interactBtn.title = interactive
                ? 'Disable pan (scroll passes through canvas)'
                : 'Enable pan (currently disabled)';
        };
        interactBtn.addEventListener('click', () => {
            interactive = !interactive;
            syncInteract();
        });
        syncInteract();
    }

    // ---- Touch / mouse pan with inertia + rubber-band bounds ----
    // u_pan is in uv-space; one unit ≈ canvas height. Keep bounds
    // small so the user can wander a little, not get lost.
    const pan      = { x: 0, y: 0 };
    const vel      = { x: 0, y: 0 };
    const FRICTION = 3.5;   // per second — natural deceleration
    let dragging   = false;
    let lastTouch  = { x: 0, y: 0, t: 0 };

    function clientToUv(cx, cy) {
        const rect = canvas.getBoundingClientRect();
        const aspect = rect.width / rect.height;
        return {
            x: (cx / rect.height) * 1.0,
            y: -(cy / rect.height) * 1.0,
            aspect
        };
    }

    function startDrag(cx, cy) {
        dragging = true;
        const u = clientToUv(cx, cy);
        lastTouch = { x: u.x, y: u.y, t: performance.now() };
        vel.x = 0; vel.y = 0;
    }
    function moveDrag(cx, cy) {
        if (!dragging) return;
        const u = clientToUv(cx, cy);
        const t = performance.now();
        const dx = u.x - lastTouch.x;
        const dy = u.y - lastTouch.y;
        const dt = Math.max((t - lastTouch.t) / 1000, 1e-3);
        // Pan is unbounded — the shader is procedural so any uv is
        // valid. Friction below stops the inertial drift naturally.
        // Direction inversion happens in the shader (uv - u_pan).
        pan.x += dx;
        pan.y += dy;
        vel.x = dx / dt;
        vel.y = dy / dt;
        lastTouch = { x: u.x, y: u.y, t };
    }
    function endDrag() {
        dragging = false;
    }

    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        startDrag(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
        if (e.touches.length !== 1) return;
        moveDrag(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    canvas.addEventListener('touchend',   endDrag, { passive: true });
    canvas.addEventListener('touchcancel', endDrag, { passive: true });
    // Mouse drag too, for desktop testing
    canvas.addEventListener('mousedown', (e) => startDrag(e.clientX, e.clientY));
    window.addEventListener('mousemove', (e) => moveDrag(e.clientX, e.clientY));
    window.addEventListener('mouseup',   endDrag);

    // Trackpad two-finger scroll / mouse wheel. The signs below are
    // chosen so a "natural scroll" macOS trackpad swipe in any
    // direction makes the scene follow the gesture, matching touch.
    // Browsers normalise pinch-zoom into wheel events with ctrlKey
    // set: we swallow those too so the page doesn't zoom.
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const h = Math.max(rect.height, 1);
        // deltaMode: 0=pixel, 1=line, 2=page. Normalize lines to
        // a sensible pixel-ish step.
        const k = e.deltaMode === 0 ? 1.0
                : e.deltaMode === 1 ? 16.0
                : rect.height;
        const sx = -e.deltaX * k / h;
        const sy =  e.deltaY * k / h;
        pan.x += sx;
        pan.y += sy;
        // Light inertia so a flick keeps drifting briefly after the
        // gesture ends.
        vel.x = sx * 8;
        vel.y = sy * 8;
    }, { passive: false });

    function updatePan(dt) {
        if (!dragging) {
            pan.x += vel.x * dt;
            pan.y += vel.y * dt;
            const fr = Math.exp(-FRICTION * dt);
            vel.x *= fr;
            vel.y *= fr;
        }
    }

    document.addEventListener('visibilitychange', () => {
        tabActive = !document.hidden;
        if (tabActive && visible) requestAnimationFrame(render);
    });
    if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
            for (const e of entries) {
                const wasVisible = visible;
                visible = e.isIntersecting;
                if (visible && !wasVisible && tabActive) {
                    requestAnimationFrame(render);
                }
            }
        }, { threshold: 0.0 });
        io.observe(canvas);
    }

    // ---- Adaptive renderScale governor ----
    // Watches the actual rAF interval EMA. When the device can't hit
    // its FPS target consistently, drops renderScale by 0.05 (floor
    // 0.35). Drop-only: never raises automatically, because we cannot
    // reliably distinguish "headroom available" from "exactly at the
    // FPS cap" without GPU-side timer queries (rare on mobile). The
    // tier ceiling (commit prior) gives the upper bound; the governor
    // protects against tier misclassification, thermal throttling,
    // and unknown old hardware.
    const gov = {
        ema: 16.67,
        bottleneckStreak: 0,
        warmup: 90,  // skip ~1.5s for compile + first-frame hitch
        lastChangeAt: 0
    };
    function governorTick(intervalMs, targetMs, nowMs) {
        if (gov.warmup > 0) { gov.warmup--; return; }
        gov.ema = 0.90 * gov.ema + 0.10 * intervalMs;
        // Need to clearly miss the target by 35% to count as bottleneck.
        // At target=16.67ms that's ema > 22.5ms — i.e. we're hitting
        // roughly 45fps or worse on a 60fps target.
        if (gov.ema > targetMs * 1.35) {
            if (++gov.bottleneckStreak >= 30) { // ~0.5s of sustained drop
                const next = Math.max(0.35, +(ui.renderScale - 0.05).toFixed(2));
                if (next !== ui.renderScale) {
                    console.log('[bokeh] governor: renderScale',
                                ui.renderScale, '->', next,
                                '(ema', gov.ema.toFixed(1) + 'ms)');
                    ui.renderScale = next;
                    reflectSlider('renderScale', ui.renderScale);
                    saveCachedUI();
                    gov.lastChangeAt = nowMs;
                    gov.warmup = 60; // re-stabilise
                }
                gov.bottleneckStreak = 0;
            }
        } else {
            gov.bottleneckStreak = 0;
        }
    }
    // Reset governor warmup whenever the user touches the slider, so
    // it doesn't immediately fight a manual change.
    const rsSlider = document.getElementById('u_renderScale');
    if (rsSlider) rsSlider.addEventListener('input', () => { gov.warmup = 90; });

    let lastFrameMs = 0;
    function render(now) {
        if (!visible || !tabActive || !playing) return;

        // FPS cap. requestAnimationFrame keeps ticking at display
        // rate; we skip work between intervals when capped below 60.
        const maxFps   = Math.max(1, Math.min(120, ui.maxFps || 60));
        const interval = 1000 / maxFps;
        if (now - lastFrameMs < interval - 1) {
            requestAnimationFrame(render);
            return;
        }
        // Feed the governor the actual rAF interval (only when we
        // actually rendered a frame, so the FPS cap doesn't fool it).
        if (lastFrameMs > 0) governorTick(now - lastFrameMs, interval, now);
        lastFrameMs = now;

        const nowS = now * 0.001;
        let dt = nowS - lastNow;
        if (dt > 0.1) dt = 0.016;
        lastNow = nowS;
        baseTime += dt;

        // Touch-driven pan: apply inertia and rubber-band toward 0.
        updatePan(dt);

        // Render scale is user-controlled. Internal resolution =
        // canvas CSS size * renderScale * capped DPR.
        const renderScale = Math.max(0.2, Math.min(2.0, ui.renderScale || 0.75));
        const dpr     = Math.min(window.devicePixelRatio || 1, dprCap);
        const dispW   = canvas.clientWidth;
        const dispH   = canvas.clientHeight;
        const targetW = Math.max(1, Math.floor(dispW * renderScale * dpr));
        const targetH = Math.max(1, Math.floor(dispH * renderScale * dpr));
        if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
        }

        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.vertexAttribPointer(attribs.vertexPosition, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(attribs.vertexPosition);

        gl.uniform2f(uniforms.resolution, gl.canvas.width, gl.canvas.height);
        gl.uniform1f(uniforms.time, baseTime);
        gl.uniform2f(uniforms.pan, pan.x, pan.y);
        // Grain texel size is authored in CSS-space (e.g. "1.5 CSS px
        // per grain cell"). The shader reads gl_FragCoord, which is in
        // backing-store pixels, so we pre-multiply by the backing-to-CSS
        // ratio. That ratio is exactly renderScale * dpr. Result: grain
        // looks the same physical size on iPhone (low backing) and Mac
        // (high backing) instead of bigger-on-the-smaller-canvas.
        const backingPerCss = renderScale * dpr;
        SLIDERS.forEach(([id, key]) => {
            let v = ui[key];
            if (key === 'grainSize') v = Math.max(1.0, v * backingPerCss);
            gl.uniform1f(uniforms[key], v);
        });

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
}

init();
