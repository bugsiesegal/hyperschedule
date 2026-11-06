import { describe, expect, test } from "@jest/globals";
import type * as APIv4 from "hyperschedule-shared/api/v4";
import { updateSections } from "../../src/db/models/course";
import {
    getAllCourseRatings,
    getAllInstructorNames,
    getAllInstructorRatings,
    getCoursesByInstructor,
    updateCourseRatings,
    updateInstructorRatings,
} from "../../src/db/models/instructor-rating";
import { collections } from "../../src/db/collections";
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
    classes: [
        {
            course: "CSCI 131 HM",
            avgRating: 4,
            avgDifficulty: 3.5,
            numRatings: 4,
        },
    ],
};
const ratingB: APIv4.InstructorRating = {
    name: "Other Person",
    rmpId: 2,
    avgRating: 2,
    avgDifficulty: 4.5,
    numRatings: 1,
    wouldTakeAgainPercent: null,
    classes: [],
};
const courseRating: APIv4.CourseRating = {
    course: "CSCI 131 HM",
    avgRating: 3.75,
    avgDifficulty: 3.25,
    numRatings: 8,
    numInstructors: 2,
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

    test("ratings saved before class scores existed have no classes", async () => {
        const { name, classes: _classes, ...old } = ratingA;
        await collections.instructorRatings.insertOne({ _id: name, ...old });
        expect(await getAllInstructorRatings()).toStrictEqual([
            { ...ratingA, classes: [] },
        ]);
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

    test("course ratings can be stored, replaced, but not wiped", async () => {
        await updateCourseRatings([courseRating]);
        expect(await getAllCourseRatings()).toStrictEqual([courseRating]);

        const other = { ...courseRating, course: "MATH 019 HM" };
        await updateCourseRatings([other]);
        expect(await getAllCourseRatings()).toStrictEqual([other]);

        await expect(updateCourseRatings([])).rejects.toThrow();
        expect(await getAllCourseRatings()).toStrictEqual([other]);
    });

    test("getCoursesByInstructor() lists each course once per instructor", async () => {
        const term = {
            term: testSectionV4.identifier.term,
            year: testSectionV4.identifier.year,
        };
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
                {
                    ...testSectionV4,
                    identifier: {
                        ...testSectionV4.identifier,
                        courseNumber: 70,
                    },
                    // extra whitespace in the name, which happens in the real data
                    instructors: [
                        { name: ` ${testSectionV4.instructors[0]!.name} ` },
                    ],
                },
            ],
            term,
        );
        const courses = await getCoursesByInstructor();
        const first = testSectionV4.instructors[0]!.name.trim();
        const sorted = (cs: APIv4.CourseCode[]) =>
            cs.map((c) => `${c.department} ${c.courseNumber}`).sort();
        expect(sorted(courses.get(first)!)).toStrictEqual([
            "CSCI 131",
            "CSCI 70",
        ]);
    });
});
