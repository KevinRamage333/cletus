'use client';

import { use } from 'react';
import Link from 'next/link';
import { CommunityFeed } from '@/components/CommunityFeed';

/** One moderated thread, inside the gold app shell (which supplies the header and mobile tabs). */
export default function CommunityThreadPage({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = use(params);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/app/community" className="text-xs font-semibold uppercase tracking-[.16em] text-[#e3c06a]">← Community</Link>
      <div className="panel p-4">
        <CommunityFeed focusId={postId} />
      </div>
    </div>
  );
}
