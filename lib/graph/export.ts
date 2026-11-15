/**
 * Graph rows as they go into the export: the stored quote decrypted (the export already decrypts chats), and no
 * BigInt (JSON can't carry one). Pure; `decrypt` is passed in.
 */
export function exportEdge<T extends { quoteCipher: string | null; quoteTs: bigint | null }>(edge: T, decrypt: (blob: string) => string) {
  const { quoteCipher, quoteTs, ...rest } = edge;
  return { ...rest, quoteTs: quoteTs === null ? null : Number(quoteTs), quote: quoteCipher ? decrypt(quoteCipher) : null };
}
