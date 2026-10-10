import type { UIMessage } from "ai";
import type { CragStep, CragSummary } from "./crag";
import type { Citation, DemoEvent, RunMetadata, TraceEvent } from "./domain";
import type { ResearchSource, ResearchStep, ResearchSummary } from "./research";

export type CourseDataParts = {
  demo: DemoEvent;
  source: Citation;
  trace: TraceEvent;
  crag: CragSummary;
  step: CragStep;
  research: ResearchSummary;
  "research-source": ResearchSource;
  "research-step": ResearchStep;
};

export type CourseUIMessage = UIMessage<RunMetadata, CourseDataParts>;
