/** Strip anything that looks like a Solana secret key from text before it is logged or returned. */
export function redactSecrets(text: string): string {
  return text
    // base58 strings long enough to be a 64-byte secret key (87-88 chars)
    .replace(/[1-9A-HJ-NP-Za-km-z]{80,}/g, '[REDACTED]')
    // JSON byte arrays of 32+ numbers (keypair files)
    .replace(/\[(\s*\d{1,3}\s*,){31,}\s*\d{1,3}\s*\]/g, '[REDACTED]')
    .replace(/(api[-_]?key=)[^&\s"]+/gi, '$1[REDACTED]');
}
