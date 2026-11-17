import { NextResponse } from 'next/server';
import { requireOnboardedUser, errorResponse } from '@/lib/auth';
import { poolOhlcv } from '@/lib/gecko';
export const dynamic = 'force-dynamic';
const NETWORKS: Record<string, string> = { ethereum: 'eth', base: 'base', bsc: 'bsc', arbitrum: 'arbitrum', polygon: 'polygon_pos', avalanche: 'avax' };
const EVM = /^0x[0-9a-fA-F]{40}$/;
export async function GET(req: Request) {
 try {
  await requireOnboardedUser();
  const sp = new URL(req.url).searchParams;
  const chain = (sp.get('network') ?? '').toLowerCase();
  const network = NETWORKS[chain];
  const address = (sp.get('address') ?? '').trim();
  if (!network || !EVM.test(address)) return NextResponse.json({error:'Select a supported EVM network and enter a valid 0x token or pool address.'},{status:400});
  const range = (sp.get('range') ?? '1H').toUpperCase();
  const token = await fetch('https://api.dexscreener.com/tokens/v1/'+chain+'/'+address,{signal:AbortSignal.timeout(9000),cache:'no-store'}).then(r=>r.ok?r.json():[]).catch(()=>[]);
  const pairResponse = !Array.isArray(token)||token.length===0 ? await fetch('https://api.dexscreener.com/latest/dex/pairs/'+chain+'/'+address,{signal:AbortSignal.timeout(9000),cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null) : null;
  const pairs: any[] = Array.isArray(token)&&token.length?token:(pairResponse?.pairs??[]);
  const pair = pairs.filter(p=>p.chainId===chain&&EVM.test(p.pairAddress??'')).sort((a,b)=>(b.liquidity?.usd??0)-(a.liquidity?.usd??0))[0];
  if(!pair) return NextResponse.json({error:'No active '+chain+' pool found for this address.'},{status:404});
  const pool=pair.pairAddress;
  const candles=await poolOhlcv(pool,range,network);
  return NextResponse.json({network:chain,address,mint:pair.baseToken?.address??address,pool,symbol:pair.baseToken?.symbol??null,quote:pair.quoteToken?.symbol??null,dexId:pair.dexId??null,priceUsd:Number(pair.priceUsd)||null,change24h:pair.priceChange?.h24??null,mcap:pair.marketCap??pair.fdv??null,volume24h:pair.volume?.h24??null,liquidityUsd:pair.liquidity?.usd??null,candles:candles.v??[],rateLimited:candles.limited,candlesStale:candles.stale,markers:[],whaleMarkers:[],embeds:{geckoterminal:'https://www.geckoterminal.com/'+network+'/pools/'+pool+'?embed=1',dexscreener:'https://dexscreener.com/'+chain+'/'+pool+'?embed=1&theme=dark'},sources:['DexScreener','GeckoTerminal'],disclaimer:'Read-only chart. EVM trading and Cletus trade markers are not supported by this chart endpoint.'},{headers:{'Cache-Control':'no-store'}});
 } catch(e){return errorResponse(e)}
}
