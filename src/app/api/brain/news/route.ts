import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireOnboardedUser, errorResponse, HttpError } from '@/lib/auth';
import { refreshNewsAndBriefing } from '@/lib/news';

export const dynamic = 'force-dynamic';

/** Latest world briefing, market context and headlines. */
export async function GET(req: Request) {
  try {
    await requireOnboardedUser();
    const cat = new URL(req.url).searchParams.get('category');
    const [briefing, market, items] = await Promise.all([
      prisma.briefing.findFirst({ orderBy: { createdAt: 'desc' } }),
      prisma.marketSnapshot.findFirst({ orderBy: { createdAt: 'desc' } }),
      prisma.newsItem.findMany({ where: cat ? { category: cat } : {}, orderBy: { publishedAt: 'desc' }, take: 40 }),
    ]);
    return NextResponse.json({
      briefing: briefing ? { content: briefing.content, source: briefing.source, at: briefing.createdAt, itemsCount: briefing.itemsCount, sources: briefing.sources ? JSON.parse(briefing.sources) : [] } : null,
      market: market ? { solPriceUsd: market.solPriceUsd, solChange24h: market.solChange24h, trending: JSON.parse(market.trending), at: market.createdAt } : null,
      items: items.map((n) => ({ id: n.id, source: n.source, category: n.category, title: n.title, url: n.url, publishedAt: n.publishedAt })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Admin: refresh feeds and rebuild the briefing now. */
export async function POST() {
  try {
    const u = await requireOnboardedUser();
    if (!u.isAdmin) throw new HttpError(403, 'admin only');
    return NextResponse.json(await refreshNewsAndBriefing());
  } catch (e) {
    return errorResponse(e);
  }
}
