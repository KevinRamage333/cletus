export const COMMUNITY_FEED_HREF = '/app/community';

export function threadHref(id: string): string {
  return `${COMMUNITY_FEED_HREF}/${encodeURIComponent(id)}`;
}
