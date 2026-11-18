import LegalDoc from '../LegalDoc';
import { TERMS_SECTIONS, TERMS_VERSION } from '@/lib/legal';
export const metadata = { title: 'Terms of Use · Cletus' };
export default function TermsPage() {
  return (
    <LegalDoc title="Terms of Use" updated={TERMS_VERSION} current="/legal/terms">
      <p>These are the same Terms every user accepts during onboarding.</p>
      {TERMS_SECTIONS.map((s) => <section key={s.title}><h2>{s.title}</h2>{s.body.map((b, i) => <p key={i}>{b}</p>)}</section>)}
    </LegalDoc>
  );
}
