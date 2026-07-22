/**
 * Status chips on an agent card: raised hand, queued count, superseded
 * count, and "playing on phone". Markup/classes match the legacy template;
 * visibility rules are the caller's (pass only what should show).
 */
export interface AgentChipsProps {
  raised: boolean;
  raisedCount: number;
  supersededCount: number;
  onPhone: boolean;
}

export function AgentChips({ raised, raisedCount, supersededCount, onPhone }: AgentChipsProps) {
  return (
    <>
      {raised && (
        <span className="chip raised" title="Hand raised">
          ✋
        </span>
      )}
      {raisedCount > 0 && (
        <span className="chip queue" title="Queued">
          {raisedCount}
        </span>
      )}
      {supersededCount > 0 && (
        <span className="chip superseded" title="Superseded">
          {supersededCount}
        </span>
      )}
      {onPhone && (
        <span className="chip phone" title="Playing on phone">
          on phone
        </span>
      )}
    </>
  );
}
