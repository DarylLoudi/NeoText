/**
 * The empty page a project preview runs in. It has no content of its own: it tells its parent it
 * is ready and at which page path, then writes the one page the parent sends, once. Its response headers make it an
 * opaque, offline sandbox, so whatever that page does stays inside the frame.
 */
export const PREVIEW_SHELL = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Preview</title>
</head>
<body>
<script>
(function () {
  var loaded = false;
  addEventListener('message', function (event) {
    if (loaded || event.source !== parent) return;
    var data = event.data;
    if (!data || data.type !== 'nt-preview-load' || typeof data.html !== 'string') return;
    loaded = true;
    document.open();
    document.write(data.html);
    document.close();
  });
  // Which page this shell was opened at, from the project root ('' for the bare shell).
  var path = location.pathname.replace(/^[/]preview-frame[/]?/, '');
  try { path = decodeURIComponent(path); } catch (e) {}
  parent.postMessage({ type: 'nt-preview-ready', path: path.slice(0, 500) }, '*');
})();
</script>
</body>
</html>
`;

/** No network, no plugins, no base or form targets; inline and blob/data sources only. */
export const PREVIEW_CSP = [
  'sandbox allow-scripts allow-forms allow-modals',
  "default-src 'none'",
  "script-src 'unsafe-inline' blob: data:",
  "style-src 'unsafe-inline' blob:",
  'img-src data: blob:',
  'font-src data: blob:',
  'media-src data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join('; ');

export const PREVIEW_PERMISSIONS =
  'camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=(), usb=(), payment=()';
