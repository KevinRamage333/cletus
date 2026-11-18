-- Community feed in the app schema.
-- Posts stay pending until a moderator writes an append-only decision.
-- This is not the autonomous-trader paper schema.

CREATE SCHEMA IF NOT EXISTS "app";

CREATE TABLE "app"."CommunityOptIn" (
    "userId" TEXT NOT NULL,
    "optedIn" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityOptIn_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "app"."CommunityPost" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "parentId" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "moderationReason" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "moderatedBy" TEXT,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityPost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "app"."CommunityModerationEvent" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "moderatorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityModerationEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "app"."CommunityReport" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "reporterUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommunityPost_status_createdAt_idx" ON "app"."CommunityPost"("status", "createdAt");
CREATE INDEX "CommunityPost_userId_createdAt_idx" ON "app"."CommunityPost"("userId", "createdAt");
CREATE INDEX "CommunityPost_parentId_createdAt_idx" ON "app"."CommunityPost"("parentId", "createdAt");
CREATE INDEX "CommunityModerationEvent_postId_createdAt_idx" ON "app"."CommunityModerationEvent"("postId", "createdAt");
CREATE UNIQUE INDEX "CommunityReport_postId_reporterUserId_key" ON "app"."CommunityReport"("postId", "reporterUserId");
CREATE INDEX "CommunityReport_postId_idx" ON "app"."CommunityReport"("postId");

ALTER TABLE "app"."CommunityOptIn" ADD CONSTRAINT "CommunityOptIn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app"."CommunityPost" ADD CONSTRAINT "CommunityPost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app"."CommunityPost" ADD CONSTRAINT "CommunityPost_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "app"."CommunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app"."CommunityModerationEvent" ADD CONSTRAINT "CommunityModerationEvent_postId_fkey" FOREIGN KEY ("postId") REFERENCES "app"."CommunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app"."CommunityReport" ADD CONSTRAINT "CommunityReport_postId_fkey" FOREIGN KEY ("postId") REFERENCES "app"."CommunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app"."CommunityReport" ADD CONSTRAINT "CommunityReport_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "app"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
