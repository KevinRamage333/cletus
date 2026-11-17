import { PageHero, Section } from '@/components/site/ui';
import ContactForm from '@/components/site/ContactForm';
import { CONTACT_EMAIL } from '@/lib/site';

export const metadata = { title: 'Contact · Cletus', description: 'Contact the Cletus team about partnerships, benefactor support, developers or press.' };

export default function ContactPage() {
  return (
    <>
      <PageHero eyebrow="Contact" title={<>Talk to the <span className="metal">Cletus team.</span></>}>Partnerships, benefactor support, developers, security reports and press.</PageHero>
      <Section>
        <div className="grid gap-10 lg:grid-cols-[1.2fr_.8fr]">
          <ContactForm email={CONTACT_EMAIL} />
          <div className="space-y-4 text-sm text-[#a39c8f]">
            <div className="panel p-5"><p className="eyebrow">Security</p><p className="mt-2">Found a vulnerability? Please report it privately and do not test against other users&apos; data or funds.</p></div>
            <div className="panel p-5"><p className="eyebrow">Never share keys</p><p className="mt-2">The Cletus team will never ask for your private key, seed phrase or wallet password. Anyone who does is not us.</p></div>
            <div className="panel p-5"><p className="eyebrow">Not advice</p><p className="mt-2">We cannot give personal financial, investment, legal or tax advice.</p></div>
          </div>
        </div>
      </Section>
    </>
  );
}
