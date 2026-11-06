import * as APIv4 from "hyperschedule-shared/api/v4";
import { setTimeout } from "node:timers/promises";
import { z } from "zod";
import { createLogger } from "../logger";

const logger = createLogger("rmp.fetcher");

/**
 * Rate My Professors doesn't have a public API, so this is the GraphQL endpoint
 * that their website uses. Its terms of use don't allow automated access without
 * their permission. The fetcher refreshes ratings from here once a week, see
 * rmp-api/scheduler.ts, and remove that if they ask us to stop.
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

export function schoolOfRmpId(legacyId: number): APIv4.School | undefined {
    for (const [school, id] of Object.entries(RMP_SCHOOL_IDS))
        if (id === legacyId) return school as APIv4.School;
    return undefined;
}

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

async function postQuery(
    query: string,
    variables: Record<string, unknown>,
): Promise<unknown> {
    const res = await fetch(RMP_ENDPOINT, {
        method: "POST",
        headers: {
            Authorization: RMP_AUTHORIZATION,
            "Content-Type": "application/json",
            "User-Agent": "HyperscheduleBot",
        },
        body: JSON.stringify({ query, variables }),
    });
    if (!res.ok)
        throw Error(`Rate My Professors returned status ${res.status}`);

    const body: unknown = await res.json();
    // GraphQL reports problems such as a field that doesn't exist with a 200
    const errors = z
        .object({ errors: z.object({ message: z.string() }).array() })
        .safeParse(body);
    if (errors.success && errors.data.errors.length > 0)
        throw Error(
            `Rate My Professors returned an error: ${errors.data.errors[0]!.message}`,
        );
    return body;
}

async function fetchTeachersPage(
    schoolId: number,
    cursor: string,
): Promise<
    z.infer<typeof RmpTeachersResponse>["data"]["newSearch"]["teachers"]
> {
    const body = await postQuery(TEACHERS_QUERY, {
        count: PAGE_SIZE,
        cursor,
        query: {
            text: "",
            schoolID: Buffer.from(`School-${schoolId}`).toString("base64"),
            // otherwise we can get results from other schools
            fallback: false,
        },
    });
    return RmpTeachersResponse.parse(body).data.newSearch.teachers;
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

const REVIEW_PAGE_SIZE = 100;
// the most-reviewed instructors here have a few hundred reviews at most, so this
// is only a guard against requesting forever
const MAX_REVIEW_PAGES = 30;

const REVIEWS_QUERY = `
query TeacherReviews($id: ID!, $count: Int!, $cursor: String) {
    node(id: $id) {
        ... on Teacher {
            ratings(first: $count, after: $cursor) {
                pageInfo { hasNextPage endCursor }
                edges {
                    node {
                        legacyId
                        date
                        class
                        helpfulRating
                        clarityRating
                        difficultyRating
                        wouldTakeAgain
                    }
                }
            }
        }
    }
}`;

const RmpReview = z.object({
    legacyId: z.number(),
    date: z.string(),
    // typed in by whoever wrote the review, so this can be anything
    class: z.string().nullable(),
    helpfulRating: z.number().nullable(),
    clarityRating: z.number().nullable(),
    difficultyRating: z.number().nullable(),
    // this isn't documented anywhere, so we accept either 1/0 or true/false
    wouldTakeAgain: z
        .union([z.number(), z.boolean()])
        .nullable()
        .transform((v) => (v === null ? null : Boolean(v))),
});
export type RmpReview = z.infer<typeof RmpReview>;

const RmpReviewsResponse = z.object({
    data: z.object({
        // null if the instructor was removed since we got the list of them
        node: z
            .object({
                ratings: z.object({
                    pageInfo: z.object({
                        hasNextPage: z.boolean(),
                        endCursor: z.string().nullable(),
                    }),
                    edges: z.object({ node: RmpReview }).array(),
                }),
            })
            .nullable(),
    }),
});

/**
 * Fetches every review of a single instructor, or null if they no longer exist.
 * Only the scores and the class are kept, never what the review says.
 */
export async function fetchTeacherReviews(
    legacyId: number,
    delayMs: number = 1000,
): Promise<RmpReview[] | null> {
    const id = Buffer.from(`Teacher-${legacyId}`).toString("base64");
    const reviews: RmpReview[] = [];
    let cursor = "";
    for (let page = 0; page < MAX_REVIEW_PAGES; page++) {
        const body = await postQuery(REVIEWS_QUERY, {
            id,
            count: REVIEW_PAGE_SIZE,
            cursor,
        });
        await setTimeout(delayMs);

        const { node } = RmpReviewsResponse.parse(body).data;
        if (node === null) return null;
        for (const edge of node.ratings.edges) reviews.push(edge.node);

        const { hasNextPage, endCursor } = node.ratings.pageInfo;
        if (!hasNextPage || endCursor === null) break;
        cursor = endCursor;
    }
    return reviews;
}
