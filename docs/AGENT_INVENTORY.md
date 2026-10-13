# Agent Inventory

Generated from `agents/registry.json` (registry v2) on 2026-10-13. 31 agents, 31 unique IDs, 31 unique names, no duplicates.

**Execution status today:** only NARADA and GANESHA have produced recorded runs (Claude engine via scheduled tasks; 8 runs in `runs.json`, 0 Gemini runs). All other agents execute only when a Claude scheduled goal-runner session role-plays them per `agents/RUNTIME.md` and writes to the private vault; there is no programmatic per-agent executor yet. Phase 1 adds one.

## Master Control (`master`, brand `studio`)

| Agent | ID | Role | Inputs → Outputs | Engines | Retries | Approval needed | Used in pipelines |
|---|---|---|---|---|---|---|---|
| GANESHA | `ganesha_orchestrator` | Chief Orchestrator | goal issue; pipeline templates; NARADA findings → pipeline plan; final summary | claude, gemini | 2 | publish_content, spend_money, deploy | none |
| NARADA | `narada_market_intelligence` | Research & Intelligence | research question or brand focus → findings with sources and retrieval dates | claude, gemini | 2 | — | research_brief.research |
| CHITRAGUPTA | `chitragupta_quality_audit` | Quality & Audit Controller | deliverable; brief; agent acceptance criteria → QA verdict: pass / fail + issues list | claude | 1 | — | sunverse_song_release.qa, littleloop_episode.qa, foliocraft_feature.qa, research_brief.qa |
| SAMVADA | `samvada_handoffs` | Communication & Handoffs | completed steps; QA verdicts → handoff note; status update | claude | 1 | — | sunverse_song_release.handoff, littleloop_episode.handoff, foliocraft_feature.handoff, research_brief.handoff, ops_weekly_review.handoff |

## Sunverse — Music Production Studio (`sunverse`, brand `sunverse`)

| Agent | ID | Role | Inputs → Outputs | Engines | Retries | Approval needed | Used in pipelines |
|---|---|---|---|---|---|---|---|
| TUMBURU | `sunverse_tumburu_music_director` | Music Director & Composer | song idea; GANDHARVA trends → composition brief | claude | 1 | — | sunverse_song_release.composition |
| VAGDEVI | `sunverse_vagdevi_lyricist` | Lyricist | composition brief → lyrics (Devanagari + Roman transliteration) with section labels and pronunciation notes | claude | 1 | — | sunverse_song_release.lyrics |
| SARASWATI | `sunverse_saraswati_vocal_director` | Vocal & Performance Director | lyrics; composition brief → vocal direction sheet | claude | 1 | — | sunverse_song_release.vocals |
| VISHVAVASU | `sunverse_vishvavasu_sound_engineer` | Sound Engineer | composition brief; optional audio file → mix & master brief / review | claude | 1 | — | sunverse_song_release.mix |
| GANDHARVA | `sunverse_gandharva_trend_analyst` | Music Trend Analyst | release goal → trend brief with sources | claude | 1 | — | sunverse_song_release.trends |
| VISHVAKARMA | `sunverse_vishvakarma_video_producer` | Music Video Producer | lyrics; composition brief → timed shot list with scene prompts | claude | 1 | — | sunverse_song_release.video |
| SURYA | `sunverse_surya_release_manager` | Release & Publishing Manager | all release deliverables → release package | claude | 1 | publish_content | sunverse_song_release.release |
| NATA | `sunverse_nata_visual_designer` | Artwork & Visual Identity Designer | composition brief; lyrics → artwork brief + image prompts | claude | 1 | — | sunverse_song_release.artwork |

## LittleLoop — Children's Animation Studio (`littleloop`, brand `littleloop`)

