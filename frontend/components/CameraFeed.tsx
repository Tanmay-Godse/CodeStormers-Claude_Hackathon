"use client";

import Image from "next/image";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import {
  primeSpeechPlayback,
  primeVoiceRecordingPermission,
} from "@/lib/audio";

export type CameraFeedState =
  | "idle"
  | "requesting"
  | "live"
  | "blocked"
  | "unavailable"
  | "stopped"
  | "disconnected";

export type CameraFeedStatus = {
  state: CameraFeedState;
  label: string;
  message: string | null;
  canRetry: boolean;
  isLive: boolean;
};

export const INITIAL_CAMERA_FEED_STATUS: CameraFeedStatus = {
  state: "idle",
  label: "Camera idle",
  message: "Start the camera when you are ready to frame the simulation surface.",
  canRetry: true,
  isLive: false,
};

export type CapturedFrame = {
  base64: string;
  previewUrl: string;
  width: number;
  height: number;
};

export type CaptureFrameMode = "analysis" | "coach";

export type CameraFeedHandle = {
  captureFrame: (options?: {
    mode?: CaptureFrameMode;
  }) => Promise<CapturedFrame | null>;
  startCamera: () => Promise<void>;
  hasLiveStream: () => boolean;
  stopCamera: (message?: string) => void;
};

type CameraFeedProps = {
  frozenFrameUrl: string | null;
  lowBandwidthMode?: boolean;
  cheapPhoneMode?: boolean;
  onStartRequest?: () => Promise<void> | void;
  primeMicrophoneOnStart?: boolean;
  onMicrophoneIssue?: (message: string | null) => void;
  onReadyChange?: (ready: boolean) => void;
  onStatusChange?: (status: CameraFeedStatus) => void;
};

function buildCameraStatus(
  state: CameraFeedState,
  message: string | null,
): CameraFeedStatus {
  switch (state) {
    case "requesting":
      return {
        state,
        label: "Connecting camera",
        message:
          message ??
          "Requesting camera access and preparing the live preview.",
        canRetry: false,
        isLive: false,
      };
    case "live":
      return {
        state,
        label: "Camera live",
        message: message ?? "Live preview is active and ready for analysis.",
        canRetry: false,
        isLive: true,
      };
    case "blocked":
      return {
        state,
        label: "Permission blocked",
        message:
          message ??
          "Allow camera access in the browser, then retry the live preview.",
        canRetry: true,
        isLive: false,
      };
    case "unavailable":
      return {
        state,
        label: "Camera unavailable",
        message:
          message ??
          "The browser could not create a camera stream for this device.",
        canRetry: true,
        isLive: false,
      };
    case "stopped":
      return {
        state,
        label: "Camera paused",
        message:
          message ??
          "Live preview is paused. Start the camera again to continue.",
        canRetry: true,
        isLive: false,
      };
    case "disconnected":
      return {
        state,
        label: "Camera disconnected",
        message:
          message ??
          "The active camera stopped sending video. Reconnect it and retry.",
        canRetry: true,
        isLive: false,
      };
    case "idle":
    default:
      return {
        state: "idle",
        label: INITIAL_CAMERA_FEED_STATUS.label,
        message: message ?? INITIAL_CAMERA_FEED_STATUS.message,
        canRetry: true,
        isLive: false,
      };
  }
}

function canRetryWithRelaxedConstraints(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "NotFoundError" || error.name === "OverconstrainedError")
  );
}

function normalizeCameraError(error: unknown): {
  state: Extract<CameraFeedState, "blocked" | "unavailable">;
  message: string;
} {
  if (
    error instanceof DOMException &&
    (error.name === "NotAllowedError" || error.name === "SecurityError")
  ) {
    return {
      state: "blocked",
      message:
        "Camera access was blocked. Allow camera permission in the browser and try again.",
    };
  }

  if (error instanceof DOMException && error.name === "NotFoundError") {
    return {
      state: "unavailable",
      message: "No camera was found on this device.",
    };
  }

  if (
    error instanceof DOMException &&
    (error.name === "NotReadableError" || error.name === "AbortError")
  ) {
    return {
      state: "unavailable",
      message:
        "The camera is busy or the browser could not start the stream. Close other camera apps and retry.",
    };
  }

  if (error instanceof Error && error.message.trim()) {
    return {
      state: "unavailable",
      message: error.message.trim(),
    };
  }

  return {
    state: "unavailable",
    message: "The browser could not create a video stream.",
  };
}

