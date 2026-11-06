import { afterEach, describe, expect, jest, test } from "@jest/globals";
import * as APIv4 from "hyperschedule-shared/api/v4";
import { updateSections } from "../../src/db/models/course";
import {
    getAllCourseRatings,
    getAllInstructorRatings,
    updateInstructorRatings,
} from "../../src/db/models/instructor-rating";
import { refreshRatings } from "../../src/rmp-api/refresh";
import { setupDbHooks } from "../db/hooks";
import { testSectionV4 } from "../test-data";

setupDbHooks();

afterEach(() => {
    jest.restoreAllMocks();
});

const HMC = 400;
const TEACHER_ID = 11;

async function loadSection(): Promise<void> {
    await updateSections(
        [{ ...testSectionV4, instructors: [{ name: "Test Person" }] }],
        {
            term: testSectionV4.identifier.term,
            year: testSectionV4.identifier.year,
        },
    );
}

function teachersResponse(schoolId: number): Response {
    const edges =
        schoolId === HMC
            ? [
                  {
                      node: {
                          legacyId: TEACHER_ID,
                          firstName: "Test",
                          lastName: "Person",
                          avgRating: 4,
                          avgDifficulty: 3,
                          numRatings: 3,
                          wouldTakeAgainPercent: 50,
                          school: { legacyId: HMC },
                      },
                  },
              ]
            : [];
    return new Response(
        JSON.stringify({
            data: {
                newSearch: {
                    teachers: {
                        pageInfo: { hasNextPage: false, endCursor: null },
                        edges,
                    },
                },
            },
        }),
    );
}

function review(cls: string, helpful: number, clarity: number) {
    return {
        legacyId: 1,
        date: "2024-05-01 00:00:00 +0000 UTC",
        class: cls,
        helpfulRating: helpful,
        clarityRating: clarity,
        difficultyRating: 3,
        wouldTakeAgain: 1,
    };
}

function reviewsResponse(): Response {
    return new Response(
        JSON.stringify({
            data: {
                node: {
                    ratings: {
                        pageInfo: { hasNextPage: false, endCursor: null },
                        edges: [
                            review("CS131", 5, 5),
                            review("CS 131", 4, 4),
                            // counts for their overall score, but no course
                            review("SEVERAL", 2, 2),
                        ].map((node) => ({ node })),
                    },
                },
            },
        }),
    );
}

/**
 * no test in here is allowed to touch the real server, so every request goes
 * through this. `reviews` decides how review requests are answered
 */
function mockRmp(reviews: () => Response = reviewsResponse) {
    return jest.spyOn(globalThis, "fetch").mockImplementation((_, init) => {
        const { variables } = JSON.parse(init!.body as string);
        if (variables.query !== undefined) {
            const schoolId = Number(
                Buffer.from(variables.query.schoolID, "base64")
                    .toString()
                    .replace("School-", ""),
            );
            return Promise.resolve(teachersResponse(schoolId));
        }
        return Promise.resolve(reviews());
    });
}

const options = { delayMs: 0, retryDelayMs: 0 };

describe("refreshRatings", () => {
    test("saves instructor ratings with per-course scores", async () => {
        await loadSection();
        mockRmp();
        await refreshRatings(options);

        const course = APIv4.stringifyCourseCode(testSectionV4.identifier);
        expect(await getAllInstructorRatings()).toStrictEqual([
            {
                name: "Test Person",
                rmpId: TEACHER_ID,
                avgRating: 4,
                avgDifficulty: 3,
                numRatings: 3,
                wouldTakeAgainPercent: 50,
                classes: [
                    {
                        course,
                        avgRating: 4.5,
                        avgDifficulty: 3,
                        numRatings: 2,
                    },
                ],
            },
        ]);
        expect(await getAllCourseRatings()).toStrictEqual([
            {
                course,
                avgRating: 4.5,
                avgDifficulty: 3,
                numRatings: 2,
                numInstructors: 1,
            },
        ]);
    });

    test("doesn't contact Rate My Professors without any instructors", async () => {
        const fetch = mockRmp();
        await expect(refreshRatings(options)).rejects.toThrow();
        expect(fetch).not.toHaveBeenCalled();
    });

    test("keeps the old ratings if reviews keep failing", async () => {
        await loadSection();
        const old: APIv4.InstructorRating = {
            name: "Test Person",
            rmpId: TEACHER_ID,
            avgRating: 1,
            avgDifficulty: 1,
            numRatings: 1,
            wouldTakeAgainPercent: null,
            classes: [],
        };
        await updateInstructorRatings([old]);
        mockRmp(() => new Response("", { status: 503 }));

        await expect(refreshRatings(options)).rejects.toThrow("503");
        expect(await getAllInstructorRatings()).toStrictEqual([old]);
        expect(await getAllCourseRatings()).toStrictEqual([]);
    });
});
