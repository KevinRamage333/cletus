'use client';

import Image from 'next/image';
import Link from 'next/link';
import { CommunityFeed } from '@/components/CommunityFeed';

export default function CommunityThreadPage({ params }: { params: { postId: string } }) {
  return (
    <div className="min-h-screen bg-black text-white flex flex-col pb-24 md:pb-8">
      <header className="border-b border-white/10 px-4 sm:px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <Link href="/app/community" className="flex items-center gap-3 min-w-0">
            <Image src="/cletus-logo.png" alt="Cletus" width={40} height={40} className="object-contain" priority />
            <div>
              <div className="font-bold text-lg leading-none">Cletus</div>
              <div className="text-xs text-white/50 mt-0.5">Thread</div>
            </div>
          </Link>
        </div>
      </header>
      <main className="flex-1 px-4 sm:px-6 py-6">
        <div className="max-w-3xl mx-auto">
          <CommunityFeed focusId={params.postId} />
        </div>
      </main>
    </div>
  );
}
