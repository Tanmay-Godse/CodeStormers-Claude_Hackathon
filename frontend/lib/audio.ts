import { synthesizeCoachSpeech } from "@/lib/api";
import { getSpeechLanguageCode } from "@/lib/equity";
import type { CoachVoicePreset, FeedbackLanguage } from "@/lib/types";

type BrowserAudioContextConstructor = typeof AudioContext;
type BrowserSpeechVoice = SpeechSynthesisVoice;

const MALE_VOICE_HINTS = [
  "male",
  "david",
  "daniel",
  "alex",
  "fred",
  "guy",
  "thomas",
  "arthur",
  "oliver",
  "jorge",
  "diego",
  "joris",
  "nicolas",
  "matthew",
  "james",
  "john",
  "lee",
  "microsoft guy",
  "google uk english male",
];

const FEMALE_VOICE_HINTS = [
  "female",
  "zira",
  "samantha",
  "victoria",
  "allison",
  "ava",
  "aria",
  "jenny",
  "jenny neural",
  "aria online",
  "jenny online",
  "michelle",
  "kimberly",
  "kendra",
  "ivy",
  "joanna",
  "ruth",
  "salli",
  "serena",
  "susan",
  "sara",
  "hazel",
  "luna",
  "emma",
];

const US_ENGLISH_VOICE_HINTS = [
  "en-us",
  "american",
  "america",
  "new york",
  "new york city",
  "united states",
  "google us english",
  "english (america)",
  "english us",
  "microsoft aria",
  "microsoft jenny",
  "jenny online",
  "aria online",
  "samantha",
  "ava",
  "allison",
];

const NON_US_ENGLISH_VOICE_HINTS = [
  "en-gb",
  "en-au",
  "en-ie",
  "en-in",
  "british",
  "great britain",
  "received pronunciation",
  "scotland",
  "west midlands",
  "lancaster",
  "irish",
  "australia",
  "india",
  "uk english",
];

const EN_US_FEMALE_PRIORITY_HINTS = [
  "microsoft jenny",
  "microsoft aria",
  "jenny online",
  "aria online",
  "samantha",
  "allison",
  "ava",
  "kendra",
  "kimberly",
  "joanna",
  "ivy",
  "ruth",
  "salli",
  "serena",
  "victoria",
];

export const COACH_VOICE_OPTIONS: Array<{
  value: CoachVoicePreset;
  label: string;
  description: string;
}> = [
  {
    value: "guide_female",
    label: "Guide voice",
    description: "Clear, steady US-English female coach voice for live step guidance.",
  },
  {
    value: "mentor_female",
    label: "Mentor voice",
    description: "Warmer, slightly slower US-English female coach voice for question support.",
  },
  {
    value: "system_default",
    label: "System default",
    description: "Use the browser default voice for the selected language.",
  },
];

const VOICE_PRESET_CONFIG: Record<
  CoachVoicePreset,
  {
    preferBrowserFirst: boolean;
    preferredGender: "female" | "neutral";
    pitch: number;
    rate: number;
    preferredHints: string[];
  }
> = {
  guide_female: {
    preferBrowserFirst: false,
    preferredGender: "female",
    pitch: 1.14,
    rate: 0.98,
    preferredHints: [
      "allison",
      "aria",
      "ava",
      "emma",
      "jenny",
      "joanna",
      "kimberly",
      "kendra",
      "michelle",
      "ruth",
      "samantha",
      "victoria",
      "zira",
    ],
  },
  mentor_female: {
    preferBrowserFirst: false,
    preferredGender: "female",
    pitch: 1.02,
    rate: 0.92,
    preferredHints: [
      "catherine",
      "hazel",
      "karen",
      "luna",
      "michelle",
      "moira",
      "monica",
      "ruth",
      "sara",
      "susan",
    ],
  },
  system_default: {
    preferBrowserFirst: false,
    preferredGender: "neutral",
    pitch: 1,
    rate: 1,
    preferredHints: [],
  },
};

export type RecordedVoiceClip = {
  base64: string;
  durationMs: number;
  format: "wav";
  sampleRate: number;
};

export type VoiceRecordingController = {
  result: Promise<RecordedVoiceClip | null>;
  stop: () => Promise<RecordedVoiceClip | null>;
  cancel: () => Promise<void>;
};

