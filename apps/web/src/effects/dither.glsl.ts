/**
 * DitherVeil's fragment shader (VISUAL_REFERENCES.md, Effect C): 1-bit ordered (Bayer 4×4) dithering
 * of a domain-warped fbm field with a diagonal streak sweeping through, composited over a frosted
 * base so the content underneath is unreadable while held. As `uIntensity` falls, cells drop below
 * their Bayer thresholds one by one: the dissolve that reveals a spoiler when the TV catches up.
 */
export const DITHER_FRAGMENT = `#version 300 es
precision highp float;
out vec4 outColor;
uniform vec2 uResolution;
uniform float uTime;
uniform float uIntensity;
uniform float uPixel;
uniform float uDpr;
uniform vec3 uInk;
uniform vec3 uBase;
uniform float uSeed;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.02 + vec2(17.0, 9.0);
    a *= 0.5;
  }
  return v;
}
const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0,
                                  3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);

void main() {
  vec2 cell = floor(gl_FragCoord.xy / uPixel);
  // Field coordinates in cells, so the pattern keeps its scale on any card size.
  vec2 p = cell * uPixel / (180.0 * uDpr) + uSeed;
  float t = uTime;
  vec2 q = vec2(fbm(p + 0.05 * t), fbm(p + vec2(5.2, 1.3) + 0.05 * t));
  vec2 r = vec2(fbm(p + 4.0 * q + vec2(1.7, 9.2) + 0.08 * t),
                fbm(p + 4.0 * q + vec2(8.3, 2.8) + 0.08 * t));
  float f = fbm(p + 4.0 * r);
  // A faint band sweeping diagonally across, as in the reference.
  vec2 n = normalize(vec2(0.8, 1.0));
  float sweep = fract(t * 0.06) * 3.0 - 1.0;
  float span = dot(gl_FragCoord.xy / uResolution, n);
  float streak = 1.0 - smoothstep(0.0, 0.08, abs(span - sweep));
  float v = clamp((f + 0.45 * streak) * uIntensity, 0.0, 1.0);
  int index = int(mod(cell.y, 4.0)) * 4 + int(mod(cell.x, 4.0));
  float on = v > BAYER[index] / 16.0 ? 1.0 : 0.0;
  float baseAlpha = 0.88 * uIntensity;
  float alpha = max(baseAlpha, on * uIntensity);
  vec3 color = mix(uBase, uInk, on);
  outColor = vec4(color * alpha, alpha);
}`;
