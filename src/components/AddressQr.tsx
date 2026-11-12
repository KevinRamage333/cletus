'use client';
import { useEffect, useState } from 'react';

export default function AddressQr({ label, address, note }: { label: string; address: string; note?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    import('qrcode').then((q) => q.toDataURL(address, { margin: 1, width: 180, color: { dark: '#000000', light: '#ffffff' } })).then(setSrc).catch(() => setSrc(null));
  }, [address]);
  return (
    <div className="flex gap-3 items-start">
      {src ? <img src={src} alt={`QR for ${label}`} width={110} height={110} className="rounded bg-white p-1" /> : <div className="w-[110px] h-[110px] bg-white/10 rounded" />}
      <div className="min-w-0 space-y-1">
        <div className="text-sm font-semibold">{label}</div>
        <div className="font-mono text-[11px] break-all text-white/70">{address}</div>
        <button type="button" className="btn small" onClick={async () => { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Copied' : 'Copy'}</button>
        {note && <div className="text-[11px] text-white/45">{note}</div>}
      </div>
    </div>
  );
}