export type VoiceRecordingOptions = {
  maxDurationMs?: number;
  minSpeechDurationMs?: number;
  silenceDurationMs?: number;
  silenceThreshold?: number;
};

const DEFAULT_VOICE_RECORDING_MAX_DURATION_MS = 14_000;
const DEFAULT_VOICE_RECORDING_MIN_SPEECH_MS = 260;
const DEFAULT_VOICE_RECORDING_SILENCE_DURATION_MS = 1_700;
const DEFAULT_VOICE_RECORDING_SILENCE_THRESHOLD = 0.012;

let activeAudioElement: HTMLAudioElement | null = null;
let activeAudioUrl: string | null = null;
let activeAudioCompletionResolver: ((didFinish: boolean) => void) | null = null;

function getAudioContextConstructor():
  | BrowserAudioContextConstructor
  | null {
  if (typeof window === "undefined") {
    return null;
  }

  const audioWindow = window as Window & {
    webkitAudioContext?: BrowserAudioContextConstructor;
  };

  return window.AudioContext ?? audioWindow.webkitAudioContext ?? null;
}

function mergeBuffers(buffers: Float32Array[], totalSamples: number): Float32Array {
  const merged = new Float32Array(totalSamples);
  let offset = 0;

  for (const buffer of buffers) {
    merged.set(buffer, offset);
    offset += buffer.length;
  }

  return merged;
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2;
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  let offset = 0;

  function writeString(value: string) {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
    offset += value.length;
  }

  function writeUint16(value: number) {
    view.setUint16(offset, value, true);
    offset += 2;
  }

  function writeUint32(value: number) {
    view.setUint32(offset, value, true);
    offset += 4;
  }

  writeString("RIFF");
  writeUint32(36 + dataLength);
  writeString("WAVE");
  writeString("fmt ");
  writeUint32(16);
  writeUint16(1);
  writeUint16(1);
  writeUint32(sampleRate);
  writeUint32(sampleRate * bytesPerSample);
  writeUint16(bytesPerSample);
  writeUint16(16);
  writeString("data");
  writeUint32(dataLength);

  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index] ?? 0));
    const intSample = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    view.setInt16(offset, intSample, true);
    offset += 2;
  }

  return buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }

  return btoa(binary);
}

function calculateRootMeanSquare(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0;
  }

  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 0;
    sum += sample * sample;
  }

  return Math.sqrt(sum / samples.length);
}

function normalizeMicrophoneError(error: unknown): string {
  if (
    error instanceof DOMException &&
    (error.name === "NotAllowedError" || error.name === "SecurityError")
  ) {
    return "Microphone access was blocked. Allow microphone access and try again.";
  }

  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "No microphone was found on this device.";
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return "Voice recording could not start.";
}

export function canUseSpeechSynthesis(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function canUseVoiceRecording(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    getAudioContextConstructor() !== null
  );
}

export async function primeVoiceRecordingPermission(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser does not support microphone recording.");
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });
    stream.getTracks().forEach((track) => track.stop());
  } catch (error) {
    throw new Error(normalizeMicrophoneError(error));
  }
}

export function stopSpeechPlayback() {
  if (!canUseSpeechSynthesis()) {
    cleanupActiveAudioPlayback();
    return;
  }

  window.speechSynthesis.cancel();
  cleanupActiveAudioPlayback();
}

export function primeSpeechPlayback(): boolean {
  if (!canUseSpeechSynthesis()) {
    return false;
  }

  const synth = window.speechSynthesis;
  synth.getVoices();
  synth.resume();
  return true;
}

