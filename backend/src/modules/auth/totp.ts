import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

export function generateTotpSecret(): string {
  const bytes = randomBytes(20);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Decode(s: string): Buffer {
  let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase()) {
    const v = B32.indexOf(c);
    if (v < 0) throw new Error('Invalid base32');
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totpAt(secret: string, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return (code % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

/** RFC 6238, tolérance ±1 pas (30 s). */
export function verifyTotp(secret: string, code: string, nowMs = Date.now(), window = 1): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const counter = Math.floor(nowMs / 1000 / STEP_SECONDS);
  let ok = false;
  for (let w = -window; w <= window; w++) {
    const expected = Buffer.from(totpAt(secret, counter + w));
    if (timingSafeEqual(expected, Buffer.from(code))) ok = true;
  }
  return ok;
}

export function otpauthUrl(secret: string, email: string): string {
  return `otpauth://totp/MikroLan:${encodeURIComponent(email)}?secret=${secret}&issuer=MikroLan&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
