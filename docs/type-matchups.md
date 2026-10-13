# Type matchups

The arena uses the modern 18-type main-series chart (Generation VI onward), with
the two defending types multiplied together. Weakness is ×2, resistance ×0.5,
and immunity ×0; dual types can produce ×4 or ×0.25. A damaging move that matches
either of the attacker's types also receives a single ×1.5 same-type bonus.

The [official Pokémon battle guide](https://diamondpearl.pokemon.com/en-us/trainersguide/fundamentals/battling/)
describes effectiveness, dual typing and the additional 50% same-type damage.
The checked-in chart, 50 Pokémon type combinations, and 193 named move/basic
type mappings come from [PokéAPI's data](https://github.com/PokeAPI/pokeapi/tree/81d20919845b6a445969b9265aab5cec6b04cece/data/v2/csv),
retrieved on 2026-10-13: `types.csv`, `type_efficacy.csv`, `pokemon_types.csv`,
`moves.csv`, and English/Korean entries in `move_names.csv`. The
[PokéAPI documentation](https://pokeapi.co/docs/v2#types) defines the relations.
There are no runtime API requests, keys, or additional hosted services.

`src/type-data.js` holds the data and `src/type-matchups.js` calculates the
multipliers. Both the local simulation and authoritative multiplayer Worker
use the same `Battle.damage` path. Damage is multiplied before rounding and
shield absorption. An immune hit does not consume a shield, apply an on-hit
debuff, heal its attacker, count as a landed hit, or knock its target back.
Fire-type Pokémon cannot receive the arena's burn status. Residual burn and
fixed trainer Ignite damage do not receive effectiveness or same-type bonuses.

Move power remains the arena's tuned base damage. This change does not replace
the action combat with the RPG's level/Attack/Defense formula. Moves adapted
from status moves (e.g. the damaging Sweet Scent field) use the named move's
canonical type; their existing arena behavior remains. Arena-original moves
and Yuna retain their designed types. Abilities, weather, held items and
Terastallization are outside this implementation.

Selection shows move type and base power, MP, cooldown, in that order of stats.
Battle buttons show the current opponent's effectiveness multiplier; same-type
bonus is separately named in the tooltip. Opponent changes rebuild these
readouts. Hits show localized effectiveness feedback with a short throttle so
multi-hit attacks do not flood the arena. AI avoids immune damaging choices;
Master also scores usable attacks by their damage multiplier.

Periodic fields share a 0.55-second damage interval with the readout. Instead
of `/tick`, the interface says, for example, `0.55초마다 +7`. This is extra damage
while the opponent remains in the field. The visible base hit stays separate.

Validation includes chart immunities, dual-type combinations, coverage moves,
same-type bonuses, shield/debuff behavior, actual projectile collision, fixed
damage, switch updates, and both perspectives of the network snapshot.