function getPreferredSpeechVoice(
  language: FeedbackLanguage,
  preset: CoachVoicePreset,
): BrowserSpeechVoice | null {
  if (!canUseSpeechSynthesis()) {
    return null;
  }

  const requestedLanguage = getSpeechLanguageCode(language).toLowerCase();
  const requestedPrefix = requestedLanguage.split("-")[0] ?? requestedLanguage;
  const voices = window.speechSynthesis.getVoices();
  const presetConfig = VOICE_PRESET_CONFIG[preset];
  const prefersUsFemaleEnglish =
    requestedLanguage === "en-us" && presetConfig.preferredGender === "female";

  if (voices.length === 0) {
    return null;
  }

  let bestVoice: BrowserSpeechVoice | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const voice of voices) {
    const voiceName = `${voice.name} ${voice.voiceURI}`.toLowerCase();
    const voiceLanguage = voice.lang.toLowerCase();
    const voicePrefix = voiceLanguage.split("-")[0] ?? voiceLanguage;
    const isExactRequestedLanguage =
      voiceLanguage === requestedLanguage ||
      voiceLanguage.startsWith(`${requestedLanguage}-`);
    const femaleMatch = FEMALE_VOICE_HINTS.some((hint) => voiceName.includes(hint));
    const maleMatch = MALE_VOICE_HINTS.some((hint) => voiceName.includes(hint));
    const usEnglishMatch = US_ENGLISH_VOICE_HINTS.some((hint) => voiceName.includes(hint));
    const nonUsEnglishMatch = NON_US_ENGLISH_VOICE_HINTS.some((hint) =>
      voiceName.includes(hint),
    );
    const priorityHintIndex = EN_US_FEMALE_PRIORITY_HINTS.findIndex((hint) =>
      voiceName.includes(hint),
    );
    const languageScore =
      isExactRequestedLanguage
        ? 30
        : voicePrefix === requestedPrefix
          ? 18
          : 0;
    const presetHintScore = presetConfig.preferredHints.some((hint) =>
      voiceName.includes(hint),
    )
      ? 14
      : 0;
    const usEnglishScore =
      requestedLanguage === "en-us" &&
      usEnglishMatch
        ? 24
        : 0;
    const exactUsLanguageScore =
      prefersUsFemaleEnglish && isExactRequestedLanguage ? 26 : 0;
    const femaleScore =
      presetConfig.preferredGender === "female" &&
      femaleMatch
        ? 26
        : 0;
    const malePenalty =
      presetConfig.preferredGender === "female" &&
      maleMatch
        ? -42
        : 0;
    const nonUsEnglishPenalty =
      prefersUsFemaleEnglish &&
      nonUsEnglishMatch
        ? -24
        : 0;
    const enUsFemalePriorityScore =
      prefersUsFemaleEnglish && priorityHintIndex >= 0
        ? 90 - priorityHintIndex
        : 0;
    const noFemaleHintPenalty =
      prefersUsFemaleEnglish && !femaleMatch ? -22 : 0;
    const nonUsLanguagePenalty =
      prefersUsFemaleEnglish &&
      voicePrefix === "en" &&
      !isExactRequestedLanguage &&
      !usEnglishMatch
        ? -32
        : 0;
    const localServiceScore = voice.localService ? 4 : 0;
    const defaultScore = voice.default ? 2 : 0;
    const score =
      languageScore +
      presetHintScore +
      usEnglishScore +
      exactUsLanguageScore +
      enUsFemalePriorityScore +
      femaleScore +
      malePenalty +
      nonUsEnglishPenalty +
      noFemaleHintPenalty +
      nonUsLanguagePenalty +
      localServiceScore +
      defaultScore;

    if (score > bestScore) {
      bestScore = score;
      bestVoice = voice;
    }
  }

  return bestVoice;
}

function configureUtterance(
  utterance: SpeechSynthesisUtterance,
  language: FeedbackLanguage,
  preset: CoachVoicePreset,
) {
  const preferredVoice = getPreferredSpeechVoice(language, preset);
  const presetConfig = VOICE_PRESET_CONFIG[preset];
  utterance.lang = getSpeechLanguageCode(language);
  if (preferredVoice) {
    utterance.voice = preferredVoice;
  }
  utterance.rate = presetConfig.rate;
  utterance.pitch = presetConfig.pitch;
}

function shouldPreferBrowserSpeech(
  language: FeedbackLanguage,
  preset: CoachVoicePreset,
): boolean {
  if (!canUseSpeechSynthesis()) {
    return false;
  }

  const presetConfig = VOICE_PRESET_CONFIG[preset];
  if (!presetConfig.preferBrowserFirst) {
    return false;
  }

  return true;
}

export function speakText(
  text: string,
  language: FeedbackLanguage,
  preset: CoachVoicePreset = "guide_female",
): Promise<boolean> {
  if (!text.trim()) {
    return Promise.resolve(false);
  }

  return speakTextWithFallback(text.trim(), language, preset, false);
}

export function speakTextAndWait(
  text: string,
  language: FeedbackLanguage,
  preset: CoachVoicePreset = "guide_female",
): Promise<boolean> {
  if (!text.trim()) {
    return Promise.resolve(false);
  }

  return speakTextWithFallback(text.trim(), language, preset, true);
}

