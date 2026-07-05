"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { useUser } from "@clerk/nextjs";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

import {
  Plus,
  Sparkles,
  MousePointer,
  Square,
  Circle as CircleIcon,
  ArrowUpRight,
  Minus,
  Eraser,
  Type,
  Hand,
  Diamond,
  Triangle,
  ImageIcon,
  Undo,
  Redo,
  Trash2,
  Image as ImageFile,
  Frame,
  Search,
  Share2,
  Check,
  Loader2,
  X,
  Send,
  FileText,
  Layout,
  Maximize2,
  Eye,
  Edit3,
  Copy,
  Users,
  Database,
  Server,
  Cpu,
  Layers,
  HardDrive,
  Globe,
  Zap,
  Command,
Cloud, Network, Terminal, Pencil} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CommandPalette } from "@/components/CommandPalette";

export type ViewMode = "document" | "both" | "canvas";
export type Tool =
  | "select"
  | "pencil"
  | "rectangle"
  | "circle"
  | "line"
  | "arrow"
  | "text"
  | "eraser"
  | "frame"
  | "node"
  | "hand"
  | "diamond"
  | "triangle"
  | "image";

const SNAP_GRID = 20;
const RESIZE_HANDLE_SIZE = 10;

export interface SystemNode {
  id: string;
  type: Tool | "arrow";
  nodeType?: "database" | "server" | "gateway" | "balancer" | "cache" | "storage" | "client";
  title: string;
  subtitle?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  points?: { x: number; y: number }[];
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  text?: string;
  // Magnetic arrow connections
  startNodeId?: string;
  endNodeId?: string;
  color?: string;
  imageSrc?: string;
}

const snapToGrid = (value: number) => Math.round(value / SNAP_GRID) * SNAP_GRID;

function getNodeCenter(el: SystemNode) {
  return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
}

function getNodeEdgePoint(node: SystemNode, toward: { x: number; y: number }) {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;

  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return { x: cx, y: node.y };

  const scaleX = dx !== 0 ? (node.width / 2) / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? (node.height / 2) / Math.abs(dy) : Infinity;
  const scale = Math.min(scaleX, scaleY);

  return { x: cx + dx * scale, y: cy + dy * scale };
}

function drawOrthogonalArrow(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  color: string,
  isSelected: boolean
) {
  const midX = (from.x + to.x) / 2;
  ctx.strokeStyle = isSelected ? "#FFFFFF" : color;
  ctx.lineWidth = isSelected ? 2.5 : 1.8;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(midX, from.y);
  ctx.lineTo(midX, to.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();

  // Arrowhead
  const headLen = 10;
  const angle = Math.atan2(to.y - to.y, to.x - midX);
  const actualAngle = Math.atan2(to.y - to.y, to.x >= midX ? 1 : -1);
  const finalAngle = to.x >= midX ? 0 : Math.PI;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - headLen * Math.cos(finalAngle - Math.PI / 6), to.y - headLen * Math.sin(finalAngle - Math.PI / 6));
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - headLen * Math.cos(finalAngle + Math.PI / 6), to.y - headLen * Math.sin(finalAngle + Math.PI / 6));
  ctx.stroke();
}

