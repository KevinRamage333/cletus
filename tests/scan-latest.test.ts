import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildScanNow, writeScanLatest, readScanLatest, decideScanRow, shortMint, _resetScanLatest } from '@/lib/scan-latest';
import { _resetPumpAgeCache } from '@/lib/pump-age';

const now = Date.parse('2026-11-12T00:15:00Z');
const base = { mint: 'So11111111111111111111111111111111111111112', symbol: 'TEST', name: 't', pairAddress: 'P', dexId: 'raydium', priceUsd: 1, marketCap: 200_000, volume24h: 50_000, liquidityUsd: 80_000, ageHours: 3, priceChangeH1: 2, volMcap: 0.25, signals: {} as never, composite: 0.7 };

afterEach(() => { _resetScanLatest(); _resetPumpAgeCache(); });

describe('scan-latest', () => {
  it('shortens mints and labels below-score, rejected, picked, and too-old', () => {
    expect(shortMint(base.mint)).toBe('So11…1112');
    const below = decideScanRow({ ...base, composite: 0.61 }, { minScore: 0.65 });
    expect(below.decision).toBe('below 0.65');
    const rej = decideScanRow({ ...base, rejected: '24h volume < $10000' }, { minScore: 0.65 });
    expect(rej.decision).toBe('rejected');
    const picked = decideScanRow(base, { minScore: 0.65, picked: new Set([base.mint]) });
    expect(picked.decision).toBe('picked');
    const late = decideScanRow({ ...base, ageHours: 56 }, { minScore: 0.65, outcomes: new Map([[base.mint, { decision: 'too old', reason: 'late 56h after pump, below anchor' }]]) });
    expect(late.decision).toBe('too old');
  });

  it('writes at most 50 rows and round-trips the file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-'));
    const file = path.join(dir, 'scan-latest.json');
    const cands = Array.from({ length: 60 }, (_, i) => ({ ...base, mint: `MintMintMintMintMintMintMintMintMint${i.toString().padStart(4, '0')}`, symbol: `C${i}`, composite: 0.8 - i * 0.01 }));
    const scan = buildScanNow({ candidates: cands as never, minScore: 0.65, summary: 'scanned 200', at: new Date(now).toISOString() });
    expect(scan.n).toBe(50);
    writeScanLatest(scan, file);
    _resetScanLatest();
    const read = readScanLatest(file)!;
    expect(read.n).toBe(50);
    expect(read.candidates[0]!.symbol).toBe('C0');
    expect(read.candidates[0]!.decision).toBe('qualified');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
