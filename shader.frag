#ifdef GL_ES
precision highp float;
#endif

uniform vec2  u_resolution;
uniform float u_time;
uniform vec2  u_pan;             // touch/drag offset, parallaxed across layers

// Layout / camera
uniform float u_zoom;
uniform float u_density;
uniform float u_sharpness;
uniform float u_diskSize;        // bokeh disk radius (cell units)
uniform float u_sizeVar;         // +/- variance fraction
uniform float u_diskBrightness;
uniform float u_bgMix;           // background dim factor

// Scene field
uniform float u_skyAmount;
uniform float u_skyThresh;
uniform float u_greenScale;      // freq scale of base green variation

// Rim / speckle
uniform float u_rimChance;        // fraction of disks that get a rim (0..1)
uniform float u_rimStrength;      // rim brightness multiplier
uniform float u_rimThickness;     // 0 thin, 1 thick
uniform float u_rimCoverageMin;   // min fraction of circumference (0..1)
uniform float u_rimCoverageMax;   // max fraction of circumference (0..1)
uniform float u_rimSpeckle;       // speckle amplitude on rim
uniform float u_rimSpeckleScale;  // speckle frequency multiplier
uniform float u_innerOpacity;     // body translucency multiplier

// Color / post
uniform float u_warmth;
uniform float u_exposure;
uniform float u_saturation;
uniform float u_vignette;
uniform float u_grainAmount;     // film grain intensity
uniform float u_grainSize;       // grain pixel scale (>=1)
uniform float u_grainColor;      // 0 = mono luma grain, 1 = full RGB chroma jitter
uniform float u_mute;            // 0 = full intensity, 1 = recede into background

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
uniform float u_rayCount;        // angular frequency of diffraction rays

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
//   - sparse pale bluish-green sky-peek hot spots
//
// One fbm + two vnoise calls; cheap enough to evaluate per disk.
// includeSky controls whether the sky-peek hot spots are baked into
// the returned color. The background pass uses includeSky=false so
// sky shapes aren't visible as a flat layer between disks; the disk
// tint pass uses includeSky=true so disks landing on sky cells read
// pale-cyan and reveal the sky through bokeh alone.
vec3 sceneColor(vec2 uv, vec2 sunPos, bool includeSky) {
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

    // Sparse sky-peek: pale, slightly cool. Warmer near the sun.
    // Only contributes when includeSky is true (i.e. for disk
    // tinting). The background pass skips this so sky shapes don't
    // leak through as a visible flat layer between disks.
    if (includeSky) {
        float sn = vnoise(uv * 4.0 + vec2(0.0, tt * 0.5));
        float sky = smoothstep(u_skyThresh, u_skyThresh + 0.12, sn);
        vec3  skyCool = vec3(0.55, 0.68, 0.55);
        vec3  skyWarm = vec3(0.85, 0.78, 0.50);
        vec3  skyColor = mix(skyCool, skyWarm, sunMix * 0.7);
        col = mix(col, skyColor, sky * u_skyAmount);
    }

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

    // 5x5 neighbourhood. Needed because disks can exceed 1 cell of
    // radius (Disk Size > 1.0 or Size Variance pushes max rad past
    // a cell), in which case a 3x3 window clips them at cell
    // boundaries and you see the grid as square artefacts. The
    // `dist > rad * 1.15` early-continue keeps the cost small for
    // small disks - outer ring just hashes + skips.
    for (int j = -2; j <= 2; j++) {
        for (int i = -2; i <= 2; i++) {
            vec2 cell = i_st + vec2(float(i), float(j));
            vec2 r    = hash22(cell);

            // Drift: wind advects each leaf by a fraction of a cell
            vec2 drift = windField(cell * 0.4, t * u_windSpeed) * u_windAmp;

            // Centre of the disk inside this neighbour cell
            vec2 pos  = vec2(float(i), float(j)) + r + drift;
            vec2 diff = pos - f_st;

            // Per-cell radius variance, controlled by u_sizeVar (full range).
            float rJitter = (hash12(cell + 7.31) - 0.5) * u_sizeVar;
            float rad = radius * (1.0 + rJitter);

            // Per-cell shape: small ellipse stretch + random orientation,
            // so disks read as slightly off-round rather than identical
            // circles. Stays subtle: ~+/-9% axis ratio.
            float hShape = hash12(cell + 1.71);
            float hRot   = hash12(cell + 4.37);
            float stretch = (hShape - 0.5) * 0.18;
            float ra = hRot * 6.2831;
            float cR = cos(ra), sR = sin(ra);
            vec2 diffR = vec2(cR * diff.x - sR * diff.y,
                              sR * diff.x + cR * diff.y);
            diffR.x *= 1.0 + stretch;
            diffR.y *= 1.0 - stretch;
            float dist = length(diffR);

            // Blur-aware skip threshold. With heavy defocus the body
            // feathers well past `rad`, so a fixed 1.15*rad cap would
            // hard-clip the soft edge and visually re-focus the disk.
            // Use the larger of body reach (rad + blurAmt*0.5) and
            // rim reach (rad + rad*0.18), plus a small margin.
            float bodyReach = rad + max(0.0, mix(rad * 1.6, 0.04, u_sharpness)) * 0.5;
            float rimReach  = rad * 1.18;
            float maxReach  = max(bodyReach, rimReach) + rad * 0.04;
            if (dist > maxReach) continue;

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

            // Per-cell opacity character.
            float hRim   = hash12(cell + 9.13);
            float hInner = hash12(cell + 13.77);
            float rimAmt       = mix(0.85, 1.35, hRim) * u_rimStrength;
            float innerOpacity = mix(0.18, 0.45, hInner) * u_innerOpacity;

            // Soft body. Two-part construction:
            // 1) bodyEdge: a symmetric soft cutoff straddling `rad`,
            //    so the dense interior reaches all the way to the
            //    rim band (no low-opacity gap between body and rim).
            //    u_sharpness controls how soft that boundary is.
            // 2) bodyRamp: radial opacity gradient — translucent at
            //    the centre, full at the edge. Matches how an
            //    out-of-focus light pools pigment toward the rim.
            // Extended defocus range: at sharpness=0 the blur band
            // now spans well past `rad`, so the disk fully melts into
            // a soft wash - useful for background mode where you want
            // the bokeh to read as colour fields rather than circles.
            float blurAmt = mix(rad * 1.6, 0.04, u_sharpness);
            float bodyEdge = smoothstep(rad + blurAmt * 0.5,
                                        rad - blurAmt * 0.5, dist);
            float t = clamp(dist / max(rad, 1e-4), 0.0, 1.0);
            float bodyRamp = mix(0.25, 1.0, pow(t, 1.4));
            float disk = bodyEdge * bodyRamp * innerOpacity;

            // Per-cell rim presence: only some disks get a rim. Hash
            // gates it; soft-thresholded so the chance slider feels
            // continuous instead of stepping.
            float hHasRim   = hash12(cell + 31.71);
            float rimGate   = smoothstep(0.05, 0.0, hHasRim - u_rimChance);

            float rim = 0.0;
            if (rimGate > 0.001) {
                // Anchor the rim to the body's perceived outer edge,
                // which sits at dist=rad (the 50% point of the
                // symmetric body cutoff). This way the rim tracks
                // the visible boundary regardless of u_sharpness:
                // when the disk is softly defocused, the rim still
                // hugs the outside, not a fixed inner radius.
                float ang = atan(diffR.y, diffR.x);
                float wobR = vnoise(vec2(ang * 2.1 + hRot * 6.2831, hShape * 7.0)) - 0.5;
                float wobW = vnoise(vec2(ang * 3.4 - hRim  * 5.1,    hInner * 4.3)) - 0.5;
                float thick     = rad * mix(0.04, 0.16, u_rimThickness);
                float rimCenter = rad + wobR * rad * 0.04;
                float rimHalf   = thick + wobW * thick * 0.6;
                float rimRadial = smoothstep(rimHalf, 0.0, abs(dist - rimCenter));

                // Partial-circumference arc, per-cell start + coverage
                // bounded by the user's min/max sliders.
                float arcNorm  = ang / 6.2831 + 0.5;
                float arcStart = hash12(cell + 17.71);
                float covLo    = min(u_rimCoverageMin, u_rimCoverageMax);
                float covHi    = max(u_rimCoverageMin, u_rimCoverageMax);
                float arcCov   = mix(covLo, covHi, hash12(cell + 23.13));
                float dArc     = fract(arcNorm - arcStart);
                float feather  = 0.06;
                float arcMask  = smoothstep(0.0, feather, dArc)
                               * (1.0 - smoothstep(arcCov - feather, arcCov, dArc));

                // Rim-only speckle.
                float fScale = u_rimSpeckleScale;
                float granA = vnoise(diffR * 55.0 * fScale + cell * 3.1) - 0.5;
                float granB = vnoise(diffR * 28.0 * fScale - cell * 1.7) - 0.5;
                float speck = granA * 0.7 + granB * 0.3;
                float rimMod = 1.0 + speck * u_rimSpeckle;

                rim = rimRadial * arcMask * max(rimMod, 0.0)
                    * rimAmt * rimGate;
            }

            // Per-circle world-space UV for tinting.
            // Disk samples the SAME scene field that paints the background,
            // so the bokeh inherits local sky-peek / sun tint.
            vec2 cellUV = (cell + r) / gridScale;
            vec3 tint = sceneColor(cellUV, sunPos, true);

            acc += (disk + rim) * gap * tint * brightness;
        }
    }
    return acc;
}

