import Link from 'next/link';
import { PageHero, Section } from '@/components/site/ui';
import { LEGAL_NAV } from '@/lib/site';

export const metadata = { title: 'Legal · Cletus' };
const BLURB: Record<string, string> = {
  '/legal/risk': 'The risks of digital assets, automated systems and simulated results.',
  '/legal/terms': 'The terms that govern use of the Cletus software and website.',
  '/legal/privacy': 'What we collect, why, and the choices you have.',
  '/legal/not-financial-advice': 'Nothing Cletus produces is investment advice.',
};
export default function LegalIndex() {
  return (
    <>
      <PageHero eyebrow="Legal" title="Legal & disclosures">Please read these before using the application. Template language pending review by qualified counsel.</PageHero>
      <Section><div className="grid gap-4 sm:grid-cols-2">{LEGAL_NAV.map((l) => <Link key={l.href} href={l.href} className="panel block p-6 hover:border-[rgba(212,175,55,.45)]"><h2 className="text-lg font-bold text-[#f6f1e4]">{l.label} →</h2><p className="mt-2 text-sm text-[#a39c8f]">{BLURB[l.href]}</p></Link>)}</div></Section>
    </>
  );
}
