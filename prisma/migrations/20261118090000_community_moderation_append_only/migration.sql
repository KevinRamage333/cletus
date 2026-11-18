-- Moderation history is append-only and must survive member or post deletion.

-- Event -> post: a post with a moderation decision cannot be deleted.
ALTER TABLE "app"."CommunityModerationEvent" DROP CONSTRAINT "CommunityModerationEvent_postId_fkey";
ALTER TABLE "app"."CommunityModerationEvent" ADD CONSTRAINT "CommunityModerationEvent_postId_fkey" FOREIGN KEY ("postId") REFERENCES "app"."CommunityPost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Post -> user: deleting a member no longer cascades away their posts (and with them the moderation trail).
ALTER TABLE "app"."CommunityPost" DROP CONSTRAINT "CommunityPost_userId_fkey";
ALTER TABLE "app"."CommunityPost" ADD CONSTRAINT "CommunityPost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Block UPDATE, DELETE and TRUNCATE on moderation events at the database level.
CREATE OR REPLACE FUNCTION "app"."community_moderation_event_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CommunityModerationEvent is append-only (% blocked)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "CommunityModerationEvent_append_only"
  BEFORE UPDATE OR DELETE ON "app"."CommunityModerationEvent"
  FOR EACH ROW EXECUTE FUNCTION "app"."community_moderation_event_append_only"();

CREATE TRIGGER "CommunityModerationEvent_no_truncate"
  BEFORE TRUNCATE ON "app"."CommunityModerationEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."community_moderation_event_append_only"();
