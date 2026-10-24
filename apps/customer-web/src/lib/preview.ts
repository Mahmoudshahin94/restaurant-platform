/**
 * An admin's preview of the website's draft (ADR 0023). The admin opens the tenant's own site
 * with `?preview=<token>`; the token is kept for this tab only (session storage) and sent with
 * every site request, until it expires or the visitor leaves the preview.
 */
const KEY = 'madar:website-preview';

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Takes `?preview=` out of the address (so it is not shared by accident) and keeps it. */
export function capturePreviewToken(): void {
  const url = new URL(window.location.href);
  const token = url.searchParams.get('preview');
  if (!token) return;
  storage()?.setItem(KEY, token);
  url.searchParams.delete('preview');
  window.history.replaceState(window.history.state, '', url.toString());
}

export function previewToken(): string | null {
  return storage()?.getItem(KEY) ?? null;
}

export function endPreview(): void {
  storage()?.removeItem(KEY);
}
