# Visual references → effect specs

> Source files: `/home/nabhanyu/Downloads/ReferenceAttachements/` (owner's recordings). Frames
> were extracted with ffmpeg 7.0.2 and colours sampled from raw pixels; compressed copies live in
> `docs/design/reference/`. This document is the implementation spec for the four effects
> (built in Task 6). Each effect is tied to a *meaning* in the product, so the spectacle carries
> information instead of decorating.

## Reference 1: "Aurora" hero (`Recording 2026-10-16 111836.mp4`, 1478×494, 5.6 s)

Frames: `reference/aurora-glow-sequence.jpg`, `reference/aurora-ghost-text-closeup.jpg`.

What it shows:
- **Background** `#080B14` (navy-black; sampled top-left in every frame).
- **Bottom light cone ("triangle")**: a soft glow rising from the bottom centre, widest at the
  bottom edge and fading upward in a bell/cone shape. Its colour drifts continuously:
  frame 2 core `#B9CCD6` with `#5171E8` (left) and `#69B9EC` (right) → frame 9 `#7771BC`/`#6D91D7`
  → frame 16 `#D165AA` core with `#92478E`/`#A24479` flanks. The tint reaches the area above
  the text faintly (`#1A254D` → `#311C36`). Colours slide sideways while they change (pink
  enters bottom-left while blue stays right), so it is several blobs drifting, not one hue rotation.
- **Faint top beam**: a narrow, low-opacity vertical light from the top centre (frames 2-4).
- **Ghost text**: the white display word (`#F7F3FE`) splits into colour fringes near the
  cursor: red/yellow on one edge, cyan/blue on the other, with a horizontal liquid smear that
  trails the pointer and decays over roughly half a second.

### Effect A: `FloodlightGlow` (CSS) — meaning: "the stadium lights"
- Absolutely positioned, `pointer-events: none`, `aria-hidden`, at the bottom of its container.
- Shape: a container masked with
  `radial-gradient(120% 100% at 50% 100%, #000 0%, #000 30%, transparent 70%)`, holding 4 heavily
  blurred (`filter: blur(48px)`) radial blobs anchored near bottom centre.
- Palette: `--fl-blue #5171E8`, `--fl-cyan #69B9EC`, `--fl-violet #7771BC`, `--fl-pink #D165AA`.
- Motion: blobs drift ±12% horizontally on staggered 11-17 s loops; each blob's colour animates
  through the palette via `@property`-registered `<color>` custom properties, so the overall cast
  cycles blue → cyan → violet → pink in about 14 s. A top beam at 0.12 opacity.
- Strength: multiplied by `--glow-strength` (dark 1.0, light 0.55; in light theme the cone reads as
  a pastel wash).
- **Outburst API** `burst({ color, strength = 1 })`: cone scales 1 → 1.35 from the bottom edge and
  brightens (filter brightness 1 → 1.6) over 350 ms, blob colours lerp toward `color`, then ease
  back over 1.6 s. **Fired only when a big moment is revealed on the fan's TV clock** (six → gold
  `--six` mixed with the batting team colour; wicket → bowling team colour; result → winner
  colour, longer). Never on stadium time, or the effect itself would be a spoiler.
- Used in: landing hero (ambient), bottom edge of the TV pane (low ambient + outbursts).
- Reduced motion: static cone, no drift; outburst becomes a 300 ms opacity pulse.

### Effect B: `GhostText` (WebGL2) — meaning: "the moment itself"
- The real text stays in the DOM (accessible, selectable) with `opacity: 0`; a canvas overlay
  (`aria-hidden`) draws it through a shader.
- Text texture: draw the element's text with its computed font (Anek Latin, same wdth/wght/size)
  into a 2D canvas at `devicePixelRatio` (capped at 2) and upload as a texture.
- Trail field: a small float texture (64 × 64·aspect) in a ping-pong framebuffer.
  Each frame `trail *= 0.92`; the pointer stamps a Gaussian splat (radius ≈ 8% of width) whose RG =
  pointer velocity (px/frame, normalised), B = energy.
- Fragment: `d = trail.rg * strength * 0.04`; sample the text alpha three times:
  `R = A(uv + d)`, `G = A(uv + 0.35·d)`, `B = A(uv − 0.8·d)`, each a 3-tap smear along `d`.
  Output `vec3(R, G, B)`: overlap is white, R alone red, R+G yellow, G+B cyan, B alone blue,
  which is exactly the reference's fringe pattern. Light theme: render ink-coloured text and use
  the subtractive pair (fringes `#D7263D` / `#1D7FB8` at 60%) so it reads on a light background.
- Stop the animation loop when total trail energy < 0.001; restart on pointer move.
- Used in: landing wordmark "Sideline" (pointer-driven); the reveal headline on the TV pane for a
  six, wicket or result, driven by a programmatic sweep (a synthetic pointer path) instead of
  the mouse.
