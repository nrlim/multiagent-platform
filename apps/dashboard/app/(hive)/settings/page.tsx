"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Zap, Key, DollarSign, Shield, Brain, CheckCircle2,
  Eye, EyeOff, Save, AlertTriangle, Info, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHiveStore } from "@/lib/store";

// ─── Provider configs ─────────────────────────────────────────────────────────
const PROVIDERS = [
  {
    id: "google", name: "Google Gemini", color: "text-blue-400",
    bg: "bg-blue-950/30 border-blue-800/30",
    models: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
    costPer1k: 0.00025, docsUrl: "https://ai.google.dev/",
    envKey: "GEMINI_API_KEY",
  },
  {
    id: "openai", name: "OpenAI GPT", color: "text-emerald-400",
    bg: "bg-emerald-950/30 border-emerald-800/30",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
    costPer1k: 0.005, docsUrl: "https://platform.openai.com/",
    envKey: "OPENAI_API_KEY",
  },
  {
    id: "anthropic", name: "Anthropic Claude", color: "text-amber-400",
    bg: "bg-amber-950/30 border-amber-800/30",
    models: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-3-5"],
    costPer1k: 0.003, docsUrl: "https://www.anthropic.com/api",
    envKey: "ANTHROPIC_API_KEY",
  },
] as const;

// ─── Section Card ─────────────────────────────────────────────────────────────
function SectionCard({ title, icon: Icon, children }: {
  title: string; icon: React.ElementType; children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="card-elevated rounded-2xl overflow-hidden"
    >
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-white/5">
        <div className="w-7 h-7 rounded-lg bg-indigo-600/20 border border-indigo-700/30 flex items-center justify-center">
          <Icon className="w-3.5 h-3.5 text-indigo-400" />
        </div>
        <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </motion.div>
  );
}

