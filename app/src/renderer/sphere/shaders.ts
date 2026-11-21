// GLSL for the voice orb: warm liquid glass (docs/05-design-prompts.md).
// Vertex: a gentle, mostly-smooth wobble plus an outward pulse on audio.
// Fragment: domain-warped noise sampled at three depths through the sphere
// (parallax = the light seems to flow *inside*), lit centre fading to
// terracotta, a cream glassy rim and soft key-light highlight. State looks:
//   listening — cool cream highlights, gentle breathing (scale, JS side)
//   thinking  — inner light swirls inward, slightly dimmer
//   speaking  — terracotta waves rolling outward, synced to the voice level

const NOISE = /* glsl */ `
// --- ashima 3D simplex noise ---
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`

export const SPHERE_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uLevel;   // smoothed audio level 0..1
uniform float uAmp;     // base wobble amplitude
uniform float uFreq;    // wobble spatial frequency

varying vec3 vWorldPos;
varying vec3 vWorldNormal;

${NOISE}

void main() {
  float n = snoise(normal * uFreq + vec3(0.0, 0.0, uTime * 0.6));
  float displacement = uAmp * n + uLevel * 0.045;
  vec4 world = modelMatrix * vec4(position + normal * displacement, 1.0);
  vWorldPos = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

export const SPHERE_FRAGMENT = /* glsl */ `
uniform float uTime;    // flow time (advances at the state's flow speed)
uniform float uClock;   // wall-clock seconds, for waves
uniform float uLevel;
uniform float uSwirl;   // thinking 0..1
uniform float uWarm;    // speaking 0..1
uniform float uCool;    // listening 0..1

varying vec3 vWorldPos;
varying vec3 vWorldNormal;

${NOISE}

float fbm2(vec3 p) { return 0.5 * snoise(p) + 0.25 * snoise(p * 2.03 + 1.7); }
float fbm3(vec3 p) {
  float a = 0.55, s = 0.0;
  for (int i = 0; i < 3; i++) {
    s += a * snoise(p);
    p = p * 1.9 + vec3(1.3, -0.7, 2.1);
    a *= 0.42;
  }
  return s;
}

// Thinking: twist the field around the view axis, tighter toward the core,
// so the light reads as spiralling inward.
vec3 swirl(vec3 p, float t) {
  float r = length(p.xy);
  float ang = uSwirl * (t * 0.9 + 1.6 * (1.0 - r));
  float c = cos(ang), s = sin(ang);
  p.xy = mat2(c, -s, s, c) * p.xy;
  return p;
}

float liquid(vec3 p, float t) {
  p = swirl(p, t);
  vec3 q = vec3(
    fbm2(p * 0.6 + vec3(0.0, t * 0.11, t * 0.07)),
    fbm2(p * 0.6 + vec3(5.2, 1.3 - t * 0.09, 2.8)),
    fbm2(p * 0.6 + vec3(-3.1, 4.7, t * 0.05))
  );
  return fbm3(p * 0.75 + q * 1.1 + vec3(0.0, -t * 0.06, 0.0));
}

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 3.0);
  float r = sqrt(1.0 - ndv * ndv); // 0 at the disc centre, 1 at the silhouette

  // Three layers through the volume; deeper layers weigh less.
  float d = 0.0;
  float wsum = 0.0;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float w = 1.0 / (1.0 + fk * 0.8);
    d += w * liquid(vWorldPos - V * (0.12 + fk * 0.32), uTime + fk * 1.7);
    wsum += w;
  }
  float dens = smoothstep(-0.55, 0.55, d / wsum);

  vec3 cream = vec3(0.985, 0.945, 0.885);
  vec3 peach = vec3(0.965, 0.705, 0.535);
  vec3 ember = vec3(0.80, 0.405, 0.255);
  vec3 deep  = vec3(0.60, 0.27, 0.16);

  // Light lives in the centre; terracotta gathers toward the rim.
  // A soft glow: the flow only nudges the gradient, it never paints on top.
  float core = pow(ndv, 1.2);
  float glow = core * 0.75 + (dens - 0.5) * 0.45;
  vec3 col = mix(deep, ember, smoothstep(-0.15, 0.3, glow));
  col = mix(col, peach, smoothstep(0.2, 0.6, glow));
  col = mix(col, cream, smoothstep(0.5, 0.95, glow + uCool * 0.12));

  // Speaking: warm waves rolling outward from the centre.
  float wave = 0.5 + 0.5 * sin(r * 10.0 - uClock * 4.0 + (dens - 0.5) * 1.6);
  wave = pow(wave, 3.0) * uWarm * (0.3 + 1.1 * uLevel);
  col = mix(col, ember * 1.06, clamp(wave, 0.0, 1.0) * 0.4);
  col += peach * wave * 0.1;

  // Soft key light from the top-left, and a glassy cream rim.
  vec3 L = normalize(vec3(-0.55, 0.7, 0.55));
  vec3 H = normalize(L + V);
  float nh = max(dot(N, H), 0.0);
  col += cream * (pow(nh, 60.0) * 0.32 + pow(nh, 10.0) * 0.06);
  col = mix(col, cream, fres * (0.4 + 0.2 * uCool));
  col += ember * fres * 0.12 * (1.0 + uWarm * uLevel * 2.5);

  col *= 0.95 + 0.14 * uLevel - 0.13 * uSwirl;

  // Dither against banding on the smooth gradients.
  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;

  // Translucent edge melts into the halo behind it.
  gl_FragColor = vec4(col, mix(1.0, 0.8, fres));
}
`
