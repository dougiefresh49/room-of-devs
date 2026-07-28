# Rooms, borrowed brains, sentinel threads

Owner feedback round 3 (2026-07-28) extending
[04-generalized-model.md](04-generalized-model.md). Three additions —
none change the layering; two add dials, one adds a thread type.

## Rooms — Option C arrives as configuration

A **room** = one project's space: repo(s) + spine + **cast** + default
ceremony gear. The cast is one lead voice (the concierge) plus
alternates who exist *only* for checkout — never simultaneous chatter.
One audio floor globally; the salience queue is shared across rooms
with room attribution.

```mermaid
flowchart TB
  classDef owner fill:#f5c542,stroke:#8a6d1a,color:#1a1a1a
  classDef voice fill:#a78bfa,stroke:#6d28d9,color:#1a1a1a
  classDef orch fill:#60a5fa,stroke:#1d4ed8,color:#1a1a1a
  classDef worker fill:#5eead4,stroke:#0f766e,color:#1a1a1a,stroke-dasharray:5 4
  classDef memory fill:#86efac,stroke:#15803d,color:#1a1a1a
  classDef plumbing fill:#d4d4d8,stroke:#71717a,color:#1a1a1a

  O["🧑 Owner — ONE floor, salience queue shared across rooms"]:::owner

  subgraph R1["room: room-of-devs — default gear: full/light"]
    M1["🎙 Mikey (lead)"]:::voice
    D1["🎙 Donnie (checkout pool)"]:::voice
    S1["🗂 spine"]:::memory
    T1["🧠 threads: build · review"]:::orch
    M1 --- S1 --- T1
  end

  subgraph R2["room: podlink — default gear: one-off/light"]
    RA["🎙 Raph (lead, solo cast)"]:::voice
    S2["🗂 spine"]:::memory
    T2["🧠 threads: sentinel · one-offs"]:::orch
    RA --- S2 --- T2
  end

  O <--> M1
  O <--> RA
  M1 -. checkout .-> D1
```

Adopting rooms is **config, not architecture**: v1 builds ONE room
(this repo) with the room boundary as a config object — cast, spine
pointer, gear default. Podlink later = add a config entry.

## The third dial — brain tier per turn (persona ≠ model)

A persona is a voice + character + access to the spine — **not a set
of weights**. Mikey never "gets smarter"; he borrows brains:

```mermaid
flowchart LR
  classDef voice fill:#a78bfa,stroke:#6d28d9,color:#1a1a1a
  classDef worker fill:#5eead4,stroke:#0f766e,color:#1a1a1a,stroke-dasharray:5 4
  classDef plumbing fill:#d4d4d8,stroke:#71717a,color:#1a1a1a

  Q["a turn arrives"] --> M["🎙 Mikey — identity, constant"]:::voice
  M --> L1["rules — free<br/>(commands, canned acks)"]:::plumbing
  M --> L2["flash — pennies<br/>(routing, tap-in Q&A — most turns)"]:::plumbing
  M --> L3["⚡ borrowed frontier brain<br/>opus/fable, short-lived, fresh context<br/>reads spine + repo, answers, dies"]:::worker
  L3 -- "answer spoken AS Mikey" --> M
```

"His own intelligence rooted in project context" is right — with the
sharpening that the context is **externalized** (spine, repo,
transcripts). That's why a fresh borrowed brain is instantly competent,
and why Mikey stays immortal and cheap. Durable cross-month "Mikey
remembers conclusions" is the ContextDB/room-memory line (conversational
layer Stage 6), behind the same identity.

Full dial set: **(1) ceremony per thread · (2) voice attachment ·
(3) brain tier per turn.** What runs in the box / who speaks / how
smart is this turn.

## Sentinel threads — the release-day watcher

A third thread type beside build/one-off: long-lived-but-mortal,
cheap, mostly silent, push-on-anomaly. Polling needs no big brain;
diagnosis borrows one on demand.

```mermaid
sequenceDiagram
  actor O as 🧑 Owner
  participant M as 🎙 Raph (podlink lead)
  participant TM as 🗂 spine
  participant W as 🧠 sentinel thread
  participant D as ⚡ diagnosis thread

  O->>M: "release watch on podlink til tonight"
  M->>TM: file ticket: sentinel, sources, cadence, window
  M->>W: start: poll Vercel/PostHog/Sentry every 10 min
  loop every 10 min
    W->>W: fetch → cheap classifier: "ordinary?"
    Note over W: yes → silent log on ticket
  end
  W->>M: ANOMALY (operator gate): "5xx rate 3× baseline since deploy"
  M->>O: speaks it, with room attribution
  O->>M: "dig into that"
  M->>D: spawn diagnosis: frontier brain, fresh context, reads ticket log
  D->>TM: findings → ticket
  M->>O: synthesized verdict
  O->>M: "stand down"
  M->>W: settle: summary → ticket, thread dies
```

Thread-type roster so far: **build** (any ceremony gear), **one-off**
(no ticket), **sentinel** (watch + push on anomaly). Reviews/walkthroughs
are build-thread stages plus voice checkout, not their own type.
