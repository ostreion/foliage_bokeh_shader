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
    ['u_branchAmount',   'branchAmount',   'val-branchAmount'],
    ['u_branchThresh',   'branchThresh',   'val-branchThresh'],
    ['u_branchAngle',    'branchAngle',    'val-branchAngle'],
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
    ['u_sunX',           'sunX',           'val-sunX'],
    ['u_sunY',           'sunY',           'val-sunY'],
    ['u_sunSize',        'sunSize',        'val-sunSize'],
    ['u_sunBloom',       'sunBloom',       'val-sunBloom'],
    ['u_sunReach',       'sunReach',       'val-sunReach'],
    ['u_rayIntensity',   'rayIntensity',   'val-rayIntensity']
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

    function render(now) {
        now *= 0.001;
        let dt = now - lastNow;
        if (dt > 0.1) dt = 0.016;
        lastNow = now;
        baseTime += dt;

        // Render at 0.75x for cheaper devices; can be raised later.
        const quality = 0.75;
        const dispW = canvas.clientWidth;
        const dispH = canvas.clientHeight;
        const targetW = Math.floor(dispW * quality);
        const targetH = Math.floor(dispH * quality);
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
            gl.uniform1f(uniforms[key], ui[key]);
        });

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        requestAnimationFrame(render);
    }

    requestAnimationFrame(render);
}

init();
