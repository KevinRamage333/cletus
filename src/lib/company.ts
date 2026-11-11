/**
 * Operating entity shown in Terms, /legal and footers. Keep FORMATION_PENDING = true until the Missouri
 * Articles of Organization are filed (planned 2026-11-13); then flip it so the "formation pending" marker drops.
 */
export const COMPANY_NAME = 'Cletus Technologies LLC';
export const FORMATION_PENDING = true;
export const COMPANY_LEGAL = `${COMPANY_NAME} (Missouri limited liability company${FORMATION_PENDING ? ', formation pending' : ''})`;
export const COMPANY_LINE = `Cletus is software operated by ${COMPANY_LEGAL}.`;
