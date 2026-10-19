import { randomBytes, randomInt } from "node:crypto";
import type { MotionMode } from "@/lib/presets";

const palettes = [
  "deep ultraviolet with fractured lime highlights",
  "warm monochrome with brushed copper glints",
  "arctic cyan fading into muted periwinkle",
  "rose quartz, ink violet, and pearl white",
  "acid green against graphite with restrained amber",
  "midnight teal with pale champagne reflections",
  "coral haze with a cool cobalt counterpoint",
  "smoked silver with a single electric-blue accent",
  "dusty lilac and apricot over soft charcoal",
  "high-contrast vermilion with mineral blue shadows",
  "sage, cream, and a delicate violet edge",
  "ink black with phosphor aqua and orchid light",
];

const cameras = [
  "a gentle three-quarter orbit with a late, measured reveal",
  "an asymmetric push-in that eases into a suspended hold",
  "a shallow parallax sweep that drifts from lower left to upper right",
  "a slow dolly-back followed by a delicate focal pull",
  "a floating macro track with a restrained counter-rotation",
  "a wide arc around the focal subject with a soft tilt correction",
  "a near-static camera with one precise, breathing-axis shift",
  "a rising crane move that settles into a clean editorial frame",
  "a lateral glide with a subtle foreground-to-background parallax",
  "a controlled spiral-in that resolves before the final beat",
  "a diagonal tracking move that briefly opens negative space",
  "a soft rack-focus simulation paired with a shallow orbit",
];

const lighting = [
  "volumetric side light through a faint atmospheric haze",
  "a narrow rim light with a gradual, pearlescent falloff",
  "softbox reflections that travel across the form, not the frame",
  "a low-key noir pool of light with a subtle neon spill",
  "diffuse dawn light that gains warmth in the final third",
  "a cool backlight and restrained specular accents",
  "a moving caustic shimmer with softly feathered shadows",
  "split-tone light that shifts gently from cool to warm",
  "thin god rays with a fine layer of floating dust",
  "an overhead glow that blooms once, then fades to a clean edge",
  "cinematic bounce light with carefully held highlight detail",
  "a soft halo and a delicate, intermittent lens glint",
];

const particles = [
  "sparse filament sparks with long, graceful falloff",
  "a close layer of fine dust and a distant field of tiny motes",
  "slow pollen-like flecks following curved, non-uniform paths",
  "small refractive droplets that briefly catch the key light",
  "asymmetrical points of light with varied depth and scale",
  "a low-density ribbon of glowing grains that trails the camera",
  "occasional soft bokeh flecks, never forming a repeated grid",
  "fine fragments that gather, disperse, and drift out of frame",
  "subtle chromatic motes with a few near-lens streaks",
  "a sparse halo of particles that orbit at independent speeds",
  "floating micro-shards that rotate before catching a highlight",
  "quiet light spores that appear in staggered, irregular bursts",
];

const textures = [
  "silk-smooth temporal interpolation with one tactile, organic wobble",
  "precise vector-like edges softened by atmospheric depth",
  "liquid refraction at the silhouette, kept understated",
  "fine film grain and gentle halation around the brightest detail",
  "crisp geometry layered against a soft, painterly background",
  "a polished glass finish interrupted by one matte surface",
  "slow, fluid deformations that preserve the subject's proportions",
  "delicate scanline shimmer that never obscures the image",
  "subtle volumetric depth with no harsh cutout edges",
  "a smooth morph with a brief, finely textured settling motion",
  "natural motion blur with sharp focus held on the subject",
  "an editorial finish with visible negative space and clean borders",
];

const rhythms = [
  "a 5-beat arc with a quiet opening and a decisive final settle",
  "three uneven pulses followed by a long, weightless glide",
  "a slow crescendo that releases just before the loop point",
  "an off-beat shimmer over a steady, restrained camera rhythm",
  "a gentle inhale, a brief suspended moment, then a soft release",
  "a single accent at 62 percent, with the rest kept spacious",
  "a gradual lift, a short pause, and an imperfectly repeated return",
  "a calm opening that accelerates for one beat and resolves slowly",
  "a continuous motion phrase with no obvious mechanical loop",
  "two light accents separated by a long, almost still interval",
  "a fluid swell with small timing variations across each layer",
  "a quick initial reveal followed by a measured, elegant drift",
];

