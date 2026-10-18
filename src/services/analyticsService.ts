// Reads SOMA's analytics report from the Worker (/api/analytics/:brand).
// Numbers come from the YouTube Data API; the browser never holds any key.
import type { ProductId } from '../types';

const WORKER_ORIGIN = 'https://ganesha-studio.pravanigroup.workers.dev';

export interface Video {
  id: string;
  title: string;
  publishedAt: string | null;
  durationSec: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  url: string;
  reach?: number | null;
  saves?: number | null;
  shares?: number | null;
  type?: string | null;
}
export interface Insights {
  headline: string;
  working: string[];
  notWorking: string[];
  nextActions: { action: string; why: string; measureWith: string }[];
  dataGaps?: string[];
  provider?: string;
  at?: string;
  basedOn?: string;
}
export interface AnalyticsReport {
  brand: ProductId;
  connected: boolean;
  platform?: 'youtube' | 'instagram';
  studio?: { sheets: number; factoryOn: boolean; mode: string; published: number; waitingApproval: number; waitingFlow: number; failed: number; recent: { day: string; slot: number; status: string; title: string | null; igPermalink: string | null }[] };
  reason?: string;
  source?: string;
  account?: string;
  fetchedAt?: string;
  stale?: boolean;
  fetchError?: string | null;
  channel?: {
    title: string;
    handle: string;
    url: string;
    subscribers: number | null;
    subscribersHidden: boolean;
    totalViews: number | null;
    videoCount: number | null;
    createdAt: string | null;
  };
  videos?: Video[];
  summary?: {
    videosAnalysed: number;
    totalViewsOfVideos: number;
    totalLikes: number;
    totalComments: number;
    avgViewsPerVideo: number | null;
    medianViewsPerVideo: number | null;
    likeRate: number | null;
    commentRate: number | null;
    last30Days: { uploads: number; views: number };
    upTo3Min: { count: number; avgViews: number | null };
    over3Min: { count: number; avgViews: number | null };
    topVideos: string[];
    likesHiddenOn: number;
    latestUpload: string | null;
    growth?: { since: string; hours: number; subscribers: number | null; totalViews: number | null; videoCount: number | null };
  };
  insights?: Insights | null;
  insightsError?: string | null;
  dataGaps?: string[];
}

/** Same origin on Cloudflare; the GitHub Pages mirror calls the Worker directly. */
function apiBase(): string {
  try {
    return window.location.hostname.endsWith('github.io') ? WORKER_ORIGIN : '';
  } catch {
    return '';
  }
}

export async function loadAnalytics(brand: ProductId): Promise<AnalyticsReport> {
  // The owner's token (if unlocked) adds private Instagram insights and studio reel stats.
  let token: string | null = null;
  try {
    token = localStorage.getItem('gas.adminToken');
  } catch {
    token = null;
  }
  const res = await fetch(`${apiBase()}/api/analytics/${brand}`, { cache: 'no-store', headers: token ? { authorization: `Bearer ${token}` } : {} });
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) throw new Error('The analytics service is not reachable from this address.');
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as AnalyticsReport;
}
