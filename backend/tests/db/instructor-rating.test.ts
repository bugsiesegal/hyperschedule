import { describe, expect, test } from "@jest/globals";
import type * as APIv4 from "hyperschedule-shared/api/v4";
import { updateSections } from "../../src/db/models/course";
import {
    getAllInstructorNames,
    getAllInstructorRatings,
    updateInstructorRatings,
} from "../../src/db/models/instructor-rating";
import { setupDbHooks } from "./hooks";
import { testSectionV4 } from "../test-data";

setupDbHooks();

const ratingA: APIv4.InstructorRating = {
    name: "Test Person",
    rmpId: 1,
    avgRating: 4.5,
    avgDifficulty: 3,
    numRatings: 10,
    wouldTakeAgainPercent: 80,
};
const ratingB: APIv4.InstructorRating = {
    name: "Other Person",
    rmpId: 2,
    avgRating: 2,
    avgDifficulty: 4.5,
    numRatings: 1,
    wouldTakeAgainPercent: null,
};

describe("db/models/instructor-rating", () => {
    test("Basic insertion and query", async () => {
        await updateInstructorRatings([ratingA, ratingB]);
        expect(await getAllInstructorRatings()).toStrictEqual([
            ratingA,
            ratingB,
        ]);
    });

    test("updateInstructorRatings() replaces everything", async () => {
        await updateInstructorRatings([ratingA, ratingB]);
        const updated = { ...ratingA, avgRating: 1, numRatings: 11 };
        await updateInstructorRatings([updated]);
        expect(await getAllInstructorRatings()).toStrictEqual([updated]);
    });

    test("updateInstructorRatings() keeps ratings if there are no new ones", async () => {
        await updateInstructorRatings([ratingA]);
        await expect(updateInstructorRatings([])).rejects.toThrow();
        expect(await getAllInstructorRatings()).toStrictEqual([ratingA]);
    });

    test("getAllInstructorNames() returns each instructor once", async () => {
        await updateSections(
            [
                testSectionV4,
                {
                    ...testSectionV4,
                    identifier: {
                        ...testSectionV4.identifier,
                        sectionNumber: 2,
                    },
                },
            ],
            {
                term: testSectionV4.identifier.term,
                year: testSectionV4.identifier.year,
            },
        );
        const names = await getAllInstructorNames();
        expect(names.sort()).toStrictEqual(
            testSectionV4.instructors.map((i) => i.name).sort(),
        );
    });
});
