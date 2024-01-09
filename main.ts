import { debug } from "https://deno.land/std@0.195.0/log/mod.ts";
import { assert } from "https://deno.land/std@0.211.0/assert/assert.ts";
import * as csv from "https://deno.land/std@0.211.0/csv/mod.ts";
// if needed (shouldn't really be beneficial)
// import memoize from "https://deno.land/x/froebel@v0.23.2/memoize.ts"

const FACTION_SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1yxy672ufBpg2R-aUqtpKI5erArzsqL0SjJcRgHKPhEo/export?format=csv&id=1yxy672ufBpg2R-aUqtpKI5erArzsqL0SjJcRgHKPhEo&gid=2066926104";
const LEADERBOARD_SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1yxy672ufBpg2R-aUqtpKI5erArzsqL0SjJcRgHKPhEo/export?format=csv&id=1yxy672ufBpg2R-aUqtpKI5erArzsqL0SjJcRgHKPhEo&gid=463315644";

let last_fetched = new Date("1970-01-01");
// 5 minutes
const MAX_AGE_MS = 5 * 60 * 1000;

let cached_faction_csv: string[][] = [];
let cached_leader_board_csv: string[][] = [];

const should_refetch = () =>
  (new Date().getTime() - last_fetched.getTime()) > MAX_AGE_MS;

// wordy, but explicit
let cached_faction_stats: FactionStats = {};
let cached_leader_board: LeaderBoard = [];

type Faction = {
  order: number;
  faction: string;
  gamesPlayed: number;
  leagueScore: number;
  winRate: number;
};
type FactionSeason = { order: number; name: SeasonName; factions: Faction[] };
// just for fun :]
type Digit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
// all seasons should be the spreadsheet's job if we're going to treat it as the source of truth
type SeasonName = "All Seasons" | `Season A${Digit}${Digit}`;

type FactionStats = Partial<Record<SeasonName, FactionSeason>>;

type Leader = {
  rank: number;
  player: string;
  gamesPlayed: number;
  leagueScore: number;
  winRate: number;
};
type LeaderBoardSeason = {
  name: SeasonName;
  targetThreshold: number;
  currentThreshold: number;
  order: number;
  leaders: Leader[];
};
// here is my understanding of the crux of why the leaderboards is an array of named objects
// (as opposed to a single object): object iteration order is not (should not be) guaranteed
type LeaderBoard = LeaderBoardSeason[];

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

/** does not include "All Seasons"
 */
const season_names = () =>
  cached_faction_csv.slice(19).map((s) => `Season ${s[1]}` as SeasonName);

// let it crash! this is erlang right?
function mk_faction_stats(csv: string[][]): FactionStats {
  const factions = csv[1].slice(1).filter(Boolean);
  const seasons_section = csv.slice(19);

  const stats: FactionStats = {
    "All Seasons": {
      order: 0,
      name: "All Seasons",
      factions: season_faction_stats({ season: csv[3], factions }),
    },
    ...Object.fromEntries(
      season_names().map((
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

function mk_leader_board(csv: string[][]): LeaderBoard {
  return null as any;
}

const update_csvs = async () => {
  cached_faction_csv = csv.parse(
    await fetch(
      FACTION_SHEET_CSV_URL,
      {},
    ).then((r) => r.text()),
  );
  cached_leader_board_csv = csv.parse(
    await fetch(
      LEADERBOARD_SHEET_CSV_URL,
      {},
    ).then((r) => r.text()),
  );
};

const refetch = async () => {
  last_fetched = new Date();
  await update_csvs();
  cached_faction_stats = mk_faction_stats(cached_faction_csv);
  cached_leader_board = mk_leader_board(cached_leader_board_csv);
};

// const faction_stats = () => {
//   if (should_refetch()) {
//     update_stats();
//   }
//   return cached_faction_stats;
// };

await refetch();

// CAVEAT:
// the above is refreshingly simple, but obscures some complexity in how *precisely* stats are distributed
// on each request, if it has been more than MAX_AGE_MS, we will update the stats,
// !but we return the old stats immediately!
// it shouldn't be a big deal (low volume), but it is worth keeping in mind that this is a *tradeoff*

// TODO: a bit more fault-tolerance
// TODO: PER PLAYER STATS! COMPLETELY DIFFERENT, DO NOT FORGET
// i think we should cache the csv for those and generate them on demand
Deno.serve((req) => {
  if (should_refetch()) {
    queueMicrotask(refetch);
  }

  // simple regex is still appropriate for now i believe
  if (/\/faction-stats\/?$/.test(req.url)) {
    // how did i forget about Response.json?? so nice not having to get the header just right
    return Response.json(cached_faction_stats, {
      headers: { "access-control-allow-origin": "*" },
    });
  } else if (/\/leader-board\/?$/.test(req.url)) {
    return new Response(JSON.stringify(cached_leader_board), {
      headers: { "access-control-allow-origin": "*" },
    });
  } else {
    return new Response("not found", { status: 404 });
  }
});
