# Team battles

The room supports 1v1 and 2v2. Each trainer retains a six-Pokémon party and independently controls one active Pokémon. Seats 0/2 form team A; seats 1/3 form team B. Three humans can fill the fourth seat with AI; one or two humans can also play with AI in the remaining seats.

The host selects the format, swaps any trainer into either opposing seat, and adds/removes bots or chooses their difficulty. Changes clear human readiness. Human trainers cannot be replaced by bots. The existing five difficulties drive the same AI used in solo play, including delayed observation and prediction for Master. Each bot has independent decision/history state. Bots load automatically; every human must finish loading before the shared start countdown.

## Combat and presentation

- Every controller has its own MP, QWER cooldowns, trainer skill, dodge cooldown, switch cooldown, and party stats.
- Friendly fire is rejected in the damage function, before shields, statuses, stats, or lifesteal can change.
- Projectiles hit the first opponent along their path. Beams, slashes, pulses, and ground effects hit every opponent in their area. Released homing shots retain their intended controller; dodging breaks incoming tracking from both opposing trainers.
- Default targeting chooses the nearest living opponent. The opponent-switch button or T key locks another opponent. A fainted target falls back to a living opponent.
- A trainer's elimination leaves their teammate playing. Victory requires both opposing parties to be exhausted. Time-limit resolution sums remaining HP fractions across both allied parties.
- Party selection pauses everyone for at most 15 seconds, manual pause for 60 seconds. All resumes count down 3–2–1. AI knockouts choose a replacement automatically and share the countdown.
- Every client renders the same four fighters with local control prediction and interpolation for the other three. The mobile camera includes all living fighters. Distinct rings/names and the secondary HUD distinguish the ally and alternate target.
- Both allied trainers contribute to result totals and the MVP. The result party contains the team's 12 Pokémon.

## Protocol and persistence

Protocol 3 uses four controller keys (`player`, `enemy`, `ally`, `rival`) for doubles. These identify owners, not alliances. A client maps its own server seat to `player`, its partner to `ally`, and the opponents to `enemy`/`rival`. `battle.enemy` is the current local target; `battle.source(side)` always resolves that controller's active Pokémon.

Compact fighter fields stay append-only. Two-seat checkpoints remain readable, and existing v1/v2 two-player battles may reconnect and finish. New games require refreshed clients. Snapshots retain owner-specific targets, parties, cooldowns, burn/ignite attribution, stats, and queued effects; bot observation history restarts after hibernation.

Team swaps update both Durable Object socket attachments and client seat assignments. Resume tokens remain bound to the trainer. Disconnected humans have 30 seconds to return; an abandoned waiting seat is released and host ownership transfers. Leaving during asset loading returns the room to a usable lobby.

## Validation

`test/team-multiplayer.test.js` covers authority, all four perspectives, area damage, friendly-fire immunity, bot difficulties/state isolation, targeting, shared pauses, knockout switches, checkpoint restore, team results, and disconnects.

`node scripts/test-multiplayer-teams.mjs <worker-url>` uses real sockets for four humans and three humans + AI, including a host team swap, independent movement, target selection, pause/resume, manual switch, identical snapshots, seat-2 reconnect, and team elimination.

`node scripts/test-multiplayer-teams.mjs <worker-url> --load` exercises ten humans + two Master bots across three rooms. Local validation sustained 60 simulation steps/second for every client. This is a local load result, not a guarantee about individual internet latency.

For a separate local Worker, use e.g. `npx wrangler dev --port 8790` and open `http://localhost:5173/?multiplayerPort=8790`. The port override is accepted only on localhost, never production.
