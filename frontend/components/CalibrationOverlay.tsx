"use client";

import { useEffect, useRef, useState } from "react";

import { GUIDE_FRAME, clamp } from "@/lib/geometry";
import type { Calibration, CalibrationMode } from "@/lib/types";

type CalibrationOverlayProps = {
  mode: CalibrationMode;
  calibration: Calibration;
  disabled?: boolean;
  onChange: (calibration: Calibration) => void;
};

const CORNER_ORDER: Array<keyof Calibration> = ["tl", "tr", "br", "bl"];
const CORNER_LABELS: Record<keyof Calibration, string> = {
  tl: "TL",
  tr: "TR",
  br: "BR",
  bl: "BL",
};

export function CalibrationOverlay({
  mode,
  calibration,
  disabled = false,
  onChange,
}: CalibrationOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [draggingKey, setDraggingKey] = useState<keyof Calibration | null>(null);

  useEffect(() => {
    if (!draggingKey || disabled) {
      return;
    }

    function handlePointerMove(event: PointerEvent) {
      const bounds = overlayRef.current?.getBoundingClientRect();
      const activeKey = draggingKey;

      if (!bounds || !activeKey) {
        return;
      }

      onChange({
        ...calibration,
        [activeKey]: {
          x: clamp((event.clientX - bounds.left) / bounds.width, 0.05, 0.95),
          y: clamp((event.clientY - bounds.top) / bounds.height, 0.05, 0.95),
        },
      });
    }

    function handlePointerUp() {
      setDraggingKey(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [calibration, disabled, draggingKey, onChange]);

  if (mode === "guide") {
    return (
      <div className="calibration-layer" ref={overlayRef}>
        <div
          className="guide-frame"
          style={{
            left: `${GUIDE_FRAME.left * 100}%`,
            top: `${GUIDE_FRAME.top * 100}%`,
            width: `${GUIDE_FRAME.width * 100}%`,
            height: `${GUIDE_FRAME.height * 100}%`,
          }}
        />
        <div className="camera-guide-note">
          <h3>Centered guide fallback</h3>
          <p>
            Align the practice surface inside the dashed frame. This keeps the practice
            field stable when manual corner calibration is not worth the extra setup.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="calibration-layer" ref={overlayRef}>
      <svg className="overlay-layer" preserveAspectRatio="none" viewBox="0 0 100 100">
        <polygon
          fill="rgba(255, 255, 255, 0.08)"
          points={CORNER_ORDER.map((corner) => {
            const point = calibration[corner];
            return `${point.x * 100},${point.y * 100}`;
          }).join(" ")}
          stroke="rgba(255, 255, 255, 0.92)"
          strokeDasharray="4 3"
          strokeWidth="0.7"
        />
      </svg>

      {CORNER_ORDER.map((corner) => {
        const point = calibration[corner];
        return (
          <button
            className="calibration-handle"
            disabled={disabled}
            key={corner}
            onPointerDown={() => setDraggingKey(corner)}
            style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
            type="button"
          >
            {CORNER_LABELS[corner]}
          </button>
        );
      })}

      <div className="calibration-note">
        <p>
          Drag the four corners around the visible practice surface. The overlay markers
          map into this shape when feedback comes back from the backend.
        </p>
      </div>
    </div>
  );
}
