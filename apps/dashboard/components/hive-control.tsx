"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Bot, Brain, Loader2, ChevronDown,
  Network, Users, ShieldCheck, DollarSign, FlaskConical,
  ArrowUpRight, Info, X, LineChart, Zap, ListChecks, Cpu, Moon
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
    models: ["gemini-2.0-flash", "gemini-2.5-pro-preview-03-25", "gemini-2.5-flash-preview-04-17"],
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
  {
    id: "deepseek",
    label: "DeepSeek",
    icon: Cpu,
    color: "from-sky-500 to-blue-600",
    borderColor: "border-sky-500/40",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "kimi",
    label: "Kimi (Moonshot)",
    icon: Moon,
    color: "from-violet-500 to-purple-400",
    borderColor: "border-violet-500/40",
    models: ["kimi-k2.6", "kimi-k2.5", "kimi-k2-0905-preview"],
  },
];

const EXAMPLE_PROMPTS = [
  "Create a blog system with authentication, posts, and comments",
  "Build a REST API for a Todo app with user accounts",
  "Develop a simple e-commerce product catalog with search",
];

type Mode = "execute" | "analyze";

interface HiveControlProps {
  onExecute: (
    prompt: string,
    provider: string,
    model: string,
    opts?: { budget_limit?: number; run_qa?: boolean; require_review?: boolean }
  ) => void;
  onAnalyze?: (requirement: string, provider: string, model: string) => void;
  isRunning: boolean;
  isAnalyzing?: boolean;
}

