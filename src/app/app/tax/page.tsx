import LocalTax from '@/components/app/LocalTax';
import TaxCenter from '@/components/account/TaxCenter';
import { isDemo } from '@/lib/demo';
export const dynamic = 'force-dynamic';

export default function TaxPage() {
  const demo = isDemo();
  return (
    <div className="space-y-10">
      <LocalTax />
      {!demo && <section><h3 className="mb-3 text-sm font-bold uppercase tracking-[.16em] text-[#e3c06a]">Account Tax Center</h3><TaxCenter /></section>}
    </div>
  );
}
