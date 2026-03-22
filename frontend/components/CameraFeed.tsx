"use client";

import Image from "next/image";
import {
  useCallback,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import {
  primeSpeechPlayback,
  primeVoiceRecordingPermission,
} from "@/lib/audio";

type PermissionState = "idle" | "requesting" | "granted" | "denied" | "error";

export type CapturedFrame = {
  base64: string;
  previewUrl: string;
  width: number;
  height: number;
};

export type CameraFeedHandle = {
  captureFrame: () => Promise<CapturedFrame | null>;
  startCamera: () => Promise<void>;
  hasLiveStream: () => boolean;
  stopCamera: () => void;
};

type CameraFeedProps = {
  frozenFrameUrl: string | null;
  lowBandwidthMode?: boolean;
  cheapPhoneMode?: boolean;
  primeMicrophoneOnStart?: boolean;
  onMicrophoneIssue?: (message: string | null) => void;
  onReadyChange?: (ready: boolean) => void;
};

export const CameraFeed = forwardRef<CameraFeedHandle, CameraFeedProps>(
  function CameraFeed(
    {
      frozenFrameUrl,
      lowBandwidthMode = false,
      cheapPhoneMode = false,
      primeMicrophoneOnStart = false,
      onMicrophoneIssue,
      onReadyChange,
    },
    ref,
  ) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const onReadyChangeRef = useRef(onReadyChange);
    const [permissionState, setPermissionState] = useState<PermissionState>("idle");
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    useEffect(() => {
      onReadyChangeRef.current = onReadyChange;
    }, [onReadyChange]);

    const stopCamera = useCallback(() => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;

      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }

      setPermissionState((current) =>
        current === "granted" ? "idle" : current,
      );
      onReadyChangeRef.current?.(false);
    }, []);

    const startCamera = useCallback(async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPermissionState("error");
        setErrorMessage("This browser does not support camera access.");
        onReadyChangeRef.current?.(false);
        return;
      }

      primeSpeechPlayback();
      setPermissionState("requesting");
      setErrorMessage(null);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: "environment",
            width: { ideal: lowBandwidthMode || cheapPhoneMode ? 960 : 1280 },
            height: { ideal: lowBandwidthMode || cheapPhoneMode ? 720 : 960 },
          },
        });

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
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

        setPermissionState("granted");
        onReadyChangeRef.current?.(true);
      } catch (error) {
        setPermissionState("denied");
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Camera permission was denied.",
        );
        onReadyChangeRef.current?.(false);
      }
    }, [cheapPhoneMode, lowBandwidthMode, onMicrophoneIssue, primeMicrophoneOnStart]);

    const captureFrame = useCallback(async (): Promise<CapturedFrame | null> => {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (!video || !canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        return null;
      }

      const maxLongEdge = lowBandwidthMode ? 720 : 1200;
      const imageQuality = lowBandwidthMode ? 0.62 : 0.86;
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
        stopCamera();
      };
    }, [stopCamera]);

    useImperativeHandle(
      ref,
      () => ({
        captureFrame,
        startCamera,
        hasLiveStream: () => Boolean(streamRef.current),
        stopCamera,
      }),
      [captureFrame, startCamera, stopCamera],
    );

    const isWaiting = permissionState === "idle" || permissionState === "denied";
    const statusLabel =
      permissionState === "granted"
        ? "Camera live"
        : permissionState === "requesting"
          ? "Requesting permission"
          : permissionState === "denied"
            ? "Permission blocked"
            : permissionState === "error"
              ? "Camera unavailable"
              : "Camera idle";

    return (
      <div className="overlay-layer">
        <video
          className="camera-video"
          muted
          playsInline
          ref={videoRef}
          style={{ opacity: permissionState === "granted" ? 1 : 0 }}
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
        <div className="camera-chrome">
          <div className="camera-toolbar">
            <span className="camera-status">{statusLabel}</span>
          </div>
          <div className="camera-footer">
            <span className="camera-status">Use a safe simulation surface only</span>
          </div>
        </div>

        {isWaiting ? (
          <div className="camera-empty">
            <div className="camera-empty-card">
              <h3>Start the trainer camera</h3>
              <p>
                Camera access only begins after you click. Frame the orange, banana, or
                foam pad so the overlay targets sit on a clear practice field.
              </p>
              <button className="button-primary" onClick={() => void startCamera()}>
                {permissionState === "denied" ? "Retry Camera Access" : "Enable Camera"}
              </button>
              {errorMessage ? (
                <p className="fine-print" style={{ color: "rgba(255,255,255,0.82)", marginTop: 12 }}>
                  {errorMessage}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {permissionState === "error" ? (
          <div className="camera-empty">
            <div className="camera-empty-card">
              <h3>Camera unavailable</h3>
              <p>{errorMessage ?? "The browser could not create a video stream."}</p>
            </div>
          </div>
        ) : null}

        <canvas ref={canvasRef} style={{ display: "none" }} />
      </div>
    );
  },
);