export function HiveControl({ onExecute, onAnalyze, isRunning, isAnalyzing }: HiveControlProps) {
  const [mode, setMode] = useState<Mode>("analyze");
  const [prompt, setPrompt] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("google");
  const [selectedModel, setSelectedModel] = useState("gemini-2.0-flash");
  const [showProviderPicker, setShowProviderPicker] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [budgetLimit, setBudgetLimit] = useState(2.0);
  const [runQa, setRunQa] = useState(true);
  const [requireReview, setRequireReview] = useState(false);
  const [showRoles, setShowRoles] = useState(false);

  const provider = PROVIDERS.find((p) => p.id === selectedProvider) ?? PROVIDERS[0];
  const ProviderIcon = provider.icon;
  const busy = isRunning || !!isAnalyzing;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || busy) return;
    if (mode === "analyze") {
      onAnalyze?.(prompt.trim(), selectedProvider, selectedModel);
    } else {
      onExecute(prompt.trim(), selectedProvider, selectedModel, {
        budget_limit: budgetLimit,
        run_qa: runQa,
        require_review: requireReview,
      });
    }
  }

  function handleProviderSelect(pid: string) {
    setSelectedProvider(pid);
    const p = PROVIDERS.find((x) => x.id === pid)!;
    setSelectedModel(p.models[0]);
    setShowModelPicker(false);
  }

  return (
    <Card className="bg-slate-50 border-slate-200 backdrop-blur-sm relative">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
              <Network className="w-3.5 h-3.5 text-white" />
            </div>
            Hive Orchestrator
          </CardTitle>
          <button
            type="button"
            onClick={() => setShowRoles(true)}
            className="p-1.5 rounded-md text-slate-500 hover:text-indigo-600 hover:bg-slate-100 transition-colors"
            title="View Worker Roles"
          >
            <Info className="w-4 h-4" />
          </button>
        </div>
        <CardDescription className="text-slate-500 text-xs">
          {mode === "analyze"
            ? "BA Agent decomposes your requirement into Kanban tasks"
            : "Manager Agent spawns Workers to execute directly"}
        </CardDescription>
      </CardHeader>

      {/* Roles popup */}
      <AnimatePresence>
        {showRoles && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute top-14 left-4 right-4 z-20 bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 bg-slate-50/80">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-widest">Available Roles</span>
              <button
                onClick={() => setShowRoles(false)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="p-4 flex flex-wrap gap-2 bg-white">
              {[
                { label: "Business Analyst", color: "bg-teal-50 text-teal-700 border-teal-200" },
                { label: "Manager", color: "bg-indigo-50 text-indigo-700 border-indigo-200" },
                { label: "DB Arch", color: "bg-sky-50 text-sky-700 border-sky-200" },
                { label: "Backend", color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                { label: "Frontend", color: "bg-amber-50 text-amber-700 border-amber-200" },
                { label: "UI/UX", color: "bg-purple-50 text-purple-700 border-purple-200" },
                { label: "Code Review", color: "bg-blue-50 text-blue-700 border-blue-200" },
                { label: "QA", color: "bg-pink-50 text-pink-700 border-pink-200" },
                { label: "DevOps", color: "bg-slate-50 text-slate-700 border-slate-200" },
                { label: "Tech Writer", color: "bg-violet-50 text-violet-700 border-violet-200" },
              ].map((r) => (
                <span
                  key={r.label}
                  className={cn("text-xs font-bold px-2 py-1 rounded-md border tracking-wide", r.color)}
                >
                  {r.label}
                </span>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <CardContent className="space-y-4 pb-6 pt-1">

        {/* Mode toggle */}
        <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200">
          <button
            type="button"
            onClick={() => setMode("analyze")}
            disabled={busy}
            className={cn(
              "flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition-all duration-200",
              mode === "analyze"
                ? "bg-white text-teal-700 shadow-sm border border-slate-200"
                : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 border border-transparent"
            )}
          >
            <LineChart className="w-3.5 h-3.5" />
            Analyze &amp; Plan
          </button>
          <button
            type="button"
            onClick={() => setMode("execute")}
            disabled={busy}
            className={cn(
              "flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition-all duration-200",
              mode === "execute"
                ? "bg-white text-indigo-700 shadow-sm border border-slate-200"
                : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 border border-transparent"
            )}
          >
            <Zap className="w-3.5 h-3.5" />
            Direct Execute
          </button>
        </div>

        {/* Mode description */}
        <div className={cn(
          "rounded-lg px-3 py-2.5 text-[11px] leading-relaxed border",
          mode === "analyze"
            ? "bg-teal-50/50 border-teal-100 text-teal-700"
            : "bg-indigo-50/50 border-indigo-100 text-indigo-700"
        )}>
          {mode === "analyze" ? (
            <span>
              <strong className="text-teal-800">Step 1 of 2:</strong> The Business Analyst will
              break your requirement into granular tasks on the Kanban board. Then go to{" "}
              <strong className="text-teal-800">Backlog</strong> and click{" "}
              <strong className="text-teal-800">Start Factory</strong> to execute them.
            </span>
          ) : (
            <span>
              <strong className="text-indigo-800">Direct mode:</strong> The Manager spawns Workers
              immediately and executes your requirement in a single session without a planning phase.
            </span>
          )}
        </div>

        {/* Provider selector */}
        <div>
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2 block">
            LLM Provider
          </label>
          <div className="relative z-10">
            <button
              type="button"
              onClick={() => {
                if (!busy) {
                  setShowProviderPicker((x) => !x);
                  setShowModelPicker(false);
                }
              }}
              disabled={busy}
              className={cn(
                "w-full flex items-center justify-between px-3 py-2 rounded-lg",
                "bg-slate-100 border border-slate-200 text-sm text-slate-800",
                "hover:border-slate-600 transition-colors",
                busy && "opacity-50 cursor-not-allowed"
              )}
            >
              <div className="flex items-center gap-2">
                <ProviderIcon className="w-4 h-4 text-indigo-600" />
                <span className="font-semibold">{provider.label}</span>
              </div>
              <ChevronDown className={cn("w-4 h-4 text-slate-500 transition-transform", showProviderPicker && "rotate-180")} />
            </button>
            {showProviderPicker && (
              <div className="absolute top-full mt-1 left-0 right-0 z-20 bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xl">
                {PROVIDERS.map((p) => {
                  const Icon = p.icon;
                  return (
                    <button
                      key={p.id}
                      onClick={() => { handleProviderSelect(p.id); setShowProviderPicker(false); }}
                      className={cn(
                        "w-full text-left px-3 py-2.5 flex items-center gap-2 text-sm transition-colors",
                        p.id === selectedProvider ? "bg-slate-50 text-slate-900 font-semibold" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                      )}
                    >
                      <Icon className="w-4 h-4" />
                      {p.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Model selector */}
        <div>
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2 block">
            Model
          </label>
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                if (!busy) {
                  setShowModelPicker((x) => !x);
                  setShowProviderPicker(false);
                }
              }}
              disabled={busy}
              className={cn(
                "w-full flex items-center justify-between px-3 py-2 rounded-lg",
                "bg-slate-100 border border-slate-200 text-sm text-slate-800",
                "hover:border-slate-600 transition-colors",
                busy && "opacity-50 cursor-not-allowed"
              )}
            >
              <span className="font-mono">{selectedModel}</span>
              <ChevronDown className={cn("w-4 h-4 text-slate-500 transition-transform", showModelPicker && "rotate-180")} />
            </button>
            {showModelPicker && (
              <div className="absolute top-full mt-1 left-0 right-0 z-10 bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xl">
                {provider.models.map((m) => (
                  <button
                    key={m}
                    onClick={() => { setSelectedModel(m); setShowModelPicker(false); }}
                    className={cn(
                      "w-full text-left px-3 py-2.5 text-sm font-mono transition-colors",
                      m === selectedModel ? "bg-slate-50 text-slate-900 font-semibold" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Prompt input + submit */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2 block">
              {mode === "analyze" ? "Business Requirement" : "High-Level Requirement"}
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={busy}
              placeholder={
                mode === "analyze"
                  ? 'e.g. "We need an e-commerce platform with payments, inventory and analytics"'
                  : 'e.g. "Create a blog system with auth"'
              }
              rows={7}
              className={cn(
                "w-full px-4 py-3 rounded-xl text-sm resize-none",
                "bg-white border text-slate-900 placeholder-slate-400 shadow-sm",
                "focus:outline-none focus:ring-2 transition-all duration-200",
                mode === "analyze"
                  ? "border-slate-200 focus:ring-teal-500/20 focus:border-teal-500"
                  : "border-slate-200 focus:ring-indigo-500/20 focus:border-indigo-500",
                busy && "opacity-50 cursor-not-allowed"
              )}
            />
          </div>

          {!busy && (
            <div className="flex flex-col gap-1.5">
              {EXAMPLE_PROMPTS.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setPrompt(ex)}
                  className="text-left text-xs text-slate-500 hover:text-slate-700 transition-colors truncate px-2 py-1 rounded hover:bg-slate-100 flex items-center gap-1.5"
                >
                  <ArrowUpRight className="w-3 h-3 shrink-0" /> {ex}
                </button>
              ))}
            </div>
          )}

          <Button
            type="submit"
            disabled={busy || !prompt.trim()}
            className={cn(
              "w-full h-12 rounded-xl font-bold text-sm transition-all duration-300",
              busy
                ? "bg-slate-100 text-slate-400 border border-slate-200"
                : mode === "analyze"
                  ? "bg-gradient-to-r from-teal-600 to-emerald-600 text-white hover:scale-[1.02] shadow-md shadow-teal-500/20"
                  : "bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:scale-[1.02] shadow-md shadow-indigo-500/20"
            )}
          >
            {isAnalyzing ? (
              <><Loader2 className="w-6 h-6 mr-3 animate-spin" />BA Agent analyzing…</>
            ) : isRunning ? (
              <><Loader2 className="w-6 h-6 mr-3 animate-spin" />Hive workers running…</>
            ) : mode === "analyze" ? (
              <><ListChecks className="w-6 h-6 mr-3" />Analyze &amp; Create Tasks</>
            ) : (
              <><Users className="w-6 h-6 mr-3" />Launch Hive Session</>
            )}
          </Button>

          {/* Execute-only options */}
          {!busy && mode === "execute" && (
            <div className="space-y-4 pt-4 mt-2 border-t border-slate-200">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                    <DollarSign className="w-4 h-4" /> Budget Limit
                  </label>
                  <span className="text-sm font-mono font-bold text-amber-600 border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 rounded-md">
                    ${budgetLimit.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range" min={0.1} max={10} step={0.1}
                  value={budgetLimit}
                  onChange={(e) => setBudgetLimit(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-slate-200 rounded-full appearance-none accent-amber-500 cursor-pointer"
                />
                <div className="flex justify-between text-xs text-slate-600 mt-2 font-mono">
                  <span>$0.10</span><span>$10.00</span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                  <FlaskConical className="w-4 h-4" /> QA Gate
                </label>
                <button
                  type="button"
                  onClick={() => setRunQa((v) => !v)}
                  className={cn("w-10 h-5 rounded-full transition-colors relative cursor-pointer", runQa ? "bg-indigo-600" : "bg-slate-200")}
                >
                  <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow-sm", runQa ? "left-5" : "left-0.5")} />
                </button>
              </div>

              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4" /> Human Review
                </label>
                <button
                  type="button"
                  onClick={() => setRequireReview((v) => !v)}
                  className={cn("w-10 h-5 rounded-full transition-colors relative cursor-pointer", requireReview ? "bg-indigo-600" : "bg-slate-200")}
                >
                  <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow-sm", requireReview ? "left-5" : "left-0.5")} />
                </button>
              </div>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
