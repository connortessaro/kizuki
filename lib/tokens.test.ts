import { describe, expect, it } from "vitest";
import { materialReviewToken, sessionAnswersToken, sessionReviewToken } from "./tokens";

describe("pause names", () => {
  it("are unique per material, session, and round, so two pauses never share a name", () => {
    const names = [materialReviewToken("m1"), materialReviewToken("m2"), sessionAnswersToken("s1", 1), sessionAnswersToken("s1", 2), sessionReviewToken("s1"), sessionReviewToken("s2")];
    expect(new Set(names).size).toBe(names.length);
  });
});
