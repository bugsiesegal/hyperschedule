import * as APIv4 from "hyperschedule-shared/api/v4";

export const enum SectionSort {
    Default = "default",
    RatingHighToLow = "rating-high-to-low",
    RatingLowToHigh = "rating-low-to-high",
}

export type InstructorRatings = Map<string, APIv4.InstructorRating>;
export type CourseRatings = Map<string, APIv4.CourseRating>;

/**
 * An instructor's reviews for the course of a section are mixed with this many
 * reviews at their overall score, so a single glowing review of one class
 * doesn't decide it. We checked this against 18,000 reviews of 5C instructors:
 * predicting a review this way was more accurate than using their overall score
 * alone, while mixing in what students thought of the course with other
 * instructors made it less accurate, so the course's own score isn't part of it.
 */
const CLASS_PRIOR_REVIEWS = 5;

export type InstructorScore = {
    avgRating: number;
    avgDifficulty: number;
    // how many of their reviews are for this course
    numClassRatings: number;
};

// in the format the backend stores course ratings with
export function sectionCourse(section: APIv4.Section): string {
    return APIv4.stringifyCourseCode(section.identifier);
}

export function computeInstructorScore(
    rating: APIv4.InstructorRating,
    course: string,
): InstructorScore {
    const inClass = rating.classes.find((c) => c.course === course);
    if (inClass === undefined)
        return {
            avgRating: rating.avgRating,
            avgDifficulty: rating.avgDifficulty,
            numClassRatings: 0,
        };
    const mix = (classScore: number, overall: number): number =>
        (classScore * inClass.numRatings + overall * CLASS_PRIOR_REVIEWS) /
        (inClass.numRatings + CLASS_PRIOR_REVIEWS);
    return {
        avgRating: mix(inClass.avgRating, rating.avgRating),
        avgDifficulty: mix(inClass.avgDifficulty, rating.avgDifficulty),
        numClassRatings: inClass.numRatings,
    };
}

export type SectionRating = {
    // the score for this section, see computeInstructorScore
    avgRating: number;
    avgDifficulty: number;
    // the instructors' overall score, no matter the course
    professorRating: number;
    // the total over every rated instructor
    numRatings: number;
    // how many of those are for this course
    numClassRatings: number;
    // null if none of the rated instructors have this
    wouldTakeAgainPercent: number | null;
};

/**
 * when sorting, every score is treated as if it also had this many reviews at
 * the average score. this way a perfect score from one review doesn't outrank a
 * 4.9 from eighty, and a bad score from one review doesn't sink below a 2.0 from
 * forty either, while scores with many reviews barely move. this only affects
 * the order, the score shown is always the actual one.
 */
const SORT_PRIOR_REVIEWS = 5;

function ratedInstructors(
    section: APIv4.Section,
    ratings: InstructorRatings,
): APIv4.InstructorRating[] {
    const rated: APIv4.InstructorRating[] = [];
    for (const instructor of section.instructors) {
        const rating = ratings.get(instructor.name.trim());
        if (rating !== undefined) rated.push(rating);
    }
    return rated;
}

/**
 * sections can have multiple instructors, so this averages all of the ones with
 * a rating. we don't weight this by the number of reviews because the score of a
 * section with one more-reviewed instructor would then mostly ignore the other
 * instructors.
 */
export function computeSectionRating(
    section: APIv4.Section,
    ratings: InstructorRatings,
): SectionRating | null {
    const rated = ratedInstructors(section, ratings);
    if (rated.length === 0) return null;
    const course = sectionCourse(section);
    let totalRating = 0;
    let totalDifficulty = 0;
    let totalProfessor = 0;
    let numRatings = 0;
    let numClassRatings = 0;
    let totalTakeAgain = 0;
    let numTakeAgain = 0;
    for (const rating of rated) {
        const score = computeInstructorScore(rating, course);
        totalRating += score.avgRating;
        totalDifficulty += score.avgDifficulty;
        totalProfessor += rating.avgRating;
        numRatings += rating.numRatings;
        numClassRatings += score.numClassRatings;
        if (rating.wouldTakeAgainPercent !== null) {
            totalTakeAgain += rating.wouldTakeAgainPercent;
            numTakeAgain++;
        }
    }
    return {
        avgRating: totalRating / rated.length,
        avgDifficulty: totalDifficulty / rated.length,
        professorRating: totalProfessor / rated.length,
        numRatings,
        numClassRatings,
        wouldTakeAgainPercent:
            numTakeAgain === 0 ? null : totalTakeAgain / numTakeAgain,
    };
}

// the average of every single review, which is what scores are pulled toward
function averageReview(ratings: InstructorRatings): number {
    let total = 0;
    let count = 0;
    for (const rating of ratings.values()) {
        total += rating.avgRating * rating.numRatings;
        count += rating.numRatings;
    }
    return total / count;
}

/**
 * like computeSectionRating, except each instructor's score is weighted on its
 * own before averaging. otherwise an instructor with one review could borrow the
 * confidence of a co-instructor with many.
 */
function sortScore(
    section: APIv4.Section,
    ratings: InstructorRatings,
    average: number,
): { score: number; numRatings: number } | null {
    const rated = ratedInstructors(section, ratings);
    if (rated.length === 0) return null;
    const course = sectionCourse(section);
    let total = 0;
    let numRatings = 0;
    for (const rating of rated) {
        total +=
            (computeInstructorScore(rating, course).avgRating *
                rating.numRatings +
                average * SORT_PRIOR_REVIEWS) /
            (rating.numRatings + SORT_PRIOR_REVIEWS);
        numRatings += rating.numRatings;
    }
    return { score: total / rated.length, numRatings };
}

/**
 * sorts by score, weighted by the number of reviews (see SORT_PRIOR_REVIEWS).
 * sections without a rating always go last no matter the direction, since we
 * know nothing about them. sections that tie keep their relative order, which
 * means that search results stay in order of relevance.
 */
export function sortSections(
    sections: APIv4.Section[],
    sort: SectionSort,
    ratings: InstructorRatings | undefined,
): APIv4.Section[] {
    if (
        sort === SectionSort.Default ||
        ratings === undefined ||
        ratings.size === 0
    )
        return sections;

    const average = averageReview(ratings);
    const direction = sort === SectionSort.RatingHighToLow ? -1 : 1;
    return sections
        .map((section) => ({
            section,
            key: sortScore(section, ratings, average),
        }))
        .sort((a, b) => {
            if (a.key === null) return b.key === null ? 0 : 1;
            if (b.key === null) return -1;
            if (a.key.score !== b.key.score)
                return direction * (a.key.score - b.key.score);
            return b.key.numRatings - a.key.numRatings;
        })
        .map(({ section }) => section);
}

export function rmpProfessorUrl(rating: APIv4.InstructorRating): string {
    return `https://www.ratemyprofessors.com/professor/${rating.rmpId}`;
}
