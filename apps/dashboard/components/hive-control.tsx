"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Bot, Brain, Send, Loader2, ChevronDown,
  Network, Users, ShieldCheck, DollarSign, FlaskConical,
  ArrowUpRight, Info, X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

const PROVIDERS = [
  {
    id: "google",
    label: "Google Gemini",
    icon: Sparkles,
    color: "from-blue-500 to-cyan-400",
    borderColor: "border-blue-500/40",
    models: ["gemini-2.0-flash", "gemini-2.5-pro-preview-03-25", "gemini-1.5-pro"],
  },
  {
    id: "openai",
    label: "OpenAI GPT",
    icon: Bot,
    color: "from-emerald-500 to-teal-400",
    borderColor: "border-emerald-500/40",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    icon: Brain,
    color: "from-orange-400 to-amber-300",
    borderColor: "border-amber-500/40",
    models: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-3-5"],
  },
];

// Example prompts for easy testing
const EXAMPLE_PROMPTS = [
  "Create a blog system with authentication, posts, and comments",
  "Build a REST API for a Todo app with user accounts",
  "Develop a simple e-commerce product catalog with search",
];

interface HiveControlProps {
  onExecute: (
    prompt: string,
    provider: string,
    model: string,
    opts?: { budget_limit?: number; run_qa?: boolean; require_review?: boolean }
  ) => void;
  isRunning: boolean;
}

