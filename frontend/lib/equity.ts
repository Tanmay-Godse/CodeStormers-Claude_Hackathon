import type {
  ApiEquityMode,
  EquityModeSettings,
  FeedbackLanguage,
} from "@/lib/types";

export const FEEDBACK_LANGUAGE_OPTIONS: Array<{
  value: FeedbackLanguage;
  label: string;
}> = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "hi", label: "Hindi" },
];

export function toApiEquityMode(settings: EquityModeSettings): ApiEquityMode {
  return {
    enabled: settings.enabled,
    audio_coaching: settings.audioCoaching,
    low_bandwidth_mode: settings.lowBandwidthMode,
    cheap_phone_mode: settings.cheapPhoneMode,
    offline_practice_logging: settings.offlinePracticeLogging,
  };
}

export function getFeedbackLanguageLabel(language: FeedbackLanguage): string {
  return (
    FEEDBACK_LANGUAGE_OPTIONS.find((option) => option.value === language)?.label ??
    "English"
  );
}

export function getSpeechLanguageCode(language: FeedbackLanguage): string {
  switch (language) {
    case "es":
      return "es-ES";
    case "fr":
      return "fr-FR";
    case "hi":
      return "hi-IN";
    case "en":
    default:
      return "en-US";
  }
}
