import { describe, expect, test } from "@jest/globals";
import * as APIv4 from "hyperschedule-shared/api/v4";
import {
    computeClassRatings,
    matchClassTag,
    parseClassTag,
} from "../../src/rmp-api/classes";
import type { RmpReview } from "../../src/rmp-api/fetcher";

const course = (code: string): APIv4.CourseCode => APIv4.parseCourseCode(code);

function review(cls: string | null, helpful = 4, clarity = 5, difficulty = 3) {
    return {
        legacyId: 1,
        date: "2024-05-01 00:00:00 +0000 UTC",
        class: cls,
        helpfulRating: helpful,
        clarityRating: clarity,
        difficultyRating: difficulty,
        wouldTakeAgain: null,
    } satisfies RmpReview;
}

describe("parseClassTag", () => {
    test.each([
        ["CS70", { letters: "CS", number: 70, suffix: "" }],
        ["csci 070", { letters: "CSCI", number: 70, suffix: "" }],
        ["PSYCH-51", { letters: "PSYCH", number: 51, suffix: "" }],
        ["CHEM51L", { letters: "CHEM", number: 51, suffix: "L" }],
        ["E79", { letters: "E", number: 79, suffix: "" }],
        ["Core II", { letters: "CORE", number: 2, suffix: "" }],
        ["COREIII", { letters: "CORE", number: 3, suffix: "" }],
    ])("%s", (tag, expected) => {
        expect(parseClassTag(tag)).toStrictEqual(expected);
    });

    test.each([["INTROPSYC"], ["SEVERAL"], ["123"], [""], [null]])(
        "%s isn't a class",
        (tag) => {
            expect(parseClassTag(tag)).toBeNull();
        },
    );
});

describe("matchClassTag", () => {
    const taught = [
        course("CSCI 005 HM"),
        course("CSCI 070 HM"),
        course("ENGR 079 HM"),
        course("CHEM 051 HM"),
        course("CHEM 051L HM"),
        course("MATH 030 HM"),
    ];
    const match = (tag: string, school = APIv4.School.HMC) => {
        const code = matchClassTag(parseClassTag(tag)!, taught, school);
        return code === null ? null : APIv4.stringifyCourseCode(code);
    };

    test("allows a shortened or longer department", () => {
        expect(match("CS70")).toBe("CSCI 070 HM");
        expect(match("CSCI070")).toBe("CSCI 070 HM");
        expect(match("E79")).toBe("ENGR 079 HM");
    });

    test("needs the number to be a course they taught", () => {
        expect(match("CS81")).toBeNull();
    });

    test("needs the department to fit", () => {
        expect(match("MATH70")).toBeNull();
    });

    test("tells a lecture and its lab apart", () => {
        expect(match("CHEM51")).toBe("CHEM 051 HM");
        expect(match("CHEM51L")).toBe("CHEM 051L HM");
    });

    test("ignores a suffix that no course has, but never picks a lab", () => {
        expect(match("MATH30G")).toBe("MATH 030 HM");
        expect(
            matchClassTag(
                parseClassTag("CHEM51X")!,
                [course("CHEM 051L HM")],
                APIv4.School.HMC,
            ),
        ).toBeNull();
    });

    test("uses their school to choose between campuses, else gives up", () => {
        const both = [course("MATH 060 HM"), course("MATH 060 PO")];
        const pick = (school: APIv4.School | undefined) =>
            matchClassTag(parseClassTag("MATH60")!, both, school);
        expect(pick(APIv4.School.POM)).toStrictEqual(course("MATH 060 PO"));
        expect(pick(APIv4.School.SCR)).toBeNull();
        expect(pick(undefined)).toBeNull();
    });
});

describe("computeClassRatings", () => {
    const taughtBy = new Map([
        ["Test Person", [course("CSCI 070 HM"), course("CSCI 005 HM")]],
        ["Other Person", [course("CSCI 070 HM")]],
    ]);

    test("averages reviews per instructor and per course", () => {
        const { classes, courses } = computeClassRatings(
            [
                {
                    name: "Test Person",
                    school: APIv4.School.HMC,
                    reviews: [
                        review("CS70", 4, 4, 2),
                        review("cs 70", 5, 5, 4),
                        review("CS5", 2, 2, 1),
                        // these still count for their overall score, but not here
                        review("SEVERAL"),
                        review("CS999"),
                    ],
                },
                {
                    name: "Other Person",
                    school: APIv4.School.HMC,
                    reviews: [review("CSCI070", 1, 1, 5)],
                },
            ],
            taughtBy,
        );
        expect(classes.get("Test Person")).toStrictEqual([
            {
                course: "CSCI 070 HM",
                avgRating: 4.5,
                avgDifficulty: 3,
                numRatings: 2,
            },
            {
                course: "CSCI 005 HM",
                avgRating: 2,
                avgDifficulty: 1,
                numRatings: 1,
            },
        ]);
        expect(courses).toContainEqual({
            course: "CSCI 070 HM",
            avgRating: (4 + 5 + 1) / 3,
            avgDifficulty: (2 + 4 + 5) / 3,
            numRatings: 3,
            numInstructors: 2,
        });
    });

    test("skips instructors with no known courses and incomplete reviews", () => {
        const { classes, courses } = computeClassRatings(
            [
                {
                    name: "Unknown Person",
                    school: APIv4.School.HMC,
                    reviews: [review("CS70")],
                },
                {
                    name: "Other Person",
                    school: APIv4.School.HMC,
                    reviews: [{ ...review("CS70"), difficultyRating: null }],
                },
            ],
            taughtBy,
        );
        expect(classes.has("Unknown Person")).toBe(false);
        expect(classes.get("Other Person")).toStrictEqual([]);
        expect(courses).toStrictEqual([]);
    });
});