// Background canopy: a dimmed sample of the same scene field.
// Disks and background therefore share one palette.
vec3 background(vec2 uv, vec2 sunPos) {
    return sceneColor(uv, sunPos, false) * u_bgMix;
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

    // Pan with parallax. Subtract so the scene follows the finger:
    // swipe right -> world content shifts right -> we sample a uv
    // that lies to the left of the previous view-point. Background
    // canopy uses a smaller factor for a faint depth effect.
    vec2 uvBokeh = uv - u_pan;
    vec2 uvBg    = uv - u_pan * 0.55;

    // 1. Background canopy
    vec3 col = background(uvBg, sunPos);

    // Single bokeh layer. Disks sample sceneColor at their cell
    // centre, inheriting local sky / sun tint.
    vec3 fg = bokehLayer(
        uvBokeh,
        6.5 * u_zoom,
        u_diskSize,
        u_diskBrightness,
        sunPos
    );
    col += fg;

    // 4. Minimal background sun: just a soft warm bloom on the right.
    //    Kept additive but low-amplitude so ACES doesn't blow it out.
    //    Uses uvBokeh so the sun translates with the panned scene
    //    rather than staying pinned to the screen.
    float sunDist = length(uvBokeh - sunPos);
    float bloom   = exp(-sunDist * (u_sunReach / max(u_sunSize, 0.05)));
    col += C_SUN_CORE * bloom * u_sunBloom;

    // Tiny crisp core only when sun is on-screen
    float core = smoothstep(u_sunSize * 0.20, 0.0, sunDist);
    col += C_SUN_CORE * pow(core, 4.0) * 0.6;

    // 5. Subtle diffraction rays, coupled to the wind so the sunburst
    //    sways and breathes as if filtered through rustling leaves.
    if (u_rayIntensity > 0.001) {
        // Wind sample at the sun's location. windField is already
        // warm in cache (used by bokeh drift), so reusing it here is
        // free. Returns roughly -0.5..0.5 per axis.
        vec2 wSun = windField(sunPos * 0.4, u_time * u_windSpeed);

        // Sway: rotate the whole sunburst by a small wind-driven
        // angle. Reads as the rays leaning with the canopy.
        float sway = wSun.x * 0.18;
        float ang  = atan(uvBokeh.y - sunPos.y, uvBokeh.x - sunPos.x) + sway;

        // Two sines at related freqs give a beat pattern whose
        // visible spike count tracks u_rayCount.
        float rays = sin(ang * u_rayCount        + u_time * 0.05 * u_windSpeed)
                   * sin(ang * u_rayCount * 1.85 - u_time * 0.03 * u_windSpeed);
        rays = smoothstep(0.85, 1.0, rays);

        // Per-ray independent sparkle. Bucket the angle by ray index,
        // hash for stable per-ray phase + frequency, modulate the
        // spike's intensity with its own slow sine. Each spoke now
        // pulses on its own clock instead of the whole sunburst
        // rising and falling together.
        float bucket  = floor(ang * u_rayCount * 0.15915494 + 0.5);
        float hPhase  = hash12(vec2(bucket, 17.3));
        float hFreq   = hash12(vec2(bucket, 31.7));
        float twF     = 0.6 + hFreq * 1.8;
        float twinkle = 0.35
                      + 0.65 * (0.5 + 0.5 * sin(u_time * twF
                                              + hPhase * 6.2831));
        rays *= twinkle;

        // Mask drift inherits the wind direction so the "sprinkle"
        // travels with the leaves rather than along a fixed axis.
        vec2  drift   = vec2(u_time * 0.05 * u_windSpeed, 0.0) + wSun * 0.6;
        float rayMask = fbm(uvBokeh * 8.0 + drift);
        rayMask = smoothstep(0.4, 0.7, rayMask);

        // Slow breath on amplitude: a low-freq sine plus a touch of
        // wind, so the sunburst never sits at constant brightness.
        float breath = 0.85
                     + 0.15 * sin(u_time * 0.5 * max(u_windSpeed, 0.2))
                     + 0.12 * wSun.y;

        float rayFalloff = exp(-sunDist * 1.2);
        col += C_SUN_CORE * rays * rayMask * rayFalloff
             * u_rayIntensity * 0.6 * breath;
    }

    // ---------- Post ----------
    col *= u_exposure;

    // Mute (pre-tonemap): darken globally, deepen shadows, lift
    // contrast around a low pivot, and reduce saturation modestly.
    // Doing this before ACES means shadows actually crush instead of
    // being lifted toward grey, so the canvas reads as a moody
    // background rather than a faded version of itself.
    if (u_mute > 0.0001) {
        col *= mix(1.0, 0.32, u_mute);
        float pivot = 0.06;
        col = (col - pivot) * mix(1.0, 1.55, u_mute) + pivot;
        float lumaM = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(col, vec3(lumaM), u_mute * 0.35);
    }

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

    // Analog film grain. One hash per pixel - effectively free.
    // Sampled at floor(frag/grainSize) so grain reads larger than a
    // single pixel (real film grain is ~2-3px clusters at this DPI).
    // Time-quantised to ~24fps so it stutters like film, not video.
    if (u_grainAmount > 0.0001) {
        vec2 gp = floor(gl_FragCoord.xy / max(u_grainSize, 1.0));
        // Static grain: no time term. Three hashes give per-channel
        // chroma jitter; still ~free (one hash = a few muls + fract).
        // grainColor=0 collapses RGB to a shared luma grain.
        float gR = hash12(gp + vec2(0.0,  0.0)) - 0.5;
        float gG = hash12(gp + vec2(17.3, 5.1)) - 0.5;
        float gB = hash12(gp + vec2(-9.7, 23.7)) - 0.5;
        float gM = (gR + gG + gB) * (1.0 / 3.0);
        vec3  grain = mix(vec3(gM), vec3(gR, gG, gB), u_grainColor);

        // Bias grain into shadows/midtones so highlights stay clean,
        // matching how silver halide grain behaves on film.
        float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
        float w = mix(1.0, 0.4, smoothstep(0.6, 1.0, luma));
        col += grain * u_grainAmount * w;
    }

    gl_FragColor = vec4(col, 1.0);
}
