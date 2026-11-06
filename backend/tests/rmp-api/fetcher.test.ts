import { describe, test, expect, jest, afterEach } from "@jest/globals";
import {
    fetchAllTeachers,
    fetchTeacherReviews,
} from "../../src/rmp-api/fetcher";

const SCHOOL_IDS = [400, 774, 889, 234, 768, 233];

type Page = {
    hasNextPage: boolean;
    endCursor: string | null;
    schoolId?: number;
    legacyIds: number[];
};

function pageResponse(schoolId: number, page: Page): Response {
    return new Response(
        JSON.stringify({
            data: {
                newSearch: {
                    teachers: {
                        pageInfo: {
                            hasNextPage: page.hasNextPage,
                            endCursor: page.endCursor,
                        },
                        edges: page.legacyIds.map((legacyId) => ({
                            node: {
                                legacyId,
                                firstName: "Test",
                                lastName: `Person${legacyId}`,
                                avgRating: 4,
                                avgDifficulty: 3,
                                numRatings: 5,
                                wouldTakeAgainPercent: -1,
                                school: {
                                    legacyId: page.schoolId ?? schoolId,
                                },
                            },
                        })),
                    },
                },
            },
        }),
    );
}

type Request = { schoolId: number; cursor: string };

/**
 * no test in here is allowed to touch the real server, so everything goes
 * through this, and `respond` gets to decide what each request gets
 */
function mockFetch(respond: (request: Request) => Response): {
    requests: Request[];
} {
    const requests: Request[] = [];
    jest.spyOn(globalThis, "fetch").mockImplementation((_, init) => {
        const { variables } = JSON.parse(init!.body as string);
        const schoolId = Number(
            Buffer.from(variables.query.schoolID, "base64")
                .toString()
                .replace("School-", ""),
        );
        const request = { schoolId, cursor: variables.cursor };
        requests.push(request);
        return Promise.resolve(respond(request));
    });
    return { requests };
}

afterEach(() => {
    jest.restoreAllMocks();
});

describe("src/rmp-api/fetcher.ts", () => {
    test("requests every school once and combines the results", async () => {
        const { requests } = mockFetch(({ schoolId }) =>
            pageResponse(schoolId, {
                hasNextPage: false,
                endCursor: null,
                legacyIds: [schoolId],
            }),
        );
        const teachers = await fetchAllTeachers(0);
        expect(requests.map((r) => r.schoolId)).toStrictEqual(SCHOOL_IDS);
        expect(teachers.map((t) => t.legacyId)).toStrictEqual(SCHOOL_IDS);
    });

    test("follows the cursor through every page", async () => {
        const { requests } = mockFetch(({ schoolId, cursor }) => {
            if (schoolId === 400 && cursor === "")
                return pageResponse(schoolId, {
                    hasNextPage: true,
                    endCursor: "next",
                    legacyIds: [1],
                });
            if (schoolId === 400 && cursor === "next")
                return pageResponse(schoolId, {
                    hasNextPage: false,
                    endCursor: "next",
                    legacyIds: [2],
                });
            return pageResponse(schoolId, {
                hasNextPage: false,
                endCursor: null,
                legacyIds: [],
            });
        });
        const teachers = await fetchAllTeachers(0);
        expect(requests.slice(0, 2)).toStrictEqual([
            { schoolId: 400, cursor: "" },
            { schoolId: 400, cursor: "next" },
        ]);
        expect(teachers.map((t) => t.legacyId)).toStrictEqual([1, 2]);
    });

    test("stops eventually if there is always a next page", async () => {
        const { requests } = mockFetch(({ schoolId }) =>
            pageResponse(schoolId, {
                hasNextPage: true,
                endCursor: "same",
                legacyIds: [],
            }),
        );
        await fetchAllTeachers(0);
        expect(requests.length).toBeLessThanOrEqual(20 * SCHOOL_IDS.length);
    });

    test("drops teachers from a school that we didn't ask for", async () => {
        mockFetch(({ schoolId }) =>
            pageResponse(schoolId, {
                hasNextPage: false,
                endCursor: null,
                schoolId: 99999,
                legacyIds: [1, 2, 3],
            }),
        );
        expect(await fetchAllTeachers(0)).toStrictEqual([]);
    });

    test("fails entirely if a single school fails", async () => {
        mockFetch(({ schoolId }) =>
            schoolId === 889
                ? new Response("nope", { status: 403 })
                : pageResponse(schoolId, {
                      hasNextPage: false,
                      endCursor: null,
                      legacyIds: [1],
                  }),
        );
        await expect(fetchAllTeachers(0)).rejects.toThrow("403");
    });

    test("fails on a response in an unexpected shape", async () => {
        mockFetch(() => new Response(JSON.stringify({ data: {} })));
        await expect(fetchAllTeachers(0)).rejects.toThrow();
    });

    test("passes on the message of a GraphQL error", async () => {
        mockFetch(
            () =>
                new Response(JSON.stringify({ errors: [{ message: "nope" }] })),
        );
        await expect(fetchAllTeachers(0)).rejects.toThrow(
            "Rate My Professors returned an error: nope",
        );
    });
});

