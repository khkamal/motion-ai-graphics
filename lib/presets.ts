export type MotionMode = "2d" | "3d" | "line-art";
export type BackgroundMode = "original" | "transparent" | "green" | "blue" | "custom";

export type StudioPreset = {
  id: string;
  name: string;
  category: string;
  palette: {
    base: string;
    accent: string;
    highlight: string;
    secondary: string;
  };
  motion: "orbit" | "drift" | "pulse" | "ribbon" | "ripple" | "glide" | "warp" | "bloom";
  particle: string;
  layout: string;
  intensity: number;
  particleCount: number;
};

export const studioPresets: StudioPreset[] = [
  {
    id: "aurora-drift",
    name: "Aurora drift",
    category: "Organic",
    palette: { base: "#101520", accent: "#a3ffcf", highlight: "#82b6ff", secondary: "#b894ff" },
    motion: "drift",
    particle: "Soft motes",
    layout: "Atmospheric depth",
    intensity: 0.7,
    particleCount: 68,
  },
  {
    id: "neon-noir",
    name: "Neon noir",
    category: "Electric",
    palette: { base: "#100c1b", accent: "#cb72ff", highlight: "#42e7ff", secondary: "#ff5f91" },
    motion: "orbit",
    particle: "Light trails",
    layout: "Off-axis orbit",
    intensity: 1,
    particleCount: 92,
  },
  {
    id: "soft-focus",
    name: "Soft focus",
    category: "Minimal",
    palette: { base: "#12151b", accent: "#e0c1a1", highlight: "#b4c8b4", secondary: "#f0dbca" },
    motion: "glide",
    particle: "Dust bloom",
    layout: "Editorial frame",
    intensity: 0.42,
    particleCount: 34,
  },
  {
    id: "solar-flare",
    name: "Solar flare",
    category: "Cinematic",
    palette: { base: "#1b1110", accent: "#ff9b5f", highlight: "#ffd56a", secondary: "#ff6470" },
    motion: "pulse",
    particle: "Ember field",
    layout: "Radial burst",
    intensity: 0.92,
    particleCount: 82,
  },
  {
    id: "deep-current",
    name: "Deep current",
    category: "Fluid",
    palette: { base: "#08141b", accent: "#62e4d0", highlight: "#6eb4ed", secondary: "#c2f0c8" },
    motion: "ripple",
    particle: "Floating plankton",
    layout: "Layered current",
    intensity: 0.68,
    particleCount: 74,
  },
  {
    id: "chrome-motion",
    name: "Chrome motion",
    category: "3D form",
    palette: { base: "#11151b", accent: "#c9dded", highlight: "#85b9e5", secondary: "#bbc5d5" },
    motion: "warp",
    particle: "Specular flecks",
    layout: "Sculpted perspective",
    intensity: 0.78,
    particleCount: 58,
  },
  {
    id: "petal-study",
    name: "Petal study",
    category: "Botanical",
    palette: { base: "#151319", accent: "#f3a6bd", highlight: "#d7f2bc", secondary: "#c6abf0" },
    motion: "bloom",
    particle: "Pollen drift",
    layout: "Organic scatter",
    intensity: 0.6,
    particleCount: 54,
  },
  {
    id: "signal-wave",
    name: "Signal wave",
    category: "Graphic",
    palette: { base: "#101318", accent: "#b8f36b", highlight: "#66d6c2", secondary: "#dce7b5" },
    motion: "ribbon",
    particle: "Signal sparks",
    layout: "Flowing bands",
    intensity: 0.82,
    particleCount: 78,
  },
];

export function presetById(id: string): StudioPreset {
  return studioPresets.find((preset) => preset.id === id) ?? studioPresets[0];
}
