"use client";

import { Wifi, WifiOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WsStatus } from "@/lib/use-hive-socket";

interface WsStatusBadgeProps {
  status: WsStatus;
  className?: string;
}

const CONFIG: Record<WsStatus, { icon: React.ElementType; color: string; bg: string; label: string; animate?: boolean }> = {
  connected:    { icon: Wifi,    color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30", label: "Live" },
  connecting:   { icon: Loader2, color: "text-blue-400",    bg: "bg-blue-500/10 border-blue-500/30",       label: "Connecting", animate: true },
  reconnecting: { icon: Loader2, color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/30",     label: "Reconnecting", animate: true },
  disconnected: { icon: WifiOff, color: "text-slate-500",   bg: "bg-slate-800/40 border-slate-700/40",     label: "Offline" },
};

export function WsStatusBadge({ status, className }: WsStatusBadgeProps) {
  const c = CONFIG[status];
  const Icon = c.icon;
  return (
    <div className={cn(
      "flex items-center gap-1.5 px-2 py-1 rounded-full border text-xs font-medium",
      c.bg, c.color, className
    )}>
      <Icon className={cn("w-3 h-3", c.animate && "animate-spin")} />
      <span>{c.label}</span>
    </div>
  );
}
