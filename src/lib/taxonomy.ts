import type { Category, Subcategory, Taxonomy } from "./types";

/**
 * Seed taxonomy. Categories are the top level; subcategories are the
 * refinement slots an entity can be filed into. The seed is deliberately
 * broad enough for Chinese web novels and classical literature alike, and an
 * agent can extend it per-novel via POST /api/taxonomy.
 */
export const BUILTIN_TAXONOMY: Record<Category, Subcategory[]> = {
  character: [
    { key: "protagonist", label: "Protagonist" },
    { key: "antagonist", label: "Antagonist" },
    { key: "supporting", label: "Supporting" },
    { key: "mentor", label: "Mentor / Elder" },
    { key: "ally", label: "Ally" },
    { key: "love-interest", label: "Love Interest" },
    { key: "rival", label: "Rival" },
    { key: "minor", label: "Minor / Mentioned" },
    { key: "group", label: "Group / Faction" },
    { key: "deity", label: "Deity / Spirit" },
    { key: "animal", label: "Animal / Companion" },
  ],
  scene: [
    { key: "interior-room", label: "Interior — Room / House" },
    { key: "interior-public", label: "Interior — Public Space" },
    { key: "street", label: "Street / Road" },
    { key: "wilderness", label: "Wilderness / Mountain / Forest" },
    { key: "water", label: "Water / Sea / Lake" },
    { key: "settlement", label: "Village / Town / City" },
    { key: "temple", label: "Temple / Palace / Shrine" },
    { key: "school", label: "School / Academy" },
    { key: "workplace", label: "Workplace" },
    { key: "battlefield", label: "Battlefield" },
    { key: "abstract", label: "Abstract / Inner World" },
    { key: "sky", label: "Sky / Celestial" },
  ],
  object: [
    { key: "weapon", label: "Weapon" },
    { key: "artifact", label: "Artifact / Treasure" },
    { key: "letter", label: "Letter / Document" },
    { key: "vehicle", label: "Vehicle" },
    { key: "garment", label: "Garment" },
    { key: "token", label: "Token / Keepsake" },
    { key: "food", label: "Food / Drink" },
  ],
  event: [
    { key: "battle", label: "Battle" },
    { key: "journey", label: "Journey / Departure" },
    { key: "reunion", label: "Reunion" },
    { key: "betrayal", label: "Betrayal" },
    { key: "ritual", label: "Ritual / Ceremony" },
    { key: "discovery", label: "Discovery / Revelation" },
    { key: "separation", label: "Separation / Loss" },
    { key: "celebration", label: "Celebration" },
  ],
  emotion: [
    { key: "joy", label: "Joy" },
    { key: "sorrow", label: "Sorrow" },
    { key: "fear", label: "Fear / Dread" },
    { key: "anger", label: "Anger / Fury" },
    { key: "love", label: "Love / Tenderness" },
    { key: "awe", label: "Awe / Wonder" },
    { key: "hate", label: "Hate" },
    { key: "calm", label: "Calm / Stillness" },
  ],
  theme: [
    { key: "destiny", label: "Destiny / Fate" },
    { key: "love-theme", label: "Love" },
    { key: "power", label: "Power / Ambition" },
    { key: "mortality", label: "Mortality" },
    { key: "redemption", label: "Redemption" },
    { key: "identity", label: "Identity / Belonging" },
    { key: "freedom", label: "Freedom / Bondage" },
  ],
};

/** The default, immutable taxonomy document. */
export function defaultTaxonomy(): Taxonomy {
  return {
    id: "builtin",
    version: 1,
    builtin: BUILTIN_TAXONOMY,
    extra: {},
  };
}

/** All valid category keys. */
export const CATEGORIES = Object.keys(BUILTIN_TAXONOMY) as Category[];

export function isCategory(value: string): value is Category {
  return (CATEGORIES as string[]).includes(value);
}

/** Flatten the taxonomy into a lookup of subcategory key -> label. */
export function subcategoryIndex(
  taxonomy: Taxonomy,
): Map<string, { label: string; category: string }> {
  const map = new Map<string, { label: string; category: string }>();
  for (const [category, subs] of Object.entries(taxonomy.builtin)) {
    for (const sub of subs) map.set(sub.key, { label: sub.label, category });
  }
  for (const [category, subs] of Object.entries(taxonomy.extra ?? {})) {
    for (const sub of subs) map.set(sub.key, { label: sub.label, category });
  }
  return map;
}
