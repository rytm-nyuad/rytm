# Prompt Version Changelog

## v2 — 2026-04-12
- **MORNING_BRIEF_COMPOSER_SYSTEM_PROMPT**: Replaced domain-by-domain clinical report (500-700 words) with narrative coach-note format (200-300 words). Removed mandatory medical disclaimer (moved to UI). Added persona guidance. Banned euphemistic filler phrases.
- **ACTION_GENERATOR_SYSTEM_PROMPT**: Added behavioral science techniques (habit stacking, implementation intentions, tiny habits, identity reinforcement). Added `when` time-of-day field. Added `qualitative` success_criteria type for non-measurable actions. Added meal context and action history inputs.

## v1 — Original (pre-2026-04-12)
- Full archive: `v1_original.py`
- All original prompts as shipped with initial coach feature.
