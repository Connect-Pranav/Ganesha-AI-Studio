// Character sheet thumbnail (fetched with the owner token, shown as a blob URL).
import { useEffect, useState } from 'react';
import { base, getToken } from '../services/adminService';

export function SheetThumb({ id, name }: { id: string; name: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    const token = getToken();
    if (!token) return;
    fetch(`${base()}/api/reels/sheets/${id}/image`, { headers: { authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (b && alive) {
          url = URL.createObjectURL(b);
          setSrc(url);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);
  return src ? <img className="rf-thumb" src={src} alt={`${name} character sheet`} /> : <div className="rf-thumb rf-thumb-empty" aria-hidden="true" />;
}
