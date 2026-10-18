"use client";

import * as React from "react";
import type { Engine } from "@/lib/canvas/engine";
import { textBox } from "@/lib/canvas/shapes";
import { fontFamilyCss } from "@/lib/canvas/theme";
import { LINE_HEIGHT } from "@/lib/canvas/text";
import { THEMES } from "@/lib/canvas/theme";
import { resolveColor } from "@/lib/canvas/theme";
import { useCameraVersion, useEditingVersion, useUi } from "./hooks";

/**
 * In-place editor. A transparent textarea is laid over the element using exactly the same font,
 * size and position as the canvas rendering, so editing is WYSIWYG at any zoom or rotation.
 */
export function TextEditor({ engine }: { engine: Engine }) {
  const ui = useUi(engine);
  useCameraVersion(engine);
  useEditingVersion(engine);
  const ed = ui.editing;
  const ref = React.useRef<HTMLTextAreaElement | null>(null);
  const finishing = React.useRef(false);

  React.useEffect(() => {
    finishing.current = false;
    const t = ref.current;
    if (!t) return;
    t.focus({ preventScroll: true });
    const len = t.value.length;
    t.setSelectionRange(len, len);
  }, [ed?.id, ed?.field]);

  if (!ed) return null;
  const el = engine.store.get(ed.id);
  if (!el) return null;
  const z = engine.camera.zoom;
  const colors = THEMES[ui.view.theme];

  // Geometry of the text region in the element's local (unscaled) coordinate space.
  let box = { x: 0, y: 0, w: el.w, h: el.h };
  let size = 16;
  let weight: number | string = 400;
  let family = fontFamilyCss("sans");
  let align: "left" | "center" | "right" = "left";
  let color = colors.ink;
  let vcenter = false;
  let singleLine = false;
  let italic = false;

  switch (el.type) {
    case "shape": {
      const b = textBox(el.shape, el.w, el.h);
      box = b;
      size = el.fontSize ?? 16;
      family = fontFamilyCss(el.font ?? "sans");
      align = el.align ?? "center";
      weight = el.bold ? 600 : 400;
      italic = !!el.italic;
      color = resolveColor(el.color, ui.view.theme, "ink");
      vcenter = true;
      singleLine = false;
      break;
    }
    case "text":
      box = { x: -1, y: 0, w: Math.max(el.w + 4, 24), h: el.h };
      size = el.fontSize;
      family = fontFamilyCss(el.font);
      align = el.align;
      weight = el.bold ? 600 : 400;
      italic = !!el.italic;
      color = resolveColor(el.stroke, ui.view.theme, "ink");
      break;
    case "sticky":
      box = { x: 14, y: 14, w: el.w - 28, h: el.h - 28 };
      size = el.fontSize ?? 20;
      family = fontFamilyCss(el.font ?? "hand");
      color = "#292524";
      break;
    case "frame":
      box = { x: 14, y: 8, w: Math.max(80, el.w - 28), h: 24 };
      size = 13;
      weight = 600;
      singleLine = true;
      vcenter = true;
      color = colors.ink;
      break;
    case "table":
      box = { x: 10, y: 4, w: Math.max(80, el.w - 20), h: 26 };
      size = 13;
      weight = 600;
      singleLine = true;
      vcenter = true;
      break;
    case "card": {
      const tile = Math.min(40, el.h - 24);
      const left = el.icon ? 12 + tile + 12 : 14;
      box = { x: left - 2, y: 6, w: el.w - left - 10, h: el.h - 12 };
      size = 13.5;
      weight = 600;
      vcenter = true;
      break;
    }
    case "icon":
      box = { x: -20, y: el.h - 26, w: el.w + 40, h: 24 };
      size = 12.5;
      weight = 600;
      align = "center";
      singleLine = true;
      vcenter = true;
      break;
    case "connector": {
      const g = engine.geom.connector(el);
      const w = 200;
      box = { x: g.label.p.x - w / 2, y: g.label.p.y - 14, w, h: 28 };
      size = el.fontSize ?? 12;
      weight = 600;
      align = "center";
      singleLine = true;
      vcenter = true;
      break;
    }
    default:
      return null;
  }

  const isConnector = el.type === "connector";
  const origin = isConnector ? { x: 0, y: 0 } : { x: el.x, y: el.y };
  const angle = isConnector ? 0 : el.angle ?? 0;
  const cx = origin.x + (isConnector ? 0 : el.w / 2);
  const cy = origin.y + (isConnector ? 0 : el.h / 2);
  const screenCenter = engine.worldToScreen({ x: cx, y: cy });
  // position the unscaled box: translate to the element centre, rotate, scale, then offset by -w/2,-h/2
  const wrapperStyle: React.CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    width: isConnector ? 0 : el.w,
    height: isConnector ? 0 : el.h,
    transformOrigin: "0 0",
    transform: isConnector
      ? `translate(${engine.camera.x}px, ${engine.camera.y}px) scale(${z})`
      : `translate(${screenCenter.x}px, ${screenCenter.y}px) rotate(${angle}rad) scale(${z}) translate(${-el.w / 2}px, ${-el.h / 2}px)`,
    pointerEvents: "none",
  };

  const finish = (mode: "commit" | "cancel") => {
    if (finishing.current) return;
    finishing.current = true;
    if (mode === "commit") engine.commitEditing();
    else engine.cancelEditing();
  };

  const multiline = !singleLine;
  const lh = size * LINE_HEIGHT;

  return (
    <div style={wrapperStyle} data-slate-editor>
      <div
        style={{
          position: "absolute",
          left: box.x,
          top: box.y,
          width: box.w,
          height: box.h,
          display: "flex",
          alignItems: vcenter ? "center" : "flex-start",
          pointerEvents: "auto",
        }}
        data-slate-ui
      >
        <textarea
          ref={ref}
          value={ed.value}
          spellCheck={false}
          rows={1}
          autoFocus
          onChange={(ev) => engine.updateEditing(ev.target.value)}
          onBlur={() => finish("commit")}
          onKeyDown={(ev) => {
            ev.stopPropagation();
            if (ev.key === "Escape") {
              ev.preventDefault();
              finish("commit");
              return;
            }
            const mod = ev.ctrlKey || ev.metaKey;
            const enterCommits = !multiline || el.type === "shape" || el.type === "card";
            if (ev.key === "Enter" && ((enterCommits && !ev.shiftKey) || mod)) {
              ev.preventDefault();
              finish("commit");
            }
          }}
          style={{
            width: "100%",
            height: vcenter ? Math.min(box.h, Math.max(lh, (ed.value.split("\n").length + 0) * lh)) : "100%",
            maxHeight: "100%",
            resize: "none",
            overflow: "hidden",
            background: "transparent",
            border: "none",
            outline: "none",
            padding: 0,
            margin: 0,
            font: `${italic ? "italic " : ""}${weight} ${size}px/${lh}px ${family}`,
            textAlign: align,
            color,
            caretColor: color,
            whiteSpace: singleLine ? "pre" : "pre-wrap",
            overflowWrap: "anywhere",
          }}
        />
      </div>
    </div>
  );
}
