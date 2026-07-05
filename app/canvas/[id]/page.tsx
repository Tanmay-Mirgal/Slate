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
  Image as ImageIcon,
  Frame,
  MessageSquare,
  Search,
  Share2,
  Bot,
  ChevronDown,
  MoreHorizontal,
  Database,
  Server,
  Cpu,
  Layers,
  HardDrive,
  Globe,
  Zap,
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
  ShieldCheck,
  Lock
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

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
  | "comment" 
  | "node";

export interface SystemNode {
  id: string;
  type: Tool;
  nodeType?: "database" | "server" | "gateway" | "balancer" | "cache" | "storage" | "client" | "auth";
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
}

export default function CanvasPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = params.id as string;

  // URL Access Mode: ?mode=edit vs ?mode=view
  const accessMode = searchParams.get("mode") || "edit";
  const isReadOnly = accessMode === "view";

  // Clerk User Info
  const { user } = useUser();
  const guestIdRef = React.useRef(`guest-${Math.floor(Math.random() * 10000)}`);
  const myUserId = user?.id || guestIdRef.current;
  const myUserName = user?.fullName || user?.firstName || "Teammate";
  const myUserAvatar = user?.imageUrl || "";

  // Convex Queries & Mutations
  const slate = useQuery(api.slates.getById, { id: id as Id<"slates"> });
  const activePresence = useQuery(
    api.slates.getPresence, 
    id ? { slateId: id as Id<"slates"> } : "skip"
  );
  
  const updateElementsMutation = useMutation(api.slates.updateElements);
  const updateDocumentMutation = useMutation(api.slates.updateDocument);
  const updatePresenceMutation = useMutation(api.slates.updatePresence);
  const toggleShareMutation = useMutation(api.slates.toggleShare);

  // Layout View Mode State
  const [viewMode, setViewMode] = React.useState<ViewMode>("both");
  const [activeTool, setActiveTool] = React.useState<Tool>("select");
  const [zoom, setZoom] = React.useState<number>(100);
  const [isAiChatOpen, setIsAiChatOpen] = React.useState<boolean>(false);
  const [isLibraryOpen, setIsLibraryOpen] = React.useState<boolean>(false);
  const [isShareModalOpen, setIsShareModalOpen] = React.useState<boolean>(false);
  const [copiedType, setCopiedType] = React.useState<"edit" | "view" | null>(null);

  // Document Markdown State
  const [docText, setDocText] = React.useState<string>(
    "# System Architecture & Low Level Design\n\n## 1. Overview\nThis slate contains the low-level design diagrams and component mappings for your application.\n\n## 2. Components\n- **Client UI**: Next.js 16 App Router\n- **Backend**: Convex Cloud Realtime Functions\n- **Authentication**: Clerk OAuth Provider\n- **Database**: Convex Document DB\n"
  );
  const [isDocSaving, setIsDocSaving] = React.useState(false);

  // Canvas Elements State
  const [elements, setElements] = React.useState<SystemNode[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [isCanvasSaving, setIsCanvasSaving] = React.useState(false);
  const [hasLoadedInitial, setHasLoadedInitial] = React.useState(false);

  // Drawing state
  const [isDrawing, setIsDrawing] = React.useState(false);
  const [currentElement, setCurrentElement] = React.useState<SystemNode | null>(null);
  const [strokeColor, setStrokeColor] = React.useState("#a855f7");
  const [fillColor, setFillColor] = React.useState("#18181b");

  // AI Chat Messages State
  const [aiInput, setAiInput] = React.useState("");
  const [aiMessages, setAiMessages] = React.useState<{ role: "user" | "assistant"; text: string }[]>([
    { role: "assistant", text: "Hello! I am Slate AI. How can I help you design your system architecture today?" }
  ]);

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const lastPresenceTimeRef = React.useRef<number>(0);

  // Sync Initial Slate Data from Convex
  React.useEffect(() => {
    if (slate && !hasLoadedInitial) {
      if (slate.documentText) setDocText(slate.documentText);
      if (slate.elements) {
        try {
          setElements(JSON.parse(slate.elements));
        } catch (e) {
          console.error("Error parsing elements", e);
        }
      }
      setHasLoadedInitial(true);
    }
  }, [slate, hasLoadedInitial]);

  // Reactive Sync: Update local state if another user updates Convex elements
  React.useEffect(() => {
    if (slate?.elements && hasLoadedInitial && !isCanvasSaving) {
      try {
        const parsed = JSON.parse(slate.elements);
        if (JSON.stringify(parsed) !== JSON.stringify(elements)) {
          setElements(parsed);
        }
      } catch (e) {}
    }
    if (slate?.documentText && hasLoadedInitial && !isDocSaving) {
      if (slate.documentText !== docText) {
        setDocText(slate.documentText);
      }
    }
  }, [slate]);

  // Save Canvas Elements to Convex
  const saveElementsToConvex = async (els: SystemNode[]) => {
    if (!id || isReadOnly) return;
    setIsCanvasSaving(true);
    try {
      await updateElementsMutation({
        id: id as Id<"slates">,
        elements: JSON.stringify(els),
      });
    } catch (e) {
      console.error("Failed saving elements", e);
    } finally {
      setTimeout(() => setIsCanvasSaving(false), 500);
    }
  };

  // Save Document Text to Convex
  const saveDocToConvex = async (text: string) => {
    if (!id || isReadOnly) return;
    setIsDocSaving(true);
    try {
      await updateDocumentMutation({
        id: id as Id<"slates">,
        documentText: text,
      });
    } catch (e) {
      console.error("Failed saving document", e);
    } finally {
      setTimeout(() => setIsDocSaving(false), 500);
    }
  };

  // Broadcast Live Multiplayer Cursor Position
  const broadcastPresence = (x: number, y: number) => {
    if (!id || !myUserId) return;
    const now = Date.now();
    // Throttle to every 100ms
    if (now - lastPresenceTimeRef.current > 100) {
      lastPresenceTimeRef.current = now;
      updatePresenceMutation({
        slateId: id as Id<"slates">,
        userId: myUserId,
        userName: myUserName,
        userAvatar: myUserAvatar,
        cursorX: x,
        cursorY: y,
      });
    }
  };

  // Copy Share Link Helper
  const handleCopyLink = (mode: "edit" | "view") => {
    const origin = window.location.origin;
    const shareUrl = `${origin}/canvas/${id}?mode=${mode}`;
    navigator.clipboard.writeText(shareUrl);
    setCopiedType(mode);
    setTimeout(() => setCopiedType(null), 2000);
  };

  // Add Architecture Component Node
  const handleAddComponentNode = (nodeType: SystemNode["nodeType"], title: string, subtitle: string) => {
    if (isReadOnly) return;

    const newNode: SystemNode = {
      id: `node-${Date.now()}`,
      type: "node",
      nodeType,
      title,
      subtitle,
      x: 200 + Math.random() * 100,
      y: 200 + Math.random() * 100,
      width: 180,
      height: 90,
      strokeColor: "#a855f7",
      fillColor: "#121217",
      strokeWidth: 2,
    };

    const updated = [...elements, newNode];
    setElements(updated);
    saveElementsToConvex(updated);
    setIsLibraryOpen(false);
    setSelectedId(newNode.id);
  };

  // Render Canvas Nodes & Live Multiplayer Cursors
  const renderAllNodes = (ctx: CanvasRenderingContext2D, els: SystemNode[]) => {
    // 1. Render Shapes & Architecture Nodes
    els.forEach((el) => {
      ctx.save();
      const isSelected = el.id === selectedId;

      if (el.type === "node") {
        ctx.fillStyle = el.fillColor || "#121217";
        ctx.strokeStyle = isSelected ? "#a855f7" : "#27272a";
        ctx.lineWidth = isSelected ? 2.5 : 1.5;

        const radius = 12;
        ctx.beginPath();
        ctx.roundRect(el.x, el.y, el.width, el.height, radius);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#a855f7";
        ctx.beginPath();
        ctx.roundRect(el.x, el.y, el.width, 4, [radius, radius, 0, 0]);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 13px sans-serif";
        ctx.fillText(el.title, el.x + 16, el.y + 36);

        if (el.subtitle) {
          ctx.fillStyle = "#a1a1aa";
          ctx.font = "11px sans-serif";
          ctx.fillText(el.subtitle, el.x + 16, el.y + 58);
        }

      } else if (el.type === "rectangle") {
        ctx.fillStyle = el.fillColor;
        ctx.strokeStyle = isSelected ? "#a855f7" : el.strokeColor;
        ctx.lineWidth = el.strokeWidth;
        if (el.fillColor !== "transparent") ctx.fillRect(el.x, el.y, el.width, el.height);
        ctx.strokeRect(el.x, el.y, el.width, el.height);

      } else if (el.type === "circle") {
        ctx.fillStyle = el.fillColor;
        ctx.strokeStyle = isSelected ? "#a855f7" : el.strokeColor;
        ctx.lineWidth = el.strokeWidth;
        ctx.beginPath();
        const rx = Math.abs(el.width) / 2;
        const ry = Math.abs(el.height) / 2;
        ctx.ellipse(el.x + rx, el.y + ry, rx, ry, 0, 0, 2 * Math.PI);
        if (el.fillColor !== "transparent") ctx.fill();
        ctx.stroke();

      } else if (el.type === "arrow") {
        ctx.strokeStyle = isSelected ? "#a855f7" : el.strokeColor;
        ctx.lineWidth = el.strokeWidth;
        const fromX = el.x;
        const fromY = el.y;
        const toX = el.x + el.width;
        const toY = el.y + el.height;

        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.stroke();

        const headlen = 14;
        const angle = Math.atan2(toY - fromY, toX - fromX);
        ctx.beginPath();
        ctx.moveTo(toX, toY);
        ctx.lineTo(toX - headlen * Math.cos(angle - Math.PI / 6), toY - headlen * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(toX, toY);
        ctx.lineTo(toX - headlen * Math.cos(angle + Math.PI / 6), toY - headlen * Math.sin(angle + Math.PI / 6));
        ctx.stroke();

      } else if (el.type === "line") {
        ctx.strokeStyle = isSelected ? "#a855f7" : el.strokeColor;
        ctx.lineWidth = el.strokeWidth;
        ctx.beginPath();
        ctx.moveTo(el.x, el.y);
        ctx.lineTo(el.x + el.width, el.y + el.height);
        ctx.stroke();

      } else if (el.type === "pencil" && el.points) {
        ctx.strokeStyle = isSelected ? "#a855f7" : el.strokeColor;
        ctx.lineWidth = el.strokeWidth;
        if (el.points.length > 0) {
          ctx.beginPath();
          ctx.moveTo(el.points[0].x, el.points[0].y);
          for (let i = 1; i < el.points.length; i++) {
            ctx.lineTo(el.points[i].x, el.points[i].y);
          }
          ctx.stroke();
        }
      } else if (el.type === "text") {
        ctx.fillStyle = el.strokeColor;
        ctx.font = "bold 15px sans-serif";
        ctx.fillText(el.text || "Text Label", el.x, el.y);
      }

      if (isSelected) {
        ctx.strokeStyle = "#a855f7";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(el.x - 4, el.y - 4, el.width + 8, el.height + 8);
        ctx.setLineDash([]);
      }

      ctx.restore();
    });

    // 2. Render Live Multiplayer Cursors (Teammates)
    if (activePresence && activePresence.length > 0) {
      const teammateColors = ["#ec4899", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6"];

      activePresence.forEach((p, idx) => {
        if (p.userId === myUserId) return; // Skip own cursor

        ctx.save();
        const cursorColor = teammateColors[idx % teammateColors.length];

        // Cursor Pointer Arrow
        ctx.fillStyle = cursorColor;
        ctx.beginPath();
        ctx.moveTo(p.cursorX, p.cursorY);
        ctx.lineTo(p.cursorX + 14, p.cursorY + 14);
        ctx.lineTo(p.cursorX + 6, p.cursorY + 16);
        ctx.lineTo(p.cursorX, p.cursorY + 22);
        ctx.closePath();
        ctx.fill();

        // User Name Pill Tag
        ctx.fillStyle = cursorColor;
        const tagX = p.cursorX + 12;
        const tagY = p.cursorY + 18;
        const tagText = p.userName || "Teammate";

        ctx.font = "bold 11px sans-serif";
        const textMetrics = ctx.measureText(tagText);
        const tagWidth = textMetrics.width + 12;

        ctx.beginPath();
        ctx.roundRect(tagX, tagY, tagWidth, 20, 6);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.fillText(tagText, tagX + 6, tagY + 14);

        ctx.restore();
      });
    }
  };

  // Canvas Mouse Interaction
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isReadOnly) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / (zoom / 100);
    const y = (e.clientY - rect.top) / (zoom / 100);

    if (activeTool === "eraser") {
      const remaining = elements.filter((el) => {
        return !(x >= el.x && x <= el.x + el.width && y >= el.y && y <= el.y + el.height);
      });
      setElements(remaining);
      saveElementsToConvex(remaining);
      return;
    }

    if (activeTool === "select") {
      const clicked = [...elements].reverse().find((el) => {
        return x >= el.x && x <= el.x + el.width && y >= el.y && y <= el.y + el.height;
      });
      setSelectedId(clicked ? clicked.id : null);
      return;
    }

    setIsDrawing(true);
    const newId = `shape-${Date.now()}`;

    if (activeTool === "pencil") {
      setCurrentElement({
        id: newId,
        type: "pencil",
        x,
        y,
        width: 0,
        height: 0,
        points: [{ x, y }],
        strokeColor,
        fillColor: "transparent",
        strokeWidth: 2,
      });
    } else if (activeTool === "text") {
      const textVal = prompt("Enter text:", "Architecture Note");
      if (textVal) {
        const newText: SystemNode = {
          id: newId,
          type: "text",
          title: textVal,
          x,
          y,
          width: 120,
          height: 30,
          text: textVal,
          strokeColor,
          fillColor: "transparent",
          strokeWidth: 2,
        };
        const updated = [...elements, newText];
        setElements(updated);
        saveElementsToConvex(updated);
      }
      setIsDrawing(false);
    } else {
      setCurrentElement({
        id: newId,
        type: activeTool,
        title: "",
        x,
        y,
        width: 0,
        height: 0,
        strokeColor,
        fillColor,
        strokeWidth: 2,
      });
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / (zoom / 100);
    const y = (e.clientY - rect.top) / (zoom / 100);

    // Broadcast cursor to multiplayer teammates
    broadcastPresence(x, y);

    if (isReadOnly || !isDrawing || !currentElement) return;

    if (currentElement.type === "pencil") {
      setCurrentElement({
        ...currentElement,
        points: [...(currentElement.points || []), { x, y }],
      });
    } else {
      setCurrentElement({
        ...currentElement,
        width: x - currentElement.x,
        height: y - currentElement.y,
      });
    }
  };

  const handleCanvasMouseUp = () => {
    if (isReadOnly) return;
    if (isDrawing && currentElement) {
      const updated = [...elements, currentElement];
      setElements(updated);
      saveElementsToConvex(updated);
      setCurrentElement(null);
      setIsDrawing(false);
    }
  };

  // Render Loop
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

    const allEls = currentElement ? [...elements, currentElement] : elements;
    renderAllNodes(ctx, allEls);

    ctx.restore();
  }, [elements, currentElement, selectedId, activePresence, zoom, viewMode]);

  // AI Chat Submit Handler
  const handleSendAi = (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiInput.trim()) return;

    const userMsg = { role: "user" as const, text: aiInput };
    setAiMessages((prev) => [...prev, userMsg]);
    setAiInput("");

    setTimeout(() => {
      setAiMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "I've analyzed your system architecture nodes. Would you like me to generate a Redis Cache node or add a Load Balancer?",
        },
      ]);
    }, 800);
  };

  return (
    <TooltipProvider>
      <div className="flex flex-col h-screen w-screen bg-[#09090b] text-neutral-100 font-sans overflow-hidden select-none">
        
        {/* TOP HEADER NAVIGATION BAR */}
        <header className="h-14 border-b border-neutral-800 bg-[#0c0c0e] px-4 flex items-center justify-between shrink-0 z-40">
          
          {/* Left Title & Access Mode Badge */}
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="flex items-center gap-2 group">
              <Image
                src="/logo.png"
                alt="Slate Logo"
                width={28}
                height={28}
                className="rounded-md shadow-md group-hover:scale-105 transition-transform"
              />
              <span className="font-bold text-sm tracking-tight text-white">
                {slate?.title || "LLD Design"}
              </span>
            </Link>

            {/* Read-Only vs Edit Mode Indicator */}
            {isReadOnly ? (
              <div className="px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-bold flex items-center gap-1">
                <Eye className="w-3 h-3" />
                View Only
              </div>
            ) : (
              <div className="px-2.5 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-[10px] font-bold flex items-center gap-1">
                <Edit3 className="w-3 h-3" />
                Edit Access
              </div>
            )}

            {/* Save Status Badge */}
            {!isReadOnly && (
              <div className="text-[11px] font-semibold text-neutral-500 flex items-center gap-1.5 ml-1 border-l border-neutral-800 pl-3">
                {isCanvasSaving || isDocSaving ? (
                  <span className="text-purple-400 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Saving...
                  </span>
                ) : (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    Synced
                  </span>
                )}
              </div>
            )}
          </div>

          {/* CENTER MODE SWITCHER: Document | Both | Canvas */}
          <div className="flex items-center p-1 rounded-xl bg-neutral-950 border border-neutral-800">
            <button
              onClick={() => setViewMode("document")}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                viewMode === "document" 
                  ? "bg-neutral-800 text-white shadow-sm" 
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Document
            </button>
            <button
              onClick={() => setViewMode("both")}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                viewMode === "both" 
                  ? "bg-neutral-800 text-white shadow-sm" 
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              <Layout className="w-3.5 h-3.5" />
              Both
            </button>
            <button
              onClick={() => setViewMode("canvas")}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                viewMode === "canvas" 
                  ? "bg-neutral-800 text-white shadow-sm" 
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              <Maximize2 className="w-3.5 h-3.5" />
              Canvas
            </button>
          </div>

          {/* RIGHT ACTIONS: Teammates Avatars, Share Dialog, AI Chat */}
          <div className="flex items-center gap-3">
            
            {/* ACTIVE MULTIPLAYER TEAMMATES BAR */}
            <div className="flex items-center gap-1 bg-neutral-900 border border-neutral-800 px-2.5 py-1 rounded-full">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse mr-1" />
              <span className="text-[11px] font-bold text-neutral-300">
                {activePresence ? activePresence.length : 1} Live
              </span>
              <div className="flex -space-x-1.5 ml-1">
                {activePresence?.map((p, idx) => (
                  <div
                    key={p._id || idx}
                    className="w-5 h-5 rounded-full bg-purple-600 border border-neutral-950 flex items-center justify-center text-[9px] font-bold text-white uppercase overflow-hidden"
                    title={p.userName}
                  >
                    {p.userAvatar ? (
                      <img src={p.userAvatar} alt={p.userName} className="w-full h-full object-cover" />
                    ) : (
                      p.userName?.charAt(0) || "U"
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* SHARE DIALOG WITH PERMISSIONS */}
            <Dialog open={isShareModalOpen} onOpenChange={setIsShareModalOpen}>
              <DialogTrigger asChild>
                <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-600/10 border border-purple-500/30 text-xs font-bold text-purple-400 hover:bg-purple-600 hover:text-white transition-all cursor-pointer shadow-md">
                  <Share2 className="w-3.5 h-3.5" />
                  Share
                </button>
              </DialogTrigger>
              <DialogContent className="bg-neutral-950 border-neutral-900 text-white max-w-md">
                <DialogHeader className="mb-3">
                  <DialogTitle className="text-lg font-bold flex items-center gap-2">
                    <Users className="w-5 h-5 text-purple-500" />
                    Collaborate & Share Slate
                  </DialogTitle>
                  <DialogDescription className="text-neutral-400">
                    Invite team members to view or edit this architecture canvas in real-time.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 mb-4">
                  {/* Edit Permission Link */}
                  <div className="p-3 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Edit3 className="w-3.5 h-3.5 text-purple-400" />
                        Edit Access Link
                      </span>
                      <span className="text-[10px] text-purple-400 font-semibold">Can edit & draw</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={typeof window !== "undefined" ? `${window.location.origin}/canvas/${id}?mode=edit` : ""}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-1.5 text-xs text-neutral-300 font-mono outline-none"
                      />
                      <Button
                        size="sm"
                        onClick={() => handleCopyLink("edit")}
                        className="rounded-xl bg-purple-600 text-white hover:bg-purple-700 cursor-pointer text-xs flex items-center gap-1 shrink-0"
                      >
                        {copiedType === "edit" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedType === "edit" ? "Copied!" : "Copy"}
                      </Button>
                    </div>
                  </div>

                  {/* View Only Permission Link */}
                  <div className="p-3 rounded-2xl bg-neutral-900 border border-neutral-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Eye className="w-3.5 h-3.5 text-amber-400" />
                        View Only Link
                      </span>
                      <span className="text-[10px] text-amber-400 font-semibold">Read-only presentation</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={typeof window !== "undefined" ? `${window.location.origin}/canvas/${id}?mode=view` : ""}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-1.5 text-xs text-neutral-300 font-mono outline-none"
                      />
                      <Button
                        size="sm"
                        onClick={() => handleCopyLink("view")}
                        className="rounded-xl bg-neutral-800 text-white hover:bg-neutral-700 cursor-pointer text-xs flex items-center gap-1 shrink-0"
                      >
                        {copiedType === "view" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        {copiedType === "view" ? "Copied!" : "Copy"}
                      </Button>
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            {/* AI CHAT BUTTON */}
            <Button
              onClick={() => setIsAiChatOpen(!isAiChatOpen)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold text-white transition-all cursor-pointer ${
                isAiChatOpen 
                  ? "bg-purple-700 shadow-lg shadow-purple-900/40" 
                  : "bg-gradient-to-r from-purple-600 to-indigo-600 hover:opacity-95 shadow-md shadow-purple-600/20"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              ✨ AI Chat
            </Button>

            {/* Zoom Percentage */}
            <div className="flex items-center gap-1 text-xs font-bold text-neutral-400 border-l border-neutral-800 pl-3">
              <span>{zoom}%</span>
            </div>
          </div>
        </header>

        {/* MAIN BODY AREA */}
        <div className="flex-1 flex overflow-hidden relative">

          {/* LEFT VERTICAL FLOATING TOOLBAR DOCK (Disabled if Read-Only) */}
          {viewMode !== "document" && (
            <aside className={`absolute top-6 left-6 z-30 flex flex-col gap-1 p-1.5 rounded-2xl bg-[#101014] border border-neutral-800/80 shadow-2xl backdrop-blur-md ${
              isReadOnly ? "opacity-50 pointer-events-none" : ""
            }`}>
              <Dialog open={isLibraryOpen} onOpenChange={setIsLibraryOpen}>
                <DialogTrigger asChild>
                  <button className="p-2.5 rounded-xl text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer group">
                    <Plus className="w-4.5 h-4.5 text-purple-400 group-hover:scale-110 transition-transform" />
                  </button>
                </DialogTrigger>
                <DialogContent className="bg-neutral-950 border-neutral-900 text-white max-w-lg">
                  <DialogHeader className="mb-4">
                    <DialogTitle className="text-lg font-bold flex items-center gap-2">
                      <Layers className="w-5 h-5 text-purple-500" />
                      System Architecture Component Library
                    </DialogTitle>
                    <DialogDescription className="text-neutral-400">
                      Click any architecture component to insert it directly onto your canvas.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <button
                      onClick={() => handleAddComponentNode("database", "PostgreSQL Database", "Primary Relational DB")}
                      className="p-3.5 rounded-2xl border border-neutral-800 bg-neutral-900/60 hover:border-purple-500/40 hover:bg-neutral-800/40 text-left transition-all cursor-pointer flex items-center gap-3 group"
                    >
                      <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400 group-hover:scale-110 transition-transform">
                        <Database className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">Database Node</h4>
                        <p className="text-[10px] text-neutral-400">Postgres / MongoDB</p>
                      </div>
                    </button>

                    <button
                      onClick={() => handleAddComponentNode("gateway", "API Gateway", "REST & GraphQL Router")}
                      className="p-3.5 rounded-2xl border border-neutral-800 bg-neutral-900/60 hover:border-indigo-500/40 hover:bg-neutral-800/40 text-left transition-all cursor-pointer flex items-center gap-3 group"
                    >
                      <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 group-hover:scale-110 transition-transform">
                        <Zap className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">API Gateway</h4>
                        <p className="text-[10px] text-neutral-400">Entry Route Handler</p>
                      </div>
                    </button>

                    <button
                      onClick={() => handleAddComponentNode("server", "Microservice Cluster", "Node.js Server Instances")}
                      className="p-3.5 rounded-2xl border border-neutral-800 bg-neutral-900/60 hover:border-emerald-500/40 hover:bg-neutral-800/40 text-left transition-all cursor-pointer flex items-center gap-3 group"
                    >
                      <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 group-hover:scale-110 transition-transform">
                        <Server className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">Microservice</h4>
                        <p className="text-[10px] text-neutral-400">Backend Application</p>
                      </div>
                    </button>

                    <button
                      onClick={() => handleAddComponentNode("balancer", "Load Balancer", "Nginx / ALB Distribution")}
                      className="p-3.5 rounded-2xl border border-neutral-800 bg-neutral-900/60 hover:border-amber-500/40 hover:bg-neutral-800/40 text-left transition-all cursor-pointer flex items-center gap-3 group"
                    >
                      <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400 group-hover:scale-110 transition-transform">
                        <Cpu className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">Load Balancer</h4>
                        <p className="text-[10px] text-neutral-400">Traffic Distribution</p>
                      </div>
                    </button>

                    <button
                      onClick={() => handleAddComponentNode("cache", "Redis Cache", "In-Memory Session Store")}
                      className="p-3.5 rounded-2xl border border-neutral-800 bg-neutral-900/60 hover:border-rose-500/40 hover:bg-neutral-800/40 text-left transition-all cursor-pointer flex items-center gap-3 group"
                    >
                      <div className="p-2 rounded-xl bg-rose-500/10 text-rose-400 group-hover:scale-110 transition-transform">
                        <HardDrive className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">Redis Cache</h4>
                        <p className="text-[10px] text-neutral-400">High-speed Memory</p>
                      </div>
                    </button>

                    <button
                      onClick={() => handleAddComponentNode("client", "Client Frontend", "React / Mobile App")}
                      className="p-3.5 rounded-2xl border border-neutral-800 bg-neutral-900/60 hover:border-sky-500/40 hover:bg-neutral-800/40 text-left transition-all cursor-pointer flex items-center gap-3 group"
                    >
                      <div className="p-2 rounded-xl bg-sky-500/10 text-sky-400 group-hover:scale-110 transition-transform">
                        <Globe className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">Client App</h4>
                        <p className="text-[10px] text-neutral-400">Web / iOS / Android</p>
                      </div>
                    </button>
                  </div>
                </DialogContent>
              </Dialog>

              <button
                onClick={() => alert("AI Magic Layout Triggered")}
                className="p-2.5 rounded-xl text-purple-400 hover:text-purple-300 hover:bg-neutral-800 transition-colors cursor-pointer"
                title="✨ AI Magic Tool"
              >
                <Sparkles className="w-4.5 h-4.5" />
              </button>

              <div className="w-5 h-px bg-neutral-800 my-1 self-center" />

              <button
                onClick={() => setActiveTool("select")}
                className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                  activeTool === "select" ? "bg-neutral-800 text-white shadow-inner" : "text-neutral-400 hover:text-white"
                }`}
                title="Select (v)"
              >
                <MousePointer className="w-4.5 h-4.5" />
              </button>

              <button
                onClick={() => setActiveTool("rectangle")}
                className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                  activeTool === "rectangle" ? "bg-neutral-800 text-white shadow-inner" : "text-neutral-400 hover:text-white"
                }`}
                title="Rectangle (r)"
              >
                <Square className="w-4.5 h-4.5" />
              </button>

              <button
                onClick={() => setActiveTool("circle")}
                className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                  activeTool === "circle" ? "bg-neutral-800 text-white shadow-inner" : "text-neutral-400 hover:text-white"
                }`}
                title="Circle (o)"
              >
                <CircleIcon className="w-4.5 h-4.5" />
              </button>

              <button
                onClick={() => setActiveTool("arrow")}
                className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                  activeTool === "arrow" ? "bg-neutral-800 text-white shadow-inner" : "text-neutral-400 hover:text-white"
                }`}
                title="Arrow (a)"
              >
                <ArrowUpRight className="w-4.5 h-4.5" />
              </button>

              <button
                onClick={() => setActiveTool("line")}
                className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                  activeTool === "line" ? "bg-neutral-800 text-white shadow-inner" : "text-neutral-400 hover:text-white"
                }`}
                title="Line (l)"
              >
                <Minus className="w-4.5 h-4.5" />
              </button>

              <button
                onClick={() => setActiveTool("eraser")}
                className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                  activeTool === "eraser" ? "bg-neutral-800 text-white shadow-inner" : "text-neutral-400 hover:text-white"
                }`}
                title="Eraser (e)"
              >
                <Eraser className="w-4.5 h-4.5" />
              </button>

              <button
                onClick={() => setActiveTool("text")}
                className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                  activeTool === "text" ? "bg-neutral-800 text-white shadow-inner" : "text-neutral-400 hover:text-white"
                }`}
                title="Text (t)"
              >
                <Type className="w-4.5 h-4.5" />
              </button>
            </aside>
          )}

          {/* LEFT SIDE: MARKDOWN DOCUMENTATION EDITOR */}
          {(viewMode === "document" || viewMode === "both") && (
            <div className={`h-full border-r border-neutral-800 bg-[#0b0b0e] flex flex-col p-6 overflow-y-auto ${
              viewMode === "both" ? "w-1/2" : "w-full"
            }`}>
              <div className="flex items-center justify-between mb-4 border-b border-neutral-900 pb-3">
                <span className="text-xs font-extrabold uppercase tracking-wider text-purple-400 flex items-center gap-1.5">
                  <FileText className="w-4 h-4" />
                  System Documentation
                </span>
                <span className="text-[10px] font-semibold text-neutral-500">
                  {isReadOnly ? "Read Only" : "Auto-saving markdown"}
                </span>
              </div>

              <textarea
                value={docText}
                readOnly={isReadOnly}
                onChange={(e) => {
                  setDocText(e.target.value);
                  saveDocToConvex(e.target.value);
                }}
                placeholder="Write system documentation here..."
                className="w-full h-full bg-transparent text-sm text-neutral-200 outline-none resize-none font-mono leading-relaxed placeholder-neutral-600 p-0 border-none focus:ring-0"
              />
            </div>
          )}

          {/* RIGHT SIDE: WHITEBOARD CANVAS */}
          {(viewMode === "canvas" || viewMode === "both") && (
            <div className={`h-full relative overflow-hidden bg-[#09090b] ${
              viewMode === "both" ? "w-1/2" : "w-full"
            }`}>
              <canvas
                ref={canvasRef}
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                className={`w-full h-full block ${isReadOnly ? "cursor-default" : "cursor-crosshair"}`}
              />
            </div>
          )}

          {/* RIGHT SLIDE-OVER AI CHAT DRAWER */}
          {isAiChatOpen && (
            <aside className="absolute top-0 right-0 h-full w-80 bg-[#0d0d11]/95 border-l border-neutral-800 shadow-2xl backdrop-blur-xl z-50 flex flex-col justify-between">
              <div className="p-4 border-b border-neutral-800 flex items-center justify-between">
                <span className="font-bold text-sm text-white flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-400" />
                  Slate Architecture AI
                </span>
                <button onClick={() => setIsAiChatOpen(false)} className="p-1 text-neutral-400 hover:text-white cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 p-4 space-y-3 overflow-y-auto text-xs">
                {aiMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-2xl ${
                      msg.role === "user"
                        ? "bg-purple-600/20 border border-purple-500/30 text-white ml-6"
                        : "bg-neutral-900 border border-neutral-800 text-neutral-300 mr-6"
                    }`}
                  >
                    {msg.text}
                  </div>
                ))}
              </div>

              <form onSubmit={handleSendAi} className="p-3 border-t border-neutral-800 flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Ask AI to design system..."
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white outline-none placeholder-neutral-500"
                />
                <button type="submit" className="p-2 rounded-xl bg-purple-600 text-white hover:bg-purple-700 cursor-pointer">
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </aside>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
