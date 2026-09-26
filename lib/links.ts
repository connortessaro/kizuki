import { z } from "zod";
import type { Ask } from "./model";

/** A prerequisite link: `conceptId` needs `needsConceptId` first. */
export interface Link {
  /** The concept that needs the other first. */
  conceptId: string;
  /** The concept to understand first. */
  needsConceptId: string;
}

/**
 * The loop check. True if adding the link would make a concept need itself, directly or
 * through a chain (A needs B, B needs A).
 */
export function wouldCreateLoop(links: Link[], candidate: Link): boolean {
  if (candidate.conceptId === candidate.needsConceptId) return true;
  const needs = new Map<string, string[]>();
  for (const l of links) needs.set(l.conceptId, [...(needs.get(l.conceptId) ?? []), l.needsConceptId]);
  const stack = [candidate.needsConceptId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop()!;
    if (id === candidate.conceptId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(needs.get(id) ?? []));
  }
  return false;
}

/** The shape the model must reply in when proposing links. */
export const linkReplySchema = z.object({
  links: z.array(
    z.object({
      concept: z.string().describe('The label of the concept that needs another first, like "C3".'),
      needs: z.string().describe('The label of the concept it needs first, like "C1".'),
    }),
  ),
});
/** The model's reply when proposing links, before any checks. */
export type LinkReply = z.infer<typeof linkReplySchema>;

/** The instructions given to the model for proposing links. */
export const LINK_SYSTEM = `You help a student order the concepts of a course.
A link "C3 needs C1" means a student should understand C1 before C3.
Rules:
- Only link concepts from the list, using their labels like "C1".
- Only propose a link when one concept clearly builds on the other.
- Never link a concept to itself, and never make a circle.
- It is fine to propose no links.`;

/**
 * The guard for link proposals. Keeps a link only if both concepts are known, it is not
 * already there (in any state), it is not a repeat, and it keeps the map loop-free.
 */
export function validateLinkReply(reply: LinkReply, refs: Map<string, string>, existing: Link[]): { links: Link[]; dropped: number } {
  const accepted: Link[] = [];
  let dropped = 0;
  const key = (l: Link) => `${l.conceptId}>${l.needsConceptId}`;
  const known = new Set(existing.map(key));
  for (const raw of reply.links) {
    const conceptId = refs.get(raw.concept.trim().toUpperCase());
    const needsConceptId = refs.get(raw.needs.trim().toUpperCase());
    const link = conceptId && needsConceptId ? { conceptId, needsConceptId } : null;
    if (!link || known.has(key(link)) || wouldCreateLoop([...existing, ...accepted], link)) {
      dropped += 1;
      continue;
    }
    known.add(key(link));
    accepted.push(link);
  }
  return { links: accepted, dropped };
}

/**
 * Asks the model which confirmed concepts need which others first, and returns only the
 * links that passed {@link validateLinkReply}. `existing` is every link already proposed,
 * confirmed, or dropped, so none is suggested twice.
 */
export async function proposeLinks(input: { concepts: { conceptId: string; name: string }[]; existing: Link[]; ask: Ask }): Promise<{ links: Link[]; dropped: number }> {
  if (input.concepts.length < 2) return { links: [], dropped: 0 };
  const refs = new Map<string, string>();
  const lines = input.concepts.map((c, i) => {
    refs.set(`C${i + 1}`, c.conceptId);
    return `C${i + 1}: ${c.name}`;
  });
  const prompt = `Concepts:\n${lines.join("\n")}\n\nWhich concepts need which others first?`;
  const reply = await input.ask({ system: LINK_SYSTEM, prompt, schema: linkReplySchema });
  return validateLinkReply(reply, refs, input.existing);
}
