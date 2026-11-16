import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, setSessionCookie } from "@/lib/auth";
import { FINANCIAL_CONSENT_STAGES, FINANCIAL_CONSENT_VERSION, validateFinancialConsentStage } from "@/lib/financial-consent";

export const dynamic = "force-dynamic";

function acceptanceKind(stageId: string) {
  return `financial-consent:${stageId}`;
}

async function getProgress(userId: string) {
  const accepted = await prisma.acceptance.findMany({
    where: { userId, version: FINANCIAL_CONSENT_VERSION, kind: { startsWith: "financial-consent:" } },
    select: { kind: true },
  });
  const completed = new Set(accepted.map((item) => item.kind));
  const next = FINANCIAL_CONSENT_STAGES.find((stage) => !completed.has(acceptanceKind(stage.id)));
  return { completed, next, completedCount: next ? FINANCIAL_CONSENT_STAGES.indexOf(next) : FINANCIAL_CONSENT_STAGES.length };
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const progress = await getProgress(user.id);
  return NextResponse.json({
    version: FINANCIAL_CONSENT_VERSION,
    nextStage: progress.next?.id ?? null,
    completedCount: progress.completedCount,
    totalStages: FINANCIAL_CONSENT_STAGES.length,
  });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!user.termsVersion || !user.riskVersion) {
    return NextResponse.json({ error: "Complete Terms and Risk steps first." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const progress = await getProgress(user.id);
  const validation = validateFinancialConsentStage(body, FINANCIAL_CONSENT_VERSION, progress.next?.id ?? null);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });

  const now = new Date();
  const isLastStage = progress.next?.id === FINANCIAL_CONSENT_STAGES[FINANCIAL_CONSENT_STAGES.length - 1].id;
  const updatedUser = await prisma.$transaction(async (tx) => {
    await tx.acceptance.create({
      data: {
        userId: user.id,
        kind: acceptanceKind(progress.next!.id),
        version: FINANCIAL_CONSENT_VERSION,
        userAgent: req.headers.get("user-agent")?.slice(0, 300),
      },
    });
    if (isLastStage) {
      return tx.user.update({
        where: { id: user.id },
        data: { financialConsentVersion: FINANCIAL_CONSENT_VERSION, financialConsentAt: now },
      });
    }
    return null;
  });

  const nextStage = isLastStage
    ? null
    : FINANCIAL_CONSENT_STAGES[progress.completedCount + 1]?.id ?? null;
  const response = NextResponse.json({
    ok: true,
    completedStage: progress.next!.id,
    nextStage,
    completedCount: progress.completedCount + 1,
    totalStages: FINANCIAL_CONSENT_STAGES.length,
    next: isLastStage ? "/onboarding/wallet" : undefined,
  });
  if (updatedUser) await setSessionCookie(response, updatedUser);
  return response;
}
