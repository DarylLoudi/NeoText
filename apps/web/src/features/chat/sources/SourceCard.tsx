import type { Source } from '@neotext/shared';
import { Favicon } from './Favicon';
import styles from './SourceCard.module.css';

export const SOURCE_LINK_REL = 'noopener noreferrer nofollow';

/** The source's number on a marker tag, as citations show it in the answer. */
export function SourceNumber({ n }: { n: number }) {
  return <span className={styles.number}>{n}</span>;
}

/** One source in the strip. Every value from the page is rendered as text, never as markup. */
export function SourceCard({ source }: { source: Source }) {
  return (
    <a
      className={styles.card}
      href={source.url}
      target="_blank"
      rel={SOURCE_LINK_REL}
      title={source.snippet || undefined}
      data-source-card=""
    >
      <span className={styles.meta}>
        <SourceNumber n={source.n} />
        <Favicon url={source.url} domain={source.domain} />
        <span className={styles.domain}>{source.domain}</span>
      </span>
      <span className={styles.title} dir="auto">
        {source.title || source.domain}
      </span>
    </a>
  );
}
