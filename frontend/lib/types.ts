export type StepStatus = "pass" | "retry" | "unclear" | "unsafe";
export type SkillLevel = "beginner" | "intermediate";
export type CalibrationMode = "corners" | "guide";
export type UserRole = "student" | "admin";
export type AdminApprovalStatus = "none" | "pending" | "rejected";
export type SafetyGateStatus = "cleared" | "blocked" | "needs_human_review";
export type ReviewCaseStatus = "pending" | "resolved";
export type AuthMode = "sign-in" | "create-account";
export type FeedbackLanguage = "en" | "es" | "fr" | "hi";
export type CoachVoicePreset =
  | "guide_male"
  | "guide_female"
  | "mentor_female"
  | "system_default";

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

export type KnowledgeMultipleChoiceQuestion = {
  id: string;
  stage_id: string;
  prompt: string;
  choices: string[];
  correct_index: number;
  explanation: string;
  point_value: number;
  difficulty: "warmup" | "core" | "challenge";
};

export type KnowledgeFlashcard = {
  id: string;
  stage_id: string;
  front: string;
  back: string;
  memory_tip: string;
  point_value: number;
};

export type KnowledgeStudyMode =
  | "current_procedure"
  | "related_topics"
  | "common_mistakes";

export type KnowledgeTopicSuggestion = {
  id: string;
  label: string;
  description: string;
  study_mode: KnowledgeStudyMode;
};

export type KnowledgePackRequest = {
  procedure_id: string;
  skill_level: SkillLevel;
  feedback_language: FeedbackLanguage;
  learner_name?: string;
  focus_area?: string;
  study_mode?: KnowledgeStudyMode;
  selected_topic?: string;
  recent_issue_labels?: string[];
  avoid_question_prompts?: string[];
  avoid_flashcard_fronts?: string[];
  generation_nonce?: string;
};

export type KnowledgePackResponse = {
  study_mode: KnowledgeStudyMode;
  topic_title: string;
  title: string;
  summary: string;
  recommended_focus: string;
  celebration_line: string;
  topic_suggestions: KnowledgeTopicSuggestion[];
  rapidfire_rounds: KnowledgeMultipleChoiceQuestion[];
  quiz_questions: KnowledgeMultipleChoiceQuestion[];
  flashcards: KnowledgeFlashcard[];
};

export type HealthStatus = {
  status: string;
  simulation_only: boolean;
  ai_provider: string;
  ai_ready: boolean;
  ai_coach_model: string;
  transcription_ready: boolean;
  transcription_model: string;
  transcription_api_base_url: string;
};

export type TranscriptionTestRequest = {
  audio_base64: string;
  audio_format: "wav" | "mp3";
};

export type TranscriptionTestResponse = {
  transcript: string;
  latency_ms: number;
  transcription_model: string;
  transcription_api_base_url: string;
  transcription_provider: string;
};

export type CoachChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type CoachChatRequest = {
  procedure_id: string;
  stage_id: string;
  skill_level: SkillLevel;
  practice_surface?: string;
  learner_focus?: string;
  feedback_language: FeedbackLanguage;
  simulation_confirmation: boolean;
  image_base64?: string;
  audio_base64?: string;
  audio_format?: "wav" | "mp3";
  student_name?: string;
  session_id?: string;
  equity_mode: ApiEquityMode;
  messages: CoachChatMessage[];
};

export type CoachSpeechRequest = {
  text: string;
  feedback_language: FeedbackLanguage;
  coach_voice: CoachVoicePreset;
};

export type CoachChatResponse = {
  conversation_stage: "goal_setting" | "planning" | "guiding" | "blocked";
  coach_message: string;
  plan_summary: string;
  suggested_next_step: string;
  camera_observations: string[];
  stage_focus: string[];
  learner_goal_summary: string;
  learner_transcript: string;
};

export type Issue = {
  code: string;
  severity: "low" | "medium" | "high";
  message: string;
};

export type EquityModeSettings = {
  enabled: boolean;
  feedbackLanguage: FeedbackLanguage;
  audioCoaching: boolean;
  coachVoice: CoachVoicePreset;
  lowBandwidthMode: boolean;
  cheapPhoneMode: boolean;
  offlinePracticeLogging: boolean;
};

export type ApiEquityMode = {
  enabled: boolean;
  audio_coaching: boolean;
  low_bandwidth_mode: boolean;
  cheap_phone_mode: boolean;
  offline_practice_logging: boolean;
};

export type OfflinePracticeLog = {
  id: string;
  stageId: string;
  note?: string;
  frameWidth: number;
  frameHeight: number;
  lowBandwidthMode: boolean;
  cheapPhoneMode: boolean;
  createdAt: string;
};

export type AnalyzeFrameRequest = {
  procedure_id: string;
  stage_id: string;
  skill_level: SkillLevel;
  practice_surface?: string;
  image_base64: string;
  student_question?: string;
  simulation_confirmation: boolean;
  session_id?: string;
  student_name?: string;
  student_username?: string;
  feedback_language: FeedbackLanguage;
  equity_mode: ApiEquityMode;
};

export type SafetyGateResult = {
  status: SafetyGateStatus;
  confidence: number;
  reason: string;
  refusal_message?: string | null;
};

export type AnalyzeFrameResponse = {
  analysis_mode: "coaching" | "blocked";
  step_status: StepStatus;
  grading_decision: "graded" | "not_graded";
  grading_reason?: string | null;
  confidence: number;
  visible_observations: string[];
  issues: Issue[];
  coaching_message: string;
  next_action: string;
  overlay_target_ids: string[];
  score_delta: number;
  safety_gate: SafetyGateResult;
  requires_human_review: boolean;
  human_review_reason?: string | null;
  review_case_id?: string | null;
};

