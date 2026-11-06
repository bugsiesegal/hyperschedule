import * as APIv4 from "hyperschedule-shared/api/v4";
import {
    useCourseAreaDescription,
    useCourseRatings,
    useInstructorRatings,
} from "@hooks/api/query";
import { useOfferingHistoryLookup } from "@hooks/history";

import { formatTime12 } from "@lib/time";
import { memo } from "react";
import Css from "./CourseDescriptionBox.module.css";
import * as Feather from "react-feather";
import { combineLocations } from "@lib/schedule";
import { computeNonMuddCredits, computeMuddCredits } from "@lib/credits";
import {
    computeSectionRating,
    rmpProfessorUrl,
    sectionCourse,
    type SectionRating,
} from "@lib/rating";
import SectionStatusBadge from "@components/common/SectionStatusBadge";
import { useState } from "react";
import { useAllTerms } from "@hooks/term";
import { CURRENT_TERM } from "hyperschedule-shared/api/current-term";

// certain course descriptions contain links, such as PE 095B
const linkHtmlMatcher = /<a +href="?([A-Za-z0-9:\/.%_-]+)"?.*>(.*)<\/a>/;

function processDescription(description: string): React.JSX.Element {
    const match = linkHtmlMatcher.exec(description);

    if (match !== null) {
        const start = match.index;
        const end = start + match[0].length;
        const before = description.slice(0, start);
        const after = description.slice(end);
        return (
            <>
                {before}
                <a href={match[1]} target="_blank">
                    {match[2]} <Feather.ExternalLink size={"1em"} />
                </a>
                {after}
            </>
        );
    } else {
        return <>{description}</>;
    }
}

const campusCss = [
    // this is ordered by the year the school is established
    Css.pom,
    Css.scr,
    Css.cmc,
    Css.hmc,
    Css.ptz,
];

// 3 years if offered every semester
const HISTORY_ENTRY_CUTOFF = 6;

function reviews(n: number): string {
    return `${n} review${n === 1 ? "" : "s"}`;
}

function InstructorRatingLink(props: {
    rating: APIv4.InstructorRating;
    course: string;
}) {
    const { avgRating, avgDifficulty, numRatings, wouldTakeAgainPercent } =
        props.rating;
    const inCourse = props.rating.classes.find(
        (c) => c.course === props.course,
    );
    return (
        <>
            <a
                className={Css.rating}
                href={rmpProfessorUrl(props.rating)}
                target="_blank"
                rel="noopener noreferrer"
                title="View on Rate My Professors"
            >
                <Feather.Star size="1em" fill="currentColor" />{" "}
                {avgRating.toFixed(1)}/5 from {reviews(numRatings)},{" "}
                {avgDifficulty.toFixed(1)}/5 difficulty
                {wouldTakeAgainPercent === null
                    ? ""
                    : `, ${Math.round(wouldTakeAgainPercent)}% would take again`}{" "}
                <Feather.ExternalLink size="1em" />
            </a>
            {inCourse === undefined ? (
                <></>
            ) : (
                <span className={Css.courseRating}>
                    {inCourse.avgRating.toFixed(1)}/5 from{" "}
                    {reviews(inCourse.numRatings)} of this course
                </span>
            )}
        </>
    );
}

// the score that course rows show and sort by, and every review of the course
function RatingSection(props: {
    sectionRating: SectionRating | null;
    courseRating: APIv4.CourseRating | undefined;
}) {
    const { sectionRating, courseRating } = props;
    if (sectionRating === null && courseRating === undefined) return <></>;
    return (
        <section className={Css.ratings}>
            <h3>Rating</h3>
            <ul>
                {sectionRating === null ? (
                    <></>
                ) : (
                    <li title="Combines the instructors' reviews for this course with their overall scores">
                        <Feather.Star size="1em" fill="currentColor" />{" "}
                        {sectionRating.avgRating.toFixed(1)}/5 for this section,{" "}
                        {sectionRating.avgDifficulty.toFixed(1)}/5 difficulty
                    </li>
                )}
                {courseRating === undefined ? (
                    <></>
                ) : (
                    <li title="Every review of this course on Rate My Professors, no matter who taught it">
                        {courseRating.avgRating.toFixed(1)}/5 for this course
                        with any instructor, from{" "}
                        {reviews(courseRating.numRatings)} of{" "}
                        {courseRating.numInstructors} instructor
                        {courseRating.numInstructors === 1 ? "" : "s"}
                    </li>
                )}
            </ul>
        </section>
    );
}

