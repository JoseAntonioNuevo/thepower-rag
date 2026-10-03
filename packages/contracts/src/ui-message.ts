import type { UIMessage } from "ai";
import type { CragStep, CragSummary } from "./crag";
import type { Citation, DemoEvent, RunMetadata, TraceEvent } from "./domain";

export type CourseDataParts = {
  demo: DemoEvent;
  source: Citation;
  trace: TraceEvent;
  crag: CragSummary;
  step: CragStep;
};

export type CourseUIMessage = UIMessage<RunMetadata, CourseDataParts>;
