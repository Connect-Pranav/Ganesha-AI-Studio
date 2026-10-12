// Data access for the dashboard. Today it serves DEMO data only.
// Later this is the single place to swap in Supabase or a backend API —
// UI components never import data sources directly.
import { demoData } from '../data/demoData';
import type { DashboardData } from '../types';

export interface DashboardResult {
  data: DashboardData;
  source: 'demo' | 'live';
}

// Test hooks for the loading / empty / error states:
//   ?state=error   → simulated load failure
//   ?state=empty   → empty data set
//   ?state=slow    → long loading state
function getForcedState(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('state');
  } catch {
    return null;
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function loadDashboard(): Promise<DashboardResult> {
  const forced = getForcedState();
  await wait(forced === 'slow' ? 4000 : 450);

  if (forced === 'error') {
    throw new Error('Could not load dashboard data (simulated error).');
  }

  if (forced === 'empty') {
    return {
      source: 'demo',
      data: { ...demoData, tasks: [], activity: [], workflows: [] },
    };
  }

  // Deep copy so local edits (new tasks) never mutate the demo source.
  return { source: 'demo', data: structuredClone(demoData) };
}