export function HiveControl({ onExecute, isRunning }: HiveControlProps) {
  const [prompt, setPrompt] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("google");
  const [selectedModel, setSelectedModel] = useState("gemini-2.0-flash");
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [budgetLimit, setBudgetLimit] = useState(2.0);
  const [runQa, setRunQa] = useState(true);
  const [requireReview, setRequireReview] = useState(false);
  const [showRoles, setShowRoles] = useState(false);

  const provider = PROVIDERS.find((p) => p.id === selectedProvider) ?? PROVIDERS[0];
  const ProviderIcon = provider.icon;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || isRunning) return;
    onExecute(prompt.trim(), selectedProvider, selectedModel, {
      budget_limit: budgetLimit,
      run_qa: runQa,
      require_review: requireReview,
    });
  }

  function handleProviderSelect(pid: string) {
    setSelectedProvider(pid);
    const p = PROVIDERS.find((x) => x.id === pid)!;
    setSelectedModel(p.models[0]);
    setShowModelPicker(false);
  }

  return (
    <Card className="bg-slate-900/60 border-slate-700/50 backdrop-blur-sm relative">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
              <Network className="w-3.5 h-3.5 text-white" />
            </div>
            Hive Orchestrator
          </CardTitle>
          <button
            type="button"
            onClick={() => setShowRoles(true)}
            className="p-1.5 rounded-md text-slate-500 hover:text-indigo-400 hover:bg-slate-800 transition-colors"
            title="View Worker Roles"
          >
            <Info className="w-4 h-4" />
          </button>
        </div>
        <CardDescription className="text-slate-500 text-xs">
          Manager Agent will decompose your task and spawn specialized Workers
        </CardDescription>
      </CardHeader>

      <AnimatePresence>
        {showRoles && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute top-14 left-4 right-4 z-20 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700/50 bg-slate-800/80">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">Available Roles</span>
              <button
                onClick={() => setShowRoles(false)}
                className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="p-4 flex flex-wrap gap-2 bg-slate-900/50">
              {[
                { label: "Manager", color: "bg-violet-500/20 text-violet-300 border-violet-500/30" },
                { label: "DB Arch", color: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30" },
                { label: "Backend", color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
                { label: "Frontend", color: "bg-amber-500/20 text-amber-300 border-amber-500/30" },
                { label: "QA", color: "bg-pink-500/20 text-pink-300 border-pink-500/30" },
              ].map((r) => (
                <span
                  key={r.label}
                  className={cn(
                    "text-xs font-bold px-2 py-1 rounded-md border tracking-wide",
                    r.color
                  )}
                >
                  {r.label}
                </span>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <CardContent className="space-y-6 pb-6 pt-1">

        {/* Provider selector */}
        <div>
          <label className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2 block">
            LLM Provider
          </label>
          <div className="grid grid-cols-3 gap-2">
            {PROVIDERS.map((p) => {
              const Icon = p.icon;
              const selected = p.id === selectedProvider;
              return (
                <button
                  key={p.id}
                  onClick={() => handleProviderSelect(p.id)}
                  disabled={isRunning}
                  className={cn(
                    "flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all duration-200",
                    "text-xs font-medium",
                    selected
                      ? `border-2 ${p.borderColor} bg-slate-800 text-slate-100`
                      : "border-slate-700/50 bg-slate-800/30 text-slate-400 hover:border-slate-600 hover:text-slate-300",
                    isRunning && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <div
                    className={cn(
                      "w-8 h-8 rounded-md flex items-center justify-center",
                      selected ? `bg-gradient-to-br ${p.color}` : "bg-slate-700"
                    )}
                  >
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-center leading-tight">{p.label.split(" ")[1]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Model selector */}
        <div>
          <label className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2 block">
            Model
          </label>
          <div className="relative">
            <button
              type="button"
              onClick={() => !isRunning && setShowModelPicker((x) => !x)}
              disabled={isRunning}
              className={cn(
                "w-full flex items-center justify-between px-3 py-2 rounded-lg",
                "bg-slate-800 border border-slate-700/50 text-sm text-slate-200",
                "hover:border-slate-600 transition-colors",
                isRunning && "opacity-50 cursor-not-allowed"
              )}
            >
              <span className="font-mono">{selectedModel}</span>
              <ChevronDown
                className={cn(
                  "w-4 h-4 text-slate-500 transition-transform",
                  showModelPicker && "rotate-180"
                )}
              />
            </button>
            {showModelPicker && (
              <div className="absolute top-full mt-1 left-0 right-0 z-10 bg-slate-800 border border-slate-700 rounded-lg overflow-hidden shadow-xl">
                {provider.models.map((m) => (
                  <button
                    key={m}
                    onClick={() => { setSelectedModel(m); setShowModelPicker(false); }}
                    className={cn(
                      "w-full text-left px-3 py-2 text-sm font-mono transition-colors",
                      m === selectedModel
                        ? "bg-slate-700 text-slate-100"
                        : "text-slate-400 hover:bg-slate-700/50 hover:text-slate-200"
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Prompt input */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2 block">
              High-Level Requirement
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isRunning}
              placeholder='e.g. "Create a blog system with auth"'
              rows={8}
              className={cn(
                "w-full px-4 py-3 rounded-xl text-base resize-none",
                "bg-slate-800 border-2 border-slate-700/50 text-slate-100 placeholder-slate-600",
                "focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50",
                "transition-all duration-200 shadow-inner",
                isRunning && "opacity-50 cursor-not-allowed"
              )}
            />
          </div>

          {/* Quick examples */}
          {!isRunning && (
            <div className="flex flex-col gap-1.5">
              {EXAMPLE_PROMPTS.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setPrompt(ex)}
                  className="text-left text-xs text-slate-500 hover:text-slate-300 transition-colors truncate px-2 py-1 rounded hover:bg-slate-800/50 flex items-center gap-1.5"
                >
                  <ArrowUpRight className="w-3 h-3 shrink-0" /> {ex}
                </button>
              ))}
            </div>
          )}

          <Button
            type="submit"
            disabled={isRunning || !prompt.trim()}
            className={cn(
              "w-full py-7 rounded-xl font-bold text-lg transition-all duration-300",
              isRunning
                ? "bg-slate-700 text-slate-400"
                : "bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:scale-[1.02] hover:shadow-indigo-500/20 shadow-xl"
            )}
          >
            {isRunning ? (
              <>
                <Loader2 className="w-6 h-6 mr-3 animate-spin" />
                Hive matches working...
              </>
            ) : (
              <>
                <Users className="w-6 h-6 mr-3" />
                Launch Hive Session
              </>
            )}
          </Button>

          {/* Phase 5 options */}
          {!isRunning && (
            <div className="space-y-4 pt-4 mt-2 border-t border-slate-700/50">
              {/* Budget limit */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                    <DollarSign className="w-4 h-4" /> Budget Limit
                  </label>
                  <span className="text-sm font-mono font-bold text-amber-400 border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 rounded-md">
                    ${budgetLimit.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={10}
                  step={0.1}
                  value={budgetLimit}
                  onChange={(e) => setBudgetLimit(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-full appearance-none accent-amber-400 cursor-pointer"
                />
                <div className="flex justify-between text-xs text-slate-600 mt-2 font-mono">
                  <span>$0.10</span><span>$10.00</span>
                </div>
              </div>

              {/* QA Gate toggle */}
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                  <FlaskConical className="w-4 h-4" /> QA Gate
                </label>
                <button
                  type="button"
                  onClick={() => setRunQa((v) => !v)}
                  className={cn(
                    "w-10 h-5 rounded-full transition-colors relative cursor-pointer",
                    runQa ? "bg-violet-600" : "bg-slate-700"
                  )}
                >
                  <span className={cn(
                    "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow-sm",
                    runQa ? "left-5" : "left-0.5"
                  )} />
                </button>
              </div>

              {/* Human review toggle */}
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4" /> Human Review
                </label>
                <button
                  type="button"
                  onClick={() => setRequireReview((v) => !v)}
                  className={cn(
                    "w-10 h-5 rounded-full transition-colors relative cursor-pointer",
                    requireReview ? "bg-emerald-600" : "bg-slate-700"
                  )}
                >
                  <span className={cn(
                    "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow-sm",
                    requireReview ? "left-5" : "left-0.5"
                  )} />
                </button>
              </div>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
