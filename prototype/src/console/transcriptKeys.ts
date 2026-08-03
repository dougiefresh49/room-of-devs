import type { TranscriptRow } from "../mock/types";

const transcriptKeys = new WeakMap<TranscriptRow, string>();
let nextTranscriptKey = 0;

export function transcriptRowKey(row: TranscriptRow) {
  const current = transcriptKeys.get(row);
  if (current) return current;
  const key = `transcript-${nextTranscriptKey}`;
  nextTranscriptKey += 1;
  transcriptKeys.set(row, key);
  return key;
}
