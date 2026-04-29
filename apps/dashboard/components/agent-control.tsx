"use client";

import { useState } from "react";
import { Sparkles, Bot, Brain, Send, Loader2, ChevronDown, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
];

interface AgentControlProps {
  onExecute: (prompt: string, provider: string, model: string) => void;
  isRunning: boolean;
}

export function AgentControl({ onExecute, isRunning }: AgentControlProps) {
  const [prompt, setPrompt] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("google");
  const [selectedModel, setSelectedModel] = useState("gemini-2.0-flash");
  const [showProviderPicker, setShowProviderPicker] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);

  const provider = PROVIDERS.find((p) => p.id === selectedProvider) ?? PROVIDERS[0];
  const ProviderIcon = provider.icon;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || isRunning) return;
    onExecute(prompt.trim(), selectedProvider, selectedModel);
  }

  function handleProviderSelect(pid: string) {
    setSelectedProvider(pid);
    const p = PROVIDERS.find((x) => x.id === pid)!;
    setSelectedModel(p.models[0]);
    setShowModelPicker(false);
  }

  return (
    <Card className="bg-slate-50 border-slate-200 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
          <ProviderIcon className="w-4 h-4" />
          Agent Control
        </CardTitle>
        <CardDescription className="text-slate-500 text-xs">
          Select a provider and describe your task
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Provider selector */}
        <div>
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2 block">
            LLM Provider
          </label>
          <div className="relative z-10">
            <button
              type="button"
              onClick={() => {
                if (!isRunning) {
                  setShowProviderPicker((x) => !x);
                  setShowModelPicker(false);
                }
              }}
              disabled={isRunning}
              className={cn(
                "w-full flex items-center justify-between px-3 py-2 rounded-lg",
                "bg-slate-100 border border-slate-200 text-sm text-slate-800",
                "hover:border-slate-600 transition-colors",
                isRunning && "opacity-50 cursor-not-allowed"
              )}
            >
              <div className="flex items-center gap-2">
                <ProviderIcon className="w-4 h-4 text-indigo-600" />
                <span className="font-semibold">{provider.label}</span>
              </div>
              <ChevronDown className={cn("w-4 h-4 text-slate-500 transition-transform", showProviderPicker && "rotate-180")} />
            </button>
            {showProviderPicker && (
              <div className="absolute top-full mt-1 left-0 right-0 z-20 bg-slate-100 border border-slate-200 rounded-lg overflow-hidden shadow-xl">
                {PROVIDERS.map((p) => {
                  const Icon = p.icon;
                  return (
                    <button
                      key={p.id}
                      onClick={() => { handleProviderSelect(p.id); setShowProviderPicker(false); }}
                      className={cn(
                        "w-full text-left px-3 py-2 flex items-center gap-2 text-sm transition-colors",
                        p.id === selectedProvider ? "bg-slate-700 text-slate-900" : "text-slate-500 hover:bg-slate-700/50 hover:text-slate-800"
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
                if (!isRunning) {
                  setShowModelPicker((x) => !x);
                  setShowProviderPicker(false);
                }
              }}
              disabled={isRunning}
              className={cn(
                "w-full flex items-center justify-between px-3 py-2 rounded-lg",
                "bg-slate-100 border border-slate-200 text-sm text-slate-800",
                "hover:border-slate-600 transition-colors",
                isRunning && "opacity-50 cursor-not-allowed"
              )}
            >
              <span className="font-mono">{selectedModel}</span>
              <ChevronDown className={cn("w-4 h-4 text-slate-500 transition-transform", showModelPicker && "rotate-180")} />
            </button>
            {showModelPicker && (
              <div className="absolute top-full mt-1 left-0 right-0 z-10 bg-slate-100 border border-slate-200 rounded-lg overflow-hidden shadow-xl">
                {provider.models.map((m) => (
                  <button
                    key={m}
                    onClick={() => { setSelectedModel(m); setShowModelPicker(false); }}
                    className={cn(
                      "w-full text-left px-3 py-2 text-sm font-mono transition-colors",
                      m === selectedModel
                        ? "bg-slate-700 text-slate-900"
                        : "text-slate-500 hover:bg-slate-700/50 hover:text-slate-800"
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
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2 block">
              Task Prompt
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isRunning}
              placeholder='e.g. "Create a Hello World React app in the workspace"'
              rows={4}
              className={cn(
                "w-full px-3 py-2.5 rounded-lg text-sm resize-none",
                "bg-slate-100 border border-slate-200 text-slate-800 placeholder-slate-600",
                "focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50",
                "transition-all duration-200",
                isRunning && "opacity-50 cursor-not-allowed"
              )}
            />
          </div>

          <Button
            type="submit"
            disabled={isRunning || !prompt.trim()}
            className={cn(
              "w-full font-semibold transition-all duration-200",
              isRunning
                ? "bg-slate-700 text-slate-500"
                : `bg-gradient-to-r ${provider.color} text-white hover:opacity-90 shadow-lg`
            )}
          >
            {isRunning ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Agent Running...
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Execute with {provider.label.split(" ")[1]}
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
