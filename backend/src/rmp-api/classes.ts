import * as APIv4 from "hyperschedule-shared/api/v4";
import type { RmpReview } from "./fetcher";

/**
 * Every review on Rate My Professors says which class it's for, but that's typed
 * in by whoever wrote it, so we get things like "CS70", "csci 070", "PSYCH 51",
 * "E79" and "Core II". This works out which course a review is for by only
 * considering courses that its instructor has actually taught, which is what
 * makes it safe to be loose about how the department is written.
 */

export type ClassTag = {
    letters: string;
    number: number;
    suffix: string;
};

const ROMAN_NUMERALS: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4 };

export function parseClassTag(tag: string | null): ClassTag | null {
    const text = (tag ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

    const match = text.match(/^([A-Z]+)(\d+)([A-Z]*)$/);
    if (match !== null)
        return {
            letters: match[1]!,
            number: parseInt(match[2]!, 10),
            suffix: match[3]!,
        };

    // mostly for "Core I", "Core II" and "Core III" at Scripps
    const roman = text.match(/^([A-Z]{2,}?)(IV|I{1,3})$/);
    if (roman !== null)
        return {
            letters: roman[1]!,
            number: ROMAN_NUMERALS[roman[2]!]!,
            suffix: "",
        };

    return null;
}

// "CS" for CSCI, "PSYCH" for PSYC, "GOV" for GOVT, "E" for ENGR and so on
function departmentMatches(department: string, letters: string): boolean {
    return department.startsWith(letters) || letters.startsWith(department);
}

/**
 * Picks the course a tag refers to out of the ones the instructor has taught, or
 * null if there isn't exactly one that fits. `school` is the instructor's school
 * on Rate My Professors, which breaks ties between campuses.
 */
export function matchClassTag(
    tag: ClassTag,
    taught: readonly APIv4.CourseCode[],
    school: APIv4.School | undefined,
): APIv4.CourseCode | null {
    let candidates = taught.filter(
        (c) =>
            c.courseNumber === tag.number &&
            departmentMatches(c.department, tag.letters),
    );
    const sameSuffix = candidates.filter((c) => c.suffix === tag.suffix);
    if (sameSuffix.length > 0) candidates = sameSuffix;
    // e.g. "MATH30G" when only MATH 030 exists, but never a lab for a lecture
    else if (tag.suffix !== "")
        candidates = candidates.filter((c) => c.suffix === "");

    let distinct = [
        ...new Map(
            candidates.map((c) => [APIv4.stringifyCourseCode(c), c]),
        ).values(),
    ];
    if (distinct.length > 1)
        distinct = distinct.filter((c) => c.affiliation === school);
    return distinct.length === 1 ? distinct[0]! : null;
}

export type ReviewedInstructor = {
    // the instructor's name in our data
    name: string;
    // their school on Rate My Professors
    school: APIv4.School | undefined;
    reviews: readonly RmpReview[];
};

type Totals = {
    rating: number;
    difficulty: number;
    count: number;
};

function add(
    totals: Map<string, Totals>,
    key: string,
    review: RmpReview,
): void {
    const t = totals.get(key) ?? { rating: 0, difficulty: 0, count: 0 };
    // this is how Rate My Professors computes the overall score of a review
    t.rating += (review.helpfulRating! + review.clarityRating!) / 2;
    t.difficulty += review.difficultyRating!;
    t.count++;
    totals.set(key, t);
}

/**
 * Averages reviews by course, both for each instructor and over everyone who has
 * taught the course. Reviews that we can't tie to a course are left out here,
 * but they still count towards the instructor's overall score.
 */
export function computeClassRatings(
    instructors: readonly ReviewedInstructor[],
    taughtBy: ReadonlyMap<string, readonly APIv4.CourseCode[]>,
): {
    classes: Map<string, APIv4.InstructorClassRating[]>;
    courses: APIv4.CourseRating[];
} {
    const perInstructor = new Map<string, Map<string, Totals>>();
    const perCourse = new Map<string, Totals>();
    const instructorsPerCourse = new Map<string, Set<string>>();

    for (const instructor of instructors) {
        const taught = taughtBy.get(instructor.name) ?? [];
        if (taught.length === 0) continue;
        const totals = new Map<string, Totals>();
        for (const review of instructor.reviews) {
            if (
                review.helpfulRating === null ||
                review.clarityRating === null ||
                review.difficultyRating === null
            )
                continue;
            const tag = parseClassTag(review.class);
            if (tag === null) continue;
            const code = matchClassTag(tag, taught, instructor.school);
            if (code === null) continue;

            const course = APIv4.stringifyCourseCode(code);
            add(totals, course, review);
            add(perCourse, course, review);
            const names = instructorsPerCourse.get(course) ?? new Set();
            names.add(instructor.name);
            instructorsPerCourse.set(course, names);
        }
        perInstructor.set(instructor.name, totals);
    }

    const toRating = (
        course: string,
        t: Totals,
    ): APIv4.InstructorClassRating => ({
        course,
        avgRating: t.rating / t.count,
        avgDifficulty: t.difficulty / t.count,
        numRatings: t.count,
    });
    return {
        classes: new Map(
            [...perInstructor].map(([name, totals]) => [
                name,
                [...totals].map(([course, t]) => toRating(course, t)),
            ]),
        ),
        courses: [...perCourse].map(([course, t]) => ({
            ...toRating(course, t),
            numInstructors: instructorsPerCourse.get(course)!.size,
        })),
    };
}
