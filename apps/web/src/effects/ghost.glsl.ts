/**
 * GhostText's shaders (VISUAL_REFERENCES.md, Effect B). A small trail field (ping-pong framebuffer)
 * holds the pointer's recent velocity: every frame it decays and the pointer stamps a Gaussian splat
 * (RG = velocity, B = energy). The composite samples the text's alpha three times, offset along the
 * trail and smeared over three taps: red ahead, green a little behind, blue further back. Where all
 * three overlap the text is solid ink; where they part, the reference's red/yellow and cyan/blue
 * fringes appear. In the light theme the fringes are the subtractive pair over ink-coloured text.
 */
export const TRAIL_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPrev;
uniform vec2 uPointer;
uniform vec2 uVelocity;
uniform float uEnergy;
uniform float uAspect;
uniform float uRadius;
uniform float uDecay;
uniform bool uEncoded;

vec3 decode(vec4 c) { return uEncoded ? c.rgb * 2.0 - 1.0 : c.rgb; }
vec4 encode(vec3 v) { return uEncoded ? vec4(clamp(v * 0.5 + 0.5, 0.0, 1.0), 1.0) : vec4(v, 1.0); }

void main() {
  vec3 v = decode(texture(uPrev, vUv)) * uDecay;
  vec2 d = (vUv - uPointer) * vec2(1.0, uAspect);
  float g = exp(-dot(d, d) / (2.0 * uRadius * uRadius)) * uEnergy;
  v.rg += uVelocity * g;
  v.b += g;
  outColor = encode(v);
}`;

export const GHOST_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uText;
uniform sampler2D uTrail;
uniform bool uEncoded;
uniform float uStrength;
uniform vec3 uInk;
uniform bool uLight;

vec2 trailAt(vec2 uv) {
  vec4 c = texture(uTrail, uv);
  return uEncoded ? c.rg * 2.0 - 1.0 : c.rg;
}
float alphaAt(vec2 uv) { return texture(uText, uv).a; }
float smear(vec2 uv, vec2 dir) {
  return (alphaAt(uv) + alphaAt(uv - dir * 0.5) + alphaAt(uv - dir)) / 3.0;
}

void main() {
  vec2 d = trailAt(vUv) * uStrength * 0.04;
  float r = smear(vUv + d, d);
  float g = smear(vUv + 0.35 * d, 0.35 * d);
  float b = smear(vUv - 0.8 * d, -0.8 * d);
  if (!uLight) {
    // Additive on the night sky: overlap is white ink, R alone red, R+G yellow, G+B cyan, B blue.
    float a = max(max(r, g), b);
    outColor = vec4(vec3(r, g, b) * uInk, a);
  } else {
    float o = min(min(r, g), b);
    vec3 red = vec3(0.843, 0.149, 0.239);
    vec3 blue = vec3(0.114, 0.498, 0.722);
    float fr = (r - o) * 0.6;
    float fg = (g - o) * 0.6;
    float fb = (b - o) * 0.6;
    float a = clamp(o + fr + fg + fb, 0.0, 1.0);
    outColor = vec4(uInk * o + red * fr + mix(red, blue, 0.5) * fg + blue * fb, a);
  }
}`;
