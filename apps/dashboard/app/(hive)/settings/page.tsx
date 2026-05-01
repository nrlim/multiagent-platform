"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap, Key, DollarSign, Shield, Brain, CheckCircle2,
  Eye, EyeOff, Save, AlertTriangle, Info, ExternalLink,
  Settings as SettingsIcon, Activity, Cpu, Network,
  Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHiveStore } from "@/lib/store";
import { fetchSystemSettings, updateSystemSettings } from "@/lib/engine-client";

const PROVIDERS = [
  {
    id: "google", name: "Google Gemini", color: "text-blue-600",
    bg: "bg-blue-50 border-blue-200",
    models: ["gemini-2.0-flash", "gemini-2.5-pro-preview-03-25", "gemini-2.5-flash-preview-04-17"],
    costPer1k: 0.00025, docsUrl: "https://ai.google.dev/",
    envKey: "GEMINI_API_KEY",
    dbKey: "google_key",
    setKey: "google_key_set",
  },
  {
    id: "openai", name: "OpenAI GPT", color: "text-emerald-600",
    bg: "bg-emerald-50 border-emerald-200",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
    costPer1k: 0.005, docsUrl: "https://platform.openai.com/",
    envKey: "OPENAI_API_KEY",
    dbKey: "openai_key",
    setKey: "openai_key_set",
  },
  {
    id: "anthropic", name: "Anthropic Claude", color: "text-amber-600",
    bg: "bg-amber-50 border-amber-200",
    models: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-3-5"],
    costPer1k: 0.003, docsUrl: "https://www.anthropic.com/api",
    envKey: "ANTHROPIC_API_KEY",
    dbKey: "anthropic_key",
    setKey: "anthropic_key_set",
  },
  {
    id: "deepseek", name: "DeepSeek", color: "text-sky-600",
    bg: "bg-sky-50 border-sky-200",
    models: ["deepseek-chat", "deepseek-reasoner"],
    costPer1k: 0.00027, docsUrl: "https://platform.deepseek.com/",
    envKey: "DEEPSEEK_API_KEY",
    dbKey: "deepseek_key",
    setKey: "deepseek_key_set",
  },
  {
    id: "kimi", name: "Kimi (Moonshot)", color: "text-violet-600",
    bg: "bg-violet-50 border-violet-200",
    models: ["kimi-k2.6", "kimi-k2.5", "kimi-k2-0905-preview"],
    costPer1k: 0.0012, docsUrl: "https://platform.kimi.ai/",
    envKey: "KIMI_API_KEY",
    dbKey: "kimi_key",
    setKey: "kimi_key_set",
  },
] as const;

// ─── Settings Card ────────────────────────────────────────────────────────────
function SettingsCard({ title, description, children, footer, icon: Icon }: {
  title: string; description?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; icon?: React.ElementType;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
      <div className="p-6 md:p-8 flex-1">
        <div className="flex items-start gap-4 mb-6">
          {Icon && (
            <div className="w-10 h-10 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0 shadow-sm">
              <Icon className="w-5 h-5 text-indigo-600" />
            </div>
          )}
          <div>
            <h2 className="text-lg font-bold text-slate-900">{title}</h2>
            {description && <div className="text-sm font-medium text-slate-500 mt-1.5 leading-relaxed">{description}</div>}
          </div>
        </div>
        <div>{children}</div>
      </div>
      {footer && (
        <div className="px-6 md:px-8 py-4 bg-slate-50/80 border-t border-slate-100 flex items-center justify-between">
          {footer}
        </div>
      )}
    </div>
  );
}

