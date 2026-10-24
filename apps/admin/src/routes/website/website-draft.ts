import { WEBSITE_LIMITS, type WebsiteSectionType } from '@pos/shared-types';
import { type WebsiteConfig, type WebsiteSection, blankSection } from '@pos/validation';

/**
 * The website editor's changes to a draft (ADR 0023), as pure functions: the page keeps one
 * draft in state and replaces it through these. Sections keep `order` equal to their position
 * (in steps of 10), so what the editor lists is what visitors see.
 */

/** The sections as listed: by order. */
export function sortedSections(config: WebsiteConfig): WebsiteSection[] {
  return [...config.sections].sort((a, b) => a.order - b.order);
}

function withSections(config: WebsiteConfig, sections: WebsiteSection[]): WebsiteConfig {
  return { ...config, sections: sections.map((s, i) => ({ ...s, order: i * 10 })) };
}

/** Moves a section one place up (-1) or down (+1); at either end nothing changes. */
export function moveSection(config: WebsiteConfig, id: string, step: -1 | 1): WebsiteConfig {
  const sections = sortedSections(config);
  const from = sections.findIndex((s) => s.id === id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= sections.length) return config;
  const [moved] = sections.splice(from, 1);
  if (!moved) return config;
  sections.splice(to, 0, moved);
  return withSections(config, sections);
}

export function updateSection(
  config: WebsiteConfig,
  id: string,
  change: (section: WebsiteSection) => WebsiteSection,
): WebsiteConfig {
  return { ...config, sections: config.sections.map((s) => (s.id === id ? change(s) : s)) };
}

export function removeSection(config: WebsiteConfig, id: string): WebsiteConfig {
  return withSections(
    config,
    sortedSections(config).filter((s) => s.id !== id),
  );
}

/** A free anchor id for a new section of `type` (`gallery`, `gallery-2`, …). */
export function newSectionId(config: WebsiteConfig, type: WebsiteSectionType): string {
  const base = type.toLowerCase().replace(/_/g, '-');
  const taken = new Set(config.sections.map((s) => s.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${String(n)}`)) n += 1;
  return `${base}-${String(n)}`;
}

/** Adds a section of `type` at the end, or before the footer (which stays last). */
export function addSection(
  config: WebsiteConfig,
  type: WebsiteSectionType,
): { config: WebsiteConfig; id: string } | null {
  if (config.sections.length >= WEBSITE_LIMITS.sections) return null;
  const id = newSectionId(config, type);
  const sections = sortedSections(config);
  const footer = sections.findIndex((s) => s.type === 'FOOTER');
  const at = footer >= 0 && type !== 'FOOTER' ? footer : sections.length;
  sections.splice(at, 0, blankSection(type, id, 0));
  return { config: withSections(config, sections), id };
}

/** Whether a section of `type` can be added (one footer at most). */
export function canAdd(config: WebsiteConfig, type: WebsiteSectionType): boolean {
  if (config.sections.length >= WEBSITE_LIMITS.sections) return false;
  return type !== 'FOOTER' || !config.sections.some((s) => s.type === 'FOOTER');
}
