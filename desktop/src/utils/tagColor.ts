// Deterministic chip colors: the same tag name always maps to the same swatch,
// so the bar stays visually stable across sessions without storing a color.
// Each entry is a [background, text] pair tuned for both light and dark themes.
const TAG_PALETTE: ReadonlyArray<readonly [string, string]> = [
  ["#e87a90", "#ffffff"],
  ["#7aa0e8", "#ffffff"],
  ["#5bb98c", "#ffffff"],
  ["#49b0a8", "#ffffff"],
  ["#b07ad8", "#ffffff"],
  ["#e0954a", "#ffffff"],
  ["#d86fae", "#ffffff"],
  ["#6fb0d8", "#ffffff"],
  ["#8bb24a", "#ffffff"],
  ["#c98a5b", "#ffffff"],
  ["#9a8bd8", "#ffffff"],
  ["#d8a04a", "#ffffff"]
];

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0; // keep it a 32-bit int
  }
  return Math.abs(hash);
}

export function tagColor(name: string): { background: string; color: string } {
  const [background, color] = TAG_PALETTE[hashString(name) % TAG_PALETTE.length];
  return { background, color };
}
