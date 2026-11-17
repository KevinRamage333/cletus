'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { threadHref } from '@/lib/community-paths';

type Status = 'PENDING' | 'APPROVED' | 'REJECTED';
type FeedPost = {
  id: string;
  body: string;
  createdAt: string;
  authorLabel: string;
  parentId: string | null;
  replyCount: number;
  mine?: boolean;
  status?: Status;
  moderationReason?: string | null;
};
type QueuePost = { id: string; body: string; createdAt: string; authorLabel: string; reportCount: number; flagged: boolean };
type Me = { optedIn: boolean; isModerator: boolean; banned: boolean };

const STATUS_LABEL: Record<Status, string> = {
  PENDING: 'Pending review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

function StatusBadge({ status }: { status?: Status }) {
  if (!status) return null;
  const tone = status === 'APPROVED' ? 'text-emerald-300 border-emerald-500/40' : status === 'REJECTED' ? 'text-red-300 border-red-500/40' : 'text-amber-200 border-amber-400/40';
  return <span data-testid="post-status" className={`text-[10px] uppercase tracking-wider border rounded-full px-2 py-0.5 ${tone}`}>{STATUS_LABEL[status]}</span>;
}

function PostCard({ post, onReport }: { post: FeedPost; onReport?: (id: string, reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  return (
    <article data-testid="community-post" className="rounded-xl border border-white/10 bg-black/40 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[#E5C76B]">{post.authorLabel}</span>
        <StatusBadge status={post.status} />
      </div>
      <p className="text-sm text-white/85 whitespace-pre-wrap break-words">{post.body}</p>
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-white/40">
        <time dateTime={post.createdAt}>{new Date(post.createdAt).toLocaleString()}</time>
        {!post.parentId && <Link href={threadHref(post.id)} className="text-amber-200 hover:underline" data-testid="thread-link">Thread{post.replyCount ? ` · ${post.replyCount}` : ''}</Link>}
        {post.moderationReason && <span>Moderator: {post.moderationReason}</span>}
      </div>
      {onReport && !post.mine && (
        <div>
          <button type="button" className="text-[11px] text-white/45 hover:text-white" data-testid="report-post" onClick={() => setOpen((v) => !v)}>Report</button>
          {open && (
            <form className="mt-2 flex gap-2" onSubmit={async (event) => { event.preventDefault(); try { await onReport(post.id, reason); setNote('Report sent.'); setReason(''); setOpen(false); } catch (cause) { setNote(cause instanceof Error ? cause.message : 'Could not report'); } }}>
              <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="What is wrong?" className="flex-1 text-xs px-2 py-2 rounded-lg bg-black border border-white/10" data-testid="report-reason" />
              <button className="text-xs px-3 rounded-lg border border-white/15" type="submit">Send</button>
            </form>
          )}
          {note && <p className="text-[11px] text-emerald-300 mt-1">{note}</p>}
        </div>
      )}
    </article>
  );
}

export function CommunityFeed({ focusId }: { focusId?: string }) {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [mine, setMine] = useState<FeedPost[]>([]);
  const [replies, setReplies] = useState<FeedPost[]>([]);
  const [root, setRoot] = useState<FeedPost | null>(null);
  const [queue, setQueue] = useState<QueuePost[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [draft, setDraft] = useState('');
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error' | 'empty'>('loading');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch(focusId ? `/api/community/feed/${encodeURIComponent(focusId)}` : '/api/community/feed', { cache: 'no-store' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Community is unavailable');
      const data = await res.json();
      if (focusId) {
        setRoot(data.root);
        setReplies(data.replies ?? []);
        setMe(data.me ?? null);
        setPhase(data.root ? 'ready' : 'empty');
      } else {
        setPosts(data.posts ?? []);
        setMine(data.mine ?? []);
        setMe(data.me ?? null);
        setPhase((data.posts ?? []).length || (data.mine ?? []).length ? 'ready' : 'empty');
        if (data.me?.isModerator) {
          const queueRes = await fetch('/api/community/moderation/queue', { cache: 'no-store' });
          if (queueRes.ok) setQueue((await queueRes.json()).posts ?? []);
        }
      }
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Community is unavailable');
      setPhase('error');
    }
  }, [focusId]);

  useEffect(() => { load(); }, [load]);

  async function optIn(enabled: boolean) {
    setError('');
    const res = await fetch('/api/community/opt-in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error ?? 'Could not update opt-in'); return; }
    setMe((prev) => prev ? { ...prev, optedIn: data.optedIn } : prev);
  }

  async function publish(body: string, parent = false) {
    setError('');
    setNotice('');
    const res = await fetch(parent && focusId ? `/api/community/feed/${encodeURIComponent(focusId)}` : '/api/community/feed', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error ?? 'Could not post'); return; }
    setNotice(data.message ?? 'Your post is pending review.');
    if (parent) setReply(''); else setDraft('');
    load();
  }

  async function moderate(postId: string, action: 'APPROVED' | 'REJECTED') {
    const reason = action === 'REJECTED' ? 'Does not follow the community rules.' : 'Approved';
    const res = await fetch(`/api/community/moderation/${encodeURIComponent(postId)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, reason }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error ?? 'Moderation failed');
    load();
  }

  async function report(id: string, reason: string) {
    const res = await fetch(`/api/community/feed/${encodeURIComponent(id)}/report`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? 'Could not report');
  }

  const ownPending = mine.filter((post) => !post.parentId && post.status && post.status !== 'APPROVED');

  return (
    <section data-testid={focusId ? 'thread-detail' : 'community-feed'} className="space-y-4" data-state={phase}>
      {focusId && <Link href="/app/community" className="text-xs text-amber-200 hover:underline">← Community feed</Link>}
      {phase === 'loading' && <p className="text-sm text-white/50">Loading the community feed…</p>}
      {phase === 'error' && <p role="alert" className="text-sm text-red-300">{error || 'Community is unavailable.'}</p>}
      {me && (
        <label className="flex items-start gap-2 text-sm text-white/70" data-testid="community-opt-in">
          <input type="checkbox" checked={me.optedIn} onChange={(event) => optIn(event.target.checked)} className="mt-1" />
          <span>Opt in before posting. Your public name stays an anonymous label. You can opt out at any time.</span>
        </label>
      )}
      {me?.banned && <p className="text-sm text-red-300">An admin has muted you in Community.</p>}
      {me?.optedIn && !me.banned && (!focusId || (root && (root.status === 'APPROVED' || root.mine))) && (
        <form data-testid="community-composer" className="flex gap-2" onSubmit={(event) => { event.preventDefault(); publish(focusId ? reply : draft, Boolean(focusId)); }}>
          <input value={focusId ? reply : draft} onChange={(event) => (focusId ? setReply(event.target.value) : setDraft(event.target.value))} placeholder={focusId ? 'Reply in this thread…' : 'Post to the community…'} className="flex-1 text-sm px-3 py-2.5 rounded-lg bg-black border border-white/10" />
          <button type="submit" className="px-4 py-2.5 rounded-lg text-sm font-semibold bg-[#D4AF37] text-black">{focusId ? 'Reply' : 'Post'}</button>
        </form>
      )}
      {notice && <p className="text-xs text-amber-200" data-testid="post-notice">{notice}</p>}
      {error && phase !== 'error' && <p className="text-xs text-red-300">{error}</p>}
      {focusId && root && <PostCard post={root} onReport={report} />}
      {focusId && phase === 'ready' && replies.length === 0 && <p className="text-sm text-white/40">No replies yet.</p>}
      <div className="space-y-2">{(focusId ? replies : posts).map((post) => <PostCard key={post.id} post={post} onReport={report} />)}</div>
      {!focusId && phase === 'empty' && <p className="text-sm text-white/40">No approved posts yet. New posts stay pending until a moderator approves them.</p>}
      {!focusId && ownPending.length > 0 && (
        <div className="space-y-2" data-testid="own-posts">
          <h2 className="text-xs uppercase tracking-wider text-white/40">Your posts</h2>
          {ownPending.map((post) => <PostCard key={post.id} post={post} />)}
        </div>
      )}
      {!focusId && me?.isModerator && (
        <div className="space-y-2" data-testid="moderation-queue">
          <h2 className="text-xs uppercase tracking-wider text-white/40">Moderator queue</h2>
          {queue.length === 0 && <p className="text-sm text-white/40">No posts are waiting.</p>}
          {queue.map((post) => (
            <article key={post.id} className="rounded-xl border border-white/10 p-3 space-y-2">
              <div className="text-xs text-white/50">{post.authorLabel}{post.flagged ? ' · flagged' : ''}{post.reportCount ? ` · ${post.reportCount} reports` : ''}</div>
              <p className="text-sm">{post.body}</p>
              <div className="flex gap-2">
                <button type="button" data-testid="approve-post" className="text-xs px-3 py-1.5 rounded-full bg-emerald-500 text-black" onClick={() => moderate(post.id, 'APPROVED')}>Approve</button>
                <button type="button" data-testid="reject-post" className="text-xs px-3 py-1.5 rounded-full border border-red-400/50 text-red-300" onClick={() => moderate(post.id, 'REJECTED')}>Reject</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