// ─── API Key field ────────────────────────────────────────────────────────────
function ApiKeyField({ label, envKey, placeholder }: { label: string; envKey: string; placeholder: string }) {
  const [value, setValue] = useState("");
  const [show,  setShow]  = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    // In production: POST to /api/settings/keys
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-slate-400">{label}</label>
        <span className="text-[10px] font-mono text-slate-600">{envKey}</span>
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600" />
          <input
            type={show ? "text" : "password"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            className="w-full pl-9 pr-10 py-2.5 rounded-xl bg-slate-900/70 border border-slate-700/50 text-sm text-slate-200 placeholder-slate-700
              focus:outline-none focus:ring-1 focus:ring-indigo-500/60 focus:border-indigo-500/40 transition-colors font-mono"
          />
          <button
            onClick={() => setShow(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400 transition-colors"
          >
            {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
        <button
          onClick={handleSave}
          disabled={!value.trim()}
          className={cn(
            "flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all disabled:opacity-40",
            saved
              ? "bg-emerald-600/30 border border-emerald-700/40 text-emerald-400"
              : "bg-indigo-600 hover:bg-indigo-500 text-white"
          )}
        >
          {saved ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
          {saved ? "Saved" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { provider, setProvider, budgetLimit, setBudgetLimit } = useHiveStore();
  const [activeProvider, setActiveProvider] = useState(provider);
  const [model, setModel] = useState("");
  const [qa, setQa] = useState(true);
  const [review, setReview] = useState(false);
  const [budget, setBudget] = useState(budgetLimit);

  const handleProviderChange = (id: string) => {
    setActiveProvider(id);
    setProvider(id);
    setModel("");
  };

  const handleBudgetSave = () => {
    setBudgetLimit(budget);
  };

  const currentProvider = PROVIDERS.find(p => p.id === activeProvider) ?? PROVIDERS[0];

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
      {/* ── Topbar ─────────────────────────────────────────────────────────── */}
      <header className="glass-panel border-b border-white/5 flex items-center justify-between px-6 py-4 shrink-0">
        <div>
          <h1 className="text-lg font-bold text-slate-100">Settings</h1>
          <p className="text-xs text-slate-500 mt-0.5">Manage LLM providers, API keys, and cost guardrails</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-slate-600 px-3 py-1.5 rounded-lg bg-slate-900/40 border border-white/5">
          <Info className="w-3 h-3" />
          Changes apply to the next session
        </div>
      </header>

      <div className="flex-1 p-6 max-w-2xl mx-auto w-full space-y-5">

        {/* ── LLM Provider ─────────────────────────────────────────────────── */}
        <SectionCard title="LLM Provider" icon={Brain}>
          <p className="text-xs text-slate-500 mb-4">
            Select the AI provider and model for all new Hive sessions. 
            Each provider has different cost profiles and capabilities.
          </p>
          <div className="grid grid-cols-3 gap-3 mb-5">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                onClick={() => handleProviderChange(p.id)}
                className={cn(
                  "relative rounded-xl p-3.5 border text-left transition-all",
                  activeProvider === p.id
                    ? p.bg + " ring-1 ring-inset ring-current/20"
                    : "bg-slate-900/40 border-slate-700/40 hover:border-slate-600 hover:bg-slate-800/40"
                )}
              >
                {activeProvider === p.id && (
                  <CheckCircle2 className="absolute top-2 right-2 w-3.5 h-3.5 text-current opacity-70" />
                )}
                <p className={cn("text-xs font-bold mb-1", activeProvider === p.id ? p.color : "text-slate-400")}>
                  {p.name}
                </p>
                <p className="text-[10px] text-slate-600">${p.costPer1k}/1k tok</p>
              </button>
            ))}
          </div>

          {/* Model selector */}
          <div>
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5 block">
              Model
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-900/70 border border-slate-700/50 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500/60 transition-colors"
            >
              <option value="">Auto-select (recommended)</option>
              {currentProvider.models.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <a
            href={currentProvider.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mt-3 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            <ExternalLink className="w-3 h-3" /> View {currentProvider.name} Documentation
          </a>
        </SectionCard>

        {/* ── API Keys ──────────────────────────────────────────────────────── */}
        <SectionCard title="API Keys" icon={Key}>
          <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-950/20 border border-amber-800/30 mb-5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-300/80">
              Keys are stored in your <code className="font-mono text-amber-400">.env.local</code> file and never transmitted.
              Restart the engine after changing keys.
            </p>
          </div>
          <div className="space-y-4">
            {PROVIDERS.map(p => (
              <ApiKeyField
                key={p.id}
                label={p.name}
                envKey={p.envKey}
                placeholder={`${p.envKey.toLowerCase().replace(/_/g, "-")}-...`}
              />
            ))}
          </div>
        </SectionCard>

        {/* ── Cost Guardrails ───────────────────────────────────────────────── */}
        <SectionCard title="Cost Guardrails" icon={DollarSign}>
          <p className="text-xs text-slate-500 mb-4">
            Set a hard limit on estimated spending per session. The hive will automatically stop if this threshold is reached.
          </p>
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-slate-400">Budget Limit per Session</label>
                <span className="font-mono text-sm font-bold text-emerald-400">${budget.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0.10"
                max="20.00"
                step="0.10"
                value={budget}
                onChange={(e) => setBudget(parseFloat(e.target.value))}
                className="w-full accent-indigo-500"
              />
              <div className="flex justify-between text-[10px] text-slate-700 mt-1">
                <span>$0.10</span><span>$10</span><span>$20</span>
              </div>
            </div>
            <button
              onClick={handleBudgetSave}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-colors"
            >
              <Save className="w-3.5 h-3.5" /> Apply Budget Limit
            </button>
          </div>
        </SectionCard>

        {/* ── QA & Review ──────────────────────────────────────────────────── */}
        <SectionCard title="Quality Controls" icon={Shield}>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-300 font-medium">Run QA Gate</p>
                <p className="text-xs text-slate-500 mt-0.5">Automatically test generated code before marking tasks complete</p>
              </div>
              <button
                onClick={() => setQa(v => !v)}
                className={cn(
                  "relative w-10 h-5.5 rounded-full border transition-all",
                  qa ? "bg-indigo-600 border-indigo-500" : "bg-slate-700 border-slate-600"
                )}
              >
                <div className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all", qa ? "left-5" : "left-0.5")} />
              </button>
            </div>
            <div className="h-px bg-white/5" />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-300 font-medium">Human-in-the-Loop Review</p>
                <p className="text-xs text-slate-500 mt-0.5">Pause the hive and ask for your approval before deploying changes</p>
              </div>
              <button
                onClick={() => setReview(v => !v)}
                className={cn(
                  "relative w-10 h-5.5 rounded-full border transition-all",
                  review ? "bg-indigo-600 border-indigo-500" : "bg-slate-700 border-slate-600"
                )}
              >
                <div className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all", review ? "left-5" : "left-0.5")} />
              </button>
            </div>
          </div>
        </SectionCard>

      </div>
    </div>
  );
}
