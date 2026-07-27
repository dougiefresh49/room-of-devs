# Biome Lint Report (issue #63)

Generated after initial `biome.json` setup, before any lint autofixes.

## Summary

- Files checked: 211
- Errors: 494
- Warnings: 222
- Infos: 149

## By rule (top 30)

- `lint/a11y/useButtonType`: 329
- `lint/style/useNodejsImportProtocol`: 127
- `lint/suspicious/noExplicitAny`: 84
- `lint/a11y/noSvgWithoutTitle`: 61
- `lint/style/noDescendingSpecificity`: 45
- `lint/complexity/noImportantStyles`: 39
- `lint/a11y/noLabelWithoutControl`: 35
- `lint/style/noNonNullAssertion`: 22
- `lint/style/useTemplate`: 19
- `parse`: 17
- `lint/a11y/useAriaPropsSupportedByRole`: 15
- `lint/complexity/useArrowFunction`: 14
- `lint/suspicious/useIterableCallbackReturn`: 10
- `lint/correctness/noUnusedImports`: 9
- `lint/correctness/useExhaustiveDependencies`: 8
- `lint/complexity/useOptionalChain`: 6
- `lint/a11y/useSemanticElements`: 4
- `lint/a11y/noStaticElementInteractions`: 3
- `lint/suspicious/noImplicitAnyLet`: 3
- `lint/complexity/noUselessContinue`: 2
- `lint/a11y/useKeyWithClickEvents`: 2
- `lint/suspicious/noControlCharactersInRegex`: 2
- `lint/complexity/noUselessFragments`: 1
- `lint/style/useImportType`: 1
- `lint/style/useConst`: 1
- `lint/correctness/noUnusedVariables`: 1
- `lint/a11y/useGenericFontNames`: 1
- `lint/suspicious/noShorthandPropertyOverrides`: 1
- `lint/suspicious/noArrayIndexKey`: 1
- `lint/suspicious/noDuplicateProperties`: 1

## By file extension (diagnostic count)

- `.html`: 550
- `.ts`: 275
- `.tsx`: 27
- `.css`: 12
- `.mjs`: 1

## Files with most diagnostics (top 20)

- `docs/archive/reviews/ui-redesign-2026-07/concept-sol.html`: 83
- `docs/archive/reviews/ui-redesign-2026-07/final-sol.html`: 60
- `docs/archive/reviews/ui-redesign-2026-07/concept-grok.html`: 52
- `docs/archive/reviews/ui-redesign-2026-07/final-grok.html`: 51
- `docs/mockups/live-mode-v2/concept-gpt.html`: 46
- `docs/mockups/live-mode-v2/concept-grok.html`: 32
- `docs/archive/reviews/ui-redesign-2026-07/concept-fable.html`: 32
- `docs/mockups/live-mode/concept-fable.html`: 31
- `docs/mockups/live-mode/concept-grok.html`: 27
- `tts-server/src/services/commands.ts`: 17
- `docs/archive/reviews/ui-redesign-2026-07/wild2-opus5.html`: 17
- `docs/mockups/live-mode/concept-gpt.html`: 17
- `docs/archive/reviews/ui-redesign-2026-07/wild-sol.html`: 16
- `tts-server/src/panel-ws.ts`: 15
- `docs/archive/reviews/review-dashboard.html`: 13
- `docs/archive/reviews/ui-redesign-2026-07/wild2-sol.html`: 13
- `tts-server/src/elevenlabs.ts`: 12
- `tts-server/src/index.ts`: 11
- `packages/protocol/scripts/check-fixtures.ts`: 10
- `docs/archive/reviews/ui-redesign-2026-07/synth-grok.html`: 10

## Notes

- Commit 2 is format-only; lint findings are intentionally deferred.
- Many diagnostics are in archived HTML mockups under `docs/archive/`.
- Common source-code rules: `useNodejsImportProtocol`, `noExplicitAny`, `useButtonType`.