type ReviewRequest = { teacher: string; cursor: string; count: number };

function review(legacyId: number, wouldTakeAgain: unknown = 1) {
    return {
        legacyId,
        date: "2024-05-01 00:00:00 +0000 UTC",
        class: "TEST101",
        helpfulRating: 4,
        clarityRating: 5,
        difficultyRating: 3,
        wouldTakeAgain,
    };
}

function reviewsResponse(
    reviews: unknown[] | null,
    next: string | null = null,
): Response {
    return new Response(
        JSON.stringify({
            data: {
                node:
                    reviews === null
                        ? null
                        : {
                              ratings: {
                                  pageInfo: {
                                      hasNextPage: next !== null,
                                      endCursor: next,
                                  },
                                  edges: reviews.map((node) => ({ node })),
                              },
                          },
            },
        }),
    );
}

function mockReviewFetch(respond: (request: ReviewRequest) => Response): {
    requests: ReviewRequest[];
} {
    const requests: ReviewRequest[] = [];
    jest.spyOn(globalThis, "fetch").mockImplementation((_, init) => {
        const { variables } = JSON.parse(init!.body as string);
        const request = {
            teacher: Buffer.from(variables.id, "base64").toString(),
            cursor: variables.cursor,
            count: variables.count,
        };
        requests.push(request);
        return Promise.resolve(respond(request));
    });
    return { requests };
}

describe("fetchTeacherReviews", () => {
    test("asks for the right instructor and follows every page", async () => {
        const { requests } = mockReviewFetch(({ cursor }) =>
            cursor === ""
                ? reviewsResponse([review(1), review(2)], "next")
                : reviewsResponse([review(3)]),
        );
        const reviews = await fetchTeacherReviews(1234, 0);
        expect(requests.map((r) => [r.teacher, r.cursor])).toStrictEqual([
            ["Teacher-1234", ""],
            ["Teacher-1234", "next"],
        ]);
        expect(reviews!.map((r) => r.legacyId)).toStrictEqual([1, 2, 3]);
    });

    test("reads would take again as yes, no or unanswered", async () => {
        mockReviewFetch(() =>
            reviewsResponse([
                review(1, 1),
                review(2, 0),
                review(3, null),
                review(4, true),
            ]),
        );
        const reviews = await fetchTeacherReviews(1, 0);
        expect(reviews!.map((r) => r.wouldTakeAgain)).toStrictEqual([
            true,
            false,
            null,
            true,
        ]);
    });

    test("returns null for an instructor that no longer exists", async () => {
        mockReviewFetch(() => reviewsResponse(null));
        expect(await fetchTeacherReviews(1, 0)).toBeNull();
    });

    test("stops eventually if there is always a next page", async () => {
        const { requests } = mockReviewFetch(() => reviewsResponse([], "same"));
        await fetchTeacherReviews(1, 0);
        expect(requests.length).toBeLessThanOrEqual(30);
    });

    test("fails on a bad status or a GraphQL error", async () => {
        mockReviewFetch(() => new Response("nope", { status: 429 }));
        await expect(fetchTeacherReviews(1, 0)).rejects.toThrow("429");

        jest.restoreAllMocks();
        mockReviewFetch(
            () =>
                new Response(
                    JSON.stringify({
                        errors: [{ message: 'Cannot query field "x"' }],
                    }),
                ),
        );
        await expect(fetchTeacherReviews(1, 0)).rejects.toThrow(
            'Cannot query field "x"',
        );
    });
});
