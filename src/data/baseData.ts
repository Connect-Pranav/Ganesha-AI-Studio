// Static facts only: brand names/descriptions and the three core agents' roles.
// No numbers live here. Every figure on the dashboard is computed from real
// agent output (./agent-data) in services/dashboardService.ts.
import type { DashboardData } from '../types';

export const baseData: DashboardData = {
  overview: [],
  products: [
    {
      id: 'littleloop',
      name: 'LittleLoop',
      tagline: "Children's animated shorts",
      description: 'Story-led animated shorts for children aged 2–8, for YouTube Shorts and Instagram Reels.',
      accent: '#fbbf24',
      metrics: [],
      pipeline: [],
    },
    {
      id: 'sunverse',
      name: 'Sunverse',
      tagline: 'Music and YouTube content',
      description: 'Original songs, music production and the Sunverse YouTube music channel (@SURVERSE_09).',
      accent: '#f472b6',
      metrics: [],
      pipeline: [],
    },
    {
      id: 'foliocraft',
      name: 'Foliocraft',
      tagline: 'Portfolio builder & premium themes',
      description: 'Portfolio themes and a builder that turns a resume into a personal website.',
      accent: '#22d3ee',
      metrics: [],
      pipeline: [],
    },
  ],
  agents: [
    {
      id: 'ganesha',
      name: 'GANESHA',
      role: 'Master orchestrator',
      description: 'Plans work, assigns tasks to agents and keeps the three brand workspaces separate.',
      state: 'never_run',
      currentTask: null,
    },
    {
      id: 'narada',
      name: 'NARADA',
      role: 'Market & trend research',
      description: 'Finds trends with sources attached. Flags anything it cannot verify.',
      state: 'never_run',
      currentTask: null,
    },
    {
      id: 'code-shakti',
      name: 'CODE-SHAKTI',
      role: 'Coding & verification',
      description: 'Builds features, fixes bugs and runs the production build before reporting.',
      state: 'never_run',
      currentTask: null,
    },
  ],
  tasks: [],
  activity: [],
  workflows: [],
  research: [],
  runs: [],
  pipelines: [],
  live: { tasks: false, activity: false, agents: false, research: false },
};
