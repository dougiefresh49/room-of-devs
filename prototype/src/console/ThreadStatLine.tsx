import { Coins } from "lucide-react";
import type { Craft } from "../mock/types";

export function ThreadStatLine({ craft }: { craft: Craft }) {
  if (craft.state === "empty" && craft.turns === 0) return null;

  const pull =
    craft.salienceDelta < 0
      ? `−${Math.abs(craft.salienceDelta)} CLR`
      : `+${craft.salienceDelta} CLR`;

  return (
    <div className="tstats">
      <span className="tok">
        {craft.tokens.toLocaleString()}
        <Coins size={9} aria-hidden />
      </span>
      <span className="sep">·</span>
      <span className="usd">${craft.spendUsd.toFixed(2)}</span>
      <span className="sep">·</span>
      <span className="turns">
        {craft.turns} {craft.turns === 1 ? "TURN" : "TURNS"}
      </span>
      {craft.salienceDelta !== 0 ? (
        <>
          <span className="sep">·</span>
          <span className={`pull${craft.salienceDelta > 0 ? " up" : ""}`}>{pull}</span>
        </>
      ) : null}
    </div>
  );
}