export default function CanvasPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = params.id as string;

  const accessMode = searchParams.get("mode") || "edit";
  const isReadOnly = accessMode === "view";

  const { user } = useUser();
  const guestIdRef = React.useRef(`user-${Math.floor(1000 + Math.random() * 9000)}`);
  const myUserId = user?.id || guestIdRef.current;
  const myUserName = user?.fullName || user?.firstName || `Teammate ${guestIdRef.current.slice(-4)}`;
  const myUserAvatar = user?.imageUrl || "";

  // Convex
  const slate = useQuery(api.slates.getById, { id: id as Id<"slates"> });
  const activePresence = useQuery(
    api.slates.getPresence,
    id ? { slateId: id as Id<"slates"> } : "skip"
  );
  const addElementMutation = useMutation(api.slates.addElement);
  const removeElementMutation = useMutation(api.slates.removeElement);
  const updateElementMutation = useMutation(api.slates.updateElement);
  const updateMultipleElementsMutation = useMutation(api.slates.updateMultipleElements);
  const updateDocumentMutation = useMutation(api.slates.updateDocument);
  const updatePresenceMutation = useMutation(api.slates.updatePresence);

  // Layout & Tool
  const [viewMode, setViewMode] = React.useState<ViewMode>("both");
  const [activeTool, setActiveTool] = React.useState<Tool>("select");
  const [zoom, setZoom] = React.useState<number>(100);
  const [isAiChatOpen, setIsAiChatOpen] = React.useState<boolean>(false);
  const [isLibraryOpen, setIsLibraryOpen] = React.useState<boolean>(false);
  const [isShareModalOpen, setIsShareModalOpen] = React.useState<boolean>(false);
  const [isCommandOpen, setIsCommandOpen] = React.useState<boolean>(false);
  const [copiedType, setCopiedType] = React.useState<"edit" | "view" | null>(null);

  const [docText, setDocText] = React.useState<string>(
    "# System Architecture & Low Level Design\n\n## 1. Overview\nThis slate contains the low-level design diagrams and component mappings for your application.\n\n## 2. Components\n- **Client UI**: Next.js 16 App Router\n- **Backend**: Convex Cloud Realtime Functions\n- **Authentication**: Clerk OAuth Provider\n- **Database**: Convex Document DB\n"
  );

  const [elements, setElements] = React.useState<SystemNode[]>([]);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = React.useState(false);

  // New states for Custom Canvas
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const [history, setHistory] = React.useState<SystemNode[][]>([]);
  const [future, setFuture] = React.useState<SystemNode[][]>([]);
  const [isUiHidden, setIsUiHidden] = React.useState(false);
  const [isPanning, setIsPanning] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);


  // Drawing
  const [isErasing, setIsErasing] = React.useState(false);
  const [isDrawing, setIsDrawing] = React.useState(false);
  const [currentElement, setCurrentElement] = React.useState<SystemNode | null>(null);
  const [strokeColor, setStrokeColor] = React.useState("#FFFFFF");
  const [fillColor, setFillColor] = React.useState("#141414");

  // Drag
  const [isDragging, setIsDragging] = React.useState(false);
  const [dragStart, setDragStart] = React.useState<{ x: number; y: number } | null>(null);
  const [dragOrigins, setDragOrigins] = React.useState<Map<string, { x: number; y: number }>>(new Map());

  // Resize
  const [isResizing, setIsResizing] = React.useState(false);
  const [resizeStart, setResizeStart] = React.useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [resizingId, setResizingId] = React.useState<string | null>(null);

  // Selection Net
  const [selectionNet, setSelectionNet] = React.useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [netStart, setNetStart] = React.useState<{ x: number; y: number } | null>(null);

  // Magnetic arrow
  const [magnetTarget, setMagnetTarget] = React.useState<SystemNode | null>(null);
  const [arrowStartNodeId, setArrowStartNodeId] = React.useState<string | null>(null);

  // Inline Text
  const [inlineText, setInlineText] = React.useState<{
    id: string; x: number; y: number; text: string; isNew: boolean;
  } | null>(null);

  // AI Chat
  const [aiInput, setAiInput] = React.useState("");
  const [aiMessages, setAiMessages] = React.useState<{ role: "user" | "assistant"; text: string }[]>([
    { role: "assistant", text: "Hello! I am Slate AI powered by Groq. Type a system description (e.g., 'E-commerce microservices with PostgreSQL & Redis') or 'Login flowchart' to generate connected architecture nodes on your canvas!" },
  ]);

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const lastPresenceTimeRef = React.useRef<number>(0);

  // Auto open AI drawer
  React.useEffect(() => {
    if (searchParams.get("ai") === "true") setIsAiChatOpen(true);
  }, [searchParams]);

  // Sync from Convex
  React.useEffect(() => {
    if (slate?.elements) {
      try {
        setElements(JSON.parse(slate.elements));
      } catch (e) {}
    }
  }, [slate?.elements]);

  React.useEffect(() => {
    if (slate?.documentText && slate.documentText !== docText) {
      setDocText(slate.documentText);
    }
  }, [slate?.documentText]);

  // Save doc
  const saveDocToConvex = async (text: string) => {
    if (!id || isReadOnly) return;
    setIsSaving(true);
    try {
      await updateDocumentMutation({ id: id as Id<"slates">, documentText: text });
    } catch (e) {}
    finally { setTimeout(() => setIsSaving(false), 300); }
  };

  const broadcastPresence = (x: number, y: number, currentDrawing?: SystemNode | null) => {
    if (!id || !myUserId) return;
    const now = Date.now();
    if (now - lastPresenceTimeRef.current > 70) {
      lastPresenceTimeRef.current = now;
      updatePresenceMutation({
        slateId: id as Id<"slates">, userId: myUserId, userName: myUserName,
        userAvatar: myUserAvatar, cursorX: x, cursorY: y,
        drawingElement: currentDrawing ? JSON.stringify(currentDrawing) : undefined,
      });
    }
  };

  // Commit inline text
  const commitInlineText = () => {
    if (!inlineText) return;
    const trimmed = inlineText.text.trim();
    if (trimmed && inlineText.isNew) {
      const newEl: SystemNode = {
        id: inlineText.id, type: "text", title: trimmed, text: trimmed,
        x: inlineText.x, y: inlineText.y, width: 140, height: 30,
        strokeColor: strokeColor || "#FFFFFF", fillColor: "transparent", strokeWidth: 2,
      };
      setElements(prev => [...prev, newEl]); // Optimistic update
      addElementMutation({ id: id as Id<"slates">, element: JSON.stringify(newEl) });
    }
    setInlineText(null);
    setActiveTool("select");
  };

  const handleCopyLink = (mode: "edit" | "view") => {
    const shareUrl = `${window.location.origin}/canvas/${id}?mode=${mode}`;
    navigator.clipboard.writeText(shareUrl);
    setCopiedType(mode);
    setTimeout(() => setCopiedType(null), 2000);
  };

  const handleAddComponentNode = async (nodeType: SystemNode["nodeType"], title: string, subtitle: string) => {
    if (isReadOnly) return;
    const newNode: SystemNode = {
      id: `node-${Date.now()}-${Math.random()}`, type: "node", nodeType, title, subtitle,
      x: snapToGrid(200 + Math.random() * 80), y: snapToGrid(200 + Math.random() * 80),
      width: 180, height: 90, strokeColor: "#FFFFFF", fillColor: "#141414", strokeWidth: 2,
    };
    setIsSaving(true);
    try {
      await addElementMutation({ id: id as Id<"slates">, element: JSON.stringify(newNode) });
    } catch (e) {}
    finally {
      setIsSaving(false);
      setIsLibraryOpen(false);
      setSelectedIds(new Set([newNode.id]));
    }
  };

  // AI generation
  const handleSendAi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiInput.trim()) return;
    const userPrompt = aiInput.trim();
    setAiInput("");
    setAiMessages((prev) => [...prev, { role: "user", text: userPrompt }]);
    setAiMessages((prev) => [...prev, { role: "assistant", text: "⚡ Generating architectural nodes for your canvas using Slate Groq AI..." }]);

    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: userPrompt }),
      });
      const data = await res.json();

      if (data?.elements && Array.isArray(data.elements)) {
        // First pass: add non-arrow elements so arrows can reference them
        const nodeElements = data.elements.filter((el: any) => el.type !== "arrow");
        const arrowElements = data.elements.filter((el: any) => el.type === "arrow");

        const newNodes: SystemNode[] = nodeElements.map((el: any, i: number) => ({
          id: el.id || `node-${Date.now()}-${i}`,
          type: el.type === "ellipse" ? "circle" : el.type === "diamond" ? "rectangle" : el.type === "sticky" ? "frame" : (el.type || "rectangle"),
          nodeType: (el.text || "").toLowerCase().includes("db") || (el.text || "").toLowerCase().includes("database") ? "database"
            : (el.text || "").toLowerCase().includes("api") || (el.text || "").toLowerCase().includes("gateway") ? "gateway"
            : "server",
          title: el.text || "Component Node",
          text: el.text || "Component Node",
          x: snapToGrid(el.x || 100 + (i % 4) * 240),
          y: snapToGrid(el.y || 150 + Math.floor(i / 4) * 160),
          width: el.width || 180,
          height: el.height || 90,
          strokeColor: el.color || "#FFFFFF",
          fillColor: "#141414",
          strokeWidth: 2,
        }));

        for (const node of newNodes) {
          await addElementMutation({ id: id as Id<"slates">, element: JSON.stringify(node) });
        }

        // Second pass: add connected arrows
        for (const el of arrowElements) {
          if (el.startNodeId && el.endNodeId) {
            const arrowNode: SystemNode = {
              id: el.id || `arr-${Date.now()}-${Math.random()}`,
              type: "arrow",
              title: el.text || "",
              text: el.text || "",
              x: 0, y: 0, width: 0, height: 0,
              strokeColor: el.color || "#6B7280",
              fillColor: "transparent",
              strokeWidth: 2,
              startNodeId: el.startNodeId,
              endNodeId: el.endNodeId,
            };
            await addElementMutation({ id: id as Id<"slates">, element: JSON.stringify(arrowNode) });
          }
        }

        setAiMessages((prev) => [...prev, { role: "assistant", text: `🎉 Successfully generated ${newNodes.length} nodes and ${arrowElements.length} connections on your whiteboard!` }]);
      }
    } catch (err) {
      console.error("AI diagram generation error", err);
      setAiMessages((prev) => [...prev, { role: "assistant", text: "❌ Failed generating AI diagram. Please check your GROQ_API_KEY." }]);
    }
  };

  // ─── Helper: get canvas coords from mouse event ─────────────────────────────
  const getCanvasPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / (zoom / 100) - pan.x,
      y: (e.clientY - rect.top) / (zoom / 100) - pan.y,
    };
  };

  // ─── Get node under cursor ───────────────────────────────────────────────────
  const getNodeAt = (x: number, y: number): SystemNode | null => {
    // Ignore arrow-only elements for hit testing
    return (
      [...elements].reverse().find((el) => {
        if (el.type === "arrow" && el.startNodeId && el.endNodeId) return false;
        return x >= el.x && x <= el.x + el.width && y >= el.y && y <= el.y + el.height;
      }) || null
    );
  };

  // ─── Check resize handle hit ─────────────────────────────────────────────────
  const getResizeHandleHit = (x: number, y: number): string | null => {
    for (const id of selectedIds) {
      const el = elements.find((e) => e.id === id);
      if (!el || el.type === "arrow") continue;
      const hx = el.x + el.width - RESIZE_HANDLE_SIZE / 2;
      const hy = el.y + el.height - RESIZE_HANDLE_SIZE / 2;
      if (x >= hx && x <= hx + RESIZE_HANDLE_SIZE && y >= hy && y <= hy + RESIZE_HANDLE_SIZE) {
        return id;
      }
    }
    return null;
  };

  // ─── Magnetic snap: find node close to cursor ────────────────────────────────
  const getMagnetNode = (x: number, y: number, excludeId?: string): SystemNode | null => {
    const SNAP_RADIUS = 40;
    return (
      elements.find((el) => {
        if (el.type === "arrow" || el.id === excludeId) return false;
        const cx = el.x + el.width / 2;
        const cy = el.y + el.height / 2;
        return Math.hypot(x - cx, y - cy) < SNAP_RADIUS;
      }) || null
    );
  };

  // ─── Mouse Down ─────────────────────────────────────────────────────────────
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isReadOnly) return;
    const { x, y } = getCanvasPos(e);

    if (activeTool === "hand") {
      setIsPanning(true);
      setDragStart({ x: e.clientX, y: e.clientY }); // Using clientX/Y for pure screen delta
      return;
    }

    if (activeTool === "image") {
      if (fileInputRef.current) fileInputRef.current.click();
      setActiveTool("select");
      return;
    }

    if (activeTool === "eraser") {
      setIsErasing(true);
      const target = getNodeAt(x, y);
      if (target) {
        removeElementMutation({ id: id as Id<"slates">, elementId: target.id });
        setSelectedIds((prev) => { const n = new Set(prev); n.delete(target.id); return n; });
      }
      return;
    }

    if (activeTool === "text") {
      const newId = `text-${Date.now()}-${Math.random()}`;
      setInlineText({ id: newId, x, y, text: "", isNew: true });
      setIsDrawing(false);
      return;
    }

    if (activeTool === "select") {
      // Check resize handle first
      const resizeId = getResizeHandleHit(x, y);
      if (resizeId) {
        const el = elements.find((e) => e.id === resizeId)!;
        setIsResizing(true);
        setResizingId(resizeId);
        setResizeStart({ x, y, w: el.width, h: el.height });
        return;
      }

      // Check node hit for drag
      const clicked = getNodeAt(x, y);
      if (clicked) {
        if (e.shiftKey) {
          setSelectedIds((prev) => {
            const n = new Set(prev);
            n.has(clicked.id) ? n.delete(clicked.id) : n.add(clicked.id);
            return n;
          });
        } else {
          if (!selectedIds.has(clicked.id)) {
            setSelectedIds(new Set([clicked.id]));
          }
          setIsDragging(true);
          setDragStart({ x, y });
          const origins = new Map<string, { x: number; y: number }>();
          const dragSet = selectedIds.has(clicked.id) ? selectedIds : new Set([clicked.id]);
          elements.forEach((el) => {
            if (dragSet.has(el.id)) origins.set(el.id, { x: el.x, y: el.y });
          });
          setDragOrigins(origins);
        }
        return;
      }

      // Start selection net
      setSelectedIds(new Set());
      setNetStart({ x, y });
      setSelectionNet({ x, y, w: 0, h: 0 });
      return;
    }

    // Drawing tools
    setIsDrawing(true);
    const newId = `shape-${Date.now()}-${Math.random()}`;

    if (activeTool === "arrow") {
      const magnet = getMagnetNode(x, y);
      setArrowStartNodeId(magnet ? magnet.id : null);
      const initArrow: SystemNode = {
        id: newId, type: "arrow", title: "", text: "",
        x, y, width: 0, height: 0,
        strokeColor, fillColor: "transparent", strokeWidth: 2,
        startNodeId: magnet ? magnet.id : undefined,
      };
      setCurrentElement(initArrow);
      return;
    }

    if (activeTool === "pencil") {
      setCurrentElement({
        id: newId, type: "pencil", title: "",
        x, y, width: 0, height: 0,
        points: [{ x, y }], strokeColor, fillColor: "transparent", strokeWidth: 3,
      });
    } else {
      setCurrentElement({
        id: newId, type: activeTool, title: "",
        x, y, width: 0, height: 0,
        strokeColor, fillColor, strokeWidth: 2,
      });
    }
    broadcastPresence(x, y, currentElement);
  };

  // ─── Mouse Move ─────────────────────────────────────────────────────────────
  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasPos(e);
    
    if (isErasing) {
      const target = getNodeAt(x, y);
      if (target) {
        removeElementMutation({ id: id as Id<"slates">, elementId: target.id });
        setSelectedIds((prev) => { const n = new Set(prev); n.delete(target.id); return n; });
      }
      return;
    }

    if (isPanning && dragStart) {
      const dx = (e.clientX - dragStart.x) / (zoom / 100);
      const dy = (e.clientY - dragStart.y) / (zoom / 100);
      setPan(p => ({ x: p.x + dx, y: p.y + dy }));
      setDragStart({ x: e.clientX, y: e.clientY });
      return;
    }

    broadcastPresence(x, y, currentElement);

    // Resize
    if (isResizing && resizingId && resizeStart) {
      const dx = x - resizeStart.x;
      const dy = y - resizeStart.y;
      const newW = Math.max(60, snapToGrid(resizeStart.w + dx));
      const newH = Math.max(40, snapToGrid(resizeStart.h + dy));
      setElements((prev) =>
        prev.map((el) => (el.id === resizingId ? { ...el, width: newW, height: newH } : el))
      );
      return;
    }

    // Drag
    if (isDragging && dragStart && dragOrigins.size > 0) {
      const dx = x - dragStart.x;
      const dy = y - dragStart.y;
      setElements((prev) =>
        prev.map((el) => {
          const origin = dragOrigins.get(el.id);
          if (!origin) return el;
          return { ...el, x: snapToGrid(origin.x + dx), y: snapToGrid(origin.y + dy) };
        })
      );
      return;
    }

    // Selection net
    if (netStart) {
      setSelectionNet({ x: Math.min(netStart.x, x), y: Math.min(netStart.y, y), w: Math.abs(x - netStart.x), h: Math.abs(y - netStart.y) });
      return;
    }

    // Drawing: magnet preview for arrow
    if (isDrawing && currentElement) {
      if (currentElement.type === "arrow") {
        const magnet = getMagnetNode(x, y, undefined);
        setMagnetTarget(magnet);
        setCurrentElement({ ...currentElement, width: x - currentElement.x, height: y - currentElement.y });
      } else if (currentElement.type === "pencil") {
        setCurrentElement({ ...currentElement, points: [...(currentElement.points || []), { x, y }] });
      } else {
        setCurrentElement({ ...currentElement, width: x - currentElement.x, height: y - currentElement.y });
      }
    }
  };

  // ─── Mouse Up ────────────────────────────────────────────────────────────────
  const handleCanvasMouseUp = async () => {
    if (isPanning) {
      setIsPanning(false);
      setDragStart(null);
      return;
    }
    // Finalize resize → sync to Convex
    if (isResizing && resizingId) {
      const el = elements.find((e) => e.id === resizingId);
      if (el) {
        await updateElementMutation({
          id: id as Id<"slates">,
          elementId: resizingId,
          updates: JSON.stringify({ width: el.width, height: el.height }),
        });
      }
      setIsResizing(false);
      setResizingId(null);
      setResizeStart(null);
      return;
    }

    // Finalize drag → sync to Convex
    if (isDragging && dragOrigins.size > 0) {
      const updatesList = Array.from(dragOrigins.keys()).map((eid) => {
        const el = elements.find((e) => e.id === eid);
        return { id: eid, updates: { x: el?.x, y: el?.y } };
      });
      await updateMultipleElementsMutation({
        id: id as Id<"slates">,
        updatesList: JSON.stringify(updatesList),
      });
      setIsDragging(false);
      setDragStart(null);
      setDragOrigins(new Map());
      return;
    }

    // Finalize selection net
    if (netStart && selectionNet) {
      const { x, y, w, h } = selectionNet;
      const caught = new Set(
        elements
          .filter((el) => {
            if (el.type === "arrow" && el.startNodeId) return false;
            return el.x < x + w && el.x + el.width > x && el.y < y + h && el.y + el.height > y;
          })
          .map((el) => el.id)
      );
      setSelectedIds(caught);
      setNetStart(null);
      setSelectionNet(null);
      return;
    }

    // Finalize drawing
    if (isDrawing && currentElement) {
      const finalEl = { ...currentElement };

      if (finalEl.type === "arrow") {
        const endMagnet = magnetTarget;
        if (endMagnet) {
          finalEl.endNodeId = endMagnet.id;
        }
        if (finalEl.startNodeId) {
          // Magnetic arrow: reset x,y,width,height — they are computed from node positions
          finalEl.x = 0; finalEl.y = 0; finalEl.width = 0; finalEl.height = 0;
        }
      }

      setCurrentElement(null);
      setIsDrawing(false);
      setMagnetTarget(null);
      setArrowStartNodeId(null);

      if (
        finalEl.type === "pencil" ? (finalEl.points?.length || 0) > 2 :
        finalEl.type === "arrow" ? true :
        Math.abs(finalEl.width) > 5 || Math.abs(finalEl.height) > 5
      ) {
        await addElementMutation({ id: id as Id<"slates">, element: JSON.stringify(finalEl) });
      }

      if (id && myUserId) {
        updatePresenceMutation({
          slateId: id as Id<"slates">, userId: myUserId, userName: myUserName,
          userAvatar: myUserAvatar, cursorX: 0, cursorY: 0, drawingElement: undefined,
        });
      }
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      if (ev.target?.result) {
        const newEl: SystemNode = {
          id: `image-${Date.now()}`, type: "image", title: "",
          x: -pan.x + 100, y: -pan.y + 100, width: 200, height: 200,
          strokeColor: "#000", fillColor: "transparent", strokeWidth: 1,
          imageSrc: ev.target.result as string,
        };
        await addElementMutation({ id: id as any, element: JSON.stringify(newEl) });
      }
    };
    reader.readAsDataURL(file);
  };

  // ─── Render ──────────────────────────────────────────────────────────────────
  const renderElement = (ctx: CanvasRenderingContext2D, el: SystemNode, isSelected: boolean) => {
    ctx.save();

    // Magnetic/connected arrow
    if (el.type === "arrow" && el.startNodeId && el.endNodeId) {
      const startNode = elements.find((e) => e.id === el.startNodeId);
      const endNode = elements.find((e) => e.id === el.endNodeId);
      if (startNode && endNode) {
        const endCenter = getNodeCenter(endNode);
        const startCenter = getNodeCenter(startNode);
        const from = getNodeEdgePoint(startNode, endCenter);
        const to = getNodeEdgePoint(endNode, startCenter);
        drawOrthogonalArrow(ctx, from, to, el.strokeColor || el.color || "#6B7280", isSelected);
        // Arrow label
        if (el.text) {
          const midX = (from.x + to.x) / 2;
          const midY = (from.y + to.y) / 2;
          ctx.fillStyle = "#808080";
          ctx.font = "10px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(el.text, midX, midY - 6);
          ctx.textAlign = "left";
        }
      }
      ctx.restore();
      return;
    }

    if (el.type === "node") {
      ctx.fillStyle = el.fillColor || "#141414";
      ctx.strokeStyle = isSelected ? "#FFFFFF" : "#2B2B2B";
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.roundRect(el.x, el.y, el.width, el.height, 12);
      ctx.fill(); ctx.stroke();

      let iconColor = "#FFFFFF";
      let iconBg = "rgba(255, 255, 255, 0.1)";
      let svgPaths: string[] = [];
      
      if (el.nodeType === "database") {
        iconColor = "#FFFFFF"; iconBg = "rgba(255, 255, 255, 0.1)";
        svgPaths = ["M 3 5 A 9 3 0 1 0 21 5 A 9 3 0 1 0 3 5", "M3 5V19A9 3 0 0 0 21 19V5", "M3 12A9 3 0 0 0 21 12"];
      } else if (el.nodeType === "gateway") {
        iconColor = "#818CF8"; iconBg = "rgba(129, 140, 248, 0.1)";
        svgPaths = ["M13 2 L3 14 L12 14 L11 22 L21 10 L12 10 L13 2"];
      } else if (el.nodeType === "server") {
        iconColor = "#34D399"; iconBg = "rgba(52, 211, 153, 0.1)";
        svgPaths = ["M2 2 h20 v8 h-20 z", "M2 14 h20 v8 h-20 z", "M6 6 h0.01", "M6 18 h0.01"];
      } else if (el.nodeType === "balancer") {
        iconColor = "#FBBF24"; iconBg = "rgba(251, 191, 36, 0.1)";
        svgPaths = ["M4 4 h16 v16 h-16 z", "M9 9 h6 v6 h-6 z", "M15 2 v2", "M15 20 v2", "M2 15 h2", "M2 9 h2", "M20 15 h2", "M20 9 h2", "M9 2 v2", "M9 20 v2"];
      } else if (el.nodeType === "cache") {
        iconColor = "#FB7185"; iconBg = "rgba(251, 113, 133, 0.1)";
        svgPaths = ["M22 12 L2 12", "M5.45 5.11 L2 12 v6 a2 2 0 0 0 2 2 h16 a2 2 0 0 0 2-2 v-6 l-3.45-6.89 A2 2 0 0 0 16.76 4 H7.24 a2 2 0 0 0-1.79 1.11 z", "M6 16 h0.01", "M10 16 h0.01"];
      } else if (el.nodeType === "client") {
        iconColor = "#38BDF8"; iconBg = "rgba(56, 189, 248, 0.1)";
        svgPaths = ["M12 12 m-10 0a10 10 0 1 0 20 0a10 10 0 1 0 -20 0", "M12 2 a14.5 14.5 0 0 0 0 20 a14.5 14.5 0 0 0 0-20", "M2 12 h20"];
      } else if (el.nodeType === "storage") {
        iconColor = "#22D3EE"; iconBg = "rgba(34, 211, 238, 0.1)";
        svgPaths = ["M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"];
      } else if (el.nodeType === "queue") {
        iconColor = "#F472B6"; iconBg = "rgba(244, 114, 182, 0.1)";
        svgPaths = ["M16 16 h6 v6 h-6 z", "M2 16 h6 v6 h-6 z", "M9 2 h6 v6 h-6 z", "M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3", "M12 12V8"];
      } else if (el.nodeType === "serverless") {
        iconColor = "#FB923C"; iconBg = "rgba(251, 146, 60, 0.1)";
        svgPaths = ["M4 17 L10 11 L4 5", "M12 19 h8"];
      } else {
        svgPaths = ["M12 2 L2 22 L22 22 Z"];
      }

      // Draw Icon Box
      ctx.fillStyle = iconBg;
      ctx.beginPath();
      ctx.roundRect(el.x + 14, el.y + 25, 40, 40, 10);
      ctx.fill();

      // Draw SVG Icon
      ctx.save();
      ctx.translate(el.x + 14 + 8, el.y + 25 + 8);
      ctx.strokeStyle = iconColor;
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      svgPaths.forEach(d => {
        try {
            const p = new Path2D(d);
            ctx.stroke(p);
        } catch (e) {}
      });
      ctx.restore();

      // Text
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(el.title, el.x + 66, el.y + 44);
      if (el.subtitle) {
        ctx.fillStyle = "#808080";
        ctx.font = "11px sans-serif";
        ctx.fillText(el.subtitle, el.x + 66, el.y + 60);
      }
    } else if (el.type === "rectangle" || el.type === "frame") {
      ctx.fillStyle = el.fillColor;
      ctx.strokeStyle = isSelected ? "#FFFFFF" : el.strokeColor;
      ctx.lineWidth = el.strokeWidth;
      if (el.fillColor !== "transparent") ctx.fillRect(el.x, el.y, el.width, el.height);
      ctx.strokeRect(el.x, el.y, el.width, el.height);
    } else if (el.type === "circle") {
      ctx.fillStyle = el.fillColor;
      ctx.strokeStyle = isSelected ? "#FFFFFF" : el.strokeColor;
      ctx.lineWidth = el.strokeWidth;
      ctx.beginPath();
      const rx = Math.abs(el.width) / 2;
      const ry = Math.abs(el.height) / 2;
      ctx.ellipse(el.x + rx, el.y + ry, rx, ry, 0, 0, 2 * Math.PI);
      if (el.fillColor !== "transparent") ctx.fill();
      ctx.stroke();
    } else if (el.type === "diamond") {
      ctx.fillStyle = el.fillColor;
      ctx.strokeStyle = isSelected ? "#FFFFFF" : el.strokeColor;
      ctx.lineWidth = el.strokeWidth;
      ctx.beginPath();
      ctx.moveTo(el.x + el.width / 2, el.y);
      ctx.lineTo(el.x + el.width, el.y + el.height / 2);
      ctx.lineTo(el.x + el.width / 2, el.y + el.height);
      ctx.lineTo(el.x, el.y + el.height / 2);
      ctx.closePath();
      if (el.fillColor !== "transparent") ctx.fill();
      ctx.stroke();
    } else if (el.type === "triangle") {
      ctx.fillStyle = el.fillColor;
      ctx.strokeStyle = isSelected ? "#FFFFFF" : el.strokeColor;
      ctx.lineWidth = el.strokeWidth;
      ctx.beginPath();
      ctx.moveTo(el.x + el.width / 2, el.y);
      ctx.lineTo(el.x + el.width, el.y + el.height);
      ctx.lineTo(el.x, el.y + el.height);
      ctx.closePath();
      if (el.fillColor !== "transparent") ctx.fill();
      ctx.stroke();
    } else if (el.type === "image" && el.imageSrc) {
      const img = new (window as any).Image();
      img.src = el.imageSrc;
      ctx.drawImage(img, el.x, el.y, el.width, el.height);
      if (isSelected) {
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(el.x, el.y, el.width, el.height);
      }
    } else if (el.type === "arrow") {
      // Free-draw arrow (not connected)
      ctx.strokeStyle = isSelected ? "#FFFFFF" : el.strokeColor;
      ctx.lineWidth = el.strokeWidth;
      const toX = el.x + el.width;
      const toY = el.y + el.height;
      ctx.beginPath();
      ctx.moveTo(el.x, el.y);
      ctx.lineTo(toX, toY);
      ctx.stroke();
      const headLen = 14;
      const angle = Math.atan2(toY - el.y, toX - el.x);
      ctx.beginPath();
      ctx.moveTo(toX, toY);
      ctx.lineTo(toX - headLen * Math.cos(angle - Math.PI / 6), toY - headLen * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(toX, toY);
      ctx.lineTo(toX - headLen * Math.cos(angle + Math.PI / 6), toY - headLen * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    } else if (el.type === "line") {
      ctx.strokeStyle = isSelected ? "#FFFFFF" : el.strokeColor;
      ctx.lineWidth = el.strokeWidth;
      ctx.beginPath();
      ctx.moveTo(el.x, el.y);
      ctx.lineTo(el.x + el.width, el.y + el.height);
      ctx.stroke();
    } else if (el.type === "pencil" && el.points) {
      ctx.strokeStyle = isSelected ? "#FFFFFF" : el.strokeColor;
      ctx.lineWidth = el.strokeWidth;
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      if (el.points.length > 0) {
        ctx.beginPath();
        ctx.moveTo(el.points[0].x, el.points[0].y);
        for (let i = 1; i < el.points.length; i++) ctx.lineTo(el.points[i].x, el.points[i].y);
        ctx.stroke();
      }
    } else if (el.type === "text") {
      ctx.fillStyle = el.strokeColor || "#FFFFFF";
      ctx.font = "bold 15px sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText(el.text || "Text Label", el.x, el.y);
      ctx.textBaseline = "alphabetic";
    }

    // Draw text inside shapes (rectangle, circle, diamond, triangle)
    if (["rectangle", "frame", "circle", "diamond", "triangle"].includes(el.type) && el.text) {
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 14px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const cx = el.x + Math.abs(el.width) / 2;
      const cy = el.y + Math.abs(el.height) / 2;
      ctx.fillText(el.text, cx, cy);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }

    // Selection outline
    if (isSelected && el.type !== "arrow") {
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(el.x - 4, el.y - 4, el.width + 8, el.height + 8);
      ctx.setLineDash([]);
      // Resize handle (bottom-right)
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(
        el.x + el.width - RESIZE_HANDLE_SIZE / 2,
        el.y + el.height - RESIZE_HANDLE_SIZE / 2,
        RESIZE_HANDLE_SIZE,
        RESIZE_HANDLE_SIZE
      );
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.strokeRect(
        el.x + el.width - RESIZE_HANDLE_SIZE / 2,
        el.y + el.height - RESIZE_HANDLE_SIZE / 2,
        RESIZE_HANDLE_SIZE,
        RESIZE_HANDLE_SIZE
      );
    }

    ctx.restore();
  };

  // Draw the faint grid
  const renderGrid = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += SNAP_GRID) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += SNAP_GRID) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.restore();
  };

  // Main render loop
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = canvas.parentElement?.clientWidth || window.innerWidth;
    canvas.height = canvas.parentElement?.clientHeight || window.innerHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(zoom / 100, zoom / 100);
    ctx.translate(pan.x, pan.y);

    renderGrid(ctx, canvas.width / (zoom / 100), canvas.height / (zoom / 100));

    const allEls = currentElement ? [...elements, currentElement] : elements;

    // Draw arrows first (behind nodes)
    allEls.filter((el) => el.type === "arrow").forEach((el) => renderElement(ctx, el, selectedIds.has(el.id)));
    // Draw non-arrows
    allEls.filter((el) => el.type !== "arrow").forEach((el) => renderElement(ctx, el, selectedIds.has(el.id)));

    // Magnet highlight
    if (magnetTarget) {
      ctx.save();
      ctx.strokeStyle = "#10B981";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(magnetTarget.x - 6, magnetTarget.y - 6, magnetTarget.width + 12, magnetTarget.height + 12);
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Teammates
    if (activePresence && activePresence.length > 0) {
      const colors = ["#FFFFFF", "#3B82F6", "#22C55E", "#F59E0B", "#EF4444"];
      activePresence.forEach((p, idx) => {
        if (p.userId === myUserId) return;
        if (p.drawingElement) {
          try { renderElement(ctx, JSON.parse(p.drawingElement), false); } catch (e) {}
        }
        const cc = colors[idx % colors.length];
        ctx.save();
        ctx.fillStyle = cc;
        ctx.beginPath();
        ctx.moveTo(p.cursorX, p.cursorY);
        ctx.lineTo(p.cursorX + 14, p.cursorY + 14);
        ctx.lineTo(p.cursorX + 6, p.cursorY + 16);
        ctx.lineTo(p.cursorX, p.cursorY + 22);
        ctx.closePath(); ctx.fill();
        const tagText = p.userName || "Teammate";
        ctx.font = "bold 11px sans-serif";
        const tw = ctx.measureText(tagText).width + 12;
        ctx.beginPath();
        ctx.roundRect(p.cursorX + 12, p.cursorY + 18, tw, 20, 6);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.fillText(tagText, p.cursorX + 18, p.cursorY + 32);
        ctx.restore();
      });
    }

    // Selection net
    if (selectionNet && selectionNet.w > 0) {
      ctx.save();
      ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.fillRect(selectionNet.x, selectionNet.y, selectionNet.w, selectionNet.h);
      ctx.strokeRect(selectionNet.x, selectionNet.y, selectionNet.w, selectionNet.h);
      ctx.setLineDash([]);
      ctx.restore();
    }

    ctx.restore();
  }, [elements, currentElement, selectedIds, activePresence, zoom, pan, viewMode, magnetTarget, selectionNet]);

  // Keyboard shortcuts
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "v") setActiveTool("select");
      if (e.key === "r") setActiveTool("rectangle");
      if (e.key === "o") setActiveTool("circle");
      if (e.key === "a") setActiveTool("arrow");
      if (e.key === "t") setActiveTool("text");
      if (e.key === "e") setActiveTool("eraser");
      if (e.key === "l") setActiveTool("line");
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.size > 0 && !isReadOnly) {
        selectedIds.forEach((sid) => {
          removeElementMutation({ id: id as Id<"slates">, elementId: sid });
        });
        setSelectedIds(new Set());
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsCommandOpen(true);
      }
      if (e.key === "Escape") { setSelectedIds(new Set()); setSelectionNet(null); setNetStart(null); }
      if (e.key === "+") setZoom((z) => Math.min(200, z + 10));
      if (e.key === "-") setZoom((z) => Math.max(30, z - 10));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedIds, isReadOnly, id]);

  const getCursor = () => {
    if (isReadOnly) return "default";
    if (isPanning) return "grabbing";
    if (activeTool === "hand") return "grab";
    if (isDragging) return "grabbing";
    if (isResizing) return "se-resize";
    if (activeTool === "eraser") {
      return `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="white" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>') 4 20, crosshair`;
    }
    if (activeTool === "select") return "default";
    return "crosshair";
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0A0A0A] text-white font-sans overflow-hidden select-none">
      <CommandPalette open={isCommandOpen} onOpenChange={setIsCommandOpen} onNewSlate={() => setIsLibraryOpen(true)} />{/* MAIN BODY */}
      <div className="flex-1 flex overflow-hidden relative">

        {/* FLOATING UI SHELL */}
        {!isUiHidden && (
          <>
            {/* TOP LEFT: Project Identity */}
            <div className="absolute top-4 left-4 z-40 flex items-center gap-3 bg-[#141414]/80 backdrop-blur-xl border border-white/10 rounded-2xl px-3 py-2 shadow-2xl">
              <Link href="/dashboard" className="flex items-center gap-2 group">
                <Image src="/logo.png" alt="Slate Logo" width={26} height={26} className="rounded-lg shadow-sm group-hover:scale-105 transition-transform" />
                <span className="font-bold text-xs tracking-tight text-white">{slate?.title || "LLD Architecture Design"}</span>
              </Link>
              {isReadOnly ? (
                <div className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-bold flex items-center gap-1">
                  <Eye className="w-3 h-3" />View Only
                </div>
              ) : (
                <div className="px-2 py-0.5 rounded-full bg-white/10 border border-white/20 text-white text-[10px] font-bold flex items-center gap-1">
                  <Edit3 className="w-3 h-3" />Edit Access
                </div>
              )}
              {!isReadOnly && (
                <div className="text-[11px] font-semibold text-[#808080] flex items-center gap-1.5 ml-1 border-l border-white/10 pl-3">
                  {isSaving ? (
                    <span className="text-white flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" />Syncing</span>
                  ) : (
                    <span className="text-emerald-400 flex items-center gap-1"><Check className="w-3 h-3" />Synced</span>
                  )}
                </div>
              )}
            </div>

            {/* TOP RIGHT: Global Actions */}
            <div className="absolute top-4 right-4 z-40 flex items-center gap-2 bg-[#141414]/80 backdrop-blur-xl border border-white/10 rounded-2xl px-2 py-1.5 shadow-2xl">
              <button onClick={() => setIsCommandOpen(true)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl hover:bg-white/10 text-xs font-medium text-[#C5C5C5] hover:text-white transition-all cursor-pointer">
                <Search className="w-3.5 h-3.5" />
                <kbd className="px-1 py-0.5 rounded bg-black/40 text-[9px] font-mono text-[#808080]">Ctrl K</kbd>
              </button>

              <div className="w-px h-5 bg-white/10 mx-1" />

              <div className="flex items-center gap-1 bg-black/20 border border-white/5 px-2 py-1 rounded-full cursor-help" title={`${activePresence ? activePresence.length : 1} live users`}>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse mr-1" />
                <div className="flex -space-x-1.5">
                  {activePresence?.map((p, idx) => (
                    <div key={p._id || idx} className="w-5 h-5 rounded-full bg-[#202020] text-black border border-[#141414] flex items-center justify-center text-[9px] font-bold text-white uppercase overflow-hidden">
                      {p.userAvatar ? <img src={p.userAvatar} alt={p.userName} className="w-full h-full object-cover" /> : p.userName?.charAt(0) || "U"}
                    </div>
                  ))}
                </div>
              </div>

              <Dialog open={isShareModalOpen} onOpenChange={setIsShareModalOpen}>
                <DialogTrigger className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 border border-white/10 text-xs font-bold text-white hover:bg-white hover:text-black transition-all cursor-pointer ml-1">
                  <Share2 className="w-3.5 h-3.5" />Share
                </DialogTrigger>
                <DialogContent className="bg-[#101010] border border-white/10 text-white max-w-md rounded-2xl p-6 shadow-2xl">
                  <DialogHeader className="mb-3">
                    <DialogTitle className="text-lg font-bold flex items-center gap-2"><Users className="w-5 h-5 text-white" />Collaborate & Share Slate</DialogTitle>
                    <DialogDescription className="text-xs text-[#808080]">Invite team members to view or edit this architecture canvas in real-time.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 mb-4">
                    {(["edit", "view"] as const).map((mode) => (
                      <div key={mode} className="p-3 rounded-xl bg-[#141414] border border-white/10 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white flex items-center gap-1.5">
                            {mode === "edit" ? <Edit3 className="w-3.5 h-3.5 text-white" /> : <Eye className="w-3.5 h-3.5 text-amber-400" />}
                            {mode === "edit" ? "Edit Access Link" : "View Only Link"}
                          </span>
                          <span className={`text-[10px] font-semibold ${mode === "edit" ? "text-white" : "text-amber-400"}`}>{mode === "edit" ? "Can edit & draw" : "Read-only"}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <input type="text" readOnly value={typeof window !== "undefined" ? `${window.location.origin}/canvas/${id}?mode=${mode}` : ""}
                            className="w-full bg-[#0A0A0A] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-[#C5C5C5] font-mono outline-none" />
                          <Button size="sm" onClick={() => handleCopyLink(mode)}
                            className={`rounded-lg text-white cursor-pointer text-xs flex items-center gap-1 shrink-0 h-8 ${mode === "edit" ? "bg-white text-black hover:bg-white/90" : "bg-white/10 hover:bg-white/20"}`}>
                            {copiedType === mode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                            {copiedType === mode ? "Copied!" : "Copy"}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </DialogContent>
              </Dialog>

              <Button onClick={() => setIsAiChatOpen(!isAiChatOpen)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white transition-all cursor-pointer h-8 ${isAiChatOpen ? "bg-white text-black shadow-[0_0_15px_rgba(255,255,255,0.3)]" : "bg-white/10 text-white hover:bg-white hover:text-black shadow-sm"}`}>
                <Sparkles className="w-3.5 h-3.5" />AI
              </Button>
              
              <div className="w-px h-5 bg-white/10 mx-1" />

              <div className="flex items-center gap-0.5 px-1">
                <button onClick={() => setZoom((z) => Math.max(30, z - 10))} className="text-[#808080] hover:text-white hover:bg-white/10 rounded p-1 cursor-pointer w-6 h-6 flex items-center justify-center">−</button>
                <span className="text-[10px] font-bold text-white w-9 text-center">{zoom}%</span>
                <button onClick={() => setZoom((z) => Math.min(200, z + 10))} className="text-[#808080] hover:text-white hover:bg-white/10 rounded p-1 cursor-pointer w-6 h-6 flex items-center justify-center">+</button>
              </div>
            </div>

            {/* BOTTOM CENTER: View Modes */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center p-1.5 rounded-2xl bg-[#141414]/80 backdrop-blur-xl border border-white/10 shadow-[0_20px_40px_rgba(0,0,0,0.4)]">
              {(["document", "both", "canvas"] as ViewMode[]).map((vm) => (
                <button key={vm} onClick={() => setViewMode(vm)}
                  className={`px-4 py-2 rounded-xl text-[11px] font-extrabold uppercase tracking-wide transition-all cursor-pointer flex items-center gap-2 ${viewMode === vm ? "bg-white text-black shadow-md" : "text-[#808080] hover:text-white hover:bg-white/5"}`}>
                  {vm === "document" ? <><FileText className="w-3.5 h-3.5" />Doc</> : vm === "both" ? <><Layout className="w-3.5 h-3.5" />Split</> : <><Maximize2 className="w-3.5 h-3.5" />Canvas</>}
                </button>
              ))}
            </div>
          </>
        )}

        {/* LEFT FLOATING TOOLBAR */}
        {viewMode !== "document" && !isUiHidden && (
          <aside className={`absolute left-4 top-1/2 -translate-y-1/2 z-40 flex flex-col items-center gap-1.5 py-4 px-2 rounded-[24px] bg-[#141414]/80 backdrop-blur-xl border border-white/10 shadow-[0_20px_40px_rgba(0,0,0,0.4)] ${isReadOnly ? "opacity-50 pointer-events-none" : ""}`}>
            
            <Dialog open={isLibraryOpen} onOpenChange={setIsLibraryOpen}>
              <DialogTrigger className="p-2 rounded-xl text-[#808080] hover:text-white hover:bg-[#202020] transition-colors cursor-pointer group">
                <Plus className="w-5 h-5 text-white group-hover:scale-110 transition-transform" />
              </DialogTrigger>
              <DialogContent className="bg-[#101010]/95 backdrop-blur-2xl border border-white/10 text-white max-w-lg rounded-2xl p-6 shadow-2xl">
                <DialogHeader className="mb-4">
                  <DialogTitle className="text-lg font-bold flex items-center gap-2"><Layers className="w-5 h-5 text-white" />Architecture Component Library</DialogTitle>
                  <DialogDescription className="text-xs text-[#808080]">Click any component to insert directly onto your canvas.</DialogDescription>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-3 mb-2">
                  {[
                    { nodeType: "database" as const, title: "PostgreSQL Database", subtitle: "Primary Relational DB", Icon: Database, color: "text-white", bg: "bg-white text-black/10" },
                    { nodeType: "gateway" as const, title: "API Gateway", subtitle: "REST & GraphQL Router", Icon: Zap, color: "text-indigo-400", bg: "bg-indigo-500/10" },
                    { nodeType: "server" as const, title: "Microservice Cluster", subtitle: "Node.js Server Instances", Icon: Server, color: "text-emerald-400", bg: "bg-emerald-500/10" },
                    { nodeType: "balancer" as const, title: "Load Balancer", subtitle: "Nginx / ALB Distribution", Icon: Cpu, color: "text-amber-400", bg: "bg-amber-500/10" },
                    { nodeType: "cache" as const, title: "Redis Cache", subtitle: "In-Memory Session Store", Icon: HardDrive, color: "text-rose-400", bg: "bg-rose-500/10" },
                    { nodeType: "client" as const, title: "Client Frontend", subtitle: "React / Mobile App", Icon: Globe, color: "text-sky-400", bg: "bg-sky-500/10" },
                    { nodeType: "storage" as const, title: "Object Storage", subtitle: "S3 Bucket / Blob", Icon: Cloud, color: "text-cyan-400", bg: "bg-cyan-500/10" },
                    { nodeType: "queue" as const, title: "Message Queue", subtitle: "Kafka / RabbitMQ", Icon: Network, color: "text-pink-400", bg: "bg-pink-500/10" },
                    { nodeType: "serverless" as const, title: "Serverless", subtitle: "AWS Lambda / Cloudflare", Icon: Terminal, color: "text-orange-400", bg: "bg-orange-500/10" },
                  ].map(({ nodeType, title, subtitle, Icon, color, bg }) => (
                    <button key={nodeType} onClick={() => handleAddComponentNode(nodeType, title, subtitle)}
                      className="p-3.5 rounded-2xl border border-white/5 bg-white/5 hover:bg-white/10 hover:border-white/20 text-left transition-all cursor-pointer flex items-center gap-3 group">
                      <div className={`p-2 rounded-lg ${bg} ${color} group-hover:scale-110 transition-transform`}><Icon className="w-5 h-5" /></div>
                      <div><h4 className="text-xs font-bold text-white">{title.split(" ")[0]}</h4><p className="text-[10px] text-[#808080]">{subtitle}</p></div>
                    </button>
                  ))}
                </div>
              </DialogContent>
            </Dialog>

            <div className="w-8 h-px bg-white/10 my-1.5" />

            {([
              { tool: "select" as Tool, Icon: MousePointer, title: "Select (v)" },
              { tool: "hand" as Tool, Icon: Hand, title: "Hand - Pan Canvas (h)" },
              { tool: "pencil" as Tool, Icon: Pencil, title: "Pencil (p)" },
              { tool: "rectangle" as Tool, Icon: Square, title: "Rectangle (r)" },
              { tool: "circle" as Tool, Icon: CircleIcon, title: "Circle (o)" },
              { tool: "arrow" as Tool, Icon: ArrowUpRight, title: "Arrow (a)" },
              { tool: "line" as Tool, Icon: Minus, title: "Line (l)" },
              { tool: "eraser" as Tool, Icon: Eraser, title: "Eraser (e)" },
              { tool: "text" as Tool, Icon: Type, title: "Text (t)" },
            ] as { tool: Tool; Icon: any; title: string }[]).map(({ tool, Icon, title }) => (
              <button key={tool} onClick={() => setActiveTool(tool)} title={title}
                className={`p-2.5 rounded-[14px] transition-all cursor-pointer hover:scale-110 active:scale-95 ${activeTool === tool ? "bg-white text-black shadow-md" : "text-[#808080] hover:text-white hover:bg-white/10"}`}>
                <Icon className="w-5 h-5" />
              </button>
            ))}

            {/* Color pickers matching screenshot */}
            <div className="w-8 h-px bg-white/10 my-1.5" />
            
            <div className="flex flex-col items-center gap-3 py-1">
              {/* Solid White Circle (Stroke) */}
              <label title="Stroke Color" className="cursor-pointer">
                <input type="color" value={strokeColor} onChange={(e) => setStrokeColor(e.target.value)} className="w-0 h-0 opacity-0 absolute" />
                <div className="w-7 h-7 rounded-full cursor-pointer flex items-center justify-center border-2 border-transparent" style={{ background: strokeColor === "transparent" ? "#000" : strokeColor }}>
                   {strokeColor === "transparent" && <div className="w-7 h-0.5 bg-red-500 rotate-45" />}
                </div>
              </label>
              
              {/* Outline Circle (Fill) */}
              <label title="Fill Color" className="cursor-pointer">
                <input type="color" value={fillColor === "transparent" ? "#141414" : fillColor} onChange={(e) => setFillColor(e.target.value)} className="w-0 h-0 opacity-0 absolute" />
                <div className="w-7 h-7 rounded-full border-[3px] border-[#2B2B2B] cursor-pointer flex items-center justify-center" style={{ backgroundColor: fillColor === "transparent" ? "transparent" : fillColor }}>
                </div>
              </label>
            </div>
          </aside>
        )}

        {/* MARKDOWN EDITOR */}
        {(viewMode === "document" || viewMode === "both") && (
          <div className={`h-full border-r border-[#2B2B2B] bg-[#0A0A0A] flex flex-col p-6 overflow-y-auto ${viewMode === "both" ? "w-1/2" : "w-full"}`}>
            <div className="flex items-center justify-between mb-4 border-b border-[#2B2B2B] pb-3">
              <span className="text-xs font-extrabold uppercase tracking-wider text-white flex items-center gap-1.5"><FileText className="w-4 h-4" />System Documentation</span>
              <span className="text-[10px] font-semibold text-[#808080]">{isReadOnly ? "Read Only" : "Auto-saving markdown"}</span>
            </div>
            <textarea value={docText} readOnly={isReadOnly}
              onChange={(e) => { setDocText(e.target.value); saveDocToConvex(e.target.value); }}
              placeholder="Write system documentation here..."
              className="w-full h-full bg-transparent text-sm text-[#C5C5C5] outline-none resize-none font-mono leading-relaxed placeholder-[#666666] p-0 border-none focus:ring-0" />
          </div>
        )}

        
        {isUiHidden && (
          <div className="absolute top-4 right-4 z-40 pointer-events-auto">
            <button onClick={() => setIsUiHidden(false)} className="px-4 py-2 rounded-xl bg-[#141414]/80 backdrop-blur-md border border-white/10 text-xs font-bold text-white hover:bg-white/20 transition-colors shadow-2xl cursor-pointer">
              Show UI
            </button>
          </div>
        )}
{/* CANVAS */}
        {(viewMode === "canvas" || viewMode === "both") && (
          <div className={`h-full relative overflow-hidden bg-[#0D0D0D] ${viewMode === "both" ? "w-1/2" : "w-full"}`}>
            
            
            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />

            {inlineText && (
              <input autoFocus value={inlineText.text} placeholder="Type text..."
                onChange={(e) => setInlineText({ ...inlineText, text: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Enter") commitInlineText(); if (e.key === "Escape") { setInlineText(null); setActiveTool("select"); } }}
                onBlur={commitInlineText}
                onMouseDown={(e) => e.stopPropagation()}
                className="absolute z-40 bg-[#141414] text-white font-bold border border-white rounded-lg px-2.5 py-1.5 text-sm outline-none shadow-2xl"
                style={{ left: `${(inlineText.x + pan.x) * (zoom / 100)}px`, top: `${(inlineText.y + pan.y) * (zoom / 100)}px`, minWidth: "140px" }} />
            )}

            {/* Selected count badge */}
            {selectedIds.size > 1 && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 px-3 py-1 rounded-full bg-white text-black text-white text-xs font-bold shadow-lg">
                {selectedIds.size} elements selected · Drag to move · Del to delete
              </div>
            )}

            {/* Snap hint */}
            {activeTool === "arrow" && !isReadOnly && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded-full bg-[#101010] border border-[#2B2B2B] text-[#808080] text-[10px] font-medium">
                🧲 Hover over a node to magnetically connect arrows
              </div>
            )}

            <canvas ref={canvasRef}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              className="w-full h-full block"
              style={{ cursor: getCursor() }} />
          </div>
        )}

        {/* AI CHAT DRAWER */}
        {isAiChatOpen && (
          <aside className="absolute top-0 right-0 h-full w-80 bg-[#101010] border-l border-[#2B2B2B] shadow-2xl z-50 flex flex-col justify-between">
            <div className="p-4 border-b border-[#2B2B2B] flex items-center justify-between">
              <span className="font-bold text-sm text-white flex items-center gap-2"><Sparkles className="w-4 h-4 text-white" />Slate Architecture AI</span>
              <button onClick={() => setIsAiChatOpen(false)} className="p-1 text-[#808080] hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 p-4 space-y-3 overflow-y-auto text-xs">
              {aiMessages.map((msg, idx) => (
                <div key={idx} className={`p-3 rounded-xl ${msg.role === "user" ? "bg-white text-black border border-white/40 ml-6 font-medium" : "bg-[#141414] border border-[#2B2B2B] text-[#C5C5C5] mr-6"}`}>
                  {msg.text}
                </div>
              ))}
            </div>
            <form onSubmit={handleSendAi} className="p-3 border-t border-[#2B2B2B] flex items-center gap-2">
              <input type="text" placeholder="Ask AI to design system..." value={aiInput} onChange={(e) => setAiInput(e.target.value)}
                className="w-full bg-[#141414] border border-[#2B2B2B] rounded-xl px-3 py-2 text-xs text-white outline-none placeholder-[#666666]" />
              <button type="submit" className="p-2 rounded-xl bg-white text-black hover:bg-[#E5E5E5] cursor-pointer"><Send className="w-3.5 h-3.5" /></button>
            </form>
          </aside>
        )}
      </div>
    </div>
  );
}