// ─── API Key field ────────────────────────────────────────────────────────────
function ApiKeyField({ providerConfig, isSet }: { providerConfig: any; isSet: boolean }) {
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locallySet, setLocallySet] = useState(isSet);

  useEffect(() => {
    setLocallySet(isSet);
  }, [isSet]);

  const handleSave = async () => {
    if (!value.trim()) return;
    setSaving(true);
    try {
      await updateSystemSettings({ [providerConfig.dbKey]: value });
      setSaved(true);
      setLocallySet(true);
      setTimeout(() => { setSaved(false); setSaving(false); setValue(""); }, 1500);
    } catch (e) {
      console.error(e);
      setSaving(false);
    }
  };

  const isConfigured = locallySet && !value;

  return (
    <div className="flex flex-col md:flex-row md:items-center gap-4 py-5 border-b border-slate-100 last:border-0 group">
      <div className="w-full md:w-1/3 shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <label className="text-sm font-bold text-slate-800">{providerConfig.name}</label>
          <AnimatePresence>
            {isConfigured && (
              <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="text-[10px] px-2 py-0.5 rounded font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                ACTIVE
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <p className="text-[11px] font-mono text-slate-500 bg-slate-50 inline-block px-1.5 py-0.5 rounded border border-slate-200 mt-1">{providerConfig.envKey}</p>
      </div>

      <div className="flex-1 flex gap-3 items-stretch">
        <div className="relative flex-1 group/input">
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg flex items-center justify-center transition-colors">
            <Key className={cn("w-4 h-4 transition-colors", isConfigured ? "text-emerald-500" : "text-slate-400 group-focus-within/input:text-indigo-500")} />
          </div>
          <input
            type={show && !isConfigured ? "text" : "password"}
            value={isConfigured ? "••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••" : value}
            onChange={(e) => {
              if (isConfigured) return;
              setValue(e.target.value);
            }}
            onFocus={() => {
                if (isConfigured) {
                    setLocallySet(false);
                    setValue("");
                }
            }}
            placeholder={`${providerConfig.envKey.toLowerCase().replace(/_/g, "-")}-...`}
            className={cn(
              "w-full h-full min-h-[44px] pl-12 pr-12 rounded-lg text-sm font-mono transition-all focus:outline-none focus:ring-2",
              isConfigured 
                ? "bg-slate-50 border border-slate-200 text-slate-400 cursor-default"
                : "bg-white border border-slate-200 text-slate-800 placeholder-slate-400 focus:ring-indigo-500/20 focus:border-indigo-500 shadow-sm"
            )}
          />
          <button
            onClick={() => setShow(v => !v)}
            disabled={isConfigured}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all disabled:opacity-0"
          >
            {show && !isConfigured ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        
        <AnimatePresence mode="popLayout">
          {!isConfigured ? (
            <motion.button
              key="save"
              initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.2 }}
              onClick={handleSave}
              disabled={!value.trim() || saving || saved}
              className={cn(
                "flex items-center justify-center gap-2 min-w-[100px] px-4 rounded-lg text-xs font-bold transition-all disabled:opacity-50 shadow-sm",
                saved
                  ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
                  : "bg-indigo-600 hover:bg-indigo-700 text-white border border-indigo-700"
              )}
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <CheckCircle2 className="w-3.5 h-3.5" /> : "Save"}
            </motion.button>
          ) : (
            <motion.button
              key="edit"
              initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} transition={{ duration: 0.2 }}
              onClick={() => { setLocallySet(false); setValue(""); }}
              className="flex items-center justify-center gap-2 min-w-[100px] px-4 rounded-lg text-xs font-bold transition-all bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-sm"
            >
              Update
            </motion.button>
          )}
        </AnimatePresence>
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
  const [isLoading, setIsLoading] = useState(true);
  const [dbKeysSetup, setDbKeysSetup] = useState({ google: false, openai: false, anthropic: false, deepseek: false, kimi: false });

  useEffect(() => {
    async function load() {
      try {
        const d = await fetchSystemSettings();
        setActiveProvider(d.provider);
        setModel(d.model || "");
        setBudget(d.budget_limit);
        setQa(d.run_qa);
        setReview(d.require_review);
        setDbKeysSetup({
          google: d.google_key_set,
          openai: d.openai_key_set,
          anthropic: d.anthropic_key_set,
          deepseek: d.deepseek_key_set ?? false,
          kimi: d.kimi_key_set ?? false,
        });

        // Sync local store
        setProvider(d.provider);
        setBudgetLimit(d.budget_limit);
      } catch (e) {
        console.error("Failed to load settings:", e);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [setProvider, setBudgetLimit]);

  const handleProviderChange = async (id: string) => {
    setActiveProvider(id);
    setModel("");
    setProvider(id);
    await updateSystemSettings({ provider: id, model: "" }).catch(console.error);
  };

  const handleModelChange = async (m: string) => {
    setModel(m);
    await updateSystemSettings({ model: m }).catch(console.error);
  };

  const handleBudgetSave = async () => {
    setBudgetLimit(budget);
    await updateSystemSettings({ budget_limit: budget }).catch(console.error);
  };

  const handleQaToggle = async () => {
    const next = !qa;
    setQa(next);
    await updateSystemSettings({ run_qa: next }).catch(console.error);
  };

  const handleReviewToggle = async () => {
    const next = !review;
    setReview(next);
    await updateSystemSettings({ require_review: next }).catch(console.error);
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50/50">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  const currentProvider = PROVIDERS.find(p => p.id === activeProvider) ?? PROVIDERS[0];

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50/50">
      {/* ── Topbar ──────────────────────────────────────────────────── */}
      <header className="glass-panel border-b border-slate-200 flex items-center justify-between px-6 py-4 shrink-0 bg-white sticky top-0 z-20">
        <div>
          <h1 className="text-sm font-bold text-slate-900 flex items-center gap-3">
            <div className="w-7 h-7 rounded-md bg-indigo-50 border border-indigo-100 flex items-center justify-center shadow-sm">
              <SettingsIcon className="w-3.5 h-3.5 text-indigo-600" />
            </div>
            Infrastructure Settings
          </h1>
          <p className="text-[11px] text-slate-500 mt-1 font-medium">Configure LLM providers, API keys, and execution guardrails.</p>
        </div>
      </header>

      {/* ── Main Content Area ─────────────────────────────── */}
      <div className="flex-1 overflow-y-auto w-full p-6 md:p-10 custom-scrollbar">
        <div className="w-full max-w-[1600px] mx-auto space-y-8">
          
          {/* Card 1: Default Neural Engine */}
          <SettingsCard
            title="Default Neural Engine"
            description="Select the primary LLM provider driving your AgentHive. Each engine offers distinct reasoning capabilities and cost profiles."
            icon={Brain}
            footer={
              <>
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-emerald-500" />
                  <span className="text-xs font-semibold text-slate-600">Engine Operational</span>
                </div>
                <a href={currentProvider.docsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-700 transition-colors bg-white hover:bg-indigo-50 px-3 py-1.5 rounded border border-slate-200 shadow-sm">
                  <ExternalLink className="w-3.5 h-3.5" /> SDK Docs
                </a>
              </>
            }
          >
            {/* Provider Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
              {PROVIDERS.map((p) => {
                const isActive = activeProvider === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => handleProviderChange(p.id)}
                    className={cn(
                      "relative rounded-xl p-4 text-center transition-all duration-200 border flex flex-col items-center justify-center gap-2 outline-none",
                      isActive
                        ? p.bg + " ring-2 ring-indigo-500 border-indigo-500 shadow-sm"
                        : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                    )}
                  >
                    {isActive && (
                      <div className="absolute top-2 right-2 text-current">
                        <CheckCircle2 className="w-4 h-4 text-indigo-600" />
                      </div>
                    )}
                    <span className={cn("text-sm font-bold", isActive ? p.color : "text-slate-700")}>{p.name}</span>
                  </button>
                );
              })}
            </div>

            {/* Model Select */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 block">Target Architecture (Model)</label>
              <div className="relative">
                <select
                  value={model}
                  onChange={(e) => handleModelChange(e.target.value)}
                  className="w-full pl-4 pr-10 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm font-bold text-slate-900 appearance-none focus:outline-none focus:ring-2 focus:ring-indigo-500/20 hover:border-slate-300 transition-all cursor-pointer"
                >
                  <option value="">✨ Auto-Select Optimal Model (Recommended)</option>
                  {currentProvider.models.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7"></path></svg>
                </div>
              </div>
            </div>
          </SettingsCard>

          {/* Card 2: API Keys */}
          <SettingsCard
            title="Secure Credentials Hub"
            description={
              <span className="flex items-start gap-2 text-amber-700 bg-amber-50 p-3 rounded-lg border border-amber-200 mt-2">
                <Shield className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Credentials are encrypted and stored solely in your local Postgres instance. We never transmit these to third-party telemetry.</span>
              </span>
            }
            icon={Key}
          >
            <div className="flex flex-col mt-4">
              {PROVIDERS.map(p => (
                <ApiKeyField
                  key={p.id}
                  providerConfig={p}
                  isSet={dbKeysSetup[p.id as keyof typeof dbKeysSetup] || false}
                />
              ))}
            </div>
          </SettingsCard>

          {/* Card 3: Execution Gates & Guardrails */}
          <SettingsCard
            title="Workflow Automation Guardrails"
            description="Configure financial safety limits and automation behaviors for your workflows."
            icon={Shield}
          >
            <div className="space-y-8 mt-2">
              {/* Spend Limit */}
              <div>
                <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-4 gap-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-800">Max Spend Limit / Session</h3>
                    <p className="text-xs font-medium text-slate-500 mt-1">Establish a hard ceiling for estimated expenditure per session.</p>
                  </div>
                  <span className="font-mono text-xl font-bold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-200 shrink-0 text-center">
                    ${budget.toFixed(2)}
                  </span>
                </div>
                
                <input
                  type="range" min="0.10" max="20.00" step="0.10"
                  value={budget} onChange={(e) => setBudget(parseFloat(e.target.value))}
                  className="w-full h-2 rounded-full appearance-none bg-slate-200 accent-indigo-600 hover:accent-indigo-500 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] font-bold text-slate-400 mt-2">
                  <span>$0.10</span>
                  <span>$10.00</span>
                  <span>$20.00</span>
                </div>
                <div className="mt-5 flex justify-end">
                  <button onClick={handleBudgetSave} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold transition-all shadow-sm">
                    <Save className="w-3.5 h-3.5 text-slate-400" /> Save Limit
                  </button>
                </div>
              </div>

              <div className="h-px bg-slate-100" />

              {/* Toggles */}
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="pr-4">
                    <p className="text-sm font-bold text-slate-800">Enforce QA Sub-agents</p>
                    <p className="text-xs font-medium text-slate-500 mt-1">Spawn automated testers to validate generated code syntax.</p>
                  </div>
                  <button
                    onClick={handleQaToggle}
                    className={cn(
                      "relative shrink-0 w-11 h-6 rounded-full transition-colors duration-300 border focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:ring-offset-1",
                      qa ? "bg-indigo-600 border-indigo-700" : "bg-slate-200 border-slate-300"
                    )}
                  >
                    <div className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-300", qa ? "translate-x-6" : "translate-x-1")} />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div className="pr-4">
                    <p className="text-sm font-bold text-slate-800">Human-In-The-Loop</p>
                    <p className="text-xs font-medium text-slate-500 mt-1">Suspend AI pipeline to request manual review approvals.</p>
                  </div>
                  <button
                    onClick={handleReviewToggle}
                    className={cn(
                      "relative shrink-0 w-11 h-6 rounded-full transition-colors duration-300 border focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:ring-offset-1",
                      review ? "bg-indigo-600 border-indigo-700" : "bg-slate-200 border-slate-300"
                    )}
                  >
                    <div className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-300", review ? "translate-x-6" : "translate-x-1")} />
                  </button>
                </div>
              </div>
            </div>
          </SettingsCard>

        </div>
      </div>
    </div>
  );
}
