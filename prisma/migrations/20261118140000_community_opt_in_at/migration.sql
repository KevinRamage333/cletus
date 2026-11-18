-- When a member (last) opted in to the community. Community P&L only counts trades closed after
-- max(account created + 7 days, optedInAt), so a newly eligible member never changes already published days.
ALTER TABLE "app"."CommunityOptIn" ADD COLUMN "optedInAt" TIMESTAMP(3);

-- Backfill: for current opt-ins the last update is the best record of when they opted in
-- (the opt-in toggle is the only writer of this row). Opted-out rows stay NULL.
UPDATE "app"."CommunityOptIn" SET "optedInAt" = "updatedAt" WHERE "optedIn" = true AND "optedInAt" IS NULL;
