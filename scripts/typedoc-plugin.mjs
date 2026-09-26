// A TypeDoc plugin for Kizuki: every property of an interface or class needs a doc comment.
// TypeDoc's own check would also demand comments on the fields of types it infers (such as the
// zod schemas), which have no place to write one, so this check covers only declared ones.

import { Application, ReflectionKind } from "typedoc";

/** Adds the property check to TypeDoc's validation, so a missing comment fails the docs build. */
export function load(app) {
  app.on(Application.EVENT_VALIDATE_PROJECT, (project) => {
    for (const property of project.getReflectionsByKind(ReflectionKind.Property)) {
      if (!property.parent?.kindOf(ReflectionKind.Interface | ReflectionKind.Class)) continue;
      if (property.inheritedFrom || property.flags.isExternal) continue;
      const comment = property.comment;
      if (comment && (comment.summary.some((part) => part.text.trim()) || comment.blockTags.length)) continue;
      app.logger.warn(`${property.getFriendlyFullName()} (Property) does not have a doc comment. Add a short one in plain words.`);
    }
  });
}
