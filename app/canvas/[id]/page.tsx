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
  Command
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
  | "node";

export interface SystemNode {
  id: string;
  type: Tool;
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
}

export default function CanvasPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = params.id as string;

  // Access Mode: ?mode=edit vs ?mode=view
  const accessMode = searchParams.get("mode") || "edit";
  const isReadOnly = accessMode === "view";

  // User Identity
  const { user } = useUser();
  const guestIdRef = React.useRef(`user-${Math.floor(1000 + Math.random() * 9000)}`);
  const myUserId = user?.id || guestIdRef.current;
  const myUserName = user?.fullName || user?.firstName || `Teammate ${guestIdRef.current.slice(-4)}`;
  const myUserAvatar = user?.imageUrl || "";

  // Convex Queries & Mutations
  const slate = useQuery(api.slates.getById, { id: id as Id<"slates"> });
  const activePresence = useQuery(
    api.slates.getPresence, 
    id ? { slateId: id as Id<"slates"> } : "skip"
  );
  
  const addElementMutation = useMutation(api.slates.addElement);
  const removeElementMutation = useMutation(api.slates.removeElement);
  const updateDocumentMutation = useMutation(api.slates.updateDocument);
  const updatePresenceMutation = useMutation(api.slates.updatePresence);

  // Layout & Tool State
  const [viewMode, setViewMode] = React.useState<ViewMode>("both");
  const [activeTool, setActiveTool] = React.useState<Tool>("select");
  const [zoom, setZoom] = React.useState<number>(100);
  const [isAiChatOpen, setIsAiChatOpen] = React.useState<boolean>(false);
  const [isLibraryOpen, setIsLibraryOpen] = React.useState<boolean>(false);
  const [isShareModalOpen, setIsShareModalOpen] = React.useState<boolean>(false);
  const [isCommandOpen, setIsCommandOpen] = React.useState<boolean>(false);
  const [copiedType, setCopiedType] = React.useState<"edit" | "view" | null>(null);

  // Document Text State
  const [docText, setDocText] = React.useState<string>(
    "# System Architecture & Low Level Design\n\n## 1. Overview\nThis slate contains the low-level design diagrams and component mappings for your application.\n\n## 2. Components\n- **Client UI**: Next.js 16 App Router\n- **Backend**: Convex Cloud Realtime Functions\n- **Authentication**: Clerk OAuth Provider\n- **Database**: Convex Document DB\n"
  );

  // Canvas Elements State
  const [elements, setElements] = React.useState<SystemNode[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);

  // Active Drawing State
  const [isDrawing, setIsDrawing] = React.useState(false);
  const [currentElement, setCurrentElement] = React.useState<SystemNode | null>(null);
  const [strokeColor, setStrokeColor] = React.useState("#7C3AED");
  const [fillColor, setFillColor] = React.useState("#141414");

  // Inline Canvas Text State
  const [inlineText, setInlineText] = React.useState<{
    id: string;
    x: number;
    y: number;
    text: string;
    isNew: boolean;
  } | null>(null);

  // AI Chat State
  const [aiInput, setAiInput] = React.useState("");
  const [aiMessages, setAiMessages] = React.useState<{ role: "user" | "assistant"; text: string }[]>([
    { role: "assistant", text: "Hello! I am Slate AI powered by Groq. Type a system description (e.g., 'E-commerce microservices with PostgreSQL & Redis') to generate architecture nodes directly on your canvas!" }
  ]);

  // Auto open AI Drawer if ?ai=true URL param present
  React.useEffect(() => {
    if (searchParams.get("ai") === "true") {
      setIsAiChatOpen(true);
    }
  }, [searchParams]);

  // AI Diagram Generation Handler (Calls Groq API Route)
  const handleSendAi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiInput.trim()) return;

    const userPrompt = aiInput.trim();
    setAiInput("");
    setAiMessages((prev) => [...prev, { role: "user", text: userPrompt }]);

    try {
      setAiMessages((prev) => [...prev, { role: "assistant", text: "⚡ Generating architectural nodes for your canvas using Slate Groq AI..." }]);

      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: userPrompt }),
      });

      const data = await res.json();

      if (data?.elements && Array.isArray(data.elements)) {
        const newNodes: SystemNode[] = data.elements.map((el: any, i: number) => ({
          id: el.id || `node-${Date.now()}-${i}`,
          type: el.type === "ellipse" ? "circle" : el.type === "sticky" ? "frame" : (el.type || "rectangle"),
          nodeType: (el.text || "").toLowerCase().includes("db") || (el.text || "").toLowerCase().includes("database") ? "database" : (el.text || "").toLowerCase().includes("api") || (el.text || "").toLowerCase().includes("gateway") ? "gateway" : "server",
          title: el.text || "Component Node",
          text: el.text || "Component Node",
          x: el.x || 100 + (i % 4) * 240,
          y: el.y || 150 + Math.floor(i / 4) * 160,
          width: el.width || 180,
          height: el.height || 90,
          strokeColor: el.color || "#7C3AED",
          fillColor: "#141414",
          strokeWidth: 2,
        }));

        for (const node of newNodes) {
          await addElementMutation({
            id: id as Id<"slates">,
            element: JSON.stringify(node),
          });
        }

        setAiMessages((prev) => [
          ...prev,
          { role: "assistant", text: `🎉 Successfully generated ${newNodes.length} architecture nodes on your whiteboard canvas!` }
        ]);
      }
    } catch (err) {
      console.error("AI diagram generation error", err);
      setAiMessages((prev) => [
        ...prev,
        { role: "assistant", text: "❌ Failed generating AI diagram. Please check your GROQ_API_KEY." }
      ]);
    }
  };

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const lastPresenceTimeRef = React.useRef<number>(0);

  // Sync incoming Convex database elements reactively
  React.useEffect(() => {
    if (slate?.elements) {
      try {
        const remoteEls: SystemNode[] = JSON.parse(slate.elements);
        setElements(remoteEls);
      } catch (e) {
        console.error("Error parsing slate elements", e);
      }
    }
  }, [slate?.elements]);

  // Sync document text
  React.useEffect(() => {
    if (slate?.documentText && slate.documentText !== docText) {
      setDocText(slate.documentText);
    }
  }, [slate?.documentText]);

  // Save Document Markdown
  const saveDocToConvex = async (text: string) => {
    if (!id || isReadOnly) return;
    setIsSaving(true);
    try {
      await updateDocumentMutation({
        id: id as Id<"slates">,
        documentText: text,
      });
    } catch (e) {
      console.error("Failed saving document", e);
    } finally {
      setTimeout(() => setIsSaving(false), 300);
    }
  };

  // Broadcast Live Cursor & Stroke
  const broadcastPresence = (x: number, y: number, currentDrawing?: SystemNode | null) => {
    if (!id || !myUserId) return;
    const now = Date.now();
    if (now - lastPresenceTimeRef.current > 70) {
      lastPresenceTimeRef.current = now;
      updatePresenceMutation({
        slateId: id as Id<"slates">,
        userId: myUserId,
        userName: myUserName,
        userAvatar: myUserAvatar,
        cursorX: x,
        cursorY: y,
        drawingElement: currentDrawing ? JSON.stringify(currentDrawing) : undefined,
      });
    }
  };

  // Commit Inline Text Typing
  const commitInlineText = () => {
    if (!inlineText) return;
    const trimmed = inlineText.text.trim();
    if (trimmed) {
      if (inlineText.isNew) {
        const newTextEl: SystemNode = {
          id: inlineText.id,
          type: "text",
          title: trimmed,
          text: trimmed,
          x: inlineText.x,
          y: inlineText.y + 14,
          width: 140,
          height: 30,
          strokeColor: strokeColor || "#7C3AED",
          fillColor: "transparent",
          strokeWidth: 2,
        };
        addElementMutation({
          id: id as Id<"slates">,
          element: JSON.stringify(newTextEl),
        });
      }
    }
    setInlineText(null);
  };

  // Copy Link Helper
  const handleCopyLink = (mode: "edit" | "view") => {
    const origin = window.location.origin;
    const shareUrl = `${origin}/canvas/${id}?mode=${mode}`;
    navigator.clipboard.writeText(shareUrl);
    setCopiedType(mode);
    setTimeout(() => setCopiedType(null), 2000);
  };

  // Add Architecture Node via Atomic Mutation
  const handleAddComponentNode = async (nodeType: SystemNode["nodeType"], title: string, subtitle: string) => {
    if (isReadOnly) return;

    const newNode: SystemNode = {
      id: `node-${Date.now()}-${Math.random()}`,
      type: "node",
      nodeType,
      title,
      subtitle,
      x: 200 + Math.random() * 80,
      y: 200 + Math.random() * 80,
      width: 180,
      height: 90,
      strokeColor: "#7C3AED",
      fillColor: "#141414",
      strokeWidth: 2,
    };

    setIsSaving(true);
    try {
      await addElementMutation({
        id: id as Id<"slates">,
        element: JSON.stringify(newNode),
      });
    } catch (e) {
      console.error("Failed adding component", e);
    } finally {
      setIsSaving(false);
      setIsLibraryOpen(false);
      setSelectedId(newNode.id);
    }
  };

  // Render Single Canvas Element
  const renderSingleElement = (ctx: CanvasRenderingContext2D, el: SystemNode, isSelected: boolean) => {
    ctx.save();

    if (el.type === "node") {
      ctx.fillStyle = el.fillColor || "#141414";
      ctx.strokeStyle = isSelected ? "#7C3AED" : "#2B2B2B";
      ctx.lineWidth = isSelected ? 2 : 1;

      const radius = 12;
      ctx.beginPath();
      ctx.roundRect(el.x, el.y, el.width, el.height, radius);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#7C3AED";
      ctx.beginPath();
      ctx.roundRect(el.x, el.y, el.width, 4, [radius, radius, 0, 0]);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 13px sans-serif";
      ctx.fillText(el.title, el.x + 16, el.y + 36);

      if (el.subtitle) {
        ctx.fillStyle = "#808080";
        ctx.font = "11px sans-serif";
        ctx.fillText(el.subtitle, el.x + 16, el.y + 58);
      }

    } else if (el.type === "rectangle") {
      ctx.fillStyle = el.fillColor;
      ctx.strokeStyle = isSelected ? "#7C3AED" : el.strokeColor;
      ctx.lineWidth = el.strokeWidth;
      if (el.fillColor !== "transparent") ctx.fillRect(el.x, el.y, el.width, el.height);
      ctx.strokeRect(el.x, el.y, el.width, el.height);

    } else if (el.type === "circle") {
      ctx.fillStyle = el.fillColor;
      ctx.strokeStyle = isSelected ? "#7C3AED" : el.strokeColor;
      ctx.lineWidth = el.strokeWidth;
      ctx.beginPath();
      const rx = Math.abs(el.width) / 2;
      const ry = Math.abs(el.height) / 2;
      ctx.ellipse(el.x + rx, el.y + ry, rx, ry, 0, 0, 2 * Math.PI);
      if (el.fillColor !== "transparent") ctx.fill();
      ctx.stroke();

    } else if (el.type === "arrow") {
      ctx.strokeStyle = isSelected ? "#7C3AED" : el.strokeColor;
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
      ctx.strokeStyle = isSelected ? "#7C3AED" : el.strokeColor;
      ctx.lineWidth = el.strokeWidth;
      ctx.beginPath();
      ctx.moveTo(el.x, el.y);
      ctx.lineTo(el.x + el.width, el.y + el.height);
      ctx.stroke();

    } else if (el.type === "pencil" && el.points) {
      ctx.strokeStyle = isSelected ? "#7C3AED" : el.strokeColor;
      ctx.lineWidth = el.strokeWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
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
      ctx.strokeStyle = "#7C3AED";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(el.x - 4, el.y - 4, el.width + 8, el.height + 8);
      ctx.setLineDash([]);
    }

    ctx.restore();
  };

  // Render Scene & Teammates
  const renderAllNodes = (ctx: CanvasRenderingContext2D, els: SystemNode[]) => {
    els.forEach((el) => {
      renderSingleElement(ctx, el, el.id === selectedId);
    });

    if (activePresence && activePresence.length > 0) {
      activePresence.forEach((p) => {
        if (p.userId === myUserId) return;
        if (p.drawingElement) {
          try {
            const remoteEl: SystemNode = JSON.parse(p.drawingElement);
            renderSingleElement(ctx, remoteEl, false);
          } catch (e) {}
        }
      });
    }

    if (activePresence && activePresence.length > 0) {
      const teammateColors = ["#7C3AED", "#3B82F6", "#22C55E", "#F59E0B", "#EF4444"];

      activePresence.forEach((p, idx) => {
        if (p.userId === myUserId) return;

        ctx.save();
        const cursorColor = teammateColors[idx % teammateColors.length];

        ctx.fillStyle = cursorColor;
        ctx.beginPath();
        ctx.moveTo(p.cursorX, p.cursorY);
        ctx.lineTo(p.cursorX + 14, p.cursorY + 14);
        ctx.lineTo(p.cursorX + 6, p.cursorY + 16);
        ctx.lineTo(p.cursorX, p.cursorY + 22);
        ctx.closePath();
        ctx.fill();

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

  // Canvas Mouse Interactions
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isReadOnly) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / (zoom / 100);
    const y = (e.clientY - rect.top) / (zoom / 100);

    if (activeTool === "eraser") {
      const targetEl = [...elements].reverse().find((el) => {
        return x >= el.x && x <= el.x + el.width && y >= el.y && y <= el.y + el.height;
      });
      if (targetEl) {
        removeElementMutation({
          id: id as Id<"slates">,
          elementId: targetEl.id,
        });
      }
      return;
    }

    if (activeTool === "text") {
      const newId = `text-${Date.now()}-${Math.random()}`;
      setInlineText({
        id: newId,
        x,
        y,
        text: "",
        isNew: true,
      });
      setIsDrawing(false);
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
    const newId = `shape-${Date.now()}-${Math.random()}`;

    if (activeTool === "pencil") {
      const initPencil: SystemNode = {
        id: newId,
        type: "pencil",
        title: "",
        x,
        y,
        width: 0,
        height: 0,
        points: [{ x, y }],
        strokeColor,
        fillColor: "transparent",
        strokeWidth: 3,
      };
      setCurrentElement(initPencil);
      broadcastPresence(x, y, initPencil);
    } else {
      const initShape: SystemNode = {
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
      };
      setCurrentElement(initShape);
      broadcastPresence(x, y, initShape);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / (zoom / 100);
    const y = (e.clientY - rect.top) / (zoom / 100);

    let updatedDrawing: SystemNode | null = currentElement;

    if (!isReadOnly && isDrawing && currentElement) {
      if (currentElement.type === "pencil") {
        updatedDrawing = {
          ...currentElement,
          points: [...(currentElement.points || []), { x, y }],
        };
      } else {
        updatedDrawing = {
          ...currentElement,
          width: x - currentElement.x,
          height: y - currentElement.y,
        };
      }
      setCurrentElement(updatedDrawing);
    }

    broadcastPresence(x, y, updatedDrawing);
  };

  const handleCanvasMouseUp = async () => {
    if (isReadOnly) return;
    if (isDrawing && currentElement) {
      const finalEl = { ...currentElement };
      setCurrentElement(null);
      setIsDrawing(false);

      try {
        await addElementMutation({
          id: id as Id<"slates">,
          element: JSON.stringify(finalEl),
        });
      } catch (e) {
        console.error("Failed committing element", e);
      }

      if (id && myUserId) {
        updatePresenceMutation({
          slateId: id as Id<"slates">,
          userId: myUserId,
          userName: myUserName,
          userAvatar: myUserAvatar,
          cursorX: 0,
          cursorY: 0,
          drawingElement: undefined,
        });
      }
    }
  };

  // Main Canvas Render Loop
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



  return (
    <div className="flex flex-col h-screen w-screen bg-[#0A0A0A] text-white font-sans overflow-hidden select-none">
      
      {/* Raycast Command Palette Modal */}
      <CommandPalette
        open={isCommandOpen}
        onOpenChange={setIsCommandOpen}
        onNewSlate={() => setIsLibraryOpen(true)}
      />

      {/* TOP HEADER BAR (#101010) */}
      <header className="h-14 border-b border-[#2B2B2B] bg-[#101010] px-4 flex items-center justify-between shrink-0 z-40">
        
        {/* Left Title & Status */}
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="flex items-center gap-2 group">
            <Image
              src="/logo.png"
              alt="Slate Logo"
              width={26}
              height={26}
              className="rounded-lg shadow-sm group-hover:scale-105 transition-transform"
            />
            <span className="font-bold text-xs tracking-tight text-white">
              {slate?.title || "LLD Architecture Design"}
            </span>
          </Link>

          {/* Access Badge */}
          {isReadOnly ? (
            <div className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-bold flex items-center gap-1">
              <Eye className="w-3 h-3" />
              View Only
            </div>
          ) : (
            <div className="px-2 py-0.5 rounded-full bg-[#7C3AED]/10 border border-[#7C3AED]/20 text-[#7C3AED] text-[10px] font-bold flex items-center gap-1">
              <Edit3 className="w-3 h-3" />
              Edit Access
            </div>
          )}

          {/* Sync Status */}
          {!isReadOnly && (
            <div className="text-[11px] font-semibold text-[#808080] flex items-center gap-1.5 ml-1 border-l border-[#2B2B2B] pl-3">
              {isSaving ? (
                <span className="text-[#7C3AED] flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Syncing...
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

        {/* CENTER VIEW MODE SWITCHER: Document | Both | Canvas */}
        <div className="flex items-center p-1 rounded-xl bg-[#141414] border border-[#2B2B2B]">
          <button
            onClick={() => setViewMode("document")}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              viewMode === "document" 
                ? "bg-[#202020] text-white border border-[#2B2B2B]" 
                : "text-[#808080] hover:text-white"
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            Document
          </button>
          <button
            onClick={() => setViewMode("both")}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              viewMode === "both" 
                ? "bg-[#202020] text-white border border-[#2B2B2B]" 
                : "text-[#808080] hover:text-white"
            }`}
          >
            <Layout className="w-3.5 h-3.5" />
            Both
          </button>
          <button
            onClick={() => setViewMode("canvas")}
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              viewMode === "canvas" 
                ? "bg-[#202020] text-white border border-[#2B2B2B]" 
                : "text-[#808080] hover:text-white"
            }`}
          >
            <Maximize2 className="w-3.5 h-3.5" />
            Canvas
          </button>
        </div>

        {/* RIGHT ACTIONS: Teammates, Raycast Command, Share, AI */}
        <div className="flex items-center gap-3">
          
          {/* Raycast Trigger Button */}
          <button
            onClick={() => setIsCommandOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl border border-[#2B2B2B] bg-[#141414] text-xs font-medium text-[#808080] hover:text-white transition-all cursor-pointer"
          >
            <Search className="w-3.5 h-3.5" />
            <kbd className="px-1 py-0.5 rounded border border-[#2B2B2B] bg-[#1A1A1A] text-[9px] font-mono text-[#C5C5C5]">
              Ctrl K
            </kbd>
          </button>

          {/* ACTIVE MULTIPLAYER TEAMMATES BAR */}
          <div className="flex items-center gap-1 bg-[#141414] border border-[#2B2B2B] px-2.5 py-1 rounded-full">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse mr-1" />
            <span className="text-[11px] font-bold text-[#C5C5C5]">
              {activePresence ? activePresence.length : 1} Live
            </span>
            <div className="flex -space-x-1.5 ml-1">
              {activePresence?.map((p, idx) => (
                <div
                  key={p._id || idx}
                  className="w-5 h-5 rounded-full bg-[#7C3AED] border border-[#0A0A0A] flex items-center justify-center text-[9px] font-bold text-white uppercase overflow-hidden"
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

          {/* SHARE DIALOG */}
          <Dialog open={isShareModalOpen} onOpenChange={setIsShareModalOpen}>
            <DialogTrigger className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#7C3AED]/10 border border-[#7C3AED]/30 text-xs font-bold text-[#7C3AED] hover:bg-[#7C3AED] hover:text-white transition-all cursor-pointer shadow-sm">
              <Share2 className="w-3.5 h-3.5" />
              Share
            </DialogTrigger>
            <DialogContent className="bg-[#101010] border border-[#2B2B2B] text-white max-w-md rounded-2xl p-6">
              <DialogHeader className="mb-3">
                <DialogTitle className="text-lg font-bold flex items-center gap-2">
                  <Users className="w-5 h-5 text-[#7C3AED]" />
                  Collaborate & Share Slate
                </DialogTitle>
                <DialogDescription className="text-xs text-[#808080]">
                  Invite team members to view or edit this architecture canvas in real-time.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 mb-4">
                {/* Edit Access Link */}
                <div className="p-3 rounded-xl bg-[#141414] border border-[#2B2B2B] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Edit3 className="w-3.5 h-3.5 text-[#7C3AED]" />
                      Edit Access Link
                    </span>
                    <span className="text-[10px] text-[#7C3AED] font-semibold">Can edit & draw</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={typeof window !== "undefined" ? `${window.location.origin}/canvas/${id}?mode=edit` : ""}
                      className="w-full bg-[#0A0A0A] border border-[#2B2B2B] rounded-lg px-3 py-1.5 text-xs text-[#C5C5C5] font-mono outline-none"
                    />
                    <Button
                      size="sm"
                      onClick={() => handleCopyLink("edit")}
                      className="rounded-lg bg-[#7C3AED] text-white hover:bg-[#8B5CF6] cursor-pointer text-xs flex items-center gap-1 shrink-0 h-8"
                    >
                      {copiedType === "edit" ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copiedType === "edit" ? "Copied!" : "Copy"}
                    </Button>
                  </div>
                </div>

                {/* View Only Link */}
                <div className="p-3 rounded-xl bg-[#141414] border border-[#2B2B2B] space-y-2">
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
                      className="w-full bg-[#0A0A0A] border border-[#2B2B2B] rounded-lg px-3 py-1.5 text-xs text-[#C5C5C5] font-mono outline-none"
                    />
                    <Button
                      size="sm"
                      onClick={() => handleCopyLink("view")}
                      className="rounded-lg bg-[#1A1A1A] text-white hover:bg-[#202020] cursor-pointer text-xs flex items-center gap-1 shrink-0 h-8"
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
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold text-white transition-all cursor-pointer h-9 ${
              isAiChatOpen 
                ? "bg-[#7C3AED] shadow-md shadow-[#7C3AED]/30" 
                : "bg-[#7C3AED] hover:bg-[#8B5CF6] shadow-sm"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            AI Chat
          </Button>

          {/* Zoom Level */}
          <div className="text-xs font-bold text-[#808080] border-l border-[#2B2B2B] pl-3">
            {zoom}%
          </div>
        </div>
      </header>

      {/* MAIN BODY AREA */}
      <div className="flex-1 flex overflow-hidden relative">

        {/* LEFT FLOATING DOCK TOOLBAR (#101010, radius 16px) */}
        {viewMode !== "document" && (
          <aside className={`absolute top-6 left-6 z-30 flex flex-col gap-1 p-1.5 rounded-2xl bg-[#101010] border border-[#2B2B2B] shadow-xl ${
            isReadOnly ? "opacity-50 pointer-events-none" : ""
          }`}>
            <Dialog open={isLibraryOpen} onOpenChange={setIsLibraryOpen}>
              <DialogTrigger className="p-2.5 rounded-xl text-[#808080] hover:text-white hover:bg-[#202020] transition-colors cursor-pointer group">
                <Plus className="w-4.5 h-4.5 text-[#7C3AED] group-hover:scale-110 transition-transform" />
              </DialogTrigger>
              <DialogContent className="bg-[#101010] border border-[#2B2B2B] text-white max-w-lg rounded-2xl p-6">
                <DialogHeader className="mb-4">
                  <DialogTitle className="text-lg font-bold flex items-center gap-2">
                    <Layers className="w-5 h-5 text-[#7C3AED]" />
                    Architecture Component Library
                  </DialogTitle>
                  <DialogDescription className="text-xs text-[#808080]">
                    Click any component to insert directly onto your canvas.
                  </DialogDescription>
                </DialogHeader>

                <div className="grid grid-cols-2 gap-3 mb-2">
                  <button
                    onClick={() => handleAddComponentNode("database", "PostgreSQL Database", "Primary Relational DB")}
                    className="p-3.5 rounded-xl border border-[#2B2B2B] bg-[#141414] hover:bg-[#1A1A1A] hover:border-[#7C3AED]/40 text-left transition-all cursor-pointer flex items-center gap-3 group"
                  >
                    <div className="p-2 rounded-lg bg-[#7C3AED]/10 text-[#7C3AED] group-hover:scale-110 transition-transform">
                      <Database className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white">Database Node</h4>
                      <p className="text-[10px] text-[#808080]">Postgres / MongoDB</p>
                    </div>
                  </button>

                  <button
                    onClick={() => handleAddComponentNode("gateway", "API Gateway", "REST & GraphQL Router")}
                    className="p-3.5 rounded-xl border border-[#2B2B2B] bg-[#141414] hover:bg-[#1A1A1A] hover:border-[#7C3AED]/40 text-left transition-all cursor-pointer flex items-center gap-3 group"
                  >
                    <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 group-hover:scale-110 transition-transform">
                      <Zap className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white">API Gateway</h4>
                      <p className="text-[10px] text-[#808080]">Entry Route Handler</p>
                    </div>
                  </button>

                  <button
                    onClick={() => handleAddComponentNode("server", "Microservice Cluster", "Node.js Server Instances")}
                    className="p-3.5 rounded-xl border border-[#2B2B2B] bg-[#141414] hover:bg-[#1A1A1A] hover:border-[#7C3AED]/40 text-left transition-all cursor-pointer flex items-center gap-3 group"
                  >
                    <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 group-hover:scale-110 transition-transform">
                      <Server className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white">Microservice</h4>
                      <p className="text-[10px] text-[#808080]">Backend Application</p>
                    </div>
                  </button>

                  <button
                    onClick={() => handleAddComponentNode("balancer", "Load Balancer", "Nginx / ALB Distribution")}
                    className="p-3.5 rounded-xl border border-[#2B2B2B] bg-[#141414] hover:bg-[#1A1A1A] hover:border-[#7C3AED]/40 text-left transition-all cursor-pointer flex items-center gap-3 group"
                  >
                    <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 group-hover:scale-110 transition-transform">
                      <Cpu className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white">Load Balancer</h4>
                      <p className="text-[10px] text-[#808080]">Traffic Distribution</p>
                    </div>
                  </button>

                  <button
                    onClick={() => handleAddComponentNode("cache", "Redis Cache", "In-Memory Session Store")}
                    className="p-3.5 rounded-xl border border-[#2B2B2B] bg-[#141414] hover:bg-[#1A1A1A] hover:border-[#7C3AED]/40 text-left transition-all cursor-pointer flex items-center gap-3 group"
                  >
                    <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400 group-hover:scale-110 transition-transform">
                      <HardDrive className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white">Redis Cache</h4>
                      <p className="text-[10px] text-[#808080]">High-speed Memory</p>
                    </div>
                  </button>

                  <button
                    onClick={() => handleAddComponentNode("client", "Client Frontend", "React / Mobile App")}
                    className="p-3.5 rounded-xl border border-[#2B2B2B] bg-[#141414] hover:bg-[#1A1A1A] hover:border-[#7C3AED]/40 text-left transition-all cursor-pointer flex items-center gap-3 group"
                  >
                    <div className="p-2 rounded-lg bg-sky-500/10 text-sky-400 group-hover:scale-110 transition-transform">
                      <Globe className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white">Client App</h4>
                      <p className="text-[10px] text-[#808080]">Web / iOS / Android</p>
                    </div>
                  </button>
                </div>
              </DialogContent>
            </Dialog>

            <button
              onClick={() => setIsCommandOpen(true)}
              className="p-2.5 rounded-xl text-[#7C3AED] hover:text-[#8B5CF6] hover:bg-[#202020] transition-colors cursor-pointer"
              title="Ctrl + K Command Palette"
            >
              <Command className="w-4.5 h-4.5" />
            </button>

            <div className="w-5 h-px bg-[#2B2B2B] my-1 self-center" />

            <button
              onClick={() => setActiveTool("select")}
              className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                activeTool === "select" ? "bg-[#202020] text-white border border-[#2B2B2B]" : "text-[#808080] hover:text-white"
              }`}
              title="Select (v)"
            >
              <MousePointer className="w-4.5 h-4.5" />
            </button>

            <button
              onClick={() => setActiveTool("rectangle")}
              className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                activeTool === "rectangle" ? "bg-[#202020] text-white border border-[#2B2B2B]" : "text-[#808080] hover:text-white"
              }`}
              title="Rectangle (r)"
            >
              <Square className="w-4.5 h-4.5" />
            </button>

            <button
              onClick={() => setActiveTool("circle")}
              className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                activeTool === "circle" ? "bg-[#202020] text-white border border-[#2B2B2B]" : "text-[#808080] hover:text-white"
              }`}
              title="Circle (o)"
            >
              <CircleIcon className="w-4.5 h-4.5" />
            </button>

            <button
              onClick={() => setActiveTool("arrow")}
              className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                activeTool === "arrow" ? "bg-[#202020] text-white border border-[#2B2B2B]" : "text-[#808080] hover:text-white"
              }`}
              title="Arrow (a)"
            >
              <ArrowUpRight className="w-4.5 h-4.5" />
            </button>

            <button
              onClick={() => setActiveTool("line")}
              className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                activeTool === "line" ? "bg-[#202020] text-white border border-[#2B2B2B]" : "text-[#808080] hover:text-white"
              }`}
              title="Line (l)"
            >
              <Minus className="w-4.5 h-4.5" />
            </button>

            <button
              onClick={() => setActiveTool("eraser")}
              className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                activeTool === "eraser" ? "bg-[#202020] text-white border border-[#2B2B2B]" : "text-[#808080] hover:text-white"
              }`}
              title="Eraser (e)"
            >
              <Eraser className="w-4.5 h-4.5" />
            </button>

            <button
              onClick={() => setActiveTool("text")}
              className={`p-2.5 rounded-xl transition-all cursor-pointer ${
                activeTool === "text" ? "bg-[#202020] text-white border border-[#2B2B2B]" : "text-[#808080] hover:text-white"
              }`}
              title="Text (t)"
            >
              <Type className="w-4.5 h-4.5" />
            </button>
          </aside>
        )}

        {/* LEFT SIDE: MARKDOWN DOCUMENTATION EDITOR */}
        {(viewMode === "document" || viewMode === "both") && (
          <div className={`h-full border-r border-[#2B2B2B] bg-[#0A0A0A] flex flex-col p-6 overflow-y-auto ${
            viewMode === "both" ? "w-1/2" : "w-full"
          }`}>
            <div className="flex items-center justify-between mb-4 border-b border-[#2B2B2B] pb-3">
              <span className="text-xs font-extrabold uppercase tracking-wider text-[#7C3AED] flex items-center gap-1.5">
                <FileText className="w-4 h-4" />
                System Documentation
              </span>
              <span className="text-[10px] font-semibold text-[#808080]">
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
              className="w-full h-full bg-transparent text-sm text-[#C5C5C5] outline-none resize-none font-mono leading-relaxed placeholder-[#666666] p-0 border-none focus:ring-0"
            />
          </div>
        )}

        {/* RIGHT SIDE: WHITEBOARD CANVAS (#0D0D0D) */}
        {(viewMode === "canvas" || viewMode === "both") && (
          <div className={`h-full relative overflow-hidden bg-[#0D0D0D] ${
            viewMode === "both" ? "w-1/2" : "w-full"
          }`}>
            {/* Inline Text Input overlay */}
            {inlineText && (
              <input
                autoFocus
                value={inlineText.text}
                placeholder="Type text..."
                onChange={(e) => setInlineText({ ...inlineText, text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitInlineText();
                  if (e.key === "Escape") setInlineText(null);
                }}
                onBlur={commitInlineText}
                className="absolute z-40 bg-[#141414] text-white font-bold border border-[#7C3AED] rounded-lg px-2.5 py-1.5 text-sm outline-none shadow-2xl"
                style={{
                  left: `${inlineText.x * (zoom / 100)}px`,
                  top: `${inlineText.y * (zoom / 100)}px`,
                  minWidth: "140px",
                }}
              />
            )}

            <canvas
              ref={canvasRef}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              className="w-full h-full block"
              style={{
                cursor: isReadOnly
                  ? "default"
                  : activeTool === "eraser"
                  ? `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="%23ef4444" stroke="%23ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>') 4 18, auto`
                  : activeTool === "select"
                  ? "default"
                  : "crosshair",
              }}
            />
          </div>
        )}

        {/* RIGHT SLIDE-OVER AI CHAT DRAWER */}
        {isAiChatOpen && (
          <aside className="absolute top-0 right-0 h-full w-80 bg-[#101010] border-l border-[#2B2B2B] shadow-2xl z-50 flex flex-col justify-between">
            <div className="p-4 border-b border-[#2B2B2B] flex items-center justify-between">
              <span className="font-bold text-sm text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#7C3AED]" />
                Slate Architecture AI
              </span>
              <button onClick={() => setIsAiChatOpen(false)} className="p-1 text-[#808080] hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 p-4 space-y-3 overflow-y-auto text-xs">
              {aiMessages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`p-3 rounded-xl ${
                    msg.role === "user"
                      ? "bg-[#7C3AED]/20 border border-[#7C3AED]/40 text-white ml-6"
                      : "bg-[#141414] border border-[#2B2B2B] text-[#C5C5C5] mr-6"
                  }`}
                >
                  {msg.text}
                </div>
              ))}
            </div>

            <form onSubmit={handleSendAi} className="p-3 border-t border-[#2B2B2B] flex items-center gap-2">
              <input
                type="text"
                placeholder="Ask AI to design system..."
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                className="w-full bg-[#141414] border border-[#2B2B2B] rounded-xl px-3 py-2 text-xs text-white outline-none placeholder-[#666666]"
              />
              <button type="submit" className="p-2 rounded-xl bg-[#7C3AED] text-white hover:bg-[#8B5CF6] cursor-pointer">
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </aside>
        )}
      </div>
    </div>
  );
}
