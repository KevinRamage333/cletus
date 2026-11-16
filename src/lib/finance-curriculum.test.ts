import { describe, expect, it } from "vitest";
import {
  FINANCE_CURRICULUM_VERSION,
  FINANCE_MASTERY_PASS_PCT,
  FINANCE_SUBJECTS,
  getFinanceCurriculumProgress,
  getFinanceSubject,
  isFinanceSubjectMastered,
} from "./finance-curriculum";

describe("Cletus financial intelligence curriculum", () => {
  it("defines the complete twelve-subject graduate-level finance map", () => {
    expect(FINANCE_CURRICULUM_VERSION).toBe("1.0.0");
    expect(FINANCE_SUBJECTS).toHaveLength(12);
    expect(new Set(FINANCE_SUBJECTS.map((subject) => subject.id)).size).toBe(12);
    expect(FINANCE_SUBJECTS.some((subject) => subject.id === "accounting-financial-statements")).toBe(true);
    expect(FINANCE_SUBJECTS.some((subject) => subject.id === "derivatives-quantitative-finance")).toBe(true);
    expect(FINANCE_SUBJECTS.some((subject) => subject.id === "fintech-blockchain")).toBe(true);
  });

  it("requires an evidence-linked passing assessment rather than chat confidence", () => {
    const valid = [{
      subjectId: "accounting-financial-statements" as const,
      assessmentId: "case-001",
      scorePct: FINANCE_MASTERY_PASS_PCT,
      passed: true,
      assessedAt: "2026-11-16T00:00:00.000Z",
      evidenceRef: "assessment://case-001",
    }];
    expect(isFinanceSubjectMastered("accounting-financial-statements", valid)).toBe(true);
    expect(isFinanceSubjectMastered("accounting-financial-statements", [{ ...valid[0], evidenceRef: " " }])).toBe(false);
    expect(isFinanceSubjectMastered("accounting-financial-statements", [{ ...valid[0], scorePct: 84 }])).toBe(false);
    expect(isFinanceSubjectMastered("accounting-financial-statements", [{ ...valid[0], passed: false }])).toBe(false);
  });

  it("reports progress without implying an accredited qualification", () => {
    const progress = getFinanceCurriculumProgress([]);
    expect(progress.totalSubjects).toBe(12);
    expect(progress.masteredSubjects).toBe(0);
    expect(progress.completionPct).toBe(0);
    expect(progress.byLevel.foundation.total).toBe(3);
    expect(progress.byLevel.professional.total).toBe(4);
    expect(progress.byLevel.advanced.total).toBe(5);
  });

  it("returns a subject by stable id", () => {
    expect(getFinanceSubject("economics")?.title).toBe("Microeconomics and Macroeconomics");
    expect(getFinanceSubject("not-a-subject")).toBeUndefined();
  });
});
