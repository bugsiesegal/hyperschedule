import { describe, test, expect } from "@jest/globals";
import type { RmpTeacher } from "../../src/rmp-api/fetcher";
import { matchInstructors } from "../../src/rmp-api/matcher";

function teacher(
    firstName: string,
    lastName: string,
    overrides: Partial<RmpTeacher> = {},
): RmpTeacher {
    return {
        legacyId: 1,
        firstName,
        lastName,
        avgRating: 4.5,
        avgDifficulty: 3,
        numRatings: 10,
        wouldTakeAgainPercent: 80,
        school: { legacyId: 400 },
        ...overrides,
    };
}

function matchedNames(names: string[], teachers: RmpTeacher[]): string[] {
    return matchInstructors(names, teachers).map((r) => r.name);
}

describe("src/rmp-api/matcher.ts", () => {
    test("converts a matching teacher into a rating", () => {
        expect(
            matchInstructors(
                ["Test Person"],
                [teacher("Test", "Person", { legacyId: 123 })],
            ),
        ).toStrictEqual([
            {
                name: "Test Person",
                rmpId: 123,
                avgRating: 4.5,
                avgDifficulty: 3,
                numRatings: 10,
                wouldTakeAgainPercent: 80,
            },
        ]);
    });

    test("ignores case, accents, and punctuation", () => {
        const teachers = [
            teacher("André", "O'Test"),
            teacher("Ann-Marie", "Example"),
        ];
        expect(
            matchedNames(["ANDRE OTEST", "Ann Marie Example"], teachers),
        ).toStrictEqual(["ANDRE OTEST", "Ann Marie Example"]);
    });

    test("ignores name suffixes and surrounding whitespace", () => {
        expect(
            matchedNames(["  Test Person Jr.  "], [teacher("Test", "Person")]),
        ).toStrictEqual(["Test Person Jr."]);
    });

    test("allows a middle name on only one side", () => {
        expect(
            matchedNames(["Test Middle Person"], [teacher("Test", "Person")]),
        ).toStrictEqual(["Test Middle Person"]);
        expect(
            matchedNames(["Test Person"], [teacher("Test Middle", "Person")]),
        ).toStrictEqual(["Test Person"]);
    });

    test("does not match different middle names", () => {
        expect(
            matchedNames(
                ["Test Alpha Person"],
                [teacher("Test Beta", "Person")],
            ),
        ).toStrictEqual([]);
    });

    test("does not match similar names", () => {
        const teachers = [teacher("Test", "Person")];
        for (const name of [
            "Tes Person",
            "Testing Person",
            "T Person",
            "Test Persons",
            "Other Person",
            "Test Other",
        ]) {
            expect(matchedNames([name], teachers)).toStrictEqual([]);
        }
    });

    test("does not match anything that isn't a full name", () => {
        const teachers = [teacher("Staff", "Staff"), teacher("", "Staff")];
        for (const name of ["Staff", "", "   ", "Jr."]) {
            expect(matchedNames([name], teachers)).toStrictEqual([]);
        }
    });

    test("does not use teachers without any reviews", () => {
        expect(
            matchedNames(
                ["Test Person"],
                [teacher("Test", "Person", { numRatings: 0, avgRating: 0 })],
            ),
        ).toStrictEqual([]);
    });

    test("uses the entry with the most reviews for duplicates", () => {
        const [rating] = matchInstructors(
            ["Test Person"],
            [
                teacher("Test", "Person", { legacyId: 1, numRatings: 2 }),
                teacher("Test", "Person", { legacyId: 2, numRatings: 30 }),
                teacher("Test", "Person", { legacyId: 3, numRatings: 4 }),
            ],
        );
        expect(rating!.rmpId).toStrictEqual(2);
    });

    test("only returns one rating per name", () => {
        expect(
            matchedNames(
                ["Test Person", "Test Person "],
                [teacher("Test", "Person")],
            ),
        ).toStrictEqual(["Test Person"]);
    });

    test("treats a negative would take again percent as missing", () => {
        const [rating] = matchInstructors(
            ["Test Person"],
            [teacher("Test", "Person", { wouldTakeAgainPercent: -1 })],
        );
        expect(rating!.wouldTakeAgainPercent).toBeNull();

        const [zero] = matchInstructors(
            ["Test Person"],
            [teacher("Test", "Person", { wouldTakeAgainPercent: 0 })],
        );
        expect(zero!.wouldTakeAgainPercent).toStrictEqual(0);
    });
});
