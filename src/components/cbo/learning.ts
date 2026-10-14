// AI Video & Filmmaking learning modules (four pillars). Original teaching content; the
// exercises are run inside the studio (prompt builder, scenes, voice director).
export interface LearnModule {
  id: string;
  title: string;
  points: string[];
  exercise: string;
  prompt?: Record<string, string>;
}
export interface Pillar {
  id: 'fundamentals' | 'methods' | 'filmmaking' | 'production';
  title: string;
  modules: LearnModule[];
}

export const PILLARS: Pillar[] = [
  {
    id: 'fundamentals',
    title: 'Build fundamentals',
    modules: [
      {
        id: 'f.video_basics',
        title: 'AI video creation fundamentals',
        points: ['Text-to-video: describe subject, action and setting in plain words.', 'Image-to-video: start from an approved still to lock the look.', 'Reference-based: attach character sheets so faces and outfits stay stable.', 'Pick resolution, aspect ratio (9:16 Reels/Shorts, 16:9 YouTube) and duration before writing.', 'Name the camera move and lighting; models guess badly when you don’t.', 'Continuity comes from repeating the same descriptors every scene.'],
        exercise: 'Build one 8-second 9:16 prompt with the prompt builder, then rebuild it 16:9 and compare.',
        prompt: { subject: 'A small red kite', action: 'lifts off a rooftop in the wind', scene: 'Indian city rooftop at golden hour', camera: 'slow upward tilt', lighting: 'warm low sun, soft shadows', duration: '8 seconds', aspectRatio: '9:16' },
      },
      {
        id: 'f.genai',
        title: 'Generative AI for video',
        points: ['Text, image, video and audio models are separate tools with separate limits.', 'Conditioning: reference images, first/last frames and style words steer output.', 'Common artifacts: extra fingers, melting text, flicker, identity drift, lip-sync slip.', 'Mitigate by shortening shots, simplifying hands, avoiding on-screen text.'],
        exercise: 'List the three artifacts you saw most in your last Flow clips and add a constraint for each to the scene prompt.',
      },
      {
        id: 'f.workflow',
        title: 'Understanding AI workflows',
        points: ['Brief → research → script → storyboard → characters → assets → scenes → voiceover → edit → QC → export → publish.', 'Each arrow is a handoff: write it down (the pipeline does this for you).', 'Approve characters before generating scenes; regenerate scenes, not whole films.'],
        exercise: 'Open Task manager → Plan & estimate a LittleLoop episode and read the step list against this chain.',
      },
      {
        id: 'f.voiceover',
        title: 'AI voiceovers',
        points: ['Write for the ear: short sentences, one idea per line.', 'Mark pronunciation for Hindi names and English loanwords.', 'Set pacing (words per minute) and emotion per line.', 'Generate, then sync to picture; never stretch audio more than ~5%.', 'QC: mispronunciations, clipped words, wrong emotion, level jumps.'],
        exercise: 'Run the Smart Voice Director on a 20-second brief and compare its delivery notes to your script.',
      },
    ],
  },
  {
    id: 'methods',
    title: 'Video creation methods',
    modules: [
      { id: 'm.prompt_to_video', title: 'Prompt-to-video', points: ['Subject, action, scene, composition, lighting, camera, motion, style, duration, constraints.', 'One shot per prompt; one main action per shot.'], exercise: 'Fill every field of the prompt builder for one shot.' },
      { id: 'm.avatar', title: 'AI avatar videos', points: ['Use only avatars you are authorised to use (your own likeness with consent, or licensed/original).', 'Fix framing (head-and-shoulders), script, voice and lip-sync checks.', 'No avatar provider is connected yet: plan here, render in your tool, register the output.'], exercise: 'Create an “avatar_video” production and write its first scene.' },
      { id: 'm.meta_ai', title: 'Meta AI video creation', points: ['No Meta AI integration is connected. Prompts and assets are prepared here and used manually.', 'Keep the same prompt structure so results are comparable across tools.'], exercise: 'Prepare one scene prompt and test it in Meta AI by hand; register the result.' },
      { id: 'm.vlogger', title: 'AI vlogger videos', points: ['A persona = character sheet + fixed voice profile + recurring set.', 'Lock the voice once approved; scripts stay conversational.'], exercise: 'Create a presenter character and approve a voice for it.' },
    ],
  },
  {
    id: 'filmmaking',
    title: 'AI filmmaking',
    modules: [
      { id: 'fm.film', title: 'AI films and documentaries', points: ['Idea → research with sources → synopsis → screenplay → shot list → storyboard → scenes → QC.', 'Documentaries need cited sources for every factual claim (NARADA research briefs).'], exercise: 'Plan a research_brief goal, then turn its findings into a 5-scene shot list.' },
      { id: 'fm.audio', title: 'AI narration and music', points: ['Narration script + voice direction; music mood, tempo, instrumentation; ambience and SFX cues.', 'Check licensing/commercial-use terms of any music tool before publishing.', 'TTS voices are not singing models.'], exercise: 'Write a music cue sheet for a 30-second scene.' },
      { id: 'fm.regen', title: 'Scene regeneration', points: ['Regenerate one scene, keep approved characters, costumes and voices.', 'Every regeneration is a new version with a reason.'], exercise: 'Regenerate a scene with a reason and compare versions.' },
      { id: 'fm.graphic_novel', title: 'AI graphic novels', points: ['Story → panels; character sheets and backgrounds reused; dialogue kept short.', 'Export as storyboard images registered as assets.'], exercise: 'Create a “graphic_novel” production with four panel scenes.' },
    ],
  },
  {
    id: 'production',
    title: 'Real-world production',
    modules: [
      { id: 'p.ads', title: 'AI ads', points: ['Brief, audience, script, CTA, platform variants (9:16, 1:1, 16:9).', 'Every ad goes through approval before publishing.'], exercise: 'Create an “ad” production with three platform-variant scenes.' },
      { id: 'p.avatar', title: 'Avatar presentations', points: ['Explainers and education with an authorised presenter.', 'No impersonation of real people.'], exercise: 'Write a 45-second explainer scene list.' },
      { id: 'p.vfx', title: 'AI visual effects', points: ['Shot breakdown, background replacement, compositing, transitions, cleanup.', 'Plan VFX per shot; generate plates separately.'], exercise: 'Break one scene into plate + effect layers.' },
      { id: 'p.characters', title: 'Character integration', points: ['Persistent character library: references, appearance, wardrobe, personality, voice, language.', 'The studio flags continuity issues; it cannot guarantee a model keeps a face identical.'], exercise: 'Approve a character with reference images and a locked voice.' },
      { id: 'p.product_ad', title: 'Product ads', points: ['Real product photos and verified details only.', 'Shot list, camera, lighting, appearance checks, branding, CTA, variants, final review.'], exercise: 'Create a “product_ad” production and check the product appearance in every scene.' },
    ],
  },
];
