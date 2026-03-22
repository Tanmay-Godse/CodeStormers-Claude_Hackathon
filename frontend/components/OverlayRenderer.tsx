"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { projectOverlayTarget } from "@/lib/geometry";
import type {
  Calibration,
  CalibrationMode,
  OverlayTarget,
} from "@/lib/types";

type OverlayRendererProps = {
  mode: CalibrationMode;
  calibration: Calibration;
  targetIds: string[];
  targets: OverlayTarget[];
};

export function OverlayRenderer({
  mode,
  calibration,
  targetIds,
  targets,
}: OverlayRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = containerRef.current;

    if (!node) {
      return;
    }

    const update = () => {
      const bounds = node.getBoundingClientRect();
      setSize({ width: bounds.width, height: bounds.height });
    };

    update();

    const observer = new ResizeObserver(update);
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, []);

  const targetMap = useMemo(
    () => new Map(targets.map((target) => [target.id, target])),
    [targets],
  );

  const markers = targetIds
    .map((targetId, index) => {
      const target = targetMap.get(targetId);

      if (!target || size.width === 0 || size.height === 0) {
        return null;
      }

      const point = projectOverlayTarget(
        target,
        calibration,
        size.width,
        size.height,
        mode,
      );
      const labelX = point.x + (index % 2 === 0 ? 18 : -18);
      const labelY = point.y - 18;
      const textAnchor = index % 2 === 0 ? "start" : "end";

      return (
        <g key={target.id}>
          <circle
            cx={point.x}
            cy={point.y}
            fill={target.color}
            fillOpacity="0.2"
            r="18"
            stroke={target.color}
            strokeWidth="2"
          />
          <circle cx={point.x} cy={point.y} fill={target.color} r="5" />
          <line
            stroke={target.color}
            strokeOpacity="0.8"
            strokeWidth="1.6"
            x1={point.x}
            x2={labelX}
            y1={point.y}
            y2={labelY}
          />
          <text
            className="overlay-label"
            fill="white"
            stroke="rgba(6,20,26,0.84)"
            strokeWidth="4"
            paintOrder="stroke"
            textAnchor={textAnchor}
            x={labelX}
            y={labelY - 6}
          >
            {target.label}
          </text>
        </g>
      );
    })
    .filter(Boolean);

  return (
    <div className="overlay-layer overlay-passive" ref={containerRef}>
      <svg className="overlay-layer overlay-passive" preserveAspectRatio="none">
        {markers}
      </svg>
    </div>
  );
}
