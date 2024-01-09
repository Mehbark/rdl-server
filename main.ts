import { assert } from "https://deno.land/std@0.211.0/assert/assert.ts";
import { parse } from "https://deno.land/std@0.211.0/csv/mod.ts";

let last_fetched = new Date("1970-01-01");
// 5 minutes
const MAX_AGE_MS = 5 * 60 * 1000;

let cached_csv: string[][] = [];
const should_refetch = () =>
  (new Date().getTime() - last_fetched.getTime()) > MAX_AGE_MS;

let cached_stats: Stats = {} as Stats;

type Faction = {
  order: number;
  faction: string;
  gamesPlayed: number;
  leagueScore: number;
  winRate: number;
};
type Season = { order: number; name: SeasonName; factions: Faction[] };
// just for fun :]
type Digit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
// all seasons should be the spreadsheet's job if we're going to treat it as the source of truth
type SeasonName = "All Seasons" | `Season A${Digit}${Digit}`;

type Stats = Partial<Record<SeasonName, Season>>;

const season_faction_stats = (
  { season, factions }: { season: string[]; factions: string[] },
): Faction[] =>
  factions
    .map((faction, order) => {
      const gamesPlayed = parseInt(
        season.slice(2)[order * 2],
      );
      const leagueScore = parseFloat(season.slice(2)[order * 2 + 1]);

      return {
        order,
        faction,
        gamesPlayed,
        leagueScore,
        winRate: leagueScore / gamesPlayed,
      };
    });

// let it crash! this is erlang right?
function mk_stats(csv: string[][]): Stats {
  let factions = csv[1].slice(1).filter(Boolean);
  let seasons_section = csv.slice(19);
  let season_names = seasons_section.map((s) => `Season ${s[1]}` as SeasonName);

  assert(season_names.every((name) => name.match(/Season A[0-9][0-9]/)));

  const stats: Stats = {
    "All Seasons": {
      order: 0,
      name: "All Seasons",
      factions: season_faction_stats({ season: csv[3], factions }),
    },
    ...Object.fromEntries(
      season_names.map((
        name,
        i,
      ) => [
        name,
        {
          order: i + 1,
          name,
          factions: season_faction_stats({
            season: seasons_section[i],
            factions,
          }),
        },
      ]),
    ),
  };

  return stats;
}

const update_stats = async () => {
  last_fetched = new Date();
  cached_csv = parse(
    await fetch(
      "https://docs.google.com/spreadsheets/d/1yxy672ufBpg2R-aUqtpKI5erArzsqL0SjJcRgHKPhEo/export?format=csv&id=1yxy672ufBpg2R-aUqtpKI5erArzsqL0SjJcRgHKPhEo&gid=2066926104",
      {},
    ).then((r) => r.text()),
  );
  cached_stats = mk_stats(cached_csv);
};

const stats = () => {
  if (should_refetch()) {
    update_stats();
  }
  return cached_stats;
};

await update_stats();

// CAVEAT:
// the above is refreshingly simple, but obscures some complexity in how *precisely* stats are distributed
// on each request, if it has been more than MAX_AGE_MS, we will update the stats,
// !but we return the old stats immediately!
// it shouldn't be a big deal (low volume), but it is worth keeping in mind that this is a *tradeoff*

Deno.serve((req) => {
  if (/\/faction-stats\/?$/.test(req.url)) {
    return new Response(JSON.stringify(stats()), {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } else {
    return new Response("not found", { status: 404 });
  }
});
