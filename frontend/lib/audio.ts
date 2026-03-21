import { getSpeechLanguageCode } from "@/lib/equity";
import type { FeedbackLanguage } from "@/lib/types";

export function canUseSpeechSynthesis(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function stopSpeechPlayback() {
  if (!canUseSpeechSynthesis()) {
    return;
  }

  window.speechSynthesis.cancel();
}

export function speakText(text: string, language: FeedbackLanguage): boolean {
  if (!canUseSpeechSynthesis() || !text.trim()) {
    return false;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.trim());
  utterance.lang = getSpeechLanguageCode(language);
  utterance.rate = 0.98;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
  return true;
}
