import BrainChat from '@/components/BrainChat';

export const metadata = { title: 'Cletus · Brain' };

export default function BrainPage() {
  return (
    <div className="dash">
      <div className="topbar">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><h1 style={{ margin: 0 }}>Talk to Cletus</h1><span className="badge">advisory only</span></div>
        <a className="btn small" href="/">← Dashboard</a>
      </div>
      <div className="disclaimer-bar">The Brain is not a financial advisor and can be wrong. It reads its own live state and the news. It cannot place trades. Not financial advice.</div>
      <BrainChat full />
    </div>
  );
}