| Agent | ID | Role | Inputs → Outputs | Engines | Retries | Approval needed | Used in pipelines |
|---|---|---|---|---|---|---|---|
| KRISHNA | `littleloop_krishna_story_director` | Story & Character Director | episode goal; character bible → episode concept | claude | 1 | — | littleloop_episode.concept |
| VYASA | `littleloop_vyasa_scriptwriter` | Scriptwriter & Dialogue Specialist | episode concept → timed script | claude | 1 | — | littleloop_episode.script |
| DRISHTI | `littleloop_drishti_visual_planner` | Research & Visual Planner | timed script → visual brief + shot plan | claude | 1 | — | littleloop_episode.visual_plan |
| MAYA | `littleloop_maya_prompt_engineer` | Animation Prompt Engineer | shot plan; character sheet → per-shot video prompts | claude | 1 | — | littleloop_episode.prompts |
| CHITRA | `littleloop_chitra_character_designer` | Character & Art Designer | episode concept → character sheet | claude | 1 | — | littleloop_episode.characters |
| NATARAJA | `littleloop_nataraja_edit_director` | Animation & Editing Director | timed script; shot plan → edit plan | claude | 1 | — | littleloop_episode.edit |
| NADA | `littleloop_nada_sound_director` | Voice & Sound Director | timed script → voice & sound sheet | claude | 1 | — | littleloop_episode.sound |
| LAKSHMI | `littleloop_lakshmi_growth_analyst` | Channel Growth Analyst | final episode package; optional performance numbers → posting package + experiment ideas | claude | 1 | publish_content | littleloop_episode.posting |

## Foliocraft — Portfolio Product Studio (`foliocraft`, brand `foliocraft`)

| Agent | ID | Role | Inputs → Outputs | Engines | Retries | Approval needed | Used in pipelines |
|---|---|---|---|---|---|---|---|
| BRAHMA | `foliocraft_brahma_product_architect` | Product Architect | feature idea → product spec | claude | 1 | — | foliocraft_feature.spec |
| NIRNAYA | `foliocraft_nirnaya_strategy_analyst` | Product Strategy Analyst | product spec; NARADA findings → decision log | claude | 1 | — | foliocraft_feature.decision |
| SUTRADHARA | `foliocraft_sutradhara_ux_architect` | UX/UI & Design-System Architect | product spec → UX spec | claude | 1 | — | foliocraft_feature.ux |
| KARMA | `code_shakti` | Software Engineer (CODE-SHAKTI skill) | product spec; UX spec; coding task → pull request | claude | 1 | merge_pull_request, deploy | foliocraft_feature.build |
| KUBERA | `foliocraft_kubera_monetisation` | Monetisation Analyst | product spec → pricing analysis | claude | 1 | spend_money | foliocraft_feature.pricing |

## Shared Operations (`ops`, brand `studio`)

| Agent | ID | Role | Inputs → Outputs | Engines | Retries | Approval needed | Used in pipelines |
|---|---|---|---|---|---|---|---|
| AGNI | `ops_agni_automation` | Automation Engineer | automation request → automation PR | claude | 1 | merge_pull_request | ops_weekly_review.automation |
| SOMA | `ops_soma_analytics` | Data & Analytics Analyst | public/agent-data; vault pipelines → weekly metrics report | claude | 1 | — | ops_weekly_review.metrics |
| HANUMAN | `ops_hanuman_recovery` | Troubleshooting & Recovery Specialist | runs.json failures; workflow logs → incident note with root cause and fix | claude | 1 | — | ops_weekly_review.incidents |
| DHARMA | `ops_dharma_safety` | Safety & Policy Reviewer | deliverables → safety verdict | claude | 1 | — | sunverse_song_release.safety, littleloop_episode.safety |
| MAYA-OPS | `ops_maya_docs` | Documentation Manager | completed pipelines → SOP / changelog updates | claude | 1 | — | ops_weekly_review.docs |
| LAKSHMI-OPS | `ops_lakshmi_growth` | Growth & Distribution Analyst | NARADA findings; SOMA report → experiment plan / review | claude | 1 | publish_content | ops_weekly_review.growth |

## Notes
- Contracts (mission, acceptance criteria, permissions) live in `agents/teams/*.md`, generated from the registry by `scripts/gen-contracts.mjs`.
- Agents not used as a pipeline step: GANESHA (it is the orchestrator that runs the pipelines).
- Requested-workflow role mapping (no new agents needed): see `docs/IMPLEMENTATION_PLAN.md`.