export const CameraFeed = forwardRef<CameraFeedHandle, CameraFeedProps>(
  function CameraFeed(
    {
      frozenFrameUrl,
      lowBandwidthMode = false,
      cheapPhoneMode = false,
      onStartRequest,
      primeMicrophoneOnStart = false,
      onMicrophoneIssue,
      onReadyChange,
      onStatusChange,
    },
    ref,
  ) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const onReadyChangeRef = useRef(onReadyChange);
    const onStatusChangeRef = useRef(onStatusChange);
    const requestIdRef = useRef(0);
    const streamListenerCleanupRef = useRef<(() => void) | null>(null);
    const [permissionState, setPermissionState] =
      useState<CameraFeedState>("idle");
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    useEffect(() => {
      onReadyChangeRef.current = onReadyChange;
    }, [onReadyChange]);

    useEffect(() => {
      onStatusChangeRef.current = onStatusChange;
    }, [onStatusChange]);

    useEffect(() => {
      onReadyChangeRef.current?.(permissionState === "live");
      onStatusChangeRef.current?.(
        buildCameraStatus(permissionState, errorMessage),
      );
    }, [errorMessage, permissionState]);

    const teardownStream = useCallback((stopTracks: boolean) => {
      streamListenerCleanupRef.current?.();
      streamListenerCleanupRef.current = null;

      const currentStream = streamRef.current;
      streamRef.current = null;

      if (currentStream && stopTracks) {
        currentStream.getTracks().forEach((track) => track.stop());
      }

      const video = videoRef.current;
      if (video) {
        video.pause();
        video.srcObject = null;
      }
    }, []);

    const stopCamera = useCallback((message?: string) => {
      requestIdRef.current += 1;
      teardownStream(true);
      setPermissionState("stopped");
      setErrorMessage(
        message ?? "Live preview paused. Start the camera again when ready.",
      );
    }, [teardownStream]);

    const startCamera = useCallback(async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPermissionState("unavailable");
        setErrorMessage("This browser does not support camera access.");
        return;
      }

      if (typeof window !== "undefined" && !window.isSecureContext) {
        setPermissionState("unavailable");
        setErrorMessage(
          "Camera access requires HTTPS or localhost. Open the app in a secure context and try again.",
        );
        return;
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      teardownStream(true);
      primeSpeechPlayback();
      setPermissionState("requesting");
      setErrorMessage(null);

      try {
        const width = lowBandwidthMode || cheapPhoneMode ? 960 : 1280;
        const height = lowBandwidthMode || cheapPhoneMode ? 720 : 960;
        const requestedStreams: MediaStreamConstraints[] = [
          {
            audio: false,
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: width },
              height: { ideal: height },
            },
          },
          {
            audio: false,
            video: {
              width: { ideal: width },
              height: { ideal: height },
            },
          },
          {
            audio: false,
            video: true,
          },
        ];

        let stream: MediaStream | null = null;
        let lastError: unknown = null;

        for (const constraints of requestedStreams) {
          try {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
            break;
          } catch (error) {
            lastError = error;
            if (!canRetryWithRelaxedConstraints(error)) {
              throw error;
            }
          }
        }

        if (!stream) {
          throw lastError ?? new Error("No camera stream was returned.");
        }

        if (requestIdRef.current !== requestId) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        const handleStreamEnded = () => {
          if (requestIdRef.current !== requestId) {
            return;
          }

          teardownStream(false);
          setPermissionState("disconnected");
          setErrorMessage(
            "The live preview stopped because the camera was disconnected or disabled.",
          );
        };

        stream.getVideoTracks().forEach((track) => {
          track.addEventListener("ended", handleStreamEnded);
        });
        streamListenerCleanupRef.current = () => {
          stream.getVideoTracks().forEach((track) => {
            track.removeEventListener("ended", handleStreamEnded);
          });
        };

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        if (requestIdRef.current !== requestId) {
          teardownStream(true);
          return;
        }

        if (primeMicrophoneOnStart) {
          try {
            await primeVoiceRecordingPermission();
            onMicrophoneIssue?.(null);
          } catch (error) {
            onMicrophoneIssue?.(
              error instanceof Error
                ? error.message
                : "Microphone access is required for hands-free voice chat.",
            );
          }
        }

        setPermissionState("live");
        setErrorMessage(null);
      } catch (error) {
        if (requestIdRef.current !== requestId) {
          return;
        }

        teardownStream(true);
        const normalized = normalizeCameraError(error);
        setPermissionState(normalized.state);
        setErrorMessage(normalized.message);
      }
    }, [
      cheapPhoneMode,
      lowBandwidthMode,
      onMicrophoneIssue,
      primeMicrophoneOnStart,
      teardownStream,
    ]);

    const handleStartRequest = useCallback(async () => {
      if (onStartRequest) {
        await onStartRequest();
        return;
      }

      await startCamera();
    }, [onStartRequest, startCamera]);

    const captureFrame = useCallback(async (
      options?: {
        mode?: CaptureFrameMode;
      },
    ): Promise<CapturedFrame | null> => {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        return null;
      }

      const captureMode = options?.mode ?? "analysis";
      const maxLongEdge =
        captureMode === "coach"
          ? lowBandwidthMode
            ? 448
            : 640
          : lowBandwidthMode
            ? 640
            : 960;
      const imageQuality =
        captureMode === "coach"
          ? lowBandwidthMode
            ? 0.4
            : 0.5
          : lowBandwidthMode
            ? 0.56
            : 0.72;
      const scale = Math.min(
        1,
        maxLongEdge / Math.max(video.videoWidth, video.videoHeight),
      );
      const width = Math.round(video.videoWidth * scale);
      const height = Math.round(video.videoHeight * scale);

      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d");

      if (!context) {
        return null;
      }

      context.drawImage(video, 0, 0, width, height);
      const previewUrl = canvas.toDataURL("image/jpeg", imageQuality);
      const [, base64 = ""] = previewUrl.split(",");

      return { base64, previewUrl, width, height };
    }, [lowBandwidthMode]);

    useEffect(() => {
      return () => {
        requestIdRef.current += 1;
        teardownStream(true);
      };
    }, [teardownStream]);

    useImperativeHandle(
      ref,
      () => ({
        captureFrame,
        startCamera,
        hasLiveStream: () =>
          Boolean(
            streamRef.current?.getVideoTracks().some(
              (track) => track.readyState === "live",
            ),
          ),
        stopCamera,
      }),
      [captureFrame, startCamera, stopCamera],
    );

    const status = buildCameraStatus(permissionState, errorMessage);
    const isWaiting =
      permissionState === "idle" ||
      permissionState === "blocked" ||
      permissionState === "stopped" ||
      permissionState === "disconnected" ||
      permissionState === "unavailable";
    const isLoading = permissionState === "requesting";
    const actionLabel =
      permissionState === "idle" ? "Enable Camera" : "Retry Camera Access";
    const emptyStateTitle =
      permissionState === "blocked"
        ? "Camera access blocked"
        : permissionState === "stopped"
          ? "Camera preview paused"
          : permissionState === "disconnected"
            ? "Camera disconnected"
            : permissionState === "unavailable"
              ? "Camera unavailable"
              : "Start the trainer camera";

    return (
      <div className="overlay-layer">
        <video
          className="camera-video"
          muted
          playsInline
          ref={videoRef}
          style={{ opacity: permissionState === "live" ? 1 : 0 }}
        />
        {frozenFrameUrl ? (
          <Image
            alt="Captured practice frame"
            className="camera-frozen"
            fill
            src={frozenFrameUrl}
            unoptimized
          />
        ) : null}

        {isLoading ? (
          <div className="camera-empty">
            <div className="camera-empty-card camera-loading-card">
              <div className="camera-spinner" aria-hidden="true" />
              <h3>Connecting the live preview</h3>
              <p>
                We are requesting camera access and preparing the training view.
              </p>
            </div>
          </div>
        ) : null}

        {isWaiting ? (
          <div className="camera-empty">
            <div className="camera-empty-card">
              <h3>{emptyStateTitle}</h3>
              <p>
                {status.message ??
                  "Frame any fruit or foam pad on a clear practice field."}
              </p>
              <button
                className="button-primary"
                onClick={() => void handleStartRequest()}
                type="button"
              >
                {actionLabel}
              </button>
            </div>
          </div>
        ) : null}

        <canvas ref={canvasRef} style={{ display: "none" }} />
      </div>
    );
  },
);
