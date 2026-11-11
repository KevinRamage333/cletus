import { TERMS_SECTIONS, RISK_POINTS, TERMS_VERSION } from '@/lib/legal';
export const metadata = { title: 'Cletus: Terms and Risk Disclaimer' };
export default function Disclaimer() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold gold-text">Risk Disclaimer</h1>
      <ul className="list-disc pl-6 space-y-2 text-zinc-300 text-sm">{RISK_POINTS.map((p, i) => <li key={i}>{p}</li>)}</ul>
      <h1 className="text-3xl font-bold gold-text pt-4">Terms and Conditions</h1>
      <p className="text-xs text-zinc-500">Version {TERMS_VERSION}. In the beta, binding acceptance happens during account onboarding; this page is for reading only.</p>
      {TERMS_SECTIONS.map((s) => (
        <section key={s.title} className="space-y-2">
          <h2 className="text-lg font-semibold text-amber-300">{s.title}</h2>
          {s.body.map((b, i) => <p key={i} className="text-sm text-zinc-300">{b}</p>)}
        </section>
      ))}
    </div>
  );
}
