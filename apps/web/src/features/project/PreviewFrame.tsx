import { useEffect, useRef, useState } from 'react';
import { type FrameMessage, isFrameMessage } from './protocol';

export interface PreviewFrameProps {
  /** The whole page to run (`bundlePage`). A different page mounts a fresh frame. */
  html: string;
  /** The project path of the page, where the shell opens so its relative links resolve. */
  page: string;
  title: string;
  /** Changing it reloads the same page. */
  reloadKey?: number;
  className?: string;
  onMessage: (message: FrameMessage) => void;
}

/** The sandbox: no same-origin, popups, top navigation or downloads, and no `allow` list. */
const SANDBOX = 'allow-scripts allow-forms allow-modals';

/** The shell at `page`'s path, each segment encoded. */
const shellUrl = (page: string) =>
  `/preview-frame/${page.split('/').map(encodeURIComponent).join('/')}`;

function Frame({ html, page, title, className, onMessage }: Omit<PreviewFrameProps, 'reloadKey'>) {
  const frame = useRef<HTMLIFrameElement>(null);
  const handler = useRef(onMessage);
  handler.current = onMessage;
  useEffect(() => {
    let sent = false;
    const listen = (event: MessageEvent) => {
      const win = frame.current?.contentWindow;
      // Only this frame's own window, and only messages of the known shapes.
      if (!win || event.source !== win || !isFrameMessage(event.data)) return;
      if (event.data.type !== 'nt-preview-ready') {
        handler.current(event.data);
        return;
      }
      if (sent) {
        // The shell loaded again: the page moved itself (`location.href = …`) to that path.
        const path = event.data.path;
        if (path !== undefined) handler.current({ type: 'nt-navigate', path: `/${path}` });
        return;
      }
      sent = true;
      win.postMessage({ type: 'nt-preview-load', html }, '*');
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, [html]);
  return (
    <iframe
      ref={frame}
      src={shellUrl(page)}
      title={title}
      sandbox={SANDBOX}
      referrerPolicy="no-referrer"
      className={className}
    />
  );
}

/** Runs one bundled page in the offline shell, and passes on what the page reports. */
export function PreviewFrame({ reloadKey = 0, html, page, ...rest }: PreviewFrameProps) {
  // Each page gets its own frame: the shell writes one page and ignores later ones.
  const [mount, setMount] = useState({ html, page, count: 0 });
  if (mount.html !== html || mount.page !== page) setMount({ html, page, count: mount.count + 1 });
  return <Frame key={`${reloadKey}:${mount.count}`} html={html} page={page} {...rest} />;
}
