import { describe, test, expect, jest, afterEach } from "@jest/globals";
import { fetchAllTeachers } from "../../src/rmp-api/fetcher";

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
        mockFetch(
            () =>
                new Response(JSON.stringify({ errors: [{ message: "nope" }] })),
        );
        await expect(fetchAllTeachers(0)).rejects.toThrow();
    });
});
