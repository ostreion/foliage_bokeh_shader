#ifdef GL_ES
precision highp float;
#endif

uniform vec2  u_resolution;
uniform float u_time;

// Layout / camera
uniform float u_zoom;          // overall scale of the scene
uniform float u_density;       // gap threshold (more = brighter, more gaps)
uniform float u_sharpness;     // 0 = soft cream, 1 = crisp disk
uniform float u_warmth;        // 0 = uniform gold, 1 = strong green->gold gradient
uniform float u_exposure;      // pre tone-map gain
uniform float u_saturation;    // post saturation
uniform float u_vignette;      // vignette strength

// Wind / flicker
uniform float u_windSpeed;     // overall time scale for wind & flicker
uniform float u_windAmp;       // how much circles drift
uniform float u_flickerDepth;  // 0 = no twinkle, 1 = full close-off
uniform float u_flickerSpeed;  // twinkle rate

// Sun
uniform float u_sunX;
uniform float u_sunY;
uniform float u_sunSize;
uniform float u_rayIntensity;

// ---------- Palette ----------
const vec3 C_SHADOW    = vec3(0.012, 0.020, 0.008); // near-black canopy shadow
const vec3 C_DEEP_LEAF = vec3(0.04,  0.07,  0.02);  // dark forest green base
const vec3 C_GREEN_BOK = vec3(0.32,  0.46,  0.10);  // saturated forest-green bokeh
const vec3 C_GOLD_BOK  = vec3(1.05,  0.72,  0.28);  // gold bokeh (near sun)
const vec3 C_SKY_WARM  = vec3(0.45,  0.34,  0.16);  // warm sky tint
const vec3 C_SUN_CORE  = vec3(1.0,   0.86,  0.58);

// ---------- Hashes & noise ----------
vec2 hash22(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.xx + p3.yz) * p3.zy);
}

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    vec2 u = f*f*(3.0 - 2.0*f);
    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
        v += a * vnoise(p);
        p *= 2.02;
        a *= 0.5;
    }
    return v;
}

// 2D wind field: smooth, low-frequency, slowly evolving
vec2 windField(vec2 p, float t) {
    float n1 = fbm(p * 0.7 + vec2(t * 0.12, 0.0));
    float n2 = fbm(p * 0.7 + vec2(11.3, t * 0.10));
    return vec2(n1, n2) - 0.5;
}

// ---------- Unified scene field ----------
// Returns the local color of the canopy at uv. Used to:
//   1. paint the background, and
//   2. tint each bokeh disk by sampling at the disk's centre.
// Disk and background therefore share one palette so the bokeh
// looks like brighter samples of the scene, not sprites on top.
//
// Composed of:
//   - low-freq green variation (forest dark <-> sunlit lime)
//   - radial gold halo around the sun (warmth-driven)
//   - elongated dark-brown branch streaks (anisotropic noise)
//   - sparse pale bluish-green sky-peek hot spots
//
// One fbm + two vnoise calls; cheap enough to evaluate per disk.
vec3 sceneColor(vec2 uv, vec2 sunPos) {
    // Slow temporal evolution so the canopy "breathes" with the wind
    float tt = u_time * 0.04 * u_windSpeed;

    // Base green variation
    float n1 = fbm(uv * 1.5 + vec2(tt, tt * 0.6));
    float greenMix = smoothstep(0.30, 0.78, n1);
    vec3  darkGreen   = vec3(0.04, 0.075, 0.025);
    vec3  sunnyGreen  = vec3(0.48, 0.66, 0.18);
    vec3  col = mix(darkGreen, sunnyGreen, greenMix);

    // Sun proximity gold tint (also used downstream)
    float d = length(uv - sunPos);
    float k = mix(2.2, 0.45, u_warmth);
    float sunMix = 1.0 - smoothstep(0.10, 1.0, d * k);
    col = mix(col, C_GOLD_BOK, sunMix * 0.85);

    // Elongated branch streaks: stretch coords along a diagonal,
    // then threshold a noise sample to get thin dark patches.
    vec2 br;
    br.x = uv.x * 0.55 + uv.y * 0.95;
    br.y = uv.y * 5.0 - uv.x * 0.35;
    float bn = vnoise(br * 1.6 + 13.7) * 0.6
             + vnoise(br * 3.3 - 4.2) * 0.4;
    float branch = smoothstep(0.62, 0.78, bn);
    vec3  branchColor = vec3(0.075, 0.045, 0.022);
    col = mix(col, branchColor, branch * 0.65);

    // Sparse sky-peek: pale, slightly cool. Warmer near the sun.
    float sn = vnoise(uv * 4.0 + vec2(0.0, tt * 0.5));
    float sky = smoothstep(0.78, 0.90, sn) * (1.0 - branch);
    vec3  skyCool = vec3(0.55, 0.68, 0.55);
    vec3  skyWarm = vec3(0.85, 0.78, 0.50);
    vec3  skyColor = mix(skyCool, skyWarm, sunMix * 0.7);
    col = mix(col, skyColor, sky * 0.75);

    return col;
}

