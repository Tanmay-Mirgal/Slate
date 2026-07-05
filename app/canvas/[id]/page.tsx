"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

import {
  ChevronLeft,
  MousePointer,
  Hand,
  Pencil,
  Square,
  Circle as CircleIcon,
  Minus,
  ArrowUpRight,
  Type,
  StickyNote,
  Eraser,
  Undo2,
  Redo2,
  Trash2,
  Download,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Grid,
  Check,
  Loader2,
  Save,
  Palette,
  Sparkles
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type Tool = 
  | "select" 
  | "hand" 
  | "pencil" 
  | "rectangle" 
  | "circle" 
  | "line" 
  | "arrow" 
  | "text" 
  | "sticky" 
  | "eraser";

export interface CanvasElement {
  id: string;
  type: Tool;
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: { x: number; y: number }[];
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  text?: string;
  fontSize?: number;
}

export default function CanvasPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  // Query slate details from Convex
  const slate = useQuery(api.slates.getById, { id: id as Id<"slates"> });
  const updateElementsMutation = useMutation(api.slates.updateElements);

  // Tools & Properties State
  const [activeTool, setActiveTool] = React.useState<Tool>("pencil");
  const [strokeColor, setStrokeColor] = React.useState("#a855f7"); // Purple default
  const [fillColor, setFillColor] = React.useState("transparent");
  const [strokeWidth, setStrokeWidth] = React.useState(3);
  const [fontSize, setFontSize] = React.useState(20);

  // Elements & History State
  const [elements, setElements] = React.useState<CanvasElement[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [history, setHistory] = React.useState<CanvasElement[][]>([]);
  const [historyIndex, setHistoryIndex] = React.useState<number>(-1);
  const [isSaving, setIsSaving] = React.useState(false);
  const [hasLoadedInitial, setHasLoadedInitial] = React.useState(false);

  // Canvas Pan & Zoom State
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = React.useState(false);
  const [startPan, setStartPan] = React.useState({ x: 0, y: 0 });
  const [gridStyle, setGridStyle] = React.useState<"dots" | "grid" | "plain">("dots");

  // Drawing state
  const [isDrawing, setIsDrawing] = React.useState(false);
  const [currentElement, setCurrentElement] = React.useState<CanvasElement | null>(null);

  // Text Editing inline state
  const [editingTextId, setEditingTextId] = React.useState<string | null>(null);
  const [editingTextValue, setEditingTextValue] = React.useState("");

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  // Load initial elements from Convex slate object
  React.useEffect(() => {
    if (slate && !hasLoadedInitial) {
      if (slate.elements) {
        try {
          const parsed = JSON.parse(slate.elements);
          setElements(parsed);
          setHistory([parsed]);
          setHistoryIndex(0);
        } catch (e) {
          console.error("Failed to parse slate elements", e);
        }
      }
      setHasLoadedInitial(true);
    }
  }, [slate, hasLoadedInitial]);

  // Push to history helper
  const pushHistory = (newElements: CanvasElement[]) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newElements);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setElements(newElements);
    saveToConvex(newElements);
  };

  // Debounced/Direct Save to Convex
  const saveToConvex = async (elsToSave: CanvasElement[]) => {
    if (!id) return;
    setIsSaving(true);
    try {
      await updateElementsMutation({
        id: id as Id<"slates">,
        elements: JSON.stringify(elsToSave),
      });
    } catch (e) {
      console.error("Failed to save elements:", e);
    } finally {
      setTimeout(() => setIsSaving(false), 600);
    }
  };

  // Undo / Redo
  const handleUndo = () => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      setHistoryIndex(historyIndex - 1);
      setElements(prev);
      saveToConvex(prev);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setHistoryIndex(historyIndex + 1);
      setElements(next);
      saveToConvex(next);
    }
  };

  // Clear Canvas
  const handleClear = () => {
    if (confirm("Are you sure you want to clear this canvas?")) {
      pushHistory([]);
    }
  };

  // Export Canvas as PNG Image
  const handleExportPNG = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Create a temporary canvas for export
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const ctx = exportCanvas.getContext("2d");
    if (!ctx) return;

    // Draw background
    ctx.fillStyle = "#09090b"; // Dark background
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    // Draw elements
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);
    renderAllElements(ctx, elements);
    ctx.restore();

    // Trigger download
    const dataUrl = exportCanvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = `${slate?.title || "slate"}-canvas.png`;
    link.href = dataUrl;
    link.click();
  };

  // Screen to Canvas Coordinates helper
  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    return {
      x: (clientX - pan.x) / zoom,
      y: (clientY - pan.y) / zoom,
    };
  };

  // Render Engine
  const renderAllElements = (ctx: CanvasRenderingContext2D, els: CanvasElement[]) => {
    els.forEach((el) => {
      ctx.strokeStyle = el.strokeColor;
      ctx.fillStyle = el.fillColor;
      ctx.lineWidth = el.strokeWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      // Highlight selected
      const isSelected = el.id === selectedId;

      ctx.save();

      switch (el.type) {
        case "pencil":
          if (el.points && el.points.length > 0) {
            ctx.beginPath();
            ctx.moveTo(el.points[0].x, el.points[0].y);
            for (let i = 1; i < el.points.length; i++) {
              ctx.lineTo(el.points[i].x, el.points[i].y);
            }
            ctx.stroke();
          }
          break;

        case "rectangle":
          if (el.width !== undefined && el.height !== undefined) {
            if (el.fillColor !== "transparent") {
              ctx.fillRect(el.x, el.y, el.width, el.height);
            }
            ctx.strokeRect(el.x, el.y, el.width, el.height);
          }
          break;

        case "circle":
          if (el.width !== undefined && el.height !== undefined) {
            const rx = Math.abs(el.width) / 2;
            const ry = Math.abs(el.height) / 2;
            const cx = el.x + el.width / 2;
            const cy = el.y + el.height / 2;

            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
            if (el.fillColor !== "transparent") {
              ctx.fill();
            }
            ctx.stroke();
          }
          break;

        case "line":
          if (el.width !== undefined && el.height !== undefined) {
            ctx.beginPath();
            ctx.moveTo(el.x, el.y);
            ctx.lineTo(el.x + el.width, el.y + el.height);
            ctx.stroke();
          }
          break;

        case "arrow":
          if (el.width !== undefined && el.height !== undefined) {
            const fromX = el.x;
            const fromY = el.y;
            const toX = el.x + el.width;
            const toY = el.y + el.height;

            const headlen = 15; // length of head in pixels
            const dx = toX - fromX;
            const dy = toY - fromY;
            const angle = Math.atan2(dy, dx);

            // Draw line
            ctx.beginPath();
            ctx.moveTo(fromX, fromY);
            ctx.lineTo(toX, toY);
            ctx.stroke();

            // Draw arrowhead
            ctx.beginPath();
            ctx.moveTo(toX, toY);
            ctx.lineTo(toX - headlen * Math.cos(angle - Math.PI / 6), toY - headlen * Math.sin(angle - Math.PI / 6));
            ctx.moveTo(toX, toY);
            ctx.lineTo(toX - headlen * Math.cos(angle + Math.PI / 6), toY - headlen * Math.sin(angle + Math.PI / 6));
            ctx.stroke();
          }
          break;

        case "text":
          ctx.font = `${el.fontSize || 20}px sans-serif`;
          ctx.fillStyle = el.strokeColor;
          ctx.fillText(el.text || "Type text...", el.x, el.y);
          break;

        case "sticky":
          const w = el.width || 160;
          const h = el.height || 140;

          // Sticky Note Background
          ctx.fillStyle = el.fillColor === "transparent" ? "#fef08a" : el.fillColor; // Default yellow
          ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
          ctx.shadowBlur = 10;
          ctx.shadowOffsetY = 4;
          ctx.fillRect(el.x, el.y, w, h);
          ctx.shadowColor = "transparent";

          // Sticky Note Border
          ctx.strokeStyle = "rgba(0, 0, 0, 0.15)";
          ctx.strokeRect(el.x, el.y, w, h);

          // Sticky Note Text
          ctx.fillStyle = "#18181b"; // Dark text
          ctx.font = "bold 15px sans-serif";
          
          // Basic multi-line text wrapping for sticky note
          const lines = (el.text || "Sticky Note").split("\n");
          lines.forEach((line, idx) => {
            ctx.fillText(line, el.x + 12, el.y + 28 + (idx * 20));
          });
          break;

        default:
          break;
      }

      // Draw Selection Bounding Box
      if (isSelected) {
        ctx.strokeStyle = "#a855f7";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);

        let minX = el.x;
        let minY = el.y;
        let maxX = el.x + (el.width || 0);
        let maxY = el.y + (el.height || 0);

        if (el.type === "pencil" && el.points) {
          minX = Math.min(...el.points.map((p) => p.x));
          minY = Math.min(...el.points.map((p) => p.y));
          maxX = Math.max(...el.points.map((p) => p.x));
          maxY = Math.max(...el.points.map((p) => p.y));
        }

        const padding = 6;
        ctx.strokeRect(
          minX - padding,
          minY - padding,
          maxX - minX + padding * 2,
          maxY - minY + padding * 2
        );
        ctx.setLineDash([]);
      }

      ctx.restore();
    });
  };

  // Main Canvas Animation Render Loop
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Handle HiDPI screens
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // Clear Screen
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Apply Transformation Matrix
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Combine static elements with currently active drawing element
    const allEls = currentElement ? [...elements, currentElement] : elements;
    renderAllElements(ctx, allEls);

    ctx.restore();
  }, [elements, currentElement, selectedId, pan, zoom]);

  // Window Resize Listener
  React.useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Mouse Handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoords(e);

    // Hand Tool / Middle Click Pan
    if (activeTool === "hand" || e.button === 1) {
      setIsPanning(true);
      setStartPan({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }

    // Eraser Tool
    if (activeTool === "eraser") {
      const remaining = elements.filter((el) => {
        // Simple hit test
        const dist = Math.hypot(el.x - coords.x, el.y - coords.y);
        return dist > 30;
      });
      if (remaining.length !== elements.length) {
        pushHistory(remaining);
      }
      return;
    }

    // Select Tool Hit Test
    if (activeTool === "select") {
      const clickedEl = [...elements].reverse().find((el) => {
        if (el.type === "rectangle" || el.type === "sticky" || el.type === "circle") {
          return (
            coords.x >= el.x &&
            coords.x <= el.x + (el.width || 0) &&
            coords.y >= el.y &&
            coords.y <= el.y + (el.height || 0)
          );
        }
        const dist = Math.hypot(el.x - coords.x, el.y - coords.y);
        return dist < 40;
      });

      setSelectedId(clickedEl ? clickedEl.id : null);
      return;
    }

    // Drawing Tools
    setIsDrawing(true);
    const newId = `el-${Date.now()}`;

    if (activeTool === "pencil") {
      setCurrentElement({
        id: newId,
        type: "pencil",
        x: coords.x,
        y: coords.y,
        points: [{ x: coords.x, y: coords.y }],
        strokeColor,
        fillColor,
        strokeWidth,
      });
    } else if (activeTool === "text") {
      const textVal = prompt("Enter text:", "Sample Text");
      if (textVal) {
        const newTextEl: CanvasElement = {
          id: newId,
          type: "text",
          x: coords.x,
          y: coords.y,
          text: textVal,
          fontSize,
          strokeColor,
          fillColor: "transparent",
          strokeWidth,
        };
        pushHistory([...elements, newTextEl]);
      }
      setIsDrawing(false);
    } else if (activeTool === "sticky") {
      const textVal = prompt("Enter sticky note text:", "Idea Note");
      if (textVal) {
        const newStickyEl: CanvasElement = {
          id: newId,
          type: "sticky",
          x: coords.x,
          y: coords.y,
          width: 160,
          height: 140,
          text: textVal,
          strokeColor: "#000000",
          fillColor: fillColor === "transparent" ? "#fef08a" : fillColor,
          strokeWidth: 1,
        };
        pushHistory([...elements, newStickyEl]);
      }
      setIsDrawing(false);
    } else {
      // Shapes: rectangle, circle, line, arrow
      setCurrentElement({
        id: newId,
        type: activeTool,
        x: coords.x,
        y: coords.y,
        width: 0,
        height: 0,
        strokeColor,
        fillColor,
        strokeWidth,
      });
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Pan Mode
    if (isPanning) {
      setPan({
        x: e.clientX - startPan.x,
        y: e.clientY - startPan.y,
      });
      return;
    }

    if (!isDrawing || !currentElement) return;
    const coords = getCanvasCoords(e);

    if (currentElement.type === "pencil") {
      setCurrentElement({
        ...currentElement,
        points: [...(currentElement.points || []), coords],
      });
    } else {
      setCurrentElement({
        ...currentElement,
        width: coords.x - currentElement.x,
        height: coords.y - currentElement.y,
      });
    }
  };

  const handleMouseUp = () => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }

    if (isDrawing && currentElement) {
      pushHistory([...elements, currentElement]);
      setCurrentElement(null);
      setIsDrawing(false);
    }
  };

  // Keyboard Shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "v") setActiveTool("select");
      if (e.key === "h") setActiveTool("hand");
      if (e.key === "p") setActiveTool("pencil");
      if (e.key === "r") setActiveTool("rectangle");
      if (e.key === "c") setActiveTool("circle");
      if (e.key === "a") setActiveTool("arrow");
      if (e.key === "l") setActiveTool("line");
      if (e.key === "t") setActiveTool("text");
      if (e.key === "n") setActiveTool("sticky");
      if (e.key === "e") setActiveTool("eraser");

      // Delete selected
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        const remaining = elements.filter((el) => el.id !== selectedId);
        pushHistory(remaining);
        setSelectedId(null);
      }

      // Undo/Redo Shortcuts
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId, elements, historyIndex, history]);

  // Color Swatches
  const strokeColors = [
    "#a855f7", // Purple
    "#ffffff", // White
    "#3b82f6", // Blue
    "#10b981", // Emerald
    "#f59e0b", // Amber
    "#ef4444", // Red
    "#ec4899", // Pink
  ];

  const fillColors = [
    "transparent",
    "#18181b", // Dark
    "#fef08a", // Soft Yellow (Sticky)
    "#bbf7d0", // Soft Green
    "#bfdbfe", // Soft Blue
    "#fbcfe8", // Soft Pink
  ];

  return (
    <TooltipProvider>
      <div className="relative w-screen h-screen overflow-hidden bg-[#08080a] text-neutral-100 select-none font-sans">
        
        {/* Background Grid Pattern */}
        <div 
          className={`absolute inset-0 pointer-events-none transition-opacity duration-300 ${
            gridStyle === "plain" 
              ? "opacity-0" 
              : gridStyle === "grid"
                ? "bg-[linear-gradient(to_right,#1f1f23_1px,transparent_1px),linear-gradient(to_bottom,#1f1f23_1px,transparent_1px)] bg-[size:2rem_2rem] opacity-40"
                : "bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:24px_24px] opacity-70"
          }`}
        />

        {/* HEADER CONTROL BAR */}
        <header className="absolute top-4 left-4 right-4 z-30 flex items-center justify-between pointer-events-none">
          
          {/* Left Controls: Back & Title */}
          <div className="flex items-center gap-3 pointer-events-auto">
            <Link 
              href="/dashboard"
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-neutral-900/90 border border-neutral-800/80 backdrop-blur-md text-sm font-bold text-neutral-300 hover:text-white hover:bg-neutral-800 transition-all shadow-xl"
            >
              <ChevronLeft className="w-4 h-4" />
              Dashboard
            </Link>

            <div className="flex items-center gap-2.5 px-4 py-2 rounded-2xl bg-neutral-900/90 border border-neutral-800/80 backdrop-blur-md shadow-xl">
              <span className="text-xl filter drop-shadow-sm">{slate?.thumbnailIcon || "📐"}</span>
              <span className="text-sm font-extrabold text-white tracking-tight">
                {slate?.title || "Loading Canvas..."}
              </span>
              
              {/* Save Status Indicator */}
              <div className="ml-2 pl-2 border-l border-neutral-800 flex items-center gap-1.5 text-[11px] font-semibold">
                {isSaving ? (
                  <span className="text-purple-400 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Saving...
                  </span>
                ) : (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    Saved
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right Controls: History, Clear, Export */}
          <div className="flex items-center gap-2 pointer-events-auto bg-neutral-900/90 border border-neutral-800/80 p-1.5 rounded-2xl backdrop-blur-md shadow-xl">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon-sm"
                  onClick={handleUndo}
                  disabled={historyIndex <= 0}
                  className="text-neutral-400 hover:text-white cursor-pointer disabled:opacity-40"
                >
                  <Undo2 className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon-sm"
                  onClick={handleRedo}
                  disabled={historyIndex >= history.length - 1}
                  className="text-neutral-400 hover:text-white cursor-pointer disabled:opacity-40"
                >
                  <Redo2 className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Redo (Ctrl+Shift+Z)</TooltipContent>
            </Tooltip>

            <div className="w-px h-5 bg-neutral-800 mx-1" />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon-sm"
                  onClick={handleClear}
                  className="text-neutral-400 hover:text-red-400 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Clear Canvas</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="outline"
                  size="sm"
                  onClick={handleExportPNG}
                  className="flex items-center gap-1.5 rounded-xl border-neutral-800 bg-purple-600/10 text-purple-400 hover:bg-purple-600 hover:text-white transition-all cursor-pointer font-bold text-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export PNG
                </Button>
              </TooltipTrigger>
              <TooltipContent>Export Canvas as PNG Image</TooltipContent>
            </Tooltip>
          </div>
        </header>

        {/* FLOATING TOP TOOLBAR */}
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-30 flex items-center gap-1.5 p-2 rounded-2xl bg-neutral-900/90 border border-neutral-800/80 shadow-2xl backdrop-blur-md">
          
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setActiveTool("select")}
                className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                  activeTool === "select" 
                    ? "bg-purple-600 text-white shadow-lg shadow-purple-900/30" 
                    : "text-neutral-400 hover:text-white hover:bg-neutral-800"
                }`}
              >
                <MousePointer className="w-4.5 h-4.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Select / Move (V)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setActiveTool("hand")}
                className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                  activeTool === "hand" 
                    ? "bg-purple-600 text-white shadow-lg shadow-purple-900/30" 
                    : "text-neutral-400 hover:text-white hover:bg-neutral-800"
                }`}
              >
                <Hand className="w-4.5 h-4.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Hand / Pan (H)</TooltipContent>
          </Tooltip>

          <div className="w-px h-5 bg-neutral-800 mx-0.5" />

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setActiveTool("pencil")}
                className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                  activeTool === "pencil" 
                    ? "bg-purple-600 text-white shadow-lg shadow-purple-900/30" 
                    : "text-neutral-400 hover:text-white hover:bg-neutral-800"
                }`}
              >
                <Pencil className="w-4.5 h-4.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Freehand Pencil (P)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setActiveTool("rectangle")}
                className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                  activeTool === "rectangle" 
                    ? "bg-purple-600 text-white shadow-lg shadow-purple-900/30" 
                    : "text-neutral-400 hover:text-white hover:bg-neutral-800"
                }`}
              >
                <Square className="w-4.5 h-4.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Rectangle (R)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setActiveTool("circle")}
                className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                  activeTool === "circle" 
                    ? "bg-purple-600 text-white shadow-lg shadow-purple-900/30" 
                    : "text-neutral-400 hover:text-white hover:bg-neutral-800"
                }`}
              >
                <CircleIcon className="w-4.5 h-4.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Circle / Ellipse (C)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setActiveTool("arrow")}
                className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                  activeTool === "arrow" 
                    ? "bg-purple-600 text-white shadow-lg shadow-purple-900/30" 
                    : "text-neutral-400 hover:text-white hover:bg-neutral-800"
                }`}
              >
                <ArrowUpRight className="w-4.5 h-4.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Arrow (A)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setActiveTool("line")}
                className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                  activeTool === "line" 
                    ? "bg-purple-600 text-white shadow-lg shadow-purple-900/30" 
                    : "text-neutral-400 hover:text-white hover:bg-neutral-800"
                }`}
              >
                <Minus className="w-4.5 h-4.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Straight Line (L)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setActiveTool("text")}
                className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                  activeTool === "text" 
                    ? "bg-purple-600 text-white shadow-lg shadow-purple-900/30" 
                    : "text-neutral-400 hover:text-white hover:bg-neutral-800"
                }`}
              >
                <Type className="w-4.5 h-4.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Text (T)</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setActiveTool("sticky")}
                className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                  activeTool === "sticky" 
                    ? "bg-purple-600 text-white shadow-lg shadow-purple-900/30" 
                    : "text-neutral-400 hover:text-white hover:bg-neutral-800"
                }`}
              >
                <StickyNote className="w-4.5 h-4.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Sticky Note (N)</TooltipContent>
          </Tooltip>

          <div className="w-px h-5 bg-neutral-800 mx-0.5" />

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setActiveTool("eraser")}
                className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                  activeTool === "eraser" 
                    ? "bg-purple-600 text-white shadow-lg shadow-purple-900/30" 
                    : "text-neutral-400 hover:text-white hover:bg-neutral-800"
                }`}
              >
                <Eraser className="w-4.5 h-4.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Eraser (E)</TooltipContent>
          </Tooltip>
        </div>

        {/* LEFT PROPERTIES SIDEBAR */}
        <aside className="absolute top-36 left-4 z-30 w-52 p-4 rounded-3xl bg-neutral-900/90 border border-neutral-800/80 shadow-2xl backdrop-blur-md space-y-5">
          {/* Stroke Colors */}
          <div className="space-y-2">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-purple-400" />
              Stroke Color
            </span>
            <div className="flex flex-wrap gap-1.5">
              {strokeColors.map((c) => (
                <button
                  key={c}
                  onClick={() => setStrokeColor(c)}
                  className={`w-6 h-6 rounded-full border transition-transform cursor-pointer ${
                    strokeColor === c ? "scale-125 ring-2 ring-purple-500 border-white" : "border-neutral-700 hover:scale-110"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {/* Fill Colors */}
          <div className="space-y-2">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-neutral-400 block">
              Fill Color
            </span>
            <div className="flex flex-wrap gap-1.5">
              {fillColors.map((c) => (
                <button
                  key={c}
                  onClick={() => setFillColor(c)}
                  className={`w-6 h-6 rounded-full border flex items-center justify-center text-[10px] transition-transform cursor-pointer ${
                    fillColor === c ? "scale-125 ring-2 ring-purple-500 border-white" : "border-neutral-700 hover:scale-110"
                  }`}
                  style={{ backgroundColor: c === "transparent" ? "#18181b" : c }}
                >
                  {c === "transparent" && "🚫"}
                </button>
              ))}
            </div>
          </div>

          {/* Stroke Width */}
          <div className="space-y-2">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-neutral-400 block">
              Line Thickness
            </span>
            <div className="flex items-center gap-2 bg-neutral-950 p-1.5 rounded-xl border border-neutral-800">
              {[2, 4, 8].map((w) => (
                <button
                  key={w}
                  onClick={() => setStrokeWidth(w)}
                  className={`flex-1 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                    strokeWidth === w ? "bg-purple-600 text-white" : "text-neutral-400 hover:text-white"
                  }`}
                >
                  {w === 2 ? "Thin" : w === 4 ? "Medium" : "Thick"}
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* BOTTOM LEFT ZOOM & GRID CONTROLS */}
        <div className="absolute bottom-4 left-4 z-30 flex items-center gap-2 p-1.5 rounded-2xl bg-neutral-900/90 border border-neutral-800/80 shadow-2xl backdrop-blur-md">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setZoom(Math.max(0.2, zoom - 0.1))}
            className="text-neutral-400 hover:text-white cursor-pointer"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </Button>

          <button
            onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
            className="text-xs font-extrabold text-neutral-300 px-2 py-1 rounded-lg hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            {Math.round(zoom * 100)}%
          </button>

          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setZoom(Math.min(3, zoom + 0.1))}
            className="text-neutral-400 hover:text-white cursor-pointer"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </Button>

          <div className="w-px h-4 bg-neutral-800 mx-1" />

          {/* Grid Style Switcher */}
          <button
            onClick={() => setGridStyle(gridStyle === "dots" ? "grid" : gridStyle === "grid" ? "plain" : "dots")}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer text-xs font-bold flex items-center gap-1"
          >
            <Grid className="w-3.5 h-3.5" />
            <span className="capitalize">{gridStyle}</span>
          </button>
        </div>

        {/* CANVAS DRAWING ELEMENT */}
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          className={`w-full h-full block ${
            activeTool === "hand" ? "cursor-grab active:cursor-grabbing" : activeTool === "eraser" ? "cursor-crosshair" : "cursor-crosshair"
          }`}
        />
      </div>
    </TooltipProvider>
  );
}
