import type * as APIv4 from "hyperschedule-shared/api/v4";
import type { RmpTeacher } from "./fetcher";

type ParsedName = {
    first: string;
    middle: string[];
    last: string;
};

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

/**
 * Returns null for anything that isn't at least a first and last name, such as
 * the "Staff" placeholder from the school database.
 */
function parseName(name: string): ParsedName | null {
    const tokens = name
        .normalize("NFD")
        .replace(/\p{M}/gu, "") // accents
        .toLocaleLowerCase()
        .replace(/['’.]/g, "")
        .split(/[^\p{L}\p{N}]+/u)
        .filter((token) => token !== "");

    if (NAME_SUFFIXES.has(tokens.at(-1) ?? "")) tokens.pop();
    if (tokens.length < 2) return null;

    return {
        first: tokens[0]!,
        middle: tokens.slice(1, -1),
        last: tokens.at(-1)!,
    };
}

/**
 * Middle names are often only present on one side, but if both sides have them
 * and they are different then these are probably two different people.
 */
function middleNamesAgree(a: string[], b: string[]): boolean {
    if (a.length === 0 || b.length === 0) return true;
    return a.join(" ") === b.join(" ");
}

/**
 * Finds the Rate My Professors entry for each instructor name. We would much
 * rather show no score than show someone else's score, so names have to agree
 * exactly other than accents, punctuation, and missing middle names. This means
 * that we will miss some instructors, such as those who go by a nickname on only
 * one of the sites.
 *
 * It's common for someone to have multiple entries, for example from teaching on
 * more than one campus, in which case we use the entry with the most reviews.
 */
// a rating from a name match alone, which doesn't know about classes yet
export type MatchedRating = Omit<APIv4.InstructorRating, "classes">;

export function matchInstructors(
    names: string[],
    teachers: RmpTeacher[],
): MatchedRating[] {
    const index = new Map<
        string,
        { middle: string[]; teacher: RmpTeacher }[]
    >();
    for (const teacher of teachers) {
        if (teacher.numRatings === 0) continue;
        const parsed = parseName(`${teacher.firstName} ${teacher.lastName}`);
        if (parsed === null) continue;

        const key = `${parsed.first} ${parsed.last}`;
        const entry = { middle: parsed.middle, teacher };
        const existing = index.get(key);
        if (existing === undefined) index.set(key, [entry]);
        else existing.push(entry);
    }

    const ratings: MatchedRating[] = [];
    for (const name of new Set(names.map((n) => n.trim()))) {
        const parsed = parseName(name);
        if (parsed === null) continue;

        let best: RmpTeacher | null = null;
        for (const candidate of index.get(`${parsed.first} ${parsed.last}`) ??
            []) {
            if (!middleNamesAgree(parsed.middle, candidate.middle)) continue;
            if (best === null || candidate.teacher.numRatings > best.numRatings)
                best = candidate.teacher;
        }
        if (best === null) continue;

        const { wouldTakeAgainPercent } = best;
        ratings.push({
            name,
            rmpId: best.legacyId,
            avgRating: best.avgRating,
            avgDifficulty: best.avgDifficulty,
            numRatings: best.numRatings,
            // reported as -1 if none of the reviews answered this question
            wouldTakeAgainPercent:
                wouldTakeAgainPercent === null || wouldTakeAgainPercent < 0
                    ? null
                    : wouldTakeAgainPercent,
        });
    }
    return ratings;
}
