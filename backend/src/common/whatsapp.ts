export const SUPPORT_WHATSAPP_KEY = 'support_whatsapp';

/** Numéro saisi par le super admin → lien wa.me, ou `null` s'il n'est pas exploitable. */
export function whatsappLink(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15 ? `https://wa.me/${digits}` : null;
}
