/**
 * Output filter for every Brain-generated text (demo Brain, full Brain, journal, world briefing).
 * Rewrites sentences that (a) claim regulatory compliance / registration / licensing / legal approval,
 * (b) cite a law, act or rule as endorsing Cletus or its trades, or (c) promise returns.
 * Negated statements ("Cletus is not registered with the SEC", "returns are not guaranteed") and neutral
 * educational explanations of a law are kept.
 */
export const COMPLIANCE_NOTE = 'Cletus applies its own internal risk controls; this is not a claim of regulatory compliance, registration, licensing or legal approval.';
export const RETURNS_NOTE = 'No returns are promised or guaranteed; losses, including total loss, are possible.';

const REGULATOR = String.raw`(?:SEC|CFTC|FINRA|FinCEN|NFA|regulators?|regulatory (?:bodies|authorit(?:y|ies))|government|the state|federal|U\.?S\.? (?:law|regulators?))`;
const LAW = String.raw`(?:Exchange Act|Securities (?:Exchange )?Act|Advisers Act|Commodity Exchange Act|Dodd[- ]Frank|Bank Secrecy Act|Howey|Reg(?:ulation)? [A-Z]{1,4}\b|Rule \d+[a-z]?(?:-\d+)?|§\s?\d+|securities laws?|federal laws?|regulations?|regulatory (?:framework|requirements?|standards?|rules?))`;
const SUBJECT = String.raw`(?:Cletus|we|our|us|this (?:system|bot|engine|platform|strategy|trade)|the (?:system|bot|engine|platform|strategy|trades?)|trades?|trading|signals?|strateg(?:y|ies)|every (?:trade|response))`;
const SELF = new RegExp(String.raw`\b(?:Cletus(?:'s)?|we|our|us|I|my|it is|it's|this (?:system|bot|engine|platform|strategy|framework|app)|the (?:bot|engine|platform|system|app)|(?:every|each|any|all|our|its|my) trades?|trades? (?:is|are)|signals?|parameters|risk (?:limits|controls)|guardrails|audit gates?)\b`, 'i');
const NEG = /\b(?:not|never|no|isn't|aren't|wasn't|cannot|can't|doesn't|don't|does not|do not|without|neither|nor)\b/i;

const COMPLIANCE_PATTERNS: RegExp[] = [
  new RegExp(String.raw`\b(?:fully |strictly )?(?:compliant|compliance|complies|comply|conform(?:s|ing)?|adher(?:es|ing|ence)|aligned|alignment|in accordance|consistent)\b[^.!?\n]{0,60}\b(?:with|to|under)\b[^.!?\n]{0,40}(?:${LAW}|${REGULATOR})`, 'i'),
  new RegExp(String.raw`(?:${REGULATOR})[- ](?:registered|licensed|approved|regulated|compliant|authori[sz]ed|sanctioned|endorsed|audited)`, 'i'),
  new RegExp(String.raw`\b(?:registered|licensed|regulated|approved|authori[sz]ed|endorsed|sanctioned|certified|vetted|cleared)\b[^.!?\n]{0,30}\b(?:by|with|under)\b[^.!?\n]{0,20}(?:${REGULATOR}|${LAW})`, 'i'),
  new RegExp(String.raw`\b(?:legal(?:ly)? approv(?:al|ed)|fully legal|100% legal|legally (?:compliant|sanctioned|cleared)|regulator[- ]approved|government[- ]approved)\b`, 'i'),
  new RegExp(String.raw`\b${SUBJECT}\b[^.!?\n]{0,60}\b(?:operates?|operating|governed|protected|backed|approved|permitted|allowed|meets?|satisf(?:y|ies)|follows?|under)\b[^.!?\n]{0,40}(?:${LAW})`, 'i'),
  new RegExp(String.raw`(?:${LAW})[^.!?\n]{0,40}\b(?:endorses?|approves?|permits?|allows?|protects?|backs?|covers?)\b[^.!?\n]{0,40}\b${SUBJECT}\b`, 'i'),
];
const RETURNS_PATTERNS: RegExp[] = [
  /\bguarantee(?:s|d)?\b[^.!?\n]{0,40}\b(?:profits?|returns?|gains?|income|results?|win(?:s|ning)?|yield|money|payouts?)\b/i,
  /\b(?:profits?|returns?|gains?|income|results?|yield)\b[^.!?\n]{0,30}\b(?:are|is)\s+guaranteed\b/i,
  /\b(?:risk[- ]free|can(?:no|')t lose|cannot lose|no way to lose|sure[- ]fire|sure thing|zero risk|no risk)\b/i,
  /\b(?:will|going to)\s+(?:make|earn|double|triple|10x|100x|2x|multiply|grow)\b[^.!?\n]{0,30}\b(?:you|your|money|capital|investment|portfolio|profits?|returns?)\b/i,
  /\b\d+(?:\.\d+)?\s?%\s*(?:a|per|each|every)?\s*(?:day|daily|week|weekly|month|monthly)\b[^.!?\n]{0,25}\b(?:returns?|profits?|gains?|guaranteed)\b/i,
];

export interface FilterResult { text: string; changed: boolean; hits: Array<'compliance' | 'returns'> }

function classify(sentence: string): 'compliance' | 'returns' | null {
  const plain = sentence.replace(/[*_`]/g, '').replace(/\b(U)\.(S)\.(?:(A)\.)?/g, '$1$2$3').replace(/\b(e\.g|i\.e|etc|vs)\./gi, '$1');
  if (RETURNS_PATTERNS.some((r) => r.test(plain))) {
    // "returns are not guaranteed" / "no guaranteed profits" are fine; "you can't lose" is not.
    const softNeg = /\b(?:not|never|no|nothing is|cannot be|can't be|isn't|aren't)\b[^.!?\n]{0,20}\bguarantee/i.test(plain) || /\bguarantee[sd]?\b[^.!?\n]{0,10}\b(?:nothing|no)\b/i.test(plain);
    if (!softNeg) return 'returns';
  }
  if (COMPLIANCE_PATTERNS.some((r) => r.test(plain)) && SELF.test(plain) && !NEG.test(plain)) return 'compliance';
  return null;
}

export function filterClaims(input: string): FilterResult {
  if (!input) return { text: input, changed: false, hits: [] };
  const hits = new Set<'compliance' | 'returns'>();
  const lines = input.split('\n').map((line) => {
    const m = line.match(/^(\s*(?:[-*•]|\d+[.)])?\s*)(.*)$/s)!;
    const [, prefix, body] = m;
    const parts = body.split(/(?<=[.!?])\s+(?=[A-Z*"'(\[])/);
    let lineHit = false;
    const kept = parts.filter((sent) => {
      const c = classify(sent);
      if (c) { hits.add(c); lineHit = true; return false; }
      return true;
    });
    if (!lineHit) return line;
    return kept.length ? prefix + kept.join(' ') : null;     // drop a bullet that was entirely a claim
  }).filter((l): l is string => l !== null);
  if (!hits.size) return { text: input, changed: false, hits: [] };
  let text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const notes = [hits.has('compliance') ? COMPLIANCE_NOTE : '', hits.has('returns') ? RETURNS_NOTE : ''].filter(Boolean).join(' ');
  text = `${text}\n\n${notes}`.trim();
  return { text, changed: true, hits: [...hits] };
}

export const cleanClaims = (s: string) => filterClaims(s).text;
