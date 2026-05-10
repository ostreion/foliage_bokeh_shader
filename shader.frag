#ifdef GL_ES
precision highp float;
#endif

uniform vec2 u_resolution;
uniform float u_time;

// UI Uniforms
uniform float u_bokehScale;
uniform float u_bokehSharpness;
uniform float u_sunSize;
uniform float u_rayIntensity;
uniform float u_timeScale;

// Refined Color Palette
const vec3 C_SKY = vec3(0.23, 0.29, 0.36); // Muted blue-grey sky
const vec3 C_BRANCH = vec3(0.10, 0.07, 0.05); // Deep dark warm brown
const vec3 C_DEEP_LEAF = vec3(0.08, 0.12, 0.06); // Dark green
const vec3 C_SUN_LEAF = vec3(0.35, 0.38, 0.15); // Muted olive/gold
const vec3 C_BOKEH_CORE = vec3(0.90, 0.79, 0.51); // Creamy gold
const vec3 C_SUN_GLOW = vec3(1.0, 0.95, 0.85); // Soft white

// Basic hashes
vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
    p3 += dot(p3, p3.yzx+33.33);
    return fract((p3.xx+p3.yz)*p3.zy);
}

// Low frequency noise for background branches
float noise(vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    vec2 u = f*f*(3.0-2.0*f);
    float a = dot(hash22(i + vec2(0.0,0.0)), f - vec2(0.0,0.0));
    float b = dot(hash22(i + vec2(1.0,0.0)), f - vec2(1.0,0.0));
    float c = dot(hash22(i + vec2(0.0,1.0)), f - vec2(0.0,1.0));
    float d = dot(hash22(i + vec2(1.0,1.0)), f - vec2(1.0,1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) + 0.5;
}

// Abstract Background (Sky + Branches)
vec3 getBackground(vec2 uv) {
    vec2 st = uv * 2.0;
    st += vec2(u_time * 0.01, u_time * 0.02) * u_timeScale;
    
    // Create large, blurry branch structures
    float branchNoise = noise(st) + 0.5 * noise(st * 2.0);
    branchNoise = smoothstep(0.4, 0.8, branchNoise);
    
    return mix(C_SKY, C_BRANCH, branchNoise);
}

// Cellular/Voronoi Distance for rigid leaf shapes
// Returns distance to the closest "gap" center
float voronoi(vec2 x, float timeOffset) {
    vec2 n = floor(x);
    vec2 f = fract(x);
    float m = 8.0;
    
    for(int j=-1; j<=1; j++) {
        for(int i=-1; i<=1; i++) {
            vec2 g = vec2(float(i),float(j));
            vec2 o = hash22(n + g);
            // Animate the points (leaves fluttering)
            o = 0.5 + 0.5*sin(u_time * u_timeScale * 2.0 + 6.2831*o + timeOffset);
            vec2 r = g - f + o;
            float d = dot(r,r);
            if(d < m) {
                m = d;
            }
        }
    }
    return sqrt(m);
}

// Simulate the physical canopy: sharp gaps between rigid cells
float getCanopyGap(vec2 uv, float scale, float speed, float density) {
    vec2 st = uv * scale;
    // Slow branch sway
    st += vec2(u_time * speed, u_time * speed * 0.5) * u_timeScale;
    
    // Use Voronoi for rigid leaf shapes instead of fluid oil FBM
    // Lower Voronoi distance means we are near the center of a "gap"
    float v1 = voronoi(st, 0.0);
    
    // Smoothstep creates the distinct, slightly blurred edges of the leaves
    // Invert so 1.0 is the gap (light passing), 0.0 is solid leaf
    return 1.0 - smoothstep(density - 0.2, density + 0.1, v1);
}

// Render strict geometric bokeh circles based on canopy gaps
vec3 renderBokehLayer(vec2 uv, float baseGridScale, float layerDepth, float density, vec3 tintColor, float brightness) {
    // Zoom out heavily: u_bokehScale=1.0 now equals dense, small bokeh
    float gridScale = baseGridScale * u_bokehScale * 5.0; 
    
    vec2 st = uv * gridScale;
    vec2 i_st = floor(st);
    vec2 f_st = fract(st);

    vec3 accColor = vec3(0.0);
    
    // Check neighbors to allow overlapping
    for (int y = -2; y <= 2; y++) {
        for (int x = -2; x <= 2; x++) {
            vec2 neighbor = vec2(float(x), float(y));
            
            vec2 cellCenterUV = (i_st + neighbor + 0.5) / gridScale;
            float gapLight = getCanopyGap(cellCenterUV, gridScale * 0.3, 0.05 * layerDepth, density);
            
            if (gapLight > 0.01) {
                vec2 offset = hash22(i_st + neighbor) * 0.5 + 0.25;
                vec2 diff = neighbor + offset - f_st;
                
                // Pure geometric distance
                float dist = length(diff);
                
                // Radius is fixed per cell
                float radius = 1.0 + layerDepth * 0.4;
                
                // Perfect geometric circle with sharpness controlled by UI
                float blurAmt = (1.0 - u_bokehSharpness) * radius;
                float circle = smoothstep(radius, radius - blurAmt - 0.01, dist);
                
                // Additive blending into the HDR buffer
                accColor += circle * gapLight * tintColor * brightness;
            }
        }
    }
    return accColor;
}

// ACES Filmic Tone Mapping Curve
// https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/
vec3 ACESFilm(vec3 x) {
    float a = 2.51f;
    float b = 0.03f;
    float c = 2.43f;
    float d = 0.59f;
    float e = 0.14f;
    return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
}

void main() {
    vec2 st = gl_FragCoord.xy / u_resolution.xy;
    vec2 uv = st;
    st.x *= u_resolution.x / u_resolution.y;

    // Start with the abstract sky/branch background
    vec3 finalColor = getBackground(st);
    
    // Sun position (offscreen right)
    vec2 sunPos = vec2(1.1 * (u_resolution.x/u_resolution.y), 0.5);
    float sunDist = length(st - sunPos);

    // 1. Deep Background Canopy (Dense, dark green, tiny gaps)
    float deepMask = getCanopyGap(st, 8.0 * u_bokehScale, 0.02, 0.3);
    finalColor = mix(finalColor, C_DEEP_LEAF, 0.8); // Occlude most of the sky
    finalColor += C_MID_LEAF * deepMask * 0.5; // Tiny bits of deep light passing

    // 2. Midground Bokeh (Olive/Gold, medium size, high density)
    vec3 midBokeh = renderBokehLayer(st, 12.0, 1.0, 0.5, C_SUN_LEAF, 0.5);
    finalColor += midBokeh;

    // 3. Foreground Bokeh (Bright Cream/Gold, larger)
    vec3 fgBokeh = renderBokehLayer(st, 6.0, 1.5, 0.6, C_BOKEH_CORE, 0.8);
    finalColor += fgBokeh;
    
    // 4. Extreme Foreground Dark Leaves (Voronoi cell shadows)
    float fgDarkLeaves = getCanopyGap(st, 3.0 * u_bokehScale, 0.06, 0.4);
    // Darken the edges to simulate close, out-of-focus branches
    finalColor = mix(finalColor, C_BRANCH * 0.3, (1.0 - fgDarkLeaves) * 0.6);

    // 5. Physics-Based Sun & Diffraction
    // The sun core is shrunk heavily based on u_sunSize
    float sunGlow = smoothstep(u_sunSize * 0.3, 0.0, sunDist);
    finalColor += C_SUN_GLOW * pow(sunGlow, 3.0) * 2.0; // Additive intense core
    
    // Extended soft ambient glow
    float ambientGlow = smoothstep(2.5, 0.0, sunDist);
    finalColor += C_BOKEH_CORE * ambientGlow * 0.15 * u_sunSize;
    
    // Intense, distinct diffraction rays sprinkled through the leaves
    float angle = atan(st.y - sunPos.y, st.x - sunPos.x);
    float rays = sin(angle * 7.0 + u_time * u_timeScale * 0.1) * sin(angle * 19.0 - u_time * u_timeScale * 0.05);
    rays = smoothstep(0.92, 1.0, rays); // Make them very sharp and distinct
    
    // Mask rays by a separate, high-frequency canopy so they "sprinkle" through
    float rayMask = getCanopyGap(st, 15.0, 0.01, 0.3);
    finalColor += C_SUN_GLOW * rays * ambientGlow * u_rayIntensity * rayMask * 2.0;

    // --- Post-Processing ---
    
    // Apply ACES Filmic Tone Mapping to gracefully compress the additive HDR values
    // This prevents the "giant white blob" bug
    finalColor = ACESFilm(finalColor);

    // Slight vignette
    float vignette = 1.0 - smoothstep(0.5, 1.5, length(uv - 0.5));
    finalColor *= mix(0.85, 1.0, vignette);

    // Gamma correction
    finalColor = pow(finalColor, vec3(1.0/2.2));

    gl_FragColor = vec4(finalColor, 1.0);
}
