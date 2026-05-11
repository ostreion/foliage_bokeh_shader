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
    ['u_branchAmount',   'branchAmount',   'val-branchAmount'],
    ['u_branchThresh',   'branchThresh',   'val-branchThresh'],
    ['u_branchAngle',    'branchAngle',    'val-branchAngle'],
    ['u_branchWidth',    'branchWidth',    'val-branchWidth'],
    ['u_branchOcclude',  'branchOcclude',  'val-branchOcclude'],
    ['u_leafCover',      'leafCover',      'val-leafCover'],
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

const TOGGLES = [
    ['t_branchEnabled', 'branchEnabled']
];

function setupUI() {
    const cached = loadCachedUI();

    TOGGLES.forEach(([id, key]) => {
        const el = document.getElementById(id);
        if (typeof cached[key] === 'boolean') el.checked = cached[key];
        ui[key] = el.checked;
        el.addEventListener('change', (e) => {
            ui[key] = e.target.checked;
            saveCachedUI();
        });
    });

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
        time:       gl.getUniformLocation(program, 'u_time')
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

    // Device-aware quality. Mobile/touch devices get a lower internal
    // resolution; desktop pushes higher. DPR is capped so retina
    // displays don't render at 2x and tank perf - a slight upscale
    // through CSS is invisible on this kind of soft, blurry imagery.
    const isMobile = matchMedia('(pointer: coarse)').matches
                  || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    const baseQuality = isMobile ? 0.55 : 0.75;
    const dprCap      = isMobile ? 1.25 : 1.5;

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

    function render(now) {
        if (!visible || !tabActive || !playing) return;

        now *= 0.001;
        let dt = now - lastNow;
        if (dt > 0.1) dt = 0.016;
        lastNow = now;
        baseTime += dt;

        // Render only what's actually shown. canvas.clientWidth/Height
        // are CSS pixels - the shader runs at this size * quality *
        // capped DPR, regardless of how the page is laid out. So a
        // small canvas on iPhone renders few pixels even though the
        // shader is identical to desktop.
        const dpr     = Math.min(window.devicePixelRatio || 1, dprCap);
        const dispW   = canvas.clientWidth;
        const dispH   = canvas.clientHeight;
        const targetW = Math.max(1, Math.floor(dispW * baseQuality * dpr));
        const targetH = Math.max(1, Math.floor(dispH * baseQuality * dpr));
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
        SLIDERS.forEach(([id, key]) => {
            let v = ui[key];
            // Toggle gates: branchEnabled forces branch-related uniforms to 0
            if (!ui.branchEnabled && (key === 'branchAmount' || key === 'branchOcclude')) {
                v = 0;
            }
            gl.uniform1f(uniforms[key], v);
        });

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
}

init();
