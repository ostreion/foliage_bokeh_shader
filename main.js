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

let fsSource = ''; 

async function loadShaderSource(url) {
    const response = await fetch(url);
    return await response.text();
}

function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('An error occurred compiling the shaders: ' + gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }
    return shader;
}

function initShaderProgram(gl, vsSource, fsSource) {
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vsSource);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);

    const shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vertexShader);
    gl.attachShader(shaderProgram, fragmentShader);
    gl.linkProgram(shaderProgram);

    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
        console.error('Unable to initialize the shader program: ' + gl.getProgramInfoLog(shaderProgram));
        return null;
    }

    return shaderProgram;
}

// UI State
const uiState = {
    bokehScale: 1.0,
    bokehSharpness: 0.8,
    sunSize: 0.4,
    rayIntensity: 0.6,
    timeScale: 1.0
};

// Bind sliders
function setupUI() {
    const params = [
        { id: 'u_bokehScale', key: 'bokehScale', valId: 'val-scale' },
        { id: 'u_bokehSharpness', key: 'bokehSharpness', valId: 'val-sharpness' },
        { id: 'u_sunSize', key: 'sunSize', valId: 'val-sun' },
        { id: 'u_rayIntensity', key: 'rayIntensity', valId: 'val-ray' },
        { id: 'u_timeScale', key: 'timeScale', valId: 'val-time' }
    ];

    params.forEach(p => {
        const el = document.getElementById(p.id);
        const valEl = document.getElementById(p.valId);
        
        // init
        uiState[p.key] = parseFloat(el.value);
        valEl.innerText = el.value;

        el.addEventListener('input', (e) => {
            uiState[p.key] = parseFloat(e.target.value);
            valEl.innerText = e.target.value;
        });
    });
}

async function init() {
    setupUI();

    fsSource = await loadShaderSource('shader.frag');
    const shaderProgram = initShaderProgram(gl, vsSource, fsSource);

    const programInfo = {
        program: shaderProgram,
        attribLocations: {
            vertexPosition: gl.getAttribLocation(shaderProgram, 'aVertexPosition'),
        },
        uniformLocations: {
            resolution: gl.getUniformLocation(shaderProgram, 'u_resolution'),
            time: gl.getUniformLocation(shaderProgram, 'u_time'),
            // New uniforms from UI
            bokehScale: gl.getUniformLocation(shaderProgram, 'u_bokehScale'),
            bokehSharpness: gl.getUniformLocation(shaderProgram, 'u_bokehSharpness'),
            sunSize: gl.getUniformLocation(shaderProgram, 'u_sunSize'),
            rayIntensity: gl.getUniformLocation(shaderProgram, 'u_rayIntensity'),
            timeScale: gl.getUniformLocation(shaderProgram, 'u_timeScale')
        },
    };

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    const positions = [
        -1.0,  1.0,
         1.0,  1.0,
        -1.0, -1.0,
         1.0, -1.0,
    ];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

    let baseTime = 0;
    let lastNow = 0;

    function render(now) {
        now *= 0.001; 
        
        // Integrate time using timeScale so it doesn't jump
        let dt = now - lastNow;
        lastNow = now;
        baseTime += dt * uiState.timeScale;

        const displayWidth  = canvas.clientWidth;
        const displayHeight = canvas.clientHeight;
        const quality = 1.0; 

        if (canvas.width  !== displayWidth * quality ||
            canvas.height !== displayHeight * quality) {
            canvas.width  = displayWidth * quality;
            canvas.height = displayHeight * quality;
        }

        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(programInfo.program);

        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.vertexAttribPointer(programInfo.attribLocations.vertexPosition, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(programInfo.attribLocations.vertexPosition);

        gl.uniform2f(programInfo.uniformLocations.resolution, gl.canvas.width, gl.canvas.height);
        gl.uniform1f(programInfo.uniformLocations.time, baseTime);
        
        // Pass UI uniforms
        gl.uniform1f(programInfo.uniformLocations.bokehScale, uiState.bokehScale);
        gl.uniform1f(programInfo.uniformLocations.bokehSharpness, uiState.bokehSharpness);
        gl.uniform1f(programInfo.uniformLocations.sunSize, uiState.sunSize);
        gl.uniform1f(programInfo.uniformLocations.rayIntensity, uiState.rayIntensity);

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        requestAnimationFrame(render);
    }
    
    requestAnimationFrame(render);
}

init();