// ---------- Bokeh layer ----------
// Each grid cell hosts one disk-of-confusion. The disk's
//   - position drifts via low-freq wind FBM
//   - intensity twinkles via per-cell FBM (gap opening/closing)
//   - tint is set by proximity to the sun
// Sampling 3x3 neighbours gives plenty of overlap when radius > 1 cell.
vec3 bokehLayer(
    vec2 uv,
    float gridScale,
    float radius,        // in cell units
    float brightness,
    vec2 sunPos
) {
    float t = u_time;
    vec2 st    = uv * gridScale;
    vec2 i_st  = floor(st);
    vec2 f_st  = fract(st);

    vec3 acc = vec3(0.0);

    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 cell = i_st + vec2(float(i), float(j));
            vec2 r    = hash22(cell);

            // Drift: wind advects each leaf by a fraction of a cell
            vec2 drift = windField(cell * 0.4, t * u_windSpeed) * u_windAmp;

            // Centre of the disk inside this neighbour cell
            vec2 pos  = vec2(float(i), float(j)) + r + drift;
            vec2 diff = pos - f_st;
            float dist = length(diff);

            // Per-cell radius variance: roughly +/- 6% around the base.
            // hash12 -> [0,1] -> [-1,1] * 0.06
            float rJitter = (hash12(cell + 7.31) - 0.5) * 0.12;
            float rad = radius * (1.0 + rJitter);

            if (dist > rad * 1.05) continue;

            // Twinkle: sample FBM at (cell, time). Smooth domain so no popping.
            float ph = r.x * 6.2831;
            float fl = fbm(cell * 0.9 + vec2(t * u_flickerSpeed * 0.5,
                                             t * u_flickerSpeed * 0.37) + ph);
            // Threshold against density: how often a gap is "open".
            // density=0.5 -> ~half the cells open; higher density -> rarer gaps.
            float gap = smoothstep(u_density - 0.10, u_density + 0.18, fl);
            // flickerDepth controls residual brightness when FBM says closed.
            // depth=1 -> hard close to 0; depth=0 -> always fully open.
            gap = max(gap, 1.0 - u_flickerDepth);
            if (gap < 0.005) continue;

            // Soft disk
            float blurAmt = mix(rad * 0.9, 0.04, u_sharpness);
            float disk = smoothstep(rad, rad - blurAmt, dist);

            // Subtle bright rim (real lens bokeh has a soft edge halo)
            float rim = smoothstep(rad * 1.0, rad * 0.7, dist)
                      - smoothstep(rad * 0.7, rad * 0.35, dist);
            rim = max(rim, 0.0) * 0.35 * u_sharpness;

            // Per-circle world-space UV for tinting.
            // Disk samples the SAME scene field that paints the background,
            // so the bokeh inherits local branch / sky-peek / sun tint.
            vec2 cellUV = (cell + r) / gridScale;
            vec3 tint = sceneColor(cellUV, sunPos);

            acc += (disk + rim) * gap * tint * brightness;
        }
    }
    return acc;
}

// Background canopy: a dimmed sample of the same scene field.
// Disks and background therefore share one palette.
vec3 background(vec2 uv, vec2 sunPos) {
    return sceneColor(uv, sunPos) * 0.42;
}

// ACES Filmic tone mapping
vec3 ACESFilm(vec3 x) {
    const float a = 2.51;
    const float b = 0.03;
    const float c = 2.43;
    const float d = 0.59;
    const float e = 0.14;
    return clamp((x * (a*x + b)) / (x * (c*x + d) + e), 0.0, 1.0);
}

void main() {
    vec2 frag = gl_FragCoord.xy / u_resolution.xy;
    vec2 uv = frag;
    uv.x *= u_resolution.x / u_resolution.y;

    float aspect = u_resolution.x / u_resolution.y;
    vec2 sunPos = vec2(u_sunX * aspect, u_sunY);

    // 1. Background canopy
    vec3 col = background(uv, sunPos);

    // Single bokeh layer at one characteristic disk size.
    // Disk size variance (+/- ~6%) is now per-cell inside bokehLayer.
    // Disks are brighter samples of the same scene field, so they
    // act as concentrated highlights of the local canopy color.
    vec3 fg = bokehLayer(
        uv,
        6.5 * u_zoom,
        0.78,
        1.35,
        sunPos
    );
    col += fg;

    // 4. Minimal background sun: just a soft warm bloom on the right.
    //    Kept additive but low-amplitude so ACES doesn't blow it out.
    float sunDist = length(uv - sunPos);
    float bloom   = exp(-sunDist * (1.6 / max(u_sunSize, 0.05)));
    col += C_SUN_CORE * bloom * 0.55;

    // Tiny crisp core only when sun is on-screen
    float core = smoothstep(u_sunSize * 0.20, 0.0, sunDist);
    col += C_SUN_CORE * pow(core, 4.0) * 0.6;

    // 5. Subtle diffraction rays masked by a slow FBM (so they sprinkle)
    if (u_rayIntensity > 0.001) {
        float ang = atan(uv.y - sunPos.y, uv.x - sunPos.x);
        float rays = sin(ang * 9.0 + u_time * 0.05 * u_windSpeed)
                   * sin(ang * 17.0 - u_time * 0.03 * u_windSpeed);
        rays = smoothstep(0.85, 1.0, rays);
        float rayMask = fbm(uv * 8.0 + vec2(u_time * 0.05 * u_windSpeed, 0.0));
        rayMask = smoothstep(0.4, 0.7, rayMask);
        float rayFalloff = exp(-sunDist * 1.2);
        col += C_SUN_CORE * rays * rayMask * rayFalloff * u_rayIntensity * 0.6;
    }

    // ---------- Post ----------
    col *= u_exposure;
    col = ACESFilm(col);

    // Saturation around tone-mapped luma
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(luma), col, u_saturation);

    // Vignette: stronger and more visible
    float vd = length(frag - 0.5);
    float v = 1.0 - smoothstep(0.30, 0.85, vd);
    col *= mix(1.0 - u_vignette, 1.0, v);

    // Gamma
    col = pow(max(col, 0.0), vec3(1.0 / 2.2));

    gl_FragColor = vec4(col, 1.0);
}
