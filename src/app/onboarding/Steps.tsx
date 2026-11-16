export function Steps({ at }: { at: 1 | 2 | 3 | 4 }) {
  const items = ['1. Terms & Conditions', '2. Risk Disclaimer', '3. Financial Understanding', '4. Wallet'];
  return (
    <div className="steps">
      {items.map((t, i) => (
        <span key={t} className={i + 1 < at ? 'done' : i + 1 === at ? 'on' : ''}>{t}</span>
      ))}
    </div>
  );
}
