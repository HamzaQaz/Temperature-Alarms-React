import { useSyncExternalStore } from 'react';
import { getAdminToken, subscribeAdminToken } from '@/lib/adminToken';

/** The stored Admin token, re-rendering whenever it is saved or forgotten. */
export function useAdminToken(): string | null {
  return useSyncExternalStore(subscribeAdminToken, getAdminToken, () => null);
}
