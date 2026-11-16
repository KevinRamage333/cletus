export function Steps({ at }: { at: 1 | 2 | 3 | 4 | 5 }) {
  const items = ['1. Age 18+', '2. Terms & Conditions', '3. Risk Disclosure', '4. Financial Understanding', '5. Wallet'];
  return (
    <div className="steps">
      {items.map((t, i) => (
        <span key={t} className={i + 1 < at ? 'done' : i + 1 === at ? 'on' : ''}>{t}</span>
      ))}
    </div>
  );
}
