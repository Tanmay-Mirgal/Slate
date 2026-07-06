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
  Minimize2,
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
Cloud, Network, Terminal, Pencil, Code, Smile, Monitor, ChevronRight, ChevronLeft, Grid } from "lucide-react";
import * as LucideReactIcons from "lucide-react";
import { icons as LucideCoreIcons } from "lucide";

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
  nodeType?: "database" | "server" | "gateway" | "balancer" | "cache" | "storage" | "client" | "icon" | "queue" | "serverless" | "node" | "group";
  lucideIcon?: string | null;
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

function drawMagneticArrow(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  color: string,
  isSelected: boolean
) {
  ctx.strokeStyle = isSelected ? "#FFFFFF" : color;
  ctx.lineWidth = isSelected ? 2.5 : 1.8;
  ctx.setLineDash([]);
  
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const isVertical = Math.abs(dy) > Math.abs(dx);
  
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);

  if (Math.abs(dx) < 20 || Math.abs(dy) < 20) {
    ctx.lineTo(to.x, to.y);
  } else {
    const radius = Math.min(12, Math.abs(dx) / 2, Math.abs(dy) / 2);
    if (isVertical) {
      const midY = from.y + dy / 2;
      const dirX = Math.sign(dx);
      const dirY = Math.sign(dy);
      ctx.lineTo(from.x, midY - dirY * radius);
      ctx.arcTo(from.x, midY, from.x + dirX * radius, midY, radius);
      ctx.lineTo(to.x - dirX * radius, midY);
      ctx.arcTo(to.x, midY, to.x, midY + dirY * radius, radius);
      ctx.lineTo(to.x, to.y);
    } else {
      const midX = from.x + dx / 2;
      const dirX = Math.sign(dx);
      const dirY = Math.sign(dy);
      ctx.lineTo(midX - dirX * radius, from.y);
      ctx.arcTo(midX, from.y, midX, from.y + dirY * radius, radius);
      ctx.lineTo(midX, to.y - dirY * radius);
      ctx.arcTo(midX, to.y, midX + dirX * radius, to.y, radius);
      ctx.lineTo(to.x, to.y);
    }
  }
  ctx.stroke();

  // Arrowhead pointing along the tangent at 'to'
  const headLen = 10;
  // For orthogonal routing, the final segment entering 'to' is vertical if isVertical, else horizontal
  const angle = isVertical ? Math.atan2(dy, 0) : Math.atan2(0, dx);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - headLen * Math.cos(angle - Math.PI / 6), to.y - headLen * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - headLen * Math.cos(angle + Math.PI / 6), to.y - headLen * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
}

