"use client";

import { Fragment, memo } from "react";
import { StepGroupData } from "./helm-types";
import { HelmTaskPhase } from "../../lib/helm-types";

export default memo(function StepProgressTimeline({
  stepGroups,
  currentPhase,
}: {
  stepGroups: StepGroupData[];
  currentPhase: HelmTaskPhase;
}) {
  if (stepGroups.length === 0) return null;

  return (
    <div className="helm-progress-timeline">
      <div className="helm-progress-track">
        {stepGroups.map((sg, idx) => {
          const isLast = idx === stepGroups.length - 1;
          const isActive = isLast && (currentPhase === "running" || currentPhase === "waiting_review" || currentPhase === "paused");
          const statusClass = sg.status === "completed" ? "completed" : sg.status === "error" || (isLast && currentPhase === "interrupted") ? "error" : isActive ? "active" : "pending";

          return (
            <Fragment key={sg.id}>
              <div className={`helm-progress-node ${statusClass}`} title={sg.stepLabel}>
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
                {statusClass === "active" && <span className="helm-progress-pulse" />}
                {statusClass === "pending" && <span className="helm-progress-dot" />}
              </div>
              {idx < stepGroups.length - 1 && (
                <div className={`helm-progress-line ${statusClass === "completed" ? "filled" : ""}`} />
              )}
            </Fragment>
          );
        })}
      </div>
      <div className="helm-progress-labels">
        {stepGroups.map((sg) => (
          <div key={sg.id} className="helm-progress-label" title={sg.stepLabel}>
            {sg.stepLabel.length > 6 ? sg.stepLabel.slice(0, 6) + "…" : sg.stepLabel}
          </div>
        ))}
      </div>
    </div>
  );
});
