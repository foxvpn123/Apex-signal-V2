# V2 A-Z Fixes Applied — 2026-09-11

## Final Judge pipeline
- Final Judge is now an independent mandatory stage after model aggregation/self-thinking.
- Self-Thinking failure no longer returns early and hides Final Judge.
- Added deterministic self-thinking fallback so partial provider outages do not break the pipeline.
- Final Judge uses TokenRouter dynamically from runtime environment values.
- Added explicit Final Judge runtime logs: START / SUCCESS / FAIL.
- TokenRouter supports a retry without `response_format` when a gateway rejects it.
- Final Judge JSON is normalized and validated.
- Final Judge failure is surfaced as SYSTEM state instead of being counted as a market NO_TRADE vote.

## Provider / fleet fixes
- Corrected APINEX specialist IDs to the V2 registry currently intended by the project.
- Removed OpenRouter embedding/audio/vision entries from the text market-analysis fleet.
- Fixed OpenRouter model discovery to send Authorization headers.
- Provider errors remain infrastructure states and are excluded from directional voting.

## API / diagnostics
- `/api/scan` no longer requires APINEX specifically; any configured AI provider can keep the endpoint alive.
- `/api/v2/test-final-judge` now uses the same TokenRouter service as production Final Judge.
- `/api/v2/diagnostics` reports the runtime-configured Final Judge model.

## Validation note
- The container did not have dependencies installed. Two attempts to install the project's npm dependencies timed out, so a full `npm run build` / `npm run lint` could not be completed in this environment.
- Static source checks were completed on the modified TypeScript files and their brace/parenthesis/bracket balance is valid.
