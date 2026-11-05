import * as Css from "./Filter.module.css";
import * as AppCss from "@components/App.module.css";
import { ExampleFilterBubble } from "@components/course-search/filter-bubble/FilterBubble";
import * as Search from "@lib/search";
import useStore from "@hooks/store";
import { memo, Fragment } from "react";
import classNames from "classnames";
import Slider from "@components/common/Slider";
import { useInstructorRatings } from "@hooks/api/query";

type FilterSpec = {
    name: string;
    example: string[];
};

const filterSpecs: { [k in Search.FilterKey]: FilterSpec } = {
    [Search.FilterKey.CourseCode]: {
        name: "Course Code",
        example: ["cs5", "csci005", "e79"],
    },
    [Search.FilterKey.Department]: {
        name: "Department",
        example: ["CSCI", "cs"],
    },
    [Search.FilterKey.Number]: {
        name: "Course Number",
        example: ["<100", ">=200", "=181"],
    },
    [Search.FilterKey.Title]: {
        name: "Title",
        example: ["colloquium", "research"],
    },
    [Search.FilterKey.Campus]: {
        name: "Campus",
        example: ["Harvey Mudd"],
    },
    [Search.FilterKey.Description]: {
        name: "Course Description",
        example: ["ballroom"],
    },
    [Search.FilterKey.Instructor]: {
        name: "Instructor",
        example: ["dodds"],
    },
    [Search.FilterKey.Location]: {
        name: "Location",
        example: ["McGregor", "shan"],
    },
    [Search.FilterKey.CourseArea]: {
        name: "Course Area",
        example: ["HM HSA Writing Intensive", "PO Area 5 Requirement"],
    },
    [Search.FilterKey.ScheduleDays]: {
        name: "Days",
        example: ["MWF", "T R", "wtf", "us"],
    },
    [Search.FilterKey.MeetingTime]: {
        name: "Time",
        example: [">10am", "<6:30pm", "8am-3:45pm", ">=17:05", "<=13"],
    },
    [Search.FilterKey.Credits]: {
        name: "Credits",
        example: ["<=1", "=3", "1-2", ">=2"],
    },
    [Search.FilterKey.Half]: {
        name: "Half semester",
        example: ["1", "2"],
    },
    [Search.FilterKey.Status]: {
        name: "Status",
        example: ["Open", "Reopened", "Closed"],
    },
    [Search.FilterKey.Rating]: {
        name: "Professor rating",
        example: [">=4", "3.5-5"],
    },
    [Search.FilterKey.Difficulty]: {
        name: "Professor difficulty",
        example: ["<=3", "2-3.5"],
    },
    [Search.FilterKey.TakeAgain]: {
        name: "Would take again (%)",
        example: [">=80", "50-100"],
    },
    [Search.FilterKey.Reviews]: {
        name: "Number of reviews",
        example: [">=10"],
    },
};

const ratingFilterKeys: readonly Search.FilterKey[] = [
    Search.FilterKey.Rating,
    Search.FilterKey.Difficulty,
    Search.FilterKey.TakeAgain,
    Search.FilterKey.Reviews,
];

export default memo(function Filter() {
    const setPopup = useStore((store) => store.setPopup);
    const addFilter = useStore((store) => store.addSearchFilter);
    const hideConflictingSections = useStore(
        (store) => store.hideConflictingSections,
    );
    const setHideConflictingSections = useStore(
        (store) => store.setHideConflictingSections,
    );
    // like the sort, rating filters are only offered when there are ratings
    const hasRatings = (useInstructorRatings().data?.size ?? 0) > 0;

    return (
        <div>
            <h2 className={Css.title}> Filters </h2>

            <div>
                <Slider
                    value={hideConflictingSections}
                    text="Hide sections conflicting with schedule"
                    onToggle={() => {
                        setHideConflictingSections(!hideConflictingSections);
                    }}
                />
            </div>

            <div className={Css.filterTable}>
                <span className={Css.tableHeader}>Filter for</span>
                <span className={Css.tableHeader}>Type into search box</span>
                <span className={Css.tableHeader}>Examples</span>

                {(
                    Object.entries(filterSpecs) as [
                        Search.FilterKey,
                        FilterSpec,
                    ][]
                )
                    .filter(
                        ([key]) =>
                            hasRatings || !ratingFilterKeys.includes(key),
                    )
                    .map(([key, spec], index) => {
                        return (
                            <Fragment key={key}>
                                <span
                                    className={Css.line}
                                    style={{
                                        gridRow: index + 2,
                                    }}
                                />
                                <div className={Css.nameWrapper}>
                                    <span className={Css.name}>
                                        {spec.name}
                                    </span>
                                    <button
                                        className={classNames(
                                            AppCss.defaultButton,
                                            Css.applyButton,
                                        )}
                                        onClick={() => {
                                            setPopup(null);
                                            addFilter({ key, data: null });
                                        }}
                                    >
                                        Apply
                                    </button>
                                </div>
                                <span className={Css.typeable}>
                                    <code>{key}:</code>
                                </span>

                                <div className={Css.examples}>
                                    {spec.example.map((s) => (
                                        <div
                                            className={Css.bubbleWrapper}
                                            key={s}
                                        >
                                            <ExampleFilterBubble
                                                filterKey={key}
                                                data={s}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </Fragment>
                        );
                    })}
            </div>

            <div>
                All filters are case-insensitive. When multiple filters are
                specified, only courses matching all the criteria will be shown
                (logical AND).
                {hasRatings
                    ? " Professor filters use Rate My Professors and leave out courses without a rating. When a course has more than one rated professor, their scores are averaged and their reviews are added up."
                    : ""}
            </div>
        </div>
    );
});
