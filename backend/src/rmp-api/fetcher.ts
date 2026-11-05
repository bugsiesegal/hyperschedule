import * as APIv4 from "hyperschedule-shared/api/v4";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import { createLogger } from "../logger";

const logger = createLogger("rmp.fetcher");

/**
 * Rate My Professors doesn't have a public API, so this is the GraphQL endpoint
 * that their website uses. Its terms of use don't allow automated access without
 * their permission, so make sure that we have it before running this.
 */
const RMP_ENDPOINT = "https://www.ratemyprofessors.com/graphql";
// not a secret, this is `test:test` and it's hardcoded into their website
const RMP_AUTHORIZATION = "Basic dGVzdDp0ZXN0";

// the id in ratemyprofessors.com/school/<id>
const RMP_SCHOOL_IDS = {
    [APIv4.School.HMC]: 400,
    [APIv4.School.POM]: 774,
    [APIv4.School.SCR]: 889,
    [APIv4.School.CMC]: 234,
    [APIv4.School.PTZ]: 768,
    [APIv4.School.CGU]: 233,
};

const PAGE_SIZE = 500;
// no school has anywhere near this many instructors. this is only here so a bug
// on either side can't turn into us endlessly sending requests to someone else
const MAX_PAGES_PER_SCHOOL = 20;

const TEACHERS_QUERY = `
query Teachers($count: Int!, $cursor: String, $query: TeacherSearchQuery!) {
    newSearch {
        teachers(query: $query, first: $count, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            edges {
                node {
                    legacyId
                    firstName
                    lastName
                    avgRating
                    avgDifficulty
                    numRatings
                    wouldTakeAgainPercent
                    school { legacyId }
                }
            }
        }
    }
}`;

const RmpTeacher = z.object({
    legacyId: z.number(),
    firstName: z.string(),
    lastName: z.string(),
    avgRating: z.number(),
    avgDifficulty: z.number(),
    numRatings: z.number(),
    wouldTakeAgainPercent: z.number().nullable(),
    school: z.object({ legacyId: z.number() }),
});
export type RmpTeacher = z.infer<typeof RmpTeacher>;

const RmpTeachersResponse = z.object({
    data: z.object({
        newSearch: z.object({
            teachers: z.object({
                pageInfo: z.object({
                    hasNextPage: z.boolean(),
                    endCursor: z.string().nullable(),
                }),
                edges: z.object({ node: RmpTeacher }).array(),
            }),
        }),
    }),
});

async function fetchTeachersPage(
    schoolId: number,
    cursor: string,
): Promise<
    z.infer<typeof RmpTeachersResponse>["data"]["newSearch"]["teachers"]
> {
    const res = await fetch(RMP_ENDPOINT, {
        method: "POST",
        headers: {
            Authorization: RMP_AUTHORIZATION,
            "Content-Type": "application/json",
            "User-Agent": "HyperscheduleBot",
        },
        body: JSON.stringify({
            query: TEACHERS_QUERY,
            variables: {
                count: PAGE_SIZE,
                cursor,
                query: {
                    text: "",
                    schoolID: Buffer.from(`School-${schoolId}`).toString(
                        "base64",
                    ),
                    // otherwise we can get results from other schools
                    fallback: false,
                },
            },
        }),
    });
    if (!res.ok)
        throw Error(`Rate My Professors returned status ${res.status}`);

    return RmpTeachersResponse.parse(await res.json()).data.newSearch.teachers;
}

/**
 * Fetches every instructor listed under any of the Claremont Colleges. If this
 * fails for any school the entire thing fails, as we don't want to treat
 * instructors from that school as if they no longer have a rating.
 */
export async function fetchAllTeachers(
    delayMs: number = 1000,
): Promise<RmpTeacher[]> {
    const teachers: RmpTeacher[] = [];

    // we loop through them one-by-one instead of in-parallel to not overload
    // their server
    for (const [school, schoolId] of Object.entries(RMP_SCHOOL_IDS)) {
        let cursor = "";
        let schoolTeachers = 0;
        for (let page = 0; page < MAX_PAGES_PER_SCHOOL; page++) {
            const { edges, pageInfo } = await fetchTeachersPage(
                schoolId,
                cursor,
            );
            for (const { node } of edges) {
                // being attributed someone else's score is the worst possible
                // outcome here, so we make sure that this is who we asked for
                if (node.school.legacyId !== schoolId) continue;
                teachers.push(node);
                schoolTeachers++;
            }
            await setTimeout(delayMs);

            if (!pageInfo.hasNextPage || pageInfo.endCursor === null) break;
            cursor = pageInfo.endCursor;
        }
        logger.info("Fetched %d teachers for %s", schoolTeachers, school);
    }
    return teachers;
}