export async function startVoiceRecording(
  options: VoiceRecordingOptions = {},
): Promise<VoiceRecordingController | null> {
  const AudioContextConstructor = getAudioContextConstructor();

  if (!AudioContextConstructor || !navigator.mediaDevices?.getUserMedia) {
    return null;
  }

  const maxDurationMs =
    options.maxDurationMs ?? DEFAULT_VOICE_RECORDING_MAX_DURATION_MS;
  const minSpeechDurationMs =
    options.minSpeechDurationMs ?? DEFAULT_VOICE_RECORDING_MIN_SPEECH_MS;
  const silenceDurationMs =
    options.silenceDurationMs ?? DEFAULT_VOICE_RECORDING_SILENCE_DURATION_MS;
  const silenceThreshold =
    options.silenceThreshold ?? DEFAULT_VOICE_RECORDING_SILENCE_THRESHOLD;

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });
  } catch (error) {
    throw new Error(normalizeMicrophoneError(error));
  }

  const audioContext = new AudioContextConstructor();
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const buffers: Float32Array[] = [];
  let totalSamples = 0;
  let finalizePromise: Promise<RecordedVoiceClip | null> | null = null;
  let resolveResult: ((clip: RecordedVoiceClip | null) => void) | null = null;
  let speechStartedAt: number | null = null;
  let lastSpeechAt: number | null = null;
  let accumulatedSpeechDurationMs = 0;
  let maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
  const result = new Promise<RecordedVoiceClip | null>((resolve) => {
    resolveResult = resolve;
  });

  processor.onaudioprocess = (event) => {
    const inputBuffer = event.inputBuffer;
    const channel = inputBuffer.getChannelData(0);
    const copy = new Float32Array(channel.length);
    copy.set(channel);
    buffers.push(copy);
    totalSamples += copy.length;

    const now =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const rms = calculateRootMeanSquare(copy);
    const chunkDurationMs = (copy.length / inputBuffer.sampleRate) * 1000;

    if (rms >= silenceThreshold) {
      if (speechStartedAt === null) {
        speechStartedAt = now;
      }
      lastSpeechAt = now + chunkDurationMs;
      accumulatedSpeechDurationMs += chunkDurationMs;
      return;
    }

    if (
      speechStartedAt !== null &&
      lastSpeechAt !== null &&
      accumulatedSpeechDurationMs >= minSpeechDurationMs &&
      now - lastSpeechAt >= silenceDurationMs
    ) {
      void finalize(false);
    }
  };

  source.connect(processor);
  processor.connect(audioContext.destination);
  await audioContext.resume();
  maxDurationTimer = setTimeout(() => {
    void finalize(false);
  }, maxDurationMs);

  async function finalize(discard: boolean): Promise<RecordedVoiceClip | null> {
    if (finalizePromise) {
      return finalizePromise;
    }

    finalizePromise = (async () => {
      processor.onaudioprocess = null;
      const sampleRate = audioContext.sampleRate;

      if (maxDurationTimer) {
        clearTimeout(maxDurationTimer);
        maxDurationTimer = null;
      }

      try {
        source.disconnect();
      } catch {}

      try {
        processor.disconnect();
      } catch {}

      stream.getTracks().forEach((track) => track.stop());

      if (audioContext.state !== "closed") {
        await audioContext.close();
      }

      const speechDurationMs = accumulatedSpeechDurationMs;

      if (
        discard ||
        totalSamples === 0 ||
        speechStartedAt === null ||
        speechDurationMs < minSpeechDurationMs
      ) {
        return null;
      }

      const merged = mergeBuffers(buffers, totalSamples);
      const wavBuffer = encodeWav(merged, sampleRate);

      return {
        base64: arrayBufferToBase64(wavBuffer),
        durationMs: Math.round((merged.length / sampleRate) * 1000),
        format: "wav",
        sampleRate,
      };
    })();

    finalizePromise.then((clip) => {
      resolveResult?.(clip);
      resolveResult = null;
    });

    return finalizePromise;
  }

  return {
    result,
    stop: () => finalize(false),
    cancel: async () => {
      await finalize(true);
    },
  };
}

