/**
 * Where the API lives, from VITE_API_URL. Unset means this origin: the Compose stack
 * serves the frontend and proxies `/api/` from one nginx, so a build with no address
 * works on any hostname. Local dev sets it to the backend's own port in `.env`.
 */
export function apiBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  return trimmed.replace(/\/+$/, '');
}
