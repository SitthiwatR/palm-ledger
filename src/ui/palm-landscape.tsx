"use client";

import { useEffect, useRef, useState } from "react";

/** Decorative enhancement: the illustration and all app controls work without WebGL. */
export function PalmLandscape({ className = "" }: { className?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const host = container.current;
    if (!host) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    let started = false;
    const timer = window.setTimeout(() => {
      const observer = new IntersectionObserver((entries) => {
        if (started || !entries.some((entry) => entry.isIntersecting)) return;
        started = true;
        observer.disconnect();
        void import("./palm-scene")
          .then(({ createPalmScene }) => {
            if (cancelled) return;
            try {
              dispose = createPalmScene(host, (value) => {
                if (!cancelled) setReady(value);
              });
            } catch {
              // A blocked GPU must never block sign-in or managing a garden.
            }
          })
          .catch(() => {});
      });
      observer.observe(host);
      stopObserving = () => observer.disconnect();
    }, 180);
    let stopObserving = () => {};
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stopObserving();
      dispose?.();
    };
  }, []);
  return (
    <div
      className={`palm-landscape ${ready ? "is-rendered" : ""} ${className}`}
      ref={container}
      aria-hidden="true"
      data-scene-ready={ready}
    >
      <svg className="landscape-fallback" viewBox="0 0 500 360" fill="none">
        <ellipse
          cx="252"
          cy="295"
          rx="174"
          ry="30"
          fill="#173e2f"
          opacity=".07"
        />
        <path
          d="M66 247c0-48 80-85 184-85s184 37 184 85v19c0 44-83 79-184 79S66 310 66 266z"
          fill="#d1c6a5"
        />
        <ellipse cx="250" cy="247" rx="184" ry="78" fill="#dce2b5" />
        <path
          d="M180 313c56-52 50-53 134-101"
          stroke="#f7f0d5"
          strokeWidth="22"
        />
        {[
          { x: 170, y: 217, s: 0.85 },
          { x: 323, y: 219, s: 0.82 },
          { x: 251, y: 267, s: 1.13 },
          { x: 120, y: 260, s: 0.58 },
          { x: 350, y: 276, s: 0.61 },
        ].map((tree, i) => (
          <g
            key={i}
            transform={`translate(${tree.x} ${tree.y}) scale(${tree.s})`}
          >
            <ellipse cy="7" rx="34" ry="8" fill="#547b47" opacity=".18" />
            <path
              d="M-7 4C-8-44 7-80 0-121h12C21-78 5-44 7 4z"
              fill="#a48155"
            />
            <path
              d="M5-116c-17-31-61-39-76-12 30-5 42 7 76 12z"
              fill="#266b4b"
            />
            <path d="M5-116c20-40 57-36 75-9-30-6-42 7-75 9z" fill="#398356" />
            <path
              d="M5-116c-39-8-66 10-62 47 20-29 38-32 62-47z"
              fill="#438951"
            />
            <path
              d="M5-116c39-8 66 10 62 47-20-29-38-32-62-47z"
              fill="#1f6142"
            />
            <path
              d="M5-116c-25-21-25-48-2-58 0 22 12 33 2 58z"
              fill="#4e9359"
            />
            <circle cx="4" cy="-111" r="6" fill="#997648" />
          </g>
        ))}
        <g fill="#a0b979">
          <ellipse cx="109" cy="286" rx="15" ry="8" />
          <ellipse cx="295" cy="309" rx="20" ry="10" />
          <ellipse cx="387" cy="242" rx="15" ry="9" />
        </g>
      </svg>
    </div>
  );
}
