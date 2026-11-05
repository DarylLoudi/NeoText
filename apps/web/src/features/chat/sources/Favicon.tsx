import { useState } from 'react';
import styles from './Favicon.module.css';

export interface FaviconProps {
  /** The page the icon is for; only its host is sent, and only to our own server. */
  url: string;
  /** Shown as a letter when the site has no icon we can show. */
  domain: string;
  size?: 'sm' | 'md';
}

function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname : '';
  } catch {
    return '';
  }
}

/** A site's icon through the same-origin proxy, or a plain letter tile when there is none. */
export function Favicon({ url, domain, size = 'sm' }: FaviconProps) {
  const host = hostOf(url);
  const [failedHost, setFailedHost] = useState<string | null>(null);
  const className = `${styles.icon} ${styles[size]}`;
  if (host === '' || failedHost === host) {
    const letter = (domain || host)
      .replace(/^www\./, '')
      .charAt(0)
      .toUpperCase();
    return (
      <span className={`${className} ${styles.letter}`} data-favicon-letter="" aria-hidden="true">
        {letter}
      </span>
    );
  }
  return (
    <img
      className={`${className} ${styles.image}`}
      data-favicon=""
      src={`/api/favicon?host=${encodeURIComponent(host)}`}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailedHost(host)}
    />
  );
}
