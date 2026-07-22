import { generateKeyPairSync } from 'node:crypto';

export interface WgKeyPair {
  privateKey: string; // WG base64 (raw 32 bytes)
  publicKey: string;
}

/**
 * Generates a WireGuard-compatible X25519 keypair without the `wg` CLI.
 * Raw 32-byte keys are the trailing bytes of the DER (SPKI/PKCS8) encodings.
 */
export function generateWgKeyPair(): WgKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('x25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  return {
    publicKey: publicKey.subarray(publicKey.length - 32).toString('base64'),
    privateKey: privateKey.subarray(privateKey.length - 32).toString('base64'),
  };
}