- Fallback (no WebGL2, or reduced motion): plain text with a static 1 px red/cyan `text-shadow`.

## Reference 2: "Warp" dither (`Recording 2026-09-05 074749.mp4`, 292×284, 8.9 s)

Frames: `reference/warp-dither-sequence.jpg`, `reference/warp-dither-detail.jpg`.

What it shows: 1-bit **ordered (Bayer 4×4) dithering** of a smoothly animated, domain-warped
noise field. Dark areas render as a sparse dot grid; brighter areas as denser checkerboards; the
brightest as solid white. A faint diagonal band sweeps through, then a bright arcing streak grows
from the bottom-left and a halftone mass rises from the bottom. The pattern **comes and goes**:
it fades in from sparse dots, intensifies, and recedes.

### Effect C: `DitherVeil` (WebGL2) — meaning: "held back" (spoiler shield) and "thinking"
- Uniforms: `uTime`, `uIntensity` (0-1 envelope), `uPixel` (dot size, default 3 CSS px),
  `uInk`, `uBase` (theme colours), `uSeed`.
- Field: domain-warped fbm (`q = fbm(p + 0.05t)`, `r = fbm(p + 4q + 0.08t)`, `f = fbm(p + 4r)`)
  plus a diagonal streak term `1 − smoothstep(0, w, |dot(p, n) − s(t)|)`; value
  `v = clamp((f + streak) · uIntensity, 0, 1)`.
- Ordered dither: cell = `floor(fragCoord / uPixel)`; threshold from the Bayer matrix
  `[0 8 2 10; 12 4 14 6; 3 11 1 9; 15 7 13 5] / 16` at `cell mod 4`; dot on when `v > threshold`.
- Composite: a frosted base (`uBase` at `0.88 · uIntensity` alpha) under the dots, so content
  beneath is unreadable while held.
- **Semantics:**
  1. *Held spoiler*: a moment card whose `revealAt` is still ahead of the fan's TV clock is covered
     at intensity 1. When the TV catches up, intensity animates 1 → 0 over 900 ms; the Bayer
     thresholds make the dots thin out progressively, a dissolve that literally reveals the card.
  2. *AI thinking*: while a request is in flight, intensity pulses 0.15-0.35 (2.5 s period) behind
     the card's skeleton.
  3. *Phase change* (story mode): a brief rise-and-fade wipe between phases.
- Fallback: CSS dot pattern (`radial-gradient(circle, currentColor 1px, transparent 1.2px)` at 6 px)
  with an opacity transition. Reduced motion: no animation, 150 ms fade on reveal.

## Reference 3: Slackbot input (`Screenshot 2026-09-05 075505.png`, 1112×192)

File: `reference/slackbot-input-glow.png`.

What it shows: a dark input (`#1A1D21`, 1 px light border, ~8 px radius) with a soft multicolour
halo bleeding 20-40 px beyond its edges: red/magenta and blue/cyan above, green/yellow to the
right, magenta/orange below. Sampled halo tints are subtle (`#222231`, `#1D343B`, `#2F3830`,
`#391D2A` over `#1B1D22`), so roughly 10-20% strength. Placeholder suggestion with a `Tab` key
chip; a disclaimer line below: "Slackbot is AI and can make mistakes."

### Effect D: `GlowInput` (CSS) — meaning: "you are talking to the AI"
- Wrapper `position: relative; isolation: isolate`. A `::before` at `inset: -14px` with
  `conic-gradient(from var(--glow-angle), #FF4D6D, #C64DFF, #4D7CFF, #3FE0D0, #B8F05A, #FFC94A, #FF4D6D)`,
  `filter: blur(22px)`, `z-index: -1`, radius = input radius + 14 px.
- Opacity by state (dark / light theme): idle 0.18 / 0.12, focus 0.42 / 0.28, **thinking** 0.55 /
  0.36 with `--glow-angle` (registered `@property`, `<angle>`) rotating 360° per 2.4 s.
- Input: `--surface-1` background, 1 px `--line-strong` border, `--r-control` radius, 16 px text.
- Contextual placeholder suggestion (computed from match state, not AI) with a `Tab` keycap chip
  that accepts it; helper line below: "Sideline uses AI and can make mistakes."
- Used on: the companion composer ("Ask Sideline"), the Lineup Patch intent box, the NL inspector
  query box, the chat composer.
- Reduced motion: no rotation.

## Global rules for all effects
- One spectacle at a time: outbursts and ghost reveals are reserved for genuine big moments.
- Every effect has a no-WebGL and a reduced-motion path; nothing essential is conveyed by motion alone.
- Effects pause when the tab is hidden (`document.visibilityState`) and when off-screen
  (IntersectionObserver).
- DPR capped at 2; target 60 fps on a mid-range phone; WebGL contexts created lazily and released
  on unmount.