export default memo(function CourseDescriptionBox(props: {
    section: APIv4.Section;
    showStatus: boolean;
}) {
    const descriptions = useCourseAreaDescription().data;
    const instructorRatings = useInstructorRatings().data;
    const courseRatings = useCourseRatings().data;
    const offeringHistory = useOfferingHistoryLookup();
    const allTerms = useAllTerms();
    let minYear = CURRENT_TERM.year;
    for (const t of allTerms ?? []) {
        if (t.year < minYear) minYear = t.year;
    }

    const historyEntry = offeringHistory.get(
        APIv4.stringifyCourseCode(props.section.course.code),
    );

    const [renderAllHistory, setRenderAllHistory] = useState<boolean>(false);

    let pastOfferings: React.JSX.Element | React.JSX.Element[];
    if (historyEntry === undefined || historyEntry.length === 0) {
        pastOfferings = <li className={Css.none}>(none since {minYear})</li>;
    } else {
        pastOfferings = (
            renderAllHistory || historyEntry.length < HISTORY_ENTRY_CUTOFF
                ? historyEntry
                : historyEntry.slice(0, HISTORY_ENTRY_CUTOFF)
        ).map((term) => {
            const termString = APIv4.stringifyTermIdentifier(term);
            return <li key={termString}>{termString}</li>;
        });
    }

    const instructors = props.section.instructors
        .map((i) => i.name.trim())
        .filter((s) => s !== "");

    const course = sectionCourse(props.section);
    const sectionRating =
        instructorRatings === undefined
            ? null
            : computeSectionRating(props.section, instructorRatings);

    return (
        <div className={Css.root}>
            {props.showStatus ? (
                <div className={Css.statusRow}>
                    <SectionStatusBadge status={props.section.status} />
                    <span className={Css.statusText}>
                        {props.section.seatsFilled}/{props.section.seatsTotal}{" "}
                        seats filled
                        {props.section.permCount === 0 ? (
                            <></>
                        ) : (
                            <>, {props.section.permCount} PERMs</>
                        )}
                    </span>
                </div>
            ) : (
                <></>
            )}
            <p className={Css.description}>
                {processDescription(props.section.course.description)}
            </p>
            <section className={Css.credits}>
                <h3>
                    HMC Credit
                    {computeMuddCredits(props.section) !== 1 ? "s" : ""}
                </h3>
                <div>{computeMuddCredits(props.section)}</div>
            </section>

            <section className={Css.credits}>
                <h3>
                    Non-HMC Credit
                    {computeNonMuddCredits(props.section) !== 1 ? "s" : ""}
                </h3>
                <div>{computeNonMuddCredits(props.section)}</div>
            </section>

            <section className={Css.instructors}>
                <h3>Instructor{instructors.length > 1 ? "s" : ""}</h3>
                <ul>
                    {instructors.map((name) => {
                        const rating = instructorRatings?.get(name);
                        return (
                            <li key={name}>
                                {name}
                                {rating === undefined ? (
                                    <></>
                                ) : (
                                    <InstructorRatingLink
                                        rating={rating}
                                        course={course}
                                    />
                                )}
                            </li>
                        );
                    })}
                </ul>
            </section>
            <RatingSection
                sectionRating={sectionRating}
                courseRating={courseRatings?.get(course)}
            />
            <section className={Css.areas}>
                <h3>Course Areas</h3>
                <ul>
                    {descriptions === undefined ? (
                        <span>No data</span>
                    ) : (
                        props.section.courseAreas.map((code) => {
                            const campus = code.charCodeAt(0) - 48 - 1; // 48 is the ascii code for '0'
                            let cls: string;
                            if (campus < 5) cls = campusCss[campus]!;
                            else cls = "";

                            return (
                                <li key={code} className={cls}>
                                    {descriptions.get(code) ?? code}
                                </li>
                            );
                        })
                    )}
                </ul>
            </section>
            <section className={Css.schedule}>
                <h3>Schedule</h3>
                <ul>
                    {props.section.schedules.map((slot, i) => (
                        <li key={i}>
                            {slot.days.join("")} {formatTime12(slot.startTime)}
                            &ndash;
                            {formatTime12(slot.endTime)} @{" "}
                            {combineLocations(slot.locations).join(", ")}
                        </li>
                    ))}
                    {props.section.identifier.half === null ? (
                        <></>
                    ) : (
                        <li key={"half"}>
                            (
                            {props.section.identifier.half.number === 1
                                ? "first"
                                : "second"}{" "}
                            half semester only)
                        </li>
                    )}
                </ul>
            </section>
            <section className={Css.history}>
                <>
                    <h3>Past Offerings</h3>
                    <ul>
                        {pastOfferings}
                        {renderAllHistory ||
                        (historyEntry ?? []).length <= HISTORY_ENTRY_CUTOFF ? (
                            <></>
                        ) : (
                            <li
                                className={Css.remaining}
                                onClick={() => setRenderAllHistory(true)}
                            >
                                (&hellip;{" "}
                                {historyEntry!.length - HISTORY_ENTRY_CUTOFF}{" "}
                                more)
                            </li>
                        )}
                    </ul>
                </>
            </section>
            {props.section.identifier.affiliation ===
            props.section.course.primaryAssociation ? (
                <></>
            ) : (
                <section>
                    <h3>Primary Association</h3>
                    <span>
                        {APIv4.schoolCodeToName(
                            props.section.course.primaryAssociation,
                        )}
                    </span>
                </section>
            )}
        </div>
    );
});
