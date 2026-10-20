// Brand logo when one has been supplied (public/brand/<id>-<size>.webp), otherwise the brand icon.
// Logos are only resized, never redrawn or altered.
import { Icon, type IconName } from './Icon';

// Value = file stem. Bump the stem when a logo changes so phones don't keep the cached old one.
const LOGOS: Record<string, string> = { littleloop: 'littleloop', sunverse: 'sunverse', foliocraft: 'foliocraft-v2' };
const NAMES: Record<string, string> = { littleloop: 'LittleLoop', sunverse: 'Sunverse', foliocraft: 'Foliocraft' };

export function hasLogo(id: string) {
  return Boolean(LOGOS[id]);
}

export function BrandMark({ id, size = 40, iconSize, className = '' }: { id: string; size?: number; iconSize?: number; className?: string }) {
  if (LOGOS[id]) {
    const file = size > 128 ? 320 : 128;
    return <img className={`brand-logo ${className}`} src={`./brand/${LOGOS[id]}-${file}.webp`} alt={`${NAMES[id] ?? id} logo`} width={size} height={size} loading="lazy" decoding="async" />;
  }
  return <Icon name={id as IconName} size={iconSize ?? Math.round(size * 0.55)} />;
}