async function speakTextWithFallback(
  text: string,
  language: FeedbackLanguage,
  preset: CoachVoicePreset,
  waitForCompletion: boolean,
): Promise<boolean> {
  stopSpeechPlayback();

  const didPlayBackendAudio = await playBackendSpeech(
    text,
    language,
    preset,
    waitForCompletion,
  );
  if (didPlayBackendAudio) {
    return true;
  }

  if (shouldPreferBrowserSpeech(language, preset)) {
    const didPlayBrowserSpeech = await playBrowserSpeech(
      text,
      language,
      preset,
      waitForCompletion,
    );
    if (didPlayBrowserSpeech) {
      return true;
    }
  }

  if (!canUseSpeechSynthesis()) {
    return false;
  }

  return playBrowserSpeech(text, language, preset, waitForCompletion);
}

async function playBackendSpeech(
  text: string,
  language: FeedbackLanguage,
  preset: CoachVoicePreset,
  waitForCompletion: boolean,
): Promise<boolean> {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const audioBlob = await synthesizeCoachSpeech({
      text,
      feedback_language: language,
      coach_voice: preset,
    });
    if (audioBlob.size <= 0) {
      return false;
    }

    cleanupActiveAudioPlayback();
    const audioUrl = URL.createObjectURL(audioBlob);
    const audioElement = new Audio(audioUrl);
    audioElement.preload = "auto";
    activeAudioElement = audioElement;
    activeAudioUrl = audioUrl;

    const completionPromise = waitForCompletion
      ? new Promise<boolean>((resolve) => {
          activeAudioCompletionResolver = resolve;
          audioElement.addEventListener(
            "ended",
            () => {
              resolveActiveAudioCompletion(true);
              cleanupActiveAudioPlayback();
            },
            { once: true },
          );
          audioElement.addEventListener(
            "error",
            () => {
              resolveActiveAudioCompletion(false);
              cleanupActiveAudioPlayback();
            },
            { once: true },
          );
        })
      : null;

    if (!waitForCompletion) {
      audioElement.addEventListener("ended", cleanupActiveAudioPlayback, {
        once: true,
      });
      audioElement.addEventListener("error", cleanupActiveAudioPlayback, {
        once: true,
      });
    }

    await audioElement.play();

    if (!completionPromise) {
      return true;
    }

    return completionPromise;
  } catch {
    resolveActiveAudioCompletion(false);
    cleanupActiveAudioPlayback();
    return false;
  }
}

function playBrowserSpeech(
  text: string,
  language: FeedbackLanguage,
  preset: CoachVoicePreset,
  waitForCompletion: boolean,
): Promise<boolean> {
  if (!canUseSpeechSynthesis()) {
    return Promise.resolve(false);
  }

  const synth = window.speechSynthesis;
  synth.cancel();
  synth.resume();

  return new Promise((resolve) => {
    const speakOnce = () => {
      const utterance = new SpeechSynthesisUtterance(text);
      configureUtterance(utterance, language, preset);
      utterance.onstart = () => {
        if (!waitForCompletion) {
          resolve(true);
        }
      };
      utterance.onerror = () => resolve(false);
      utterance.onend = () => resolve(true);
      synth.cancel();
      synth.resume();
      synth.speak(utterance);
    };

    const availableVoices = synth.getVoices();
    if (availableVoices.length > 0) {
      speakOnce();
      return;
    }

    let didSpeak = false;
    const handleVoicesChanged = () => {
      if (didSpeak) {
        return;
      }

      didSpeak = true;
      synth.removeEventListener?.("voiceschanged", handleVoicesChanged);
      speakOnce();
    };

    synth.addEventListener?.("voiceschanged", handleVoicesChanged);
    window.setTimeout(() => {
      if (!didSpeak) {
        handleVoicesChanged();
      }
    }, 900);
  });
}

function resolveActiveAudioCompletion(didFinish: boolean) {
  if (!activeAudioCompletionResolver) {
    return;
  }

  const resolver = activeAudioCompletionResolver;
  activeAudioCompletionResolver = null;
  resolver(didFinish);
}

function cleanupActiveAudioPlayback() {
  resolveActiveAudioCompletion(false);

  if (activeAudioElement) {
    activeAudioElement.pause();
    activeAudioElement.src = "";
    activeAudioElement = null;
  }

  if (activeAudioUrl && typeof URL !== "undefined") {
    URL.revokeObjectURL(activeAudioUrl);
    activeAudioUrl = null;
  }
}
