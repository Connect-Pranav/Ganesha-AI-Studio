// Mushak's blueprint for a command: what it will do, and whether the run started.
import { BrandMark } from './BrandMark';

export interface Blueprint {
  type: 'blueprint';
  title?: string;
  brand?: string;
  expected?: string;
  steps?: { kind: string; count: number | null }[];
  run?: { cycleId: string; appended: boolean; campaign: { id: string; name: string }; steps: number };
  error?: string;
}
const KIND: Record<string, string> = { audience: 'Growth pack', youtube: 'Find YouTube creators', discover: 'Find leads', research: 'Research', qualify: 'Score', draft: 'Write drafts' };
const BRAND: Record<string, string> = { littleloop: 'LittleLoop', sunverse: 'Sunverse', foliocraft: 'Foliocraft' };

export function BlueprintCard({ bp, from }: { bp: Blueprint; from?: string }) {
  if (bp.error) return <div className="bp-card bp-err"><strong>Blueprint not run:</strong> {bp.error}</div>;
  return (
    <div className="bp-card">
      <p className="bp-head">
        {bp.brand && <BrandMark id={bp.brand} size={22} iconSize={14} />}
        <strong>📋 Blueprint{from ? ` from ${from}` : ''}: {bp.title}</strong>
      </p>
      {bp.steps && bp.steps.length > 0 && (
        <ol className="bp-steps">
          {bp.steps.map((s, i) => (
            <li key={i}>{KIND[s.kind] ?? s.kind}{s.count ? ` × ${s.count}` : ''}</li>
          ))}
        </ol>
      )}
      {bp.expected && <p className="cx-sub">Expected: {bp.expected}</p>}
      {bp.run && (
        <p className="cx-ok">
          ▶ Running: {bp.run.steps} step(s) for {BRAND[bp.brand ?? ''] ?? bp.brand} · campaign “{bp.run.campaign.name}”{bp.run.appended ? ' (added to the run already going)' : ''}. Progress and output are in Mushak → 4-hour reports. Drafts wait for your approval.
        </p>
      )}
    </div>
  );
}
