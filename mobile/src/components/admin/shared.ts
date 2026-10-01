export type Tab = 'apercu' | 'demandes' | 'fleet' | 'audit' | 'comptes' | 'formules' | 'tickets' | 'config';

export const tabSetterRef = { current: null as ((t: Tab) => void) | null };
