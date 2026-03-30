import type { ModificationType } from "./types/docx";

interface RGB {
  r: number;
  g: number;
  b: number;
}

const RED_REFS: RGB[] = [
  { r: 255, g: 0, b: 0 },
  { r: 192, g: 0, b: 0 },
  { r: 230, g: 0, b: 18 },
  { r: 204, g: 0, b: 0 },
  { r: 255, g: 51, b: 51 },
];

const BLUE_REFS: RGB[] = [
  { r: 0, g: 0, b: 255 },
  { r: 0, g: 112, b: 192 },
  { r: 0, g: 176, b: 240 },
  { r: 68, g: 114, b: 196 },
  { r: 5, g: 99, b: 193 },
  { r: 0, g: 255, b: 255 },
];

const GREEN_REFS: RGB[] = [
  { r: 0, g: 176, b: 80 },
  { r: 0, g: 128, b: 0 },
  { r: 112, g: 173, b: 71 },
  { r: 146, g: 208, b: 80 },
  { r: 0, g: 255, b: 0 },
];

const HIGHLIGHT_MAP: Record<string, ModificationType> = {
  red: "DELETE",
  darkRed: "DELETE",
  cyan: "MODIFY",
  blue: "MODIFY",
  darkBlue: "MODIFY",
  green: "ADD",
  darkGreen: "ADD",
};

const THRESHOLD = 100;

function hexToRgb(hex: string): RGB | null {
  const cleaned = hex.replace("#", "");
  if (cleaned.length !== 6) return null;
  const num = parseInt(cleaned, 16);
  if (isNaN(num)) return null;
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

function euclideanDistance(a: RGB, b: RGB): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

function findClosestMatch(
  color: RGB,
  refs: RGB[]
): { distance: number } | null {
  let minDist = Infinity;
  for (const ref of refs) {
    const dist = euclideanDistance(color, ref);
    if (dist < minDist) minDist = dist;
  }
  return minDist < THRESHOLD ? { distance: minDist } : null;
}

export function classifyColor(hexColor: string): ModificationType {
  // Check highlight name map first
  if (HIGHLIGHT_MAP[hexColor]) {
    return HIGHLIGHT_MAP[hexColor];
  }

  const rgb = hexToRgb(hexColor);
  if (!rgb) return "NONE";

  // Skip black/near-black/white/near-white (common default text colors)
  const brightness = rgb.r + rgb.g + rgb.b;
  if (brightness < 60 || brightness > 700) return "NONE";

  const redMatch = findClosestMatch(rgb, RED_REFS);
  const blueMatch = findClosestMatch(rgb, BLUE_REFS);
  const greenMatch = findClosestMatch(rgb, GREEN_REFS);

  // Find the best (smallest distance) match
  type Match = { type: ModificationType; distance: number };
  const matches: Match[] = [];
  if (redMatch) matches.push({ type: "DELETE", distance: redMatch.distance });
  if (blueMatch) matches.push({ type: "MODIFY", distance: blueMatch.distance });
  if (greenMatch) matches.push({ type: "ADD", distance: greenMatch.distance });

  if (matches.length === 0) return "NONE";

  matches.sort((a, b) => a.distance - b.distance);
  return matches[0].type;
}
