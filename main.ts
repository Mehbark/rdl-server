import { debug } from "https://deno.land/std@0.195.0/log/mod.ts";
import { assert } from "https://deno.land/std@0.211.0/assert/assert.ts";
import * as csv from "https://deno.land/std@0.211.0/csv/mod.ts";
// if needed (shouldn't really be beneficial)
// import memoize from "https://deno.land/x/froebel@v0.23.2/memoize.ts"

const FACTION_SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1yxy672ufBpg2R-aUqtpKI5erArzsqL0SjJcRgHKPhEo/export?format=csv&id=1yxy672ufBpg2R-aUqtpKI5erArzsqL0SjJcRgHKPhEo&gid=2066926104";

// HACK: least futureproof thing by far
// also just not fun to fill out
// i'm using a mix of the main(?) "Root Digital League 3.0" sheet and the Dev/Community one
const LEADERBOARD_SHEET_CSV_URLS = [
  // main
  {
    name: "All Seasons",
    url:
      "https://docs.google.com/spreadsheets/d/1yxy672ufBpg2R-aUqtpKI5erArzsqL0SjJcRgHKPhEo/export?format=csv&id=1yxy672ufBpg2R-aUqtpKI5erArzsqL0SjJcRgHKPhEo&gid=463315644",
  },
  // dev
  {
    name: "Season A01",
    url:
      "https://docs.google.com/spreadsheets/d/1WW7UXztxE4qgUtGSYlJClShni0AMhQUCnbv2DoIyC1c/export?format=csv&id=1WW7UXztxE4qgUtGSYlJClShni0AMhQUCnbv2DoIyC1c&gid=169812129",
  },
  {
    name: "Season A02",
    url:
      "https://docs.google.com/spreadsheets/d/1WW7UXztxE4qgUtGSYlJClShni0AMhQUCnbv2DoIyC1c/export?format=csv&id=1WW7UXztxE4qgUtGSYlJClShni0AMhQUCnbv2DoIyC1c&gid=160732981",
  },
  {
    name: "Season A03",
    url:
      "https://docs.google.com/spreadsheets/d/1WW7UXztxE4qgUtGSYlJClShni0AMhQUCnbv2DoIyC1c/export?format=csv&id=1WW7UXztxE4qgUtGSYlJClShni0AMhQUCnbv2DoIyC1c&gid=1084691973",
  },
  {
    name: "Season A04",
    url:
      "https://docs.google.com/spreadsheets/d/1WW7UXztxE4qgUtGSYlJClShni0AMhQUCnbv2DoIyC1c/export?format=csv&id=1WW7UXztxE4qgUtGSYlJClShni0AMhQUCnbv2DoIyC1c&gid=1204325811",
  },
  // main
  {
    name: "Season A05",
    url:
      "https://docs.google.com/spreadsheets/d/1yxy672ufBpg2R-aUqtpKI5erArzsqL0SjJcRgHKPhEo/export?format=csv&id=1yxy672ufBpg2R-aUqtpKI5erArzsqL0SjJcRgHKPhEo&gid=1225920116",
  },
] satisfies {
  name: SeasonName;
  url: CsvSheetUrl;
}[];

// overly strict for fun; low chance of actually catching mistakes
type CsvSheetUrl =
  `https://docs.google.com/spreadsheets/d/${string}/export?format=csv&id=${string}`;

let last_fetched = new Date("1970-01-01");
// 1 minute
const MAX_AGE_MS = 1 * 60 * 1000;

let cached_faction_csv: string[][] = [];
let cached_leader_board_csvs: { name: SeasonName; csv: string[][] }[] = [];

const should_refetch = () =>
  (new Date().getTime() - last_fetched.getTime()) > MAX_AGE_MS;

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

function faction_stats(): FactionStats {
  const csv = cached_faction_csv;
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
function leader(row: string[]): Leader {
  const gamesPlayed = parseInt(row[2]);
  const leagueScore = parseFloat(row[3]);
  return {
    rank: parseInt(row[0]),
    player: row[1],
    gamesPlayed,
    leagueScore,
    winRate: 100 * leagueScore / gamesPlayed,
  };
}

function leader_board_season(
  { name, csv }: { name: SeasonName; csv: string[][] },
  order: number,
): LeaderBoardSeason {
  const currentThreshold = parseInt(csv[0][8]);
  return {
    name,
    currentThreshold,
    targetThreshold: currentThreshold,
    order,
    leaders: csv.slice(2).map(leader),
  };
}

const leader_boards = (): LeaderBoard =>
  cached_leader_board_csvs.map(leader_board_season);

function player_stats(name: string): string {
  return "//TODO";
}

const update_csvs = async () => {
  console.log(`[${new Date().toISOString()}] updating CSVs...`);
  cached_faction_csv = csv.parse(
    await fetch(
      FACTION_SHEET_CSV_URL,
      {},
    ).then((r) => r.text()),
  );
  cached_leader_board_csvs = await Promise.all(
    LEADERBOARD_SHEET_CSV_URLS.map(async (
      { name, url },
    ) => ({
      name,
      csv: csv.parse(
        await fetch(url).then((r) => r.text()),
      ),
    })),
  );
  console.log(`[${new Date().toISOString()}] CSVs updated!`);
};

const refetch = async () => {
  last_fetched = new Date();
  await update_csvs();
};

await refetch();

// TODO: a bit more fault-tolerance
// TODO: PER PLAYER STATS! COMPLETELY DIFFERENT, DO NOT FORGET
// apparently that's under faction stats. good to know!
Deno.serve((req) => {
  if (should_refetch()) {
    queueMicrotask(refetch);
  }

  const url = new URL(req.url);

  if (/^\/faction-stats\/?/.test(url.pathname)) {
    return Response.json(faction_stats(), {
      headers: { "access-control-allow-origin": "*" },
    });
  }

  if (/^\/player\/?/.test(url.pathname)) {
    const name = url.searchParams.get("name");
    if (name) {
      return Response.json(player_stats(name), {
        headers: { "access-control-allow-origin": "*" },
      });
    } else {
      return Response.json({ "error": "must give name param" }, {
        status: 400,
        headers: { "access-control-allow-origin": "*" },
      });
    }
  }

  if (/\/leader-boards\/?$/.test(url.pathname)) {
    return Response.json(leader_boards(), {
      headers: { "access-control-allow-origin": "*" },
    });
  }

  return new Response("not found", { status: 404 });
});
