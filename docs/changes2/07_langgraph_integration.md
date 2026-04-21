# 07_langgraph_integration

## What

Integrated the new deterministic preprocessing/state layer into the morning coach entry route without changing the existing LangGraph node graph itself.

Updated:

- [src/app/api/coach/morning-run/route.ts](/home/nyuad/rytm/src/app/api/coach/morning-run/route.ts:1)

## Goal

Before any LLM summary node runs, the system now ensures that the derived daily artifacts already exist:

- timezone refreshed via Fitbit profile sync
- `daily_nutrition2`
- `daily_checkin_relation2`
- `journal_summary2` when available
- `daily_input_bundle_v12`
- `user_state_current2`
- `user_state_history2` stub

## Integration Design

To keep modifications minimal, the LangGraph Python pipeline itself was left unchanged. Instead, the TypeScript morning-run route now orchestrates the deterministic preparation step before spawning Python.

Flow in `POST /api/coach/morning-run`:

1. authenticate user
2. refresh Fitbit timezone
3. resolve canonical timezone
4. fetch target overall score
5. run [runMorningPreparationForSubmissionDate](/home/nyuad/rytm/src/lib/overall-submission-workflows/morningPreparation.ts:1)
6. if state is not ready, return early with deterministic `not_enough_history`
7. otherwise continue with existing goal check, ingestion run creation, and Python LangGraph execution
8. when LangGraph returns, update `user_state_history2.actions_generated_json` for the processed day

## Early Return Behavior

If `state.shouldRunSummary === false`, the route now returns:

- `success: true`
- `status: "not_enough_history"`
- `forDate`: submission day
- `processedDate`: previous local day used for deterministic preprocessing

No Python process is started and no LLM nodes are called.

## Actions Writeback

After a successful LangGraph run, the route updates the corresponding `user_state_history2` row for the processed day with:

- `themes`: selected domains
- `actions`: display actions returned by the pipeline
- `questions`: currently empty stub

This keeps the state-history row aligned with the later morning coach output.

## Notes

- Journal remains optional: if missing, the bundle simply reflects journal missingness.
- This integration intentionally avoids bypassing or deleting existing LangGraph nodes.
- The deterministic preprocessing remains keyed by submission date and prepares the previous local day.
