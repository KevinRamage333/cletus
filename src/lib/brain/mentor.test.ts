import { describe, expect, it } from "vitest";
import { isMentorReview, MENTOR_CHARTER } from "./mentor";

describe("Cletus mentor charter", () => {
  it("preserves the owner as final authority and mentor advice as advisory", () => {
    expect(MENTOR_CHARTER).toContain("The owner is the final decision-maker");
    expect(MENTOR_CHARTER).toContain("Mentor recommendations are advisory");
    expect(MENTOR_CHARTER).toContain("emergency stop");
  });

  it("requires evidence-based teaching and demonstrated competence", () => {
    expect(MENTOR_CHARTER).toContain("teach -> practice -> test -> review evidence");
    expect(MENTOR_CHARTER).toContain("reproducible evidence");
  });

  it("does not falsely claim an external ChatGPT connection", () => {
    expect(MENTOR_CHARTER).toContain("Do not claim that ChatGPT or any external model is connected");
  });

  it("validates mentor review output", () => {
    expect(isMentorReview({
      whatCletusBelieves: "Reasoning",
      supportedEvidence: ["test output"],
      assumptionsAndGaps: ["sample is small"],
      mentorView: "Proceed cautiously",
      confidence: "medium",
      safeTests: ["paper test"],
      advisoryRecommendation: "Gather more evidence",
      ownerApprovalRequired: true,
    })).toBe(true);
    expect(isMentorReview({ confidence: "certain" })).toBe(false);
  });
});
