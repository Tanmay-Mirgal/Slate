"use client";

import * as React from "react";
import { Pause, Play } from "lucide-react";

/** The landing-page walkthrough: five steps from a template to a shared board, made with BRAG (see brag-output-*). */
export const SHOWCASE_VIDEO = {
  src: "/slate-how-to.mp4",
  poster: "/slate-how-to-poster.jpg",
  label: "How to use Slate in five steps: start from a template, describe a diagram, refine it, import code to get the docs, and share one link.",
} as const;

interface ShowcaseVideoProps {
  /** Lightbox mode: starts with sound and the full player controls. The inline preview is a silent loop with a pause button. */
  expanded?: boolean;
  className?: string;
}

export function ShowcaseVideo({ expanded = false, className }: ShowcaseVideoProps) {
  const ref = React.useRef<HTMLVideoElement | null>(null);
  const userPaused = React.useRef(false);
  const [playing, setPlaying] = React.useState(false);

  // The silent loop only plays while it is on screen, so it costs nothing below the fold.
  React.useEffect(() => {
    const el = ref.current;
    if (!el || expanded) return;
    el.muted = true; // React doesn't reflect `muted` to the DOM property, and autoplay needs it
    // autoplay can start before React hydrates, so the `play` event may already be gone
    const sync = () => setPlaying(!el.paused);
    el.addEventListener("play", sync);
    el.addEventListener("pause", sync);
    queueMicrotask(sync);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (!userPaused.current) void el.play().catch(() => {});
        } else el.pause();
      },
      { threshold: 0.35 }
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      el.removeEventListener("play", sync);
      el.removeEventListener("pause", sync);
    };
  }, [expanded]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation(); // the player sits inside a click-to-expand area
    const el = ref.current;
    if (!el) return;
    if (el.paused) {
      userPaused.current = false;
      void el.play().catch(() => {});
    } else {
      userPaused.current = true;
      el.pause();
    }
  };

  return (
    <>
      <video
        ref={ref}
        className={className}
        src={SHOWCASE_VIDEO.src}
        poster={SHOWCASE_VIDEO.poster}
        aria-label={SHOWCASE_VIDEO.label}
        muted={!expanded}
        loop={!expanded}
        autoPlay
        controls={expanded}
        playsInline
        preload={expanded ? "auto" : "metadata"}
      >
        Your browser does not support the video tag.
      </video>
      {!expanded && (
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Pause the demo video" : "Play the demo video"}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-black/60 text-white opacity-0 backdrop-blur-md transition-opacity group-hover/img:opacity-100 focus-visible:opacity-100"
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
      )}
    </>
  );
}