export type SessionEvent = {
  stageId: string;
  attempt: number;
  stepStatus: StepStatus;
  analysisMode?: "coaching" | "blocked";
  graded?: boolean;
  gradingReason?: string;
  issues: Issue[];
  scoreDelta: number;
  coachingMessage: string;
  overlayTargetIds: string[];
  visibleObservations?: string[];
  nextAction?: string;
  confidence?: number;
  safetyGate?: SafetyGateResult;
  requiresHumanReview?: boolean;
  humanReviewReason?: string;
  reviewCaseId?: string;
  createdAt: string;
};

export type DebriefEventRequest = {
  stage_id: string;
  attempt: number;
  step_status: StepStatus;
  analysis_mode: "coaching" | "blocked";
  graded: boolean;
  grading_reason?: string;
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

export type ErrorFingerprintItem = {
  code: string;
  label: string;
  count: number;
  stage_ids: string[];
};

export type AdaptiveDrill = {
  title: string;
  focus: string;
  reason: string;
  instructions: string[];
  rep_target: string;
};

export type LearnerProfileSnapshot = {
  total_sessions: number;
  graded_attempts: number;
  recurring_issues: ErrorFingerprintItem[];
};

export type DebriefRequest = {
  session_id: string;
  procedure_id: string;
  skill_level: SkillLevel;
  feedback_language: FeedbackLanguage;
  equity_mode: ApiEquityMode;
  learner_profile?: LearnerProfileSnapshot;
  events: DebriefEventRequest[];
};

export type DebriefResponse = {
  feedback_language: FeedbackLanguage;
  graded_attempt_count: number;
  not_graded_attempt_count: number;
  error_fingerprint: ErrorFingerprintItem[];
  adaptive_drill: AdaptiveDrill;
  strengths: string[];
  improvement_areas: string[];
  practice_plan: string[];
  equity_support_plan: string[];
  audio_script: string;
  quiz: QuizQuestion[];
};

export type AuthUser = {
  id: string;
  accountId: string;
  name: string;
  username: string;
  role: UserRole;
  isDeveloper: boolean;
  isSeeded: boolean;
  requestedRole?: "admin" | null;
  adminApprovalStatus: AdminApprovalStatus;
  liveSessionLimit?: number | null;
  liveSessionUsed: number;
  liveSessionRemaining?: number | null;
  sessionToken?: string | null;
  createdAt: string;
};

export type AuthAccount = {
  id: string;
  name: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  isDeveloper?: boolean;
  isSeeded?: boolean;
  requestedRole?: "admin" | null;
  adminApprovalStatus?: AdminApprovalStatus;
  liveSessionLimit?: number | null;
  liveSessionUsed?: number;
  liveSessionRemaining?: number | null;
  sessionToken?: string | null;
  createdAt: string;
};

export type CreateAuthAccountInput = {
  name: string;
  username: string;
  password: string;
  role: UserRole;
};

export type LoginAuthInput = {
  username: string;
  password: string;
  role?: UserRole;
};

export type UpdateAuthAccountInput = {
  name: string;
  username: string;
  currentPassword: string;
  newPassword?: string;
};

export type AdminRequestDecisionInput = {
  developerAccountId: string;
  developerSessionToken: string;
};

export type DemoAccountQuotaResetInput = {
  actorAccountId: string;
  actorSessionToken: string;
};

export type ReviewCase = {
  id: string;
  status: ReviewCaseStatus;
  source: "safety_gate" | "confidence_flag" | "quality_flag";
  session_id?: string | null;
  procedure_id: string;
  stage_id: string;
  skill_level: SkillLevel;
  student_name?: string | null;
  student_username?: string | null;
  created_at: string;
  trigger_reason: string;
  analysis_blocked: boolean;
  initial_step_status?: StepStatus | null;
  confidence?: number | null;
  coaching_message?: string | null;
  safety_gate: SafetyGateResult;
  reviewer_name?: string | null;
  reviewer_notes?: string | null;
  corrected_step_status?: StepStatus | null;
  corrected_coaching_message?: string | null;
  rubric_feedback?: string | null;
  resolved_at?: string | null;
};

export type ResolveReviewCaseRequest = {
  reviewer_name: string;
  reviewer_notes: string;
  corrected_step_status?: StepStatus;
  corrected_coaching_message?: string;
  rubric_feedback?: string;
};

export type StoredDebrief = {
  response: DebriefResponse;
  reviewSignature: string;
  generatedAt: string;
};

export type KnowledgeProgress = {
  answeredCount: number;
  completedQuizRounds: number;
  correctCount: number;
  flashcardsMastered: number;
  perfectRounds: number;
  rapidfireBestStreak: number;
  totalPoints: number;
  recentQuestionPrompts: string[];
  recentFlashcardFronts: string[];
};

export type SessionRecord = {
  id: string;
  procedureId: string;
  ownerUsername?: string;
  skillLevel: SkillLevel;
  practiceSurface?: string;
  simulationConfirmed?: boolean;
  learnerFocus?: string;
  calibration: Calibration;
  equityMode: EquityModeSettings;
  events: SessionEvent[];
  offlinePracticeLogs: OfflinePracticeLog[];
  debrief?: StoredDebrief;
  createdAt: string;
  updatedAt: string;
};

export type LearningStateSnapshot = {
  sessions: SessionRecord[];
  activeSessionIds: Record<string, string>;
  knowledgeProgress: KnowledgeProgress;
};
