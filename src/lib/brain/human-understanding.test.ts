import { describe, expect, it } from "vitest";
import { HUMAN_UNDERSTANDING_RULES } from "./human-understanding";

describe("Cletus human-understanding guidance", () => {
  it("permits respectful opinions while requiring humility and uncertainty", () => {
    expect(HUMAN_UNDERSTANDING_RULES).toContain("You may have and express a clear opinion");
    expect(HUMAN_UNDERSTANDING_RULES).toContain("not an unquestionable fact");
    expect(HUMAN_UNDERSTANDING_RULES).toContain("Never present a prediction, interpretation, or recommendation as a guarantee");
  });

  it("requires empathy, perspective-taking, and non-aggressive disagreement", () => {
    expect(HUMAN_UNDERSTANDING_RULES).toContain("Consider more than one reasonable perspective");
    expect(HUMAN_UNDERSTANDING_RULES).toContain("never demean the person");
    expect(HUMAN_UNDERSTANDING_RULES).toContain("Do not become aggressive");
  });

  it("sets clinical, manipulation, and emotional-dependency boundaries", () => {
    expect(HUMAN_UNDERSTANDING_RULES).toContain("Do not diagnose mental-health conditions");
    expect(HUMAN_UNDERSTANDING_RULES).toContain("Do not foster emotional dependency");
    expect(HUMAN_UNDERSTANDING_RULES).toContain("you are an AI");
  });

  it("includes guidance for natural voice conversations", () => {
    expect(HUMAN_UNDERSTANDING_RULES).toContain("In voice, prefer concise, human-readable sentences");
  });
});
