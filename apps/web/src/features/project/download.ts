/** Long enough for any browser to have started reading the blob before its URL goes. */
const REVOKE_AFTER_MS = 60_000;

/** Saves `html` as `<title>.html`. The blob URL is freed a minute later, not at once. */
export function downloadPage(title: string, html: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'project'}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
