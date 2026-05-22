"use client";

import { Fragment, memo } from "react";
import { StepGroupData } from "./solo-types";
import { SoloTaskPhase } from "../../lib/solo-types";

export default memo(function StepProgressTimeline({
  stepGroups,
  currentPhase,
}: {
  stepGroups: StepGroupData[];
  currentPhase: SoloTaskPhase;
}) {
  if (stepGroups.length === 0) return null;

  return (
    <div className="solo-progress-timeline">
      <div className="solo-progress-track">
        {stepGroups.map((sg, idx) => {
          const isLast = idx === stepGroups.length - 1;
          const isActive = isLast && (currentPhase === "running" || currentPhase === "waiting_review" || currentPhase === "paused");
          const statusClass = sg.status === "completed" ? "completed" : sg.status === "error" || (isLast && currentPhase === "interrupted") ? "error" : isActive ? "active" : "pending";

          return (
            <Fragment key={sg.id}>
              <div className={`solo-progress-node ${statusClass}`} title={sg.stepLabel}>
                {statusClass === "completed" && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 5.5L4 7.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {statusClass === "error" && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M3 3L7 7M7 3L3 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                )}
                {statusClass === "active" && <span className="solo-progress-pulse" />}
                {statusClass === "pending" && <span className="solo-progress-dot" />}
              </div>
              {idx < stepGroups.length - 1 && (
                <div className={`solo-progress-line ${statusClass === "completed" ? "filled" : ""}`} />
              )}
            </Fragment>
          );
        })}
      </div>
      <div className="solo-progress-labels">
        {stepGroups.map((sg) => (
          <div key={sg.id} className="solo-progress-label" title={sg.stepLabel}>
            {sg.stepLabel.length > 6 ? sg.stepLabel.slice(0, 6) + "…" : sg.stepLabel}
          </div>
        ))}
      </div>
    </div>
  );
});
