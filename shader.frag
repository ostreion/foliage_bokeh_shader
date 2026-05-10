#ifdef GL_ES
precision highp float;
#endif

uniform vec2  u_resolution;
uniform float u_time;

// Layout / camera
uniform float u_zoom;
uniform float u_density;
uniform float u_sharpness;
uniform float u_diskSize;        // bokeh disk radius (cell units)
uniform float u_sizeVar;         // +/- variance fraction
uniform float u_diskBrightness;
uniform float u_bgMix;           // background dim factor

// Scene field
uniform float u_branchAmount;
uniform float u_branchThresh;
uniform float u_branchAngle;     // radians, rotation of branch streaks
uniform float u_branchWidth;     // 0 = thin, 1 = thick limbs
uniform float u_branchOcclude;   // how much branches block bokeh (0..1)
uniform float u_leafCover;       // foreground-leaf irregularity (0..1)
uniform float u_skyAmount;
uniform float u_skyThresh;
uniform float u_greenScale;      // freq scale of base green variation

// Color / post
uniform float u_warmth;
uniform float u_exposure;
uniform float u_saturation;
uniform float u_vignette;

// Wind / flicker
uniform float u_windSpeed;
uniform float u_windAmp;
uniform float u_flickerDepth;
uniform float u_flickerSpeed;

// Sun
uniform float u_sunX;
uniform float u_sunY;
uniform float u_sunSize;
uniform float u_sunBloom;        // halo strength
uniform float u_sunReach;        // bloom falloff (smaller = wider)
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

// ---------- Branch field ----------
// Branches are just another color contribution to the scene
// (dark warm-brown matter), like green leaves or sky peeks.
// Rare, but when they occur they're long: high anisotropy in the
// branch direction, high threshold so coverage stays around 5-10%.
// u_branchWidth controls cross-section thickness, u_leafCover
// adds high-freq irregularity so the streaks fragment naturally.
float branchField(vec2 uv) {
    float ca = cos(u_branchAngle), sa = sin(u_branchAngle);
    vec2  uvR0 = vec2(ca * uv.x - sa * uv.y,
                      sa * uv.x + ca * uv.y);

    vec2 wobble = vec2(vnoise(uvR0 * 0.5 + 5.1),
                       vnoise(uvR0 * 0.5 - 3.3)) - 0.5;
    vec2 uvR = uvR0 + wobble * 0.45;

    // High aniso (branches are LONG) - the perpendicular stretch
    // is large so noise peaks form thin elongated ridges.
    float aniso = mix(14.0, 5.0, u_branchWidth);

    vec2 br1 = vec2(uvR.x * 0.55,                uvR.y * aniso);
    vec2 br2 = vec2(uvR.x * 0.40 + uvR.y * 0.10, uvR.y * aniso * 0.55);
    float bnA = vnoise(br1 * 0.9 + 13.7);
    float bnB = vnoise(br2 * 1.1 -  4.2);
    float bn  = bnA * bnB * 1.85;

    float widthMod = vnoise(uvR * vec2(0.22, 0.9) + 7.7) - 0.5;
    float thresh   = u_branchThresh + widthMod * 0.10;

    float branch = smoothstep(thresh, thresh + 0.10, bn);

    // Leaf irregularity: high-freq noise breaks up the streak so
    // a single branch fragments into multiple discontinuous dark
    // patches. Two octaves give both individual-leaf and clump
    // scales.
    float leaf = vnoise(uv * 18.0 + 2.3) * 0.55
               + vnoise(uv *  9.0 - 5.1) * 0.45;
    leaf = (leaf - 0.5) * u_leafCover * 0.7;
    branch = clamp(branch - leaf, 0.0, 1.0);

    return branch;
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
    float n1 = fbm(uv * u_greenScale + vec2(tt, tt * 0.6));
    float greenMix = smoothstep(0.30, 0.78, n1);
    vec3  darkGreen   = vec3(0.04, 0.075, 0.025);
    vec3  sunnyGreen  = vec3(0.48, 0.66, 0.18);
    vec3  col = mix(darkGreen, sunnyGreen, greenMix);

    // Sun proximity gold tint (also used downstream)
    float d = length(uv - sunPos);
    float k = mix(2.2, 0.45, u_warmth);
    float sunMix = 1.0 - smoothstep(0.10, 1.0, d * k);
    col = mix(col, C_GOLD_BOK, sunMix * 0.85);

    // Branches: dark warm-brown matter mixed into the scene.
    // Disks sampling sceneColor at a branch cell will come up as
    // dark-brown smears, naturally reading as long thin streaks
    // through the bokeh field instead of a separate silhouette
    // layer painted on top.
    float branch = branchField(uv);
    vec3  branchColor = vec3(0.06, 0.038, 0.020);
    col = mix(col, branchColor, branch * u_branchAmount);

    // Sparse sky-peek: pale, slightly cool. Warmer near the sun.
    float sn = vnoise(uv * 4.0 + vec2(0.0, tt * 0.5));
    float sky = smoothstep(u_skyThresh, u_skyThresh + 0.12, sn) * (1.0 - branch);
    vec3  skyCool = vec3(0.55, 0.68, 0.55);
    vec3  skyWarm = vec3(0.85, 0.78, 0.50);
    vec3  skyColor = mix(skyCool, skyWarm, sunMix * 0.7);
    col = mix(col, skyColor, sky * u_skyAmount);

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

            // Per-cell radius variance, controlled by u_sizeVar (full range).
            float rJitter = (hash12(cell + 7.31) - 0.5) * u_sizeVar;
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
    return sceneColor(uv, sunPos) * u_bgMix;
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

    // Single bokeh layer. Disks sample sceneColor at their cell
    // centre, so cells whose centre lands on branch matter come
    // out dark-brown - the branches naturally emerge through the
    // bokeh as occasional dark streaks of brown disks.
    // Branch Occlusion can additionally cut disk brightness in
    // the same area for a more silhouetted look (default 0).
    float bm = branchField(uv);
    float branchOcclude = bm * u_branchAmount * u_branchOcclude;
    vec3 fg = bokehLayer(
        uv,
        6.5 * u_zoom,
        u_diskSize,
        u_diskBrightness,
        sunPos
    );
    fg *= (1.0 - branchOcclude);
    col += fg;

    // 4. Minimal background sun: just a soft warm bloom on the right.
    //    Kept additive but low-amplitude so ACES doesn't blow it out.
    float sunDist = length(uv - sunPos);
    float bloom   = exp(-sunDist * (u_sunReach / max(u_sunSize, 0.05)));
    col += C_SUN_CORE * bloom * u_sunBloom;

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