const AVAILABLE_ICONS = [
  "User", "Users", "Server", "Database", "Cloud", "HardDrive", "Cpu", 
  "Globe", "Network", "Terminal", "Zap", "Monitor", "Smartphone", 
  "Tablet", "Laptop", "Wifi", "Bluetooth", "Lock", "Unlock", "Key", 
  "Shield", "ShieldAlert", "Settings", "Sliders", "Activity", "Box", 
  "Layers", "Layout", "Search", "Mail", "MessageSquare", "Phone", 
  "Folder", "File", "FileText", "Image", "Check", "X", "Plus", "Minus", 
  "ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "ChevronRight", 
  "ChevronLeft", "Home", "Star", "Heart", "Bell", "Calendar", "Clock", 
  "MapPin", "Navigation", "Target", "Link", "Paperclip", "Share2", 
  "Download", "Upload", "Trash2", "Edit3", "Copy", "Save", "Eye", 
  "EyeOff", "ZoomIn", "ZoomOut", "RefreshCw", "Menu", "MoreHorizontal", 
  "MoreVertical", "Grid", "List", "Type", "Hash", "Briefcase", 
  "ShoppingCart", "CreditCard", "Award", "Flag", "Map", "Truck", 
  "Package", "Smile", "Code", "Github", "Gitlab", "Trello", "Slack", 
  "Twitter", "Linkedin", "Youtube", "Figma", "Framer", "Codepen",
  "Chrome", "Command", "Webhook", "Workflow", "Boxes", "Container", "Component"
];

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
  const updateElementsMutation = useMutation(api.slates.updateElements);
  const updateDocumentMutation = useMutation(api.slates.updateDocument);
  const updatePresenceMutation = useMutation(api.slates.updatePresence);

  // Layout & Tool
  const [viewMode, setViewMode] = React.useState<ViewMode>("both");
  const [activeTool, setActiveTool] = React.useState<Tool>("select");
  const [zoom, setZoom] = React.useState<number>(100);
  const [isAiChatOpen, setIsAiChatOpen] = React.useState<boolean>(false);
  const [isInsertMenuOpen, setIsInsertMenuOpen] = React.useState<boolean>(false);
  const [insertCategory, setInsertCategory] = React.useState<"main" | "icons" | "shapes" | "diagrams">("main");
  const [iconSearchQuery, setIconSearchQuery] = React.useState("");
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

  const commitInlineText = () => {
    if (!inlineText) return;
    const trimmed = inlineText.text.trim();
    if (trimmed) {
      if (inlineText.isNew) {
        const newEl: SystemNode = {
          id: inlineText.id, type: "text", title: trimmed, text: trimmed,
          x: inlineText.x, y: inlineText.y, width: 140, height: 30,
          strokeColor: strokeColor || "#FFFFFF", fillColor: "transparent", strokeWidth: 2,
        };
        setElements(prev => [...prev, newEl]); // Optimistic update
        addElementMutation({ id: id as Id<"slates">, element: JSON.stringify(newEl) });
      } else {
        const existingEl = elements.find(el => el.id === inlineText.id);
        if (existingEl && (existingEl.text !== trimmed || existingEl.title !== trimmed)) {
          // Update both text and title for consistency
          updateElementMutation({
            id: id as Id<"slates">,
            elementId: inlineText.id,
            updates: JSON.stringify({ text: trimmed, title: trimmed })
          });
        }
      }
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
      setIsInsertMenuOpen(false);
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

                let offsetX = 0;
        let offsetY = 0;
        if (elements.length > 0) {
          let maxX = -Infinity;
          let minY = Infinity;
          elements.forEach(el => {
            if (el.x !== undefined && el.width !== undefined && el.type !== "arrow") {
              maxX = Math.max(maxX, el.x + Math.abs(el.width));
              minY = Math.min(minY, el.y);
            }
          });
          if (maxX !== -Infinity) {
            const incomingMinX = Math.min(...nodeElements.map((el: any) => el.x || 0));
            const incomingMinY = Math.min(...nodeElements.map((el: any) => el.y || 0));
            offsetX = maxX + 300 - incomingMinX; // 300px distance (approx 20cm equivalent in visual space)
            offsetY = (minY === Infinity ? 0 : minY) - incomingMinY;
          }
        }

        const newNodes: SystemNode[] = nodeElements.map((el: any, i: number) => ({
          id: el.id || `node-${Date.now()}-${i}`,
          type: el.type === "icon" ? "node" : (el.type === "ellipse" ? "circle" : el.type === "diamond" ? "rectangle" : el.type === "sticky" ? "frame" : (el.type || "rectangle")),
          nodeType: el.nodeType || ((el.text || "").toLowerCase().includes("db") || (el.text || "").toLowerCase().includes("database") ? "database"
            : (el.text || "").toLowerCase().includes("api") || (el.text || "").toLowerCase().includes("gateway") ? "gateway"
            : "server"),
          lucideIcon: el.lucideIcon,
          title: el.text || "Component Node",
          text: el.text || "Component Node",
          x: snapToGrid((el.x || 100 + (i % 4) * 240) + offsetX),
          y: snapToGrid((el.y || 150 + Math.floor(i / 4) * 160) + offsetY),
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
    
    // Save history before any potential mutation
    if (activeTool !== "hand") {
      commitToHistory(elements);
    }

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
    let madeChanges = false;

    if (isErasing) {
      setIsErasing(false);
      return;
    }

    if (isPanning) {
      setIsPanning(false);
      setDragStart(null);
      return;
    }
    // Finalize resize → sync to Convex
    if (isResizing && resizingId) {
      madeChanges = true;
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

  const handleCanvasDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isReadOnly) return;
    const { x, y } = getCanvasPos(e);
    const target = getNodeAt(x, y);
    if (target) {
      if (target.type === "text" || target.text !== undefined) {
        setInlineText({
          id: target.id,
          x: target.x,
          y: target.y,
          text: target.text || target.title || "",
          isNew: false
        });
      }
    }
  };

  const handleExportPNG = async () => {
    let elementsToExport = selectedIds.size > 0 
      ? elements.filter(el => selectedIds.has(el.id)) 
      : [...elements];

    if (selectedIds.size > 0) {
      let selMinX = Infinity, selMinY = Infinity, selMaxX = -Infinity, selMaxY = -Infinity;
      elementsToExport.forEach(el => {
        if (el.x !== undefined && el.width !== undefined && el.type !== "pencil" && el.type !== "arrow") {
          const x1 = Math.min(el.x, el.x + el.width);
          const y1 = Math.min(el.y, el.y + el.height);
          const x2 = Math.max(el.x, el.x + el.width);
          const y2 = Math.max(el.y, el.y + el.height);
          selMinX = Math.min(selMinX, x1);
          selMinY = Math.min(selMinY, y1);
          selMaxX = Math.max(selMaxX, x2);
          selMaxY = Math.max(selMaxY, y2);
        }
      });
      
      const autoIncluded = elements.filter(el => {
        if (selectedIds.has(el.id)) return false;
        if (el.type === "arrow" || el.type === "pencil") return false;
        if (el.x !== undefined && el.width !== undefined) {
          const cx = el.x + el.width / 2;
          const cy = el.y + el.height / 2;
          return cx >= selMinX && cx <= selMaxX && cy >= selMinY && cy <= selMaxY;
        }
        return false;
      });
      
      elementsToExport = [...elementsToExport, ...autoIncluded];
      const exportIds = new Set(elementsToExport.map(e => e.id));
      
      const connectedArrows = elements.filter(el => 
        el.type === "arrow" && 
        el.startNodeId && exportIds.has(el.startNodeId) && 
        el.endNodeId && exportIds.has(el.endNodeId) &&
        !exportIds.has(el.id)
      );
      elementsToExport = [...elementsToExport, ...connectedArrows];
    }

    if (elementsToExport.length === 0) return;
    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    elementsToExport.forEach(el => {
      if (el.type === "arrow" && el.startNodeId && el.endNodeId) return;
      if (el.width !== undefined && el.height !== undefined && el.type !== "pencil") {
        const x1 = Math.min(el.x, el.x + el.width);
        const y1 = Math.min(el.y, el.y + el.height);
        const x2 = Math.max(el.x, el.x + el.width);
        const y2 = Math.max(el.y, el.y + el.height);
        minX = Math.min(minX, x1);
        minY = Math.min(minY, y1);
        maxX = Math.max(maxX, x2);
        maxY = Math.max(maxY, y2);
      }
      if (el.points) {
        el.points.forEach(p => {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        });
      }
    });

    if (minX === Infinity) return;

    const padding = 40;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += (padding + 60); // Extra bottom space for watermark
    
    const width = maxX - minX;
    const height = maxY - minY;

    // High resolution export, but capped to browser's safe maximum dimension (approx 16000px)
    let exportScale = 50; 
    const MAX_DIMENSION = 16000;
    
    if (width * exportScale > MAX_DIMENSION) {
      exportScale = Math.max(1, Math.floor(MAX_DIMENSION / width));
    }
    if (height * exportScale > MAX_DIMENSION) {
      exportScale = Math.max(1, Math.floor(MAX_DIMENSION / height));
    }

    const offCanvas = document.createElement("canvas");
    offCanvas.width = width * exportScale;
    offCanvas.height = height * exportScale;
    const ctx = offCanvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(exportScale, exportScale);

    // Draw background
    ctx.fillStyle = "#0D0D0D";
    ctx.fillRect(0, 0, width, height);

    // Apply translation to crop to drawn area
    ctx.save();
    ctx.translate(-minX, -minY);

    // Draw elements
    elementsToExport.filter((el) => el.type === "arrow").forEach((el) => renderElement(ctx, el, false));
    elementsToExport.filter((el) => el.type !== "arrow").forEach((el) => renderElement(ctx, el, false));

    ctx.restore();

    // Draw Watermark / Branding at Bottom Right
    ctx.save();
    
    ctx.font = "900 26px sans-serif";
    const textWidth = ctx.measureText("Slate").width;
    
    const logoSize = 32;
    const gap = 12;
    const totalWidth = logoSize + gap + textWidth;
    
    const rightEdge = width - 24;
    const leftEdge = rightEdge - totalWidth;
    
    // Draw Slate text
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText("Slate", rightEdge, height - 28);
    
    // Draw "Powered by Tanmay Mirgal" centered under Logo + Slate
    ctx.font = "600 12px sans-serif";
    ctx.fillStyle = "#808080";
    ctx.textAlign = "center";
    ctx.fillText("Powered by Tanmay Mirgal", leftEdge + totalWidth / 2, height - 10);
    
    // Load and draw logo.png
    try {
      const img = new (window as any).Image();
      img.src = "/logo.svg";
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });
      const logoY = height - 28 - 26; 
      ctx.drawImage(img, leftEdge, logoY, logoSize, logoSize);
    } catch (err) {
      console.error("Failed to load logo", err);
    }
    
    ctx.restore();

    // Export and download
    const dataUrl = offCanvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${slate?.title || "Architecture_Diagram"}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
        drawMagneticArrow(ctx, from, to, el.strokeColor || el.color || "#6B7280", isSelected);
        // Arrow label
        if (el.text) {
          const midX = (from.x + to.x) / 2;
          const midY = (from.y + to.y) / 2;
          ctx.save();
          ctx.fillStyle = "#F8FAFC";
          ctx.font = "bold 12px sans-serif";
          ctx.textAlign = "center";
          
          const maxLineWidth = 130;
          const words = el.text.split(' ');
          const lines = [];
          let currentLine = words[0] || '';

          for (let i = 1; i < words.length; i++) {
            const word = words[i];
            const width = ctx.measureText(currentLine + " " + word).width;
            if (width < maxLineWidth) {
              currentLine += " " + word;
            } else {
              lines.push(currentLine);
              currentLine = word;
            }
          }
          if (currentLine) lines.push(currentLine);
          // Limit label to max 3 lines to prevent tall blocks
          const finalLines = lines.slice(0, 3);
          if (lines.length > 3) finalLines[2] = finalLines[2] + "...";

          // Calculate dimensions for background block
          const blockHeight = finalLines.length * 15;
          let blockWidth = 0;
          finalLines.forEach(l => {
            const w = ctx.measureText(l).width;
            if (w > blockWidth) blockWidth = w;
          });

          // Position text so it is centered on midY
          let startY = midY - (blockHeight / 2) + 10;
          
          // Draw solid opaque background badge to prevent text overlap
          ctx.fillStyle = "#0F172A";
          ctx.strokeStyle = "#334155";
          ctx.lineWidth = 1;
          const padX = 8, padY = 4;
          const rectX = midX - blockWidth / 2 - padX;
          const rectY = midY - (blockHeight / 2) - padY;
          const rectW = blockWidth + padX * 2;
          const rectH = blockHeight + padY * 2;

          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(rectX, rectY, rectW, rectH, 6);
          else ctx.rect(rectX, rectY, rectW, rectH);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = "#F8FAFC";
          finalLines.forEach((line) => {
            ctx.fillText(line, midX, startY);
            startY += 15;
          });
          
          ctx.textAlign = "left";
          ctx.restore();
        }
      }
      ctx.restore();
      return;
    }

    if (el.type === "node") {
      if (el.nodeType === "icon") {
        let iconData: any = null;
        if (el.lucideIcon) iconData = (LucideCoreIcons as any)[el.lucideIcon];
        
        ctx.fillStyle = "#FFFFFF";
        ctx.strokeStyle = isSelected ? "#FFFFFF" : "transparent";
        ctx.lineWidth = 1.5;
        
        if (isSelected) {
          ctx.beginPath();
          ctx.roundRect(el.x, el.y, el.width, el.height, 8);
          ctx.stroke();
        }

        if (iconData) {
          ctx.save();
          ctx.translate(el.x + el.width / 2 - 24, el.y + 12);
          ctx.scale(2, 2); 
          ctx.strokeStyle = "#FFFFFF";
          ctx.lineWidth = 1;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          
          try {
            iconData.forEach(([tag, attrs]: any) => {
              if (tag === 'path') {
                ctx.stroke(new Path2D(attrs.d));
              } else if (tag === 'circle') {
                ctx.beginPath(); ctx.arc(attrs.cx, attrs.cy, attrs.r, 0, 2*Math.PI); ctx.stroke();
              } else if (tag === 'rect') {
                ctx.strokeRect(attrs.x, attrs.y, attrs.width, attrs.height);
              } else if (tag === 'line') {
                ctx.beginPath(); ctx.moveTo(attrs.x1, attrs.y1); ctx.lineTo(attrs.x2, attrs.y2); ctx.stroke();
              } else if (tag === 'polyline' || tag === 'polygon') {
                const pts = attrs.points.split(' ').map((p:string) => p.split(',').map(Number));
                ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
                for(let i=1; i<pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
                if (tag === 'polygon') ctx.closePath();
                ctx.stroke();
              }
            });
          } catch(e) {}
          ctx.restore();
        }
        
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = "#FFFFFF";
        ctx.font = "bold 12px sans-serif";
        ctx.fillText(el.title, el.x + el.width / 2, el.y + 64);
        return;
      }

      ctx.fillStyle = el.fillColor || "#141414";
      ctx.strokeStyle = isSelected ? "#FFFFFF" : "#2B2B2B";
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.roundRect(el.x, el.y, el.width, el.height, 12);
      ctx.fill(); ctx.stroke();

      let iconColor = "#FFFFFF";
      let iconBg = "rgba(255, 255, 255, 0.1)";
      let svgPaths: string[] = [];
      
      let iconData: any = null;

      if (el.nodeType === "database") {
        svgPaths = ["M 3 5 A 9 3 0 1 0 21 5 A 9 3 0 1 0 3 5", "M3 5V19A9 3 0 0 0 21 19V5", "M3 12A9 3 0 0 0 21 12"];
      } else if (el.nodeType === "gateway") {
        svgPaths = ["M13 2 L3 14 L12 14 L11 22 L21 10 L12 10 L13 2"];
      } else if (el.nodeType === "server") {
        svgPaths = ["M2 2 h20 v8 h-20 z", "M2 14 h20 v8 h-20 z", "M6 6 h0.01", "M6 18 h0.01"];
      } else if (el.nodeType === "balancer") {
        svgPaths = ["M4 4 h16 v16 h-16 z", "M9 9 h6 v6 h-6 z", "M15 2 v2", "M15 20 v2", "M2 15 h2", "M2 9 h2", "M20 15 h2", "M20 9 h2", "M9 2 v2", "M9 20 v2"];
      } else if (el.nodeType === "cache") {
        svgPaths = ["M22 12 L2 12", "M5.45 5.11 L2 12 v6 a2 2 0 0 0 2 2 h16 a2 2 0 0 0 2-2 v-6 l-3.45-6.89 A2 2 0 0 0 16.76 4 H7.24 a2 2 0 0 0-1.79 1.11 z", "M6 16 h0.01", "M10 16 h0.01"];
      } else if (el.nodeType === "client") {
        svgPaths = ["M12 12 m-10 0a10 10 0 1 0 20 0a10 10 0 1 0 -20 0", "M12 2 a14.5 14.5 0 0 0 0 20 a14.5 14.5 0 0 0 0-20", "M2 12 h20"];
      } else if (el.nodeType === "storage") {
        svgPaths = ["M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"];
      } else if (el.nodeType === "queue") {
        svgPaths = ["M16 16 h6 v6 h-6 z", "M2 16 h6 v6 h-6 z", "M9 2 h6 v6 h-6 z", "M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3", "M12 12V8"];
      } else if (el.nodeType === "serverless") {
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
      
      if (iconData) {
        try {
          iconData.forEach(([tag, attrs]: any) => {
            if (tag === 'path') {
              const p = new Path2D(attrs.d);
              ctx.stroke(p);
            } else if (tag === 'circle') {
              ctx.beginPath();
              ctx.arc(attrs.cx, attrs.cy, attrs.r, 0, 2*Math.PI);
              ctx.stroke();
            } else if (tag === 'rect') {
              ctx.strokeRect(attrs.x, attrs.y, attrs.width, attrs.height);
            } else if (tag === 'line') {
              ctx.beginPath();
              ctx.moveTo(attrs.x1, attrs.y1);
              ctx.lineTo(attrs.x2, attrs.y2);
              ctx.stroke();
            } else if (tag === 'polyline' || tag === 'polygon') {
              const pts = attrs.points.split(' ').map((p:string) => p.split(',').map(Number));
              ctx.beginPath();
              ctx.moveTo(pts[0][0], pts[0][1]);
              for(let i=1; i<pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
              if (tag === 'polygon') ctx.closePath();
              ctx.stroke();
            }
          });
        } catch(e) {}
      } else {
        svgPaths.forEach(d => {
          try {
              const p = new Path2D(d);
              ctx.stroke(p);
          } catch (e) {}
        });
      }
      ctx.restore();

      // Text — Progressive Disclosure based on zoom with node clipping
      const showText = zoom >= 40;
      const showSubtitle = zoom >= 70;

      ctx.save();
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(el.x, el.y, el.width, el.height, 12);
      else ctx.rect(el.x, el.y, el.width, el.height);
      ctx.clip();

      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      const maxTextWidth = Math.max(40, Math.abs(el.width) - 76);
      let currentTextY = el.y + 25;
      const maxY = el.y + el.height - 10;

      const drawWrappedText = (text: string, font: string, fillStyle: string, lineHeight: number) => {
        ctx.font = font;
        ctx.fillStyle = fillStyle;
        const words = text.split(' ');
        let line = '';
        for (let n = 0; n < words.length; n++) {
          if (currentTextY > maxY) break;
          const testLine = line + words[n] + ' ';
          const metrics = ctx.measureText(testLine);
          if (metrics.width > maxTextWidth && n > 0) {
            ctx.fillText(line.trim(), el.x + 66, currentTextY);
            currentTextY += lineHeight;
            line = words[n] + ' ';
          } else {
            line = testLine;
          }
        }
        if (currentTextY <= maxY && line.trim()) {
          ctx.fillText(line.trim(), el.x + 66, currentTextY);
          currentTextY += lineHeight;
        }
      };

      if (showText && el.title) {
        drawWrappedText(el.title, "bold 13px sans-serif", "#FFFFFF", 16);
      }
      
      if (showSubtitle && el.subtitle) {
        currentTextY += 2;
        drawWrappedText(el.subtitle, "11px sans-serif", "#808080", 14);
      }
      
      ctx.restore();
      ctx.textBaseline = "alphabetic";
    } else if (el.type === "rectangle") {
      ctx.fillStyle = el.fillColor;
      ctx.strokeStyle = isSelected ? "#FFFFFF" : el.strokeColor;
      ctx.lineWidth = el.strokeWidth;
      if (el.fillColor !== "transparent") ctx.fillRect(el.x, el.y, el.width, el.height);
      ctx.strokeRect(el.x, el.y, el.width, el.height);
    } else if (el.type === "frame") {
      ctx.fillStyle = el.fillColor === "transparent" ? "rgba(255, 255, 255, 0.02)" : el.fillColor;
      ctx.strokeStyle = isSelected ? "#FFFFFF" : (el.strokeColor || "#4B5563");
      ctx.lineWidth = el.strokeWidth || 1.5;
      if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(el.x, el.y, el.width, el.height, 12);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(el.x, el.y, el.width, el.height);
        ctx.strokeRect(el.x, el.y, el.width, el.height);
      }
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

    // Draw text inside shapes (rectangle, frame, circle, diamond, triangle)
    if (["rectangle", "frame", "circle", "diamond", "triangle"].includes(el.type) && (el.text || el.lucideIcon || el.nodeType)) {
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 14px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";

      let iconWidth = 0;
      let iconData: any = null;
      let svgPaths: string[] = [];
      
      if (el.lucideIcon) {
        iconData = (LucideCoreIcons as any)[el.lucideIcon];
        if (iconData) iconWidth = 24 + 10; // Icon size + right padding
      } else if (el.nodeType && el.nodeType !== "node" && el.nodeType !== "group") {
        if (el.nodeType === "database") svgPaths = ["M 3 5 A 9 3 0 1 0 21 5 A 9 3 0 1 0 3 5", "M3 5V19A9 3 0 0 0 21 19V5", "M3 12A9 3 0 0 0 21 12"];
        else if (el.nodeType === "gateway") svgPaths = ["M13 2 L3 14 L12 14 L11 22 L21 10 L12 10 L13 2"];
        else if (el.nodeType === "server") svgPaths = ["M2 2 h20 v8 h-20 z", "M2 14 h20 v8 h-20 z", "M6 6 h0.01", "M6 18 h0.01"];
        else if (el.nodeType === "balancer") svgPaths = ["M4 4 h16 v16 h-16 z", "M9 9 h6 v6 h-6 z", "M15 2 v2", "M15 20 v2", "M2 15 h2", "M2 9 h2", "M20 15 h2", "M20 9 h2", "M9 2 v2", "M9 20 v2"];
        else if (el.nodeType === "cache") svgPaths = ["M22 12 L2 12", "M5.45 5.11 L2 12 v6 a2 2 0 0 0 2 2 h16 a2 2 0 0 0 2-2 v-6 l-3.45-6.89 A2 2 0 0 0 16.76 4 H7.24 a2 2 0 0 0-1.79 1.11 z", "M6 16 h0.01", "M10 16 h0.01"];
        else if (el.nodeType === "client") svgPaths = ["M12 12 m-10 0a10 10 0 1 0 20 0a10 10 0 1 0 -20 0", "M12 2 a14.5 14.5 0 0 0 0 20 a14.5 14.5 0 0 0 0-20", "M2 12 h20"];
        else if (el.nodeType === "storage") svgPaths = ["M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"];
        else if (el.nodeType === "queue") svgPaths = ["M16 16 h6 v6 h-6 z", "M2 16 h6 v6 h-6 z", "M9 2 h6 v6 h-6 z", "M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3", "M12 12V8"];
        else if (el.nodeType === "serverless") svgPaths = ["M4 17 L10 11 L4 5", "M12 19 h8"];
        else svgPaths = ["M12 2 L2 22 L22 22 Z"]; // default shape
        if (svgPaths.length > 0) iconWidth = 24 + 10;
      }
      
      const maxWidth = el.type === "frame" ? el.width - 40 : Math.max(20, el.width - iconWidth - 20); // 10px padding on each side
      const lineHeight = 18;
      const textToDraw = el.text || "";
      const paragraphs = textToDraw.split('\n');
      const lines: string[] = [];
      
      for (const p of paragraphs) {
        const words = p.split(' ');
        let line = '';
        for (let n = 0; n < words.length; n++) {
          const testLine = line + words[n] + ' ';
          const testWidth = ctx.measureText(testLine).width;
          if (testWidth > maxWidth && n > 0) {
            lines.push(line);
            line = words[n] + ' ';
          } else {
            line = testLine;
          }
        }
        if (line.trim()) lines.push(line);
      }
      
      const totalTextHeight = lines.length > 0 ? (lines.length * lineHeight) : 0;
      
      if (el.type === "frame") {
        // Frame: Top left
        let startX = el.x + 20;
        let startY = el.y + 20;
        
        if (iconData || svgPaths.length > 0) {
          ctx.save();
          ctx.translate(startX, startY);
          ctx.strokeStyle = el.strokeColor === "transparent" ? "#FFFFFF" : (el.strokeColor || "#FFFFFF");
          ctx.lineWidth = 2;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          try {
            if (iconData) {
              iconData.forEach(([tag, attrs]: any) => {
                if (tag === 'path') ctx.stroke(new Path2D(attrs.d));
                else if (tag === 'circle') { ctx.beginPath(); ctx.arc(attrs.cx, attrs.cy, attrs.r, 0, 2*Math.PI); ctx.stroke(); }
                else if (tag === 'rect') ctx.strokeRect(attrs.x, attrs.y, attrs.width, attrs.height);
                else if (tag === 'line') { ctx.beginPath(); ctx.moveTo(attrs.x1, attrs.y1); ctx.lineTo(attrs.x2, attrs.y2); ctx.stroke(); }
                else if (tag === 'polyline' || tag === 'polygon') {
                  const pts = attrs.points.split(' ').map((p:string) => p.split(',').map(Number));
                  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
                  for(let i=1; i<pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
                  if (tag === 'polygon') ctx.closePath();
                  ctx.stroke();
                }
              });
            } else {
              svgPaths.forEach(d => { try { ctx.stroke(new Path2D(d)); } catch(e) {} });
            }
          } catch(e) {}
          ctx.restore();
          startX += iconWidth; // shift text to the right of icon
        }
        
        startY += 12; // offset text baseline
        lines.forEach(l => {
          if (l.trim()) {
            ctx.fillText(l.trim(), startX, startY);
            startY += lineHeight;
          }
        });

      } else {
        // Other shapes: Centered block, Icon on Left, Text on Right
        let maxTextLineWidth = 0;
        lines.forEach(l => {
          const w = ctx.measureText(l.trim()).width;
          if (w > maxTextLineWidth) maxTextLineWidth = w;
        });

        const totalBlockWidth = iconWidth + maxTextLineWidth;
        const cx = el.x + Math.abs(el.width) / 2;
        const cy = el.y + Math.abs(el.height) / 2;
        
        let startX = cx - (totalBlockWidth / 2);
        
        if (iconData || svgPaths.length > 0) {
          ctx.save();
          ctx.translate(startX, cy - 12); // center vertically (icon height is 24)
          ctx.strokeStyle = el.strokeColor === "transparent" ? "#FFFFFF" : (el.strokeColor || "#FFFFFF");
          ctx.lineWidth = 2;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          try {
            if (iconData) {
              iconData.forEach(([tag, attrs]: any) => {
                if (tag === 'path') ctx.stroke(new Path2D(attrs.d));
                else if (tag === 'circle') { ctx.beginPath(); ctx.arc(attrs.cx, attrs.cy, attrs.r, 0, 2*Math.PI); ctx.stroke(); }
                else if (tag === 'rect') ctx.strokeRect(attrs.x, attrs.y, attrs.width, attrs.height);
                else if (tag === 'line') { ctx.beginPath(); ctx.moveTo(attrs.x1, attrs.y1); ctx.lineTo(attrs.x2, attrs.y2); ctx.stroke(); }
                else if (tag === 'polyline' || tag === 'polygon') {
                  const pts = attrs.points.split(' ').map((p:string) => p.split(',').map(Number));
                  ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
                  for(let i=1; i<pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
                  if (tag === 'polygon') ctx.closePath();
                  ctx.stroke();
                }
              });
            } else {
              svgPaths.forEach(d => { try { ctx.stroke(new Path2D(d)); } catch(e) {} });
            }
          } catch(e) {}
          ctx.restore();
          startX += iconWidth; // shift text to the right of icon
        }
        
        let startY = cy - (totalTextHeight / 2) + (lineHeight / 2);
        lines.forEach(l => {
          if (l.trim()) {
            ctx.fillText(l.trim(), startX, startY);
            startY += lineHeight;
          }
        });
      }
      
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


  // ─── Undo / Redo History ───────────────────────────────────────────────────
  const commitToHistory = React.useCallback((currentElements: SystemNode[]) => {
    setHistory(prev => {
      const last = prev[prev.length - 1];
      if (last && JSON.stringify(last) === JSON.stringify(currentElements)) {
        return prev;
      }
      return [...prev.slice(-49), currentElements];
    });
    setFuture([]);
  }, []);

  // Keyboard shortcuts

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      
      // Undo / Redo
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          // Redo
          if (future.length > 0) {
            const next = future[future.length - 1];
            setHistory(h => [...h, elements]);
            setFuture(f => f.slice(0, -1));
            updateElementsMutation({ id: id as Id<"slates">, elements: JSON.stringify(next) });
          }
        } else {
          // Undo
          if (history.length > 0) {
            const prev = history[history.length - 1];
            setFuture(f => [...f, elements]);
            setHistory(h => h.slice(0, -1));
            updateElementsMutation({ id: id as Id<"slates">, elements: JSON.stringify(prev) });
          }
        }
        return;
      }


      if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.size > 0 && !isReadOnly) {
        commitToHistory(elements);
        selectedIds.forEach((sid) => {
          removeElementMutation({ id: id as Id<"slates">, elementId: sid });
        });
        setSelectedIds(new Set());
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsCommandOpen(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelectedIds(new Set(elements.map(el => el.id)));
      }
      if (e.key === "Escape") { setSelectedIds(new Set()); setSelectionNet(null); setNetStart(null); }
      if (e.key === "+") setZoom((z) => Math.min(200, z + 10));
      if (e.key === "-") setZoom((z) => Math.max(10, z - 10));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedIds, isReadOnly, id, history, future, elements, commitToHistory, updateElementsMutation]);

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
      <CommandPalette open={isCommandOpen} onOpenChange={setIsCommandOpen} onNewSlate={() => setIsInsertMenuOpen(true)} />{/* MAIN BODY */}
      <div className="flex-1 flex overflow-hidden relative">

        {/* FLOATING UI SHELL */}
        {!isUiHidden && (
          <>
            {/* TOP LEFT: Project Identity */}
            <div className="absolute top-4 left-4 z-40 flex items-center gap-3 bg-[#141414]/80 backdrop-blur-xl border border-white/10 rounded-2xl px-3 py-2 shadow-2xl">
              <Link href="/dashboard" className="flex items-center gap-2 group">
                <Image src="/logo.svg" alt="Slate Logo" width={26} height={26} className="rounded-lg shadow-sm group-hover:scale-105 transition-transform" />
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
              <button onClick={handleExportPNG} title="Export Diagram to PNG"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-xs font-bold text-indigo-400 hover:bg-indigo-500 hover:text-white transition-all cursor-pointer">
                <ImageIcon className="w-3.5 h-3.5" />
                Export
              </button>

              <div className="w-px h-5 bg-white/10 mx-1" />

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
                <button onClick={() => setZoom((z) => Math.max(10, z - 10))} className="text-[#808080] hover:text-white hover:bg-white/10 rounded p-1 cursor-pointer w-6 h-6 flex items-center justify-center">−</button>
                <span className="text-[10px] font-bold text-white w-9 text-center">{zoom}%</span>
                <button onClick={() => setZoom((z) => Math.min(200, z + 10))} className="text-[#808080] hover:text-white hover:bg-white/10 rounded p-1 cursor-pointer w-6 h-6 flex items-center justify-center">+</button>
              </div>

              <div className="w-px h-5 bg-white/10 mx-1" />

              <button onClick={() => setIsUiHidden(true)} title="Fullscreen Mode"
                className="flex items-center justify-center p-1.5 rounded-xl text-[#808080] hover:text-white hover:bg-white/10 transition-all cursor-pointer">
                <Maximize2 className="w-4 h-4" />
              </button>
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
            
            <Dialog open={isInsertMenuOpen} onOpenChange={(open) => {
              setIsInsertMenuOpen(open);
              if (!open) setTimeout(() => { setInsertCategory("main"); setIconSearchQuery(""); }, 200);
            }}>
              <DialogTrigger className="p-2 rounded-xl text-[#808080] hover:text-white hover:bg-[#202020] transition-colors cursor-pointer group">
                <Plus className="w-5 h-5 text-white group-hover:scale-110 transition-transform" />
              </DialogTrigger>
              <DialogContent className="bg-[#1A1A1A] border border-white/10 text-white max-w-[400px] rounded-[16px] p-0 shadow-2xl overflow-hidden">
                <div className="flex flex-col h-[500px]">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
                    <Search className="w-4 h-4 text-[#808080]" />
                    <input 
                      type="text" 
                      autoFocus
                      placeholder="Search icons..." 
                      value={iconSearchQuery}
                      onChange={(e) => setIconSearchQuery(e.target.value)}
                      className="bg-transparent border-none outline-none text-sm text-white w-full placeholder:text-[#808080]"
                    />
                  </div>
                  <div className="p-4 overflow-y-auto grid grid-cols-4 gap-2 content-start flex-1">
                    {AVAILABLE_ICONS.filter(i => i.toLowerCase().includes(iconSearchQuery.toLowerCase())).map(iconName => {
                      const IconComp = (LucideReactIcons as any)[iconName];
                      if (!IconComp) return null;
                      return (
                        <button key={iconName} 
                          onClick={() => {
                            const newEl: SystemNode = {
                              id: `icon-${Date.now()}`, type: "node", title: iconName, subtitle: "Icon",
                              x: -pan.x + 100, y: -pan.y + 100, width: 80, height: 80,
                              strokeColor: "#FFFFFF", fillColor: "transparent", strokeWidth: 1.5,
                              nodeType: "icon", lucideIcon: iconName
                            };
                            addElementMutation({ id: id as any, element: JSON.stringify(newEl) });
                            setIsInsertMenuOpen(false);
                          }}
                          className="flex flex-col items-center justify-center gap-2 p-3 rounded-xl hover:bg-white/10 transition-all cursor-pointer group"
                          title={iconName}
                        >
                          <IconComp className="w-6 h-6 text-[#A0A0A0] group-hover:text-white transition-colors" strokeWidth={1.5} />
                          <span className="text-[9px] text-[#606060] group-hover:text-white truncate w-full text-center">{iconName}</span>
                        </button>
                      )
                    })}
                    {AVAILABLE_ICONS.filter(i => i.toLowerCase().includes(iconSearchQuery.toLowerCase())).length === 0 && (
                      <div className="col-span-4 text-center py-10 text-xs text-[#808080]">No icons found</div>
                    )}
                  </div>
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
              <div key={tool} className="relative group flex items-center">
                <button onClick={() => setActiveTool(tool)}
                  className={`p-2.5 rounded-[14px] transition-all cursor-pointer hover:scale-110 active:scale-95 ${activeTool === tool ? "bg-white text-black shadow-md" : "text-[#808080] hover:text-white hover:bg-white/10"}`}>
                  <Icon className="w-5 h-5" />
                </button>
                <div className="absolute left-full ml-4 top-1/2 -translate-y-1/2 px-2.5 py-1 bg-[#2B2B2B] text-white text-[11px] font-bold rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-200 whitespace-nowrap shadow-xl border border-white/10 z-50">
                  {title}
                </div>
              </div>
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
            <button onClick={() => setIsUiHidden(false)} title="Exit Fullscreen" className="p-2.5 rounded-xl bg-[#141414]/80 backdrop-blur-md border border-white/10 text-[#808080] hover:text-white hover:bg-white/20 transition-all shadow-2xl cursor-pointer">
              <Minimize2 className="w-4 h-4" />
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

            {/* Selected count badge removed as per user request */}

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
              onDoubleClick={handleCanvasDoubleClick}
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
