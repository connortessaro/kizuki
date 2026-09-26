import { evalite } from "evalite";
import { makeEmbedder } from "../lib/model";
import { homePaths } from "../lib/paths";
import { openIndex, searchPassages } from "../lib/search";
import { evalCourse, evalSettings } from "./harness";
import { OFF_TOPIC, ON_TOPIC } from "./keys";

evalite<string, number, boolean>("Not in your material", {
  data: [...OFF_TOPIC.map((input) => ({ input, expected: false })), ...ON_TOPIC.map((input) => ({ input, expected: true }))],
  task: async (text) => {
    const course = await evalCourse();
    const db = openIndex(homePaths(course.home).index);
    try {
      return (await searchPassages(db, { courseId: course.courseId, text, embed: makeEmbedder(evalSettings().embed) })).length;
    } finally {
      db.close();
    }
  },
  scorers: [
    {
      name: "Right answer about the material",
      description: "Off-topic text finds no passage (so Kizuki says \"not in your material\"); on-topic text finds at least one.",
      scorer: ({ output, expected }) => ((output > 0) === expected ? 1 : 0),
    },
  ],
  columns: ({ input, output, expected }) => [
    { label: "Text", value: input },
    { label: "Should find", value: expected ? "something" : "nothing" },
    { label: "Found", value: output },
  ],
});
