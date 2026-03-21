export type StepStatus = "pass" | "retry" | "unclear" | "unsafe";
export type SkillLevel = "beginner" | "intermediate";
export type CalibrationMode = "corners" | "guide";

export type Point = {
  x: number;
  y: number;
};

export type Calibration = {
  tl: Point;
  tr: Point;
  br: Point;
  bl: Point;
};

export type OverlayTarget = {
  id: string;
  label: string;
  description: string;
  u: number;
  v: number;
  color: string;
};

export type ProcedureStage = {
  id: string;
  title: string;
  objective: string;
  visible_checks: string[];
  common_errors: string[];
  overlay_targets: string[];
  score_weight: number;
};

export type ProcedureDefinition = {
  id: string;
  title: string;
  simulation_only: boolean;
  practice_surface: string;
  named_overlay_targets: OverlayTarget[];
  stages: ProcedureStage[];
};

export type Issue = {
  code: string;
  severity: "low" | "medium" | "high";
  message: string;
};

export type AnalyzeFrameRequest = {
  procedure_id: string;
  stage_id: string;
  skill_level: SkillLevel;
  image_base64: string;
  student_question?: string;
};

export type AnalyzeFrameResponse = {
  step_status: StepStatus;
  confidence: number;
  visible_observations: string[];
  issues: Issue[];
  coaching_message: string;
  next_action: string;
  overlay_target_ids: string[];
  score_delta: number;
};

export type SessionEvent = {
  stageId: string;
  attempt: number;
  stepStatus: StepStatus;
  issues: Issue[];
  scoreDelta: number;
  coachingMessage: string;
  overlayTargetIds: string[];
  visibleObservations?: string[];
  nextAction?: string;
  confidence?: number;
  createdAt: string;
};

export type DebriefEventRequest = {
  stage_id: string;
  attempt: number;
  step_status: StepStatus;
  issues: Issue[];
  score_delta: number;
  coaching_message: string;
  overlay_target_ids: string[];
  visible_observations: string[];
  next_action?: string;
  confidence?: number;
  created_at: string;
};

export type QuizQuestion = {
  question: string;
  answer: string;
};

export type DebriefRequest = {
  session_id: string;
  procedure_id: string;
  skill_level: SkillLevel;
  events: DebriefEventRequest[];
};

export type DebriefResponse = {
  strengths: string[];
  improvement_areas: string[];
  practice_plan: string[];
  quiz: QuizQuestion[];
};

export type StoredDebrief = {
  response: DebriefResponse;
  reviewSignature: string;
  generatedAt: string;
};

export type SessionRecord = {
  id: string;
  procedureId: string;
  skillLevel: SkillLevel;
  calibration: Calibration;
  events: SessionEvent[];
  debrief?: StoredDebrief;
  createdAt: string;
  updatedAt: string;
};
