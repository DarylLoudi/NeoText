import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Tooltip } from '../Tooltip/Tooltip';
import styles from './IconButton.module.css';

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** Required: becomes the accessible name and the tooltip. */
  label: string;
  icon: ReactNode;
  size?: 'sm' | 'md';
  pressed?: boolean;
};

export function IconButton({
  label,
  icon,
  size = 'md',
  pressed,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const classes = [styles.iconButton, styles[size], className].filter(Boolean).join(' ');
  return (
    <Tooltip content={label}>
      <button {...rest} type={type} className={classes} aria-label={label} aria-pressed={pressed}>
        {icon}
      </button>
    </Tooltip>
  );
}
