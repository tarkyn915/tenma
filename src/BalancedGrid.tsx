import type { CSSProperties, ReactNode } from 'react';
import { cn } from './utils';

interface Props {
  children: ReactNode;
  className?: string;
  itemCount: number;
  cardWidth?: number;
  gap?: number;
}

/**
 * Columns follow the container width, never the number of records on a page.
 * auto-fill retains empty tracks for small collections, so two playlists keep
 * the same size and left alignment as cards in a full library. Fractional
 * tracks share the remaining space across every column, including the last row.
 */
export function BalancedGrid({ children, className, itemCount, cardWidth = 160, gap = 20 }: Props) {
  return <div
    className={cn('balanced-grid', className)}
    data-item-count={itemCount}
    style={{ '--balanced-card-width': `${cardWidth}px`, '--balanced-gap': `${gap}px` } as CSSProperties}
  >{children}</div>;
}