const modes: Record<MotionMode, string> = {
  "2d": "preserve the original 2D illustration and build depth with layered parallax",
  "3d": "create convincing dimensional movement with a restrained camera orbit and soft depth separation",
  "line-art": "treat the line work as the hero, preserve clean contours, and add precise luminous tracing",
};

export type DynamicVariation = {
  seed: string;
  signature: string;
  palette: string;
  camera: string;
  lighting: string;
  particles: string;
  texture: string;
  rhythm: string;
  phaseDegrees: number;
  orbitDegrees: number;
  particleDensity: number;
  easing: string;
  modeDirection: string;
};

export async function createDynamicVariation(input: {
  mode: MotionMode;
  presetName: string;
  basePrompt: string;
  recentSignatures?: string[];
}): Promise<DynamicVariation> {
  const recentSignatures = new Set(input.recentSignatures ?? []);
  let variation: DynamicVariation | undefined;

  for (let attempt = 0; attempt < 32; attempt += 1) {
    const indexes = [
      randomInt(palettes.length),
      randomInt(cameras.length),
      randomInt(lighting.length),
      randomInt(particles.length),
      randomInt(textures.length),
      randomInt(rhythms.length),
    ];
    const seed = randomBytes(16).toString("hex");
    const signature = indexes.map((index) => index.toString(16).padStart(2, "0")).join("");
    if (recentSignatures.has(signature)) continue;

    variation = {
      seed,
      signature,
      palette: palettes[indexes[0]],
      camera: cameras[indexes[1]],
      lighting: lighting[indexes[2]],
      particles: particles[indexes[3]],
      texture: textures[indexes[4]],
      rhythm: rhythms[indexes[5]],
      phaseDegrees: randomInt(0, 360),
      orbitDegrees: randomInt(8, 49),
      particleDensity: randomInt(28, 83),
      easing: ["cubic ease-out", "elastic settle", "sine drift", "quintic ease-in-out", "soft spring"][randomInt(5)],
      modeDirection: modes[input.mode],
    };
    break;
  }

  if (!variation) {
    const seed = randomBytes(16).toString("hex");
    variation = {
      seed,
      signature: `fresh-${seed.slice(0, 20)}`,
      palette: palettes[randomInt(palettes.length)],
      camera: cameras[randomInt(cameras.length)],
      lighting: lighting[randomInt(lighting.length)],
      particles: particles[randomInt(particles.length)],
      texture: textures[randomInt(textures.length)],
      rhythm: rhythms[randomInt(rhythms.length)],
      phaseDegrees: randomInt(0, 360),
      orbitDegrees: randomInt(8, 49),
      particleDensity: randomInt(28, 83),
      easing: ["cubic ease-out", "elastic settle", "sine drift", "quintic ease-in-out", "soft spring"][randomInt(5)],
      modeDirection: modes[input.mode],
    };
  }

  return variation;
}

export function buildLocalMotionPrompt(input: {
  basePrompt: string;
  modifier: string;
  mode: MotionMode;
  presetName: string;
  variation: DynamicVariation;
}): string {
  const subject = input.basePrompt.trim() || "the primary subject and composition in the supplied reference image";
  const modifier = input.modifier.trim() ? ` Apply this art direction: ${input.modifier.trim()}.` : "";
  return [
    `Create an original image-to-motion sequence centered on ${subject}.`,
    `Use the ${input.presetName} visual treatment and ${input.mode} mode: ${input.variation.modeDirection}.`,
    `Motion signature ${input.variation.seed}: ${input.variation.camera}; ${input.variation.rhythm}.`,
    `Color and light: ${input.variation.palette}; ${input.variation.lighting}.`,
    `Detail pass: ${input.variation.particles}; ${input.variation.texture}.`,
    `Use ${input.variation.easing}, start phase ${input.variation.phaseDegrees} degrees, ${input.variation.orbitDegrees} degrees of orbital travel, and ${input.variation.particleDensity} percent particle density.`,
    `Preserve the subject identity, avoid repeated or mechanical motion, and finish on a stable stock-ready composition.${modifier}`,
  ].join(" ");
}
