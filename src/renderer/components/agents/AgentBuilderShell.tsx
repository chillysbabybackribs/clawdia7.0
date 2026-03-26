import React, { useMemo, useState } from 'react';
import type { AgentBlueprint, AgentBuilderCompileResult, AgentDefinition, AgentOutputMode, AgentType } from '../../../shared/types';

interface AgentBuilderShellProps {
  agent: AgentDefinition;
  onBack: () => void;
  onDeleted: () => void;
  onUpdated: (agent: AgentDefinition) => void;
}

type BuilderStep = 'describe' | 'building' | 'clarify' | 'review' | 'testing';
type BuiltBlueprint = ReturnType<typeof buildAgentBlueprint>;

const CARD_WIDTH = 'w-[720px]';
const CARD_HEIGHT = 'h-[560px]';
const inputClassName = 'mt-1 w-full rounded-lg border border-border bg-border-subtle px-3 py-2 text-[12px] text-text-primary outline-none focus:border-accent/30';
const textareaClassName = 'mt-1 w-full resize-none rounded-lg border border-border bg-border-subtle px-3 py-2 text-[12px] leading-relaxed text-text-primary outline-none focus:border-accent/30';

function inferAgentType(goal: string): AgentType {
  const lower = goal.toLowerCase();
  if (/\b(scrape|collect|extract|crawl|pricing|listings?|urls?|reddit|etsy|shopify|website|site)\b/.test(lower)) return 'web_data';
  if (/\b(spreadsheet|excel|csv|workbook|sheet|table)\b/.test(lower)) return 'spreadsheet';
  if (/\b(email|gmail|yahoo|outlook|inbox|reply|draft)\b/.test(lower)) return 'email';
  if (/\b(folder|file|rename|move|downloads|documents|pdf|organize)\b/.test(lower)) return 'files';
  if (/\b(research|monitor|track|competitor|brief|summarize)\b/.test(lower)) return 'research';
  return 'general';
}

function inferName(goal: string, type: AgentType): string {
  const trimmed = goal.replace(/\s+/g, ' ').trim();
  if (!trimmed) return 'New Agent';
  if (trimmed.length <= 42) return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return {
    web_data: 'Web Data Agent',
    spreadsheet: 'Spreadsheet Agent',
    email: 'Email Agent',
    files: 'Files Agent',
    research: 'Research Agent',
    general: 'General Agent',
  }[type];
}

function inferDescription(goal: string, type: AgentType): string {
  const trimmed = goal.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= 140) return trimmed;
  return {
    web_data: 'Collect structured data from the relevant site or current browser context and turn it into a saved export.',
    spreadsheet: 'Work through spreadsheet inputs and return a cleaned or summarized output.',
    email: 'Check the relevant inbox context, review messages, and return the requested output.',
    files: 'Find the right files, process them, and save the result with the right level of confirmation.',
    research: 'Research the requested topic and return a concise working brief.',
    general: 'Run a repeatable job based on your description.',
  }[type];
}

function inferOutput(type: AgentType): { mode: AgentOutputMode; target?: string; note: string } {
  if (type === 'web_data') {
    return {
      mode: 'csv',
      target: 'Documents/Clawdia Exports',
      note: 'Structured scraping results will save to the default exports folder.',
    };
  }
  if (type === 'spreadsheet') {
    return {
      mode: 'spreadsheet',
      note: 'Before writing a spreadsheet output, Clawdia should confirm file type and save location.',
    };
  }
  if (type === 'files') {
    return {
      mode: 'file_output',
      note: 'Before changing or saving files, Clawdia should confirm the file type and target location.',
    };
  }
  if (type === 'email') {
    return {
      mode: 'preview',
      note: 'Email agents start by reviewing and summarizing. Sending or filing can be added later.',
    };
  }
  return {
    mode: 'preview',
    note: 'This agent will return a preview-style result first so you can validate its behavior.',
  };
}

function inferDomains(goal: string): string[] {
  const lower = goal.toLowerCase();
  const domains: string[] = [];
  if (lower.includes('reddit')) domains.push('reddit.com');
  if (lower.includes('etsy')) domains.push('etsy.com');
  if (lower.includes('shopify')) domains.push('shopify.com');
  if (lower.includes('gmail')) domains.push('mail.google.com');
  if (lower.includes('yahoo')) domains.push('mail.yahoo.com');
  if (lower.includes('amazon')) domains.push('amazon.com');
  return domains;
}

function inferProcesses(type: AgentType, goal: string, refinement: string): string[] {
  const lower = `${goal} ${refinement}`.toLowerCase();

  if (type === 'web_data') {
    const source = lower.includes('reddit')
      ? 'Open Reddit and anchor to the most relevant page or feed.'
      : 'Open the relevant site or current page and establish the right source context.';
    return [
      source,
      'Collect the requested structured data without drifting into unrelated browsing.',
      'Save the result in the default exports location and summarize what was captured.',
    ];
  }

  if (type === 'email') {
    return [
      'Open the relevant mail session or inbox context.',
      'Review only the messages that match the requested job.',
      'Return a focused summary or set of drafted next actions.',
    ];
  }

  if (type === 'spreadsheet') {
    return [
      'Locate the relevant workbook, export, or current spreadsheet context.',
      'Clean, transform, or summarize the data according to the described task.',
      'Prepare the output and confirm file handling before writing it back.',
    ];
  }

  if (type === 'files') {
    return [
      'Find the relevant files or folders in the expected machine context.',
      'Apply the requested organization, rename, or processing logic.',
      'Confirm save behavior before finalizing any changed or newly created files.',
    ];
  }

  if (type === 'research') {
    return [
      'Open the most relevant sources for the requested topic.',
      'Gather the strongest signals instead of broad unstructured browsing.',
      'Return a concise brief that is immediately usable.',
    ];
  }

  return [
    'Interpret the request and identify the right local or browser context.',
    'Execute the requested job with a narrow, relevant workflow.',
    'Return a clear output that can be tested and refined.',
  ];
}

function inferInputs(goal: string, refinement: string): string[] {
  const inputs = [goal.trim()];
  if (refinement.trim()) inputs.push(refinement.trim());
  return inputs.filter(Boolean);
}

function inferScope(type: AgentType, goal: string, domains: string[]): string[] {
  if (/\breddit\b/i.test(goal)) return ['Focus on Reddit communities and threads relevant to the request.'];
  if (/\bx\b|\btwitter\b/i.test(goal)) return ['Focus on X/Twitter posts and threads relevant to the request.'];
  if (/\bhacker news\b|\bhn\b/i.test(goal)) return ['Focus on Hacker News posts and comment threads relevant to the request.'];
  if (domains.length > 0) return domains.map((domain) => `Focus on ${domain}.`);
  if (type === 'web_data') return ['Use the current browser page or the intended site as the primary source.'];
  if (type === 'files') return ['Operate only on the files or folders the user explicitly points to.'];
  if (type === 'research') return ['Stay within the most relevant sources instead of broad browsing.'];
  return ['Stay within the explicit user context and avoid unrelated exploration.'];
}

function inferConstraints(type: AgentType): string[] {
  if (type === 'web_data') {
    return [
      'Do not drift into unrelated pages once the correct source is found.',
      'Call out blocked pages, missing fields, and extraction limits clearly.',
    ];
  }
  return [
    'Stay on task and avoid expanding the scope on your own.',
    'If the request is ambiguous, surface the ambiguity instead of guessing past it.',
  ];
}

function inferSuccessCriteria(type: AgentType, outputMode: AgentOutputMode): string[] {
  const criteria = [
    outputMode === 'csv' || outputMode === 'json' || outputMode === 'spreadsheet'
      ? 'Return structured output with the expected fields and minimal noise.'
      : 'Return an output that is immediately usable without cleanup.',
    'Stay within the requested scope and constraints.',
  ];
  if (type === 'research') criteria.unshift('Highlight the strongest signals instead of producing a generic summary.');
  if (type === 'web_data') criteria.unshift('Capture the requested fields consistently across the selected source.');
  return criteria;
}

function inferAssumptions(goal: string, type: AgentType, domains: string[], refinement: string): string[] {
  const assumptions: string[] = [];
  if (goal.trim().split(/\s+/).length < 10) assumptions.push('The request is still broad and may need a narrower scope after the first test.');
  if (type === 'web_data' && domains.length === 0) assumptions.push('The source site has not been pinned down yet.');
  if (!refinement.trim()) assumptions.push('No extra constraints or output preferences have been provided yet.');
  return assumptions;
}

function inferOpenQuestions(type: AgentType, domains: string[], outputTarget?: string): string[] {
  const questions: string[] = [];
  if (type === 'web_data' && domains.length === 0) questions.push('Which exact site or URL should this agent prioritize first?');
  if (!outputTarget && (type === 'web_data' || type === 'files' || type === 'spreadsheet')) {
    questions.push('Where should the final output be saved if the first test looks right?');
  }
  return questions;
}

function inferObjective(goal: string, refinement: string): string {
  const trimmedGoal = goal.trim();
  const trimmedRefinement = refinement.trim();
  if (!trimmedRefinement) return trimmedGoal;
  return `${trimmedGoal} ${trimmedRefinement}`.trim();
}

function inferOutputSummary(type: AgentType, output: { mode: AgentOutputMode; target?: string }): string {
  if (type === 'research') {
    return 'Deliver a concise digest with the strongest findings first.';
  }
  if (type === 'email') {
    return 'Deliver a review-ready summary or draft response.';
  }
  return output.target
    ? `Deliver the result as ${output.mode.replace(/_/g, ' ')} to ${output.target}.`
    : `Deliver the result as ${output.mode.replace(/_/g, ' ')}.`;
}

function parseListInput(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.replace(/^\s*(?:[-*•]|\d+\.)\s*/, '').trim())
    .filter(Boolean);
}

function buildAgentBlueprint(goal: string, refinement: string) {
  const combinedGoal = [goal.trim(), refinement.trim()].filter(Boolean).join('\n\nAdditional guidance:\n');
  const type = inferAgentType(combinedGoal);
  const output = inferOutput(type);
  const domains = inferDomains(combinedGoal);
  const steps = inferProcesses(type, goal, refinement);
  const blueprint: AgentBlueprint = {
    objective: inferObjective(goal, refinement),
    inputs: inferInputs(goal, refinement),
    scope: inferScope(type, combinedGoal, domains),
    constraints: inferConstraints(type),
    steps,
    output: {
      mode: output.mode,
      target: output.target,
      summary: inferOutputSummary(type, output),
    },
    successCriteria: inferSuccessCriteria(type, output.mode),
    assumptions: inferAssumptions(goal, type, domains, refinement),
    openQuestions: inferOpenQuestions(type, domains, output.target),
  };

  return {
    goal: goal.trim(),
    type,
    name: inferName(goal, type),
    description: inferDescription(combinedGoal, type),
    outputMode: output.mode,
    outputTarget: output.target,
    outputNote: output.note,
    processes: steps,
    browserDomains: domains,
    blueprint,
    refinement,
  };
}

function fromCompileResult(result: AgentBuilderCompileResult, refinement: string): BuiltBlueprint {
  return {
    goal: result.blueprint.objective || result.description || result.name,
    type: result.agentType,
    name: result.name,
    description: result.description,
    outputMode: result.outputMode,
    outputTarget: result.outputTarget,
    outputNote: result.blueprint.output.summary,
    processes: result.blueprint.steps,
    browserDomains: result.resourceScope.browserDomains || [],
    blueprint: {
      ...result.blueprint,
      assumptions: result.blueprint.assumptions.length > 0 ? result.blueprint.assumptions : result.warnings,
      openQuestions: result.questions.length > 0 ? result.questions : result.blueprint.openQuestions,
    },
    refinement,
  };
}

export default function AgentBuilderShell({ agent, onBack, onDeleted, onUpdated }: AgentBuilderShellProps) {
  const [draft, setDraft] = useState<AgentDefinition>(agent);
  const [step, setStep] = useState<BuilderStep>('describe');
  const [analysisTick, setAnalysisTick] = useState(0);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [refinement, setRefinement] = useState('');
  const [builderQuestions, setBuilderQuestions] = useState<string[]>([]);
  const [builderAnswers, setBuilderAnswers] = useState<string[]>([]);
  const [builderWarnings, setBuilderWarnings] = useState<string[]>([]);
  const [activeSessionDomains, setActiveSessionDomains] = useState<string[]>([]);
  const [built, setBuilt] = useState<BuiltBlueprint | null>(() => {
    const config = (agent.config || {}) as Record<string, any>;
    const stored = Array.isArray(config._builderProcesses) && config._builderProcesses.length > 0;
    if (!agent.goal.trim() && !stored) return null;
    if (agent.blueprint) {
      const seeded = buildAgentBlueprint(agent.goal || agent.description || agent.name, config._builderRefinement || '');
      return { ...seeded, blueprint: agent.blueprint, processes: agent.blueprint.steps };
    }
    return buildAgentBlueprint(agent.goal || agent.description || agent.name, config._builderRefinement || '');
  });

  const isDraftFlow = agent.status === 'draft';
  React.useEffect(() => {
    window.clawdia.browser.listSessions().then((domains) => {
      setActiveSessionDomains(Array.isArray(domains) ? domains : []);
    }).catch(() => setActiveSessionDomains([]));
  }, []);
  const analysisSteps = useMemo(
    () => [
      'Reading your description',
      'Inferring the right agent shape',
      'Choosing default process steps',
      'Preparing the first testable build',
    ],
    [],
  );

  const applyPatch = async (patch: Partial<AgentDefinition>) => {
    const updated = await window.clawdia.agent.update(draft.id, patch);
    if (updated) {
      setDraft(updated);
      onUpdated(updated);
    }
    return updated;
  };

  const persistBlueprint = async (blueprint = built) => {
    if (!blueprint) return null;
    return applyPatch({
      goal: blueprint.blueprint.objective || blueprint.goal,
      name: blueprint.name,
      description: blueprint.description,
      blueprint: blueprint.blueprint,
      successDescription: blueprint.blueprint.successCriteria[0],
      agentType: blueprint.type,
      outputMode: blueprint.outputMode,
      outputTarget: blueprint.outputTarget,
      resourceScope: {
        ...draft.resourceScope,
        browserDomains: blueprint.browserDomains,
      },
      config: {
        ...(draft.config as Record<string, any>),
        _builderProcesses: blueprint.processes,
        _builderRefinement: blueprint.refinement,
        allowedDomains: blueprint.browserDomains,
      },
      status: draft.status,
    });
  };

  const handleDelete = async () => {
    const confirmed = window.confirm(isDraftFlow ? 'Delete this draft agent?' : 'Delete this agent?');
    if (!confirmed) return;
    await window.clawdia.agent.delete(draft.id).catch(() => {});
    onDeleted();
  };

  const handleBuild = async () => {
    if (!draft.goal.trim()) {
      setMessage('Describe the agent first.');
      return;
    }

    setMessage(null);
    setStep('building');
    setAnalysisTick(0);

    for (let i = 0; i < analysisSteps.length; i += 1) {
      setAnalysisTick(i);
      await new Promise((resolve) => setTimeout(resolve, 380));
    }

    let blueprint: BuiltBlueprint;
    try {
      const answerText = builderQuestions.length > 0
        ? builderQuestions.map((question, index) => `${question}\nAnswer: ${builderAnswers[index]?.trim() || 'No answer provided yet.'}`).join('\n\n')
        : '';
      const compiled = await window.clawdia.agent.compile({
        goal: draft.goal,
        refinement: [refinement, answerText].filter(Boolean).join('\n\n'),
        currentBlueprint: built?.blueprint || draft.blueprint,
      });
      setBuilderWarnings(compiled.warnings || []);
      if (compiled.questions.length > 0 && builderQuestions.length === 0) {
        setBuilderQuestions(compiled.questions);
        setBuilderAnswers(compiled.questions.map(() => ''));
        setStep('clarify');
        setMessage(compiled.warnings?.length ? compiled.warnings.join(' ') : 'Answer a few short questions so the builder can finish the draft.');
        return;
      }
      blueprint = fromCompileResult(compiled, refinement);
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to build the agent draft.';
      if (/No handler registered for 'agent:compile'/.test(errorMessage)) {
        blueprint = buildAgentBlueprint(draft.goal, refinement);
        setMessage('Builder compiler is unavailable in the current app process. Using the local fallback for now. Restart the Electron app to enable the new builder compiler.');
      } else {
        setStep('describe');
        setMessage(errorMessage);
        return;
      }
    }
    setBuilt(blueprint);
    const updated = await applyPatch({
      goal: blueprint.blueprint.objective || blueprint.goal,
      name: blueprint.name,
      description: blueprint.description,
      blueprint: blueprint.blueprint,
      successDescription: blueprint.blueprint.successCriteria[0],
      agentType: blueprint.type,
      outputMode: blueprint.outputMode,
      outputTarget: blueprint.outputTarget,
      resourceScope: {
        ...draft.resourceScope,
        browserDomains: blueprint.browserDomains,
      },
      config: {
        ...(draft.config as Record<string, any>),
        _builderProcesses: blueprint.processes,
        _builderRefinement: blueprint.refinement,
        allowedDomains: blueprint.browserDomains,
      },
      lastTestStatus: 'untested',
      lastTestSummary: undefined,
      status: draft.status,
    });
    if (updated) {
      setDraft(updated);
    }
    setStep('review');
  };

  const handleClarifyContinue = async () => {
    const missingAnswers = builderAnswers.some((answer) => !answer.trim());
    if (missingAnswers) {
      setMessage('Answer each question before continuing.');
      return;
    }
    setStep('building');
    await handleBuild();
  };

  const updateBuiltBlueprint = (updater: (current: BuiltBlueprint) => BuiltBlueprint) => {
    setBuilt((current) => {
      if (!current) return current;
      return updater(current);
    });
  };

  const updateBlueprintTextList = (key: 'scope' | 'constraints' | 'steps' | 'successCriteria' | 'assumptions' | 'openQuestions', value: string) => {
    updateBuiltBlueprint((current) => ({
      ...current,
      processes: key === 'steps' ? parseListInput(value) : current.processes,
      blueprint: {
        ...current.blueprint,
        [key]: parseListInput(value),
      },
    }));
  };

  const updateBlueprintField = (
    key: 'objective' | 'summary' | 'target',
    value: string,
  ) => {
    updateBuiltBlueprint((current) => {
      if (key === 'objective') {
        return {
          ...current,
          goal: value,
          description: value.trim() || current.description,
          blueprint: {
            ...current.blueprint,
            objective: value,
            inputs: value.trim() ? [value, ...current.blueprint.inputs.slice(1)] : current.blueprint.inputs,
          },
        };
      }
      if (key === 'summary') {
        return {
          ...current,
          blueprint: {
            ...current.blueprint,
            output: {
              ...current.blueprint.output,
              summary: value,
            },
          },
        };
      }
      return {
        ...current,
        outputTarget: value || undefined,
        blueprint: {
          ...current.blueprint,
          output: {
            ...current.blueprint.output,
            target: value || undefined,
          },
        },
      };
    });
  };

  const handleTest = async () => {
    if (!built) return;
    setStep('testing');
    setTesting(true);
    setMessage(null);
    await persistBlueprint(built);
    const result = await window.clawdia.agent.test(draft.id);
    const updated = await window.clawdia.agent.get(draft.id);
    if (updated) {
      setDraft(updated);
      onUpdated(updated);
    }
    setTesting(false);
    if (result.ok) {
      setMessage(updated?.lastTestSummary || 'Test completed. If this looks right, save the agent.');
    } else {
      setMessage(updated?.lastTestSummary || result.error || 'Test failed.');
    }
  };

  const handleSave = async () => {
    if (!built) return;
    setSaving(true);
    setMessage(null);
    await persistBlueprint(built);
    const updated = await applyPatch({ status: 'ready' });
    setSaving(false);
    if (updated) setMessage('Agent saved.');
  };

  const processes = built?.processes || ((draft.config as Record<string, any>)?._builderProcesses as string[] | undefined) || [];
  const blueprint = built?.blueprint || draft.blueprint;
  const normalizedSessions = new Set(activeSessionDomains.map((domain) => domain.replace(/^www\./, '').toLowerCase()));
  const scopedDomains = (built?.browserDomains || draft.resourceScope.browserDomains || []).map((domain) => domain.replace(/^www\./, '').toLowerCase());
  const missingSessionDomains = scopedDomains.filter((domain) => !normalizedSessions.has(domain));
  const outputNote = built?.outputNote
    || (draft.outputTarget
      ? `Results will save to ${draft.outputTarget}.`
      : draft.outputMode === 'csv'
        ? 'Structured scraping results will save to the default exports folder.'
        : 'Before saving files, Clawdia should confirm file type and location.');
  const canSave = draft.lastTestStatus === 'passed';

  let stepNumber = 1;
  let stepTitle = 'Describe your agent';
  let helper = 'Describe the job this agent should own. Keep it broad and outcome-focused.';
  let body: React.ReactNode = null;
  let primaryLabel = 'Create Agent';
  let primaryAction: () => void | Promise<void> = handleBuild;
  let primaryDisabled = false;
  let secondary: React.ReactNode = null;

  if (step === 'describe') {
    stepNumber = 1;
    body = (
      <div className="space-y-5">
        <textarea
          value={draft.goal}
          onChange={(e) => setDraft({ ...draft, goal: e.target.value })}
          rows={9}
          className={`${textareaClassName} mt-0 min-h-[248px]`}
          placeholder="Scrape Reddit for consistent conversation topics and discussions around the AI agent landscape so I can stay up to date on the current daily trend."
        />
        <div className="border-t border-border pt-4">
          <label className="text-[10px] uppercase tracking-[0.14em] text-text-muted">Add more detail</label>
          <textarea
            value={refinement}
            onChange={(e) => setRefinement(e.target.value)}
            rows={4}
            placeholder="Optional. Add any extra direction if the first build should lean a certain way."
            className={textareaClassName}
          />
        </div>
        {builderWarnings.length > 0 && (
          <div className="rounded-xl border border-border px-4 py-4 text-[12px] text-text-secondary">
            <div className="text-[10px] uppercase tracking-[0.14em] text-text-muted">Builder Warnings</div>
            <div className="mt-3 space-y-2">
              {builderWarnings.map((warning, index) => (
                <div key={`${warning}-${index}`}>• {warning}</div>
              ))}
            </div>
          </div>
        )}

        {missingSessionDomains.length > 0 && (
          <div className="rounded-xl border border-[rgba(255,184,77,0.28)] bg-[rgba(255,184,77,0.08)] px-4 py-4 text-[12px] text-text-secondary">
            <div className="text-[10px] uppercase tracking-[0.14em] text-[rgba(255,184,77,0.95)]">Session Check</div>
            <div className="mt-2 leading-relaxed">
              No active browser sessions detected for: {missingSessionDomains.join(', ')}.
              Log into those sites in the browser panel before testing for better results.
            </div>
          </div>
        )}
      </div>
    );
  } else if (step === 'building') {
    stepNumber = 2;
    stepTitle = 'Building your agent';
    helper = 'Clawdia is analyzing your description and assembling the first working draft.';
    primaryLabel = 'Building...';
    primaryAction = () => {};
    primaryDisabled = true;
    secondary = (
      <button
        onClick={handleDelete}
        className="no-drag rounded-lg border border-border px-3 py-1.5 text-[11px] text-[#FF5061] transition-colors hover:bg-[#FF5061]/10"
      >
        {isDraftFlow ? 'Delete Draft' : 'Delete Agent'}
      </button>
    );
    body = (
      <div className="space-y-4">
        {analysisSteps.map((label, index) => {
          const state = index < analysisTick ? 'done' : index === analysisTick ? 'active' : 'pending';
          return (
            <div
              key={label}
              className="flex items-center gap-3 rounded-xl border border-border bg-border-subtle px-4 py-4"
            >
              <div
                className={[
                  'flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold',
                  state === 'done' ? 'bg-accent text-white' : '',
                  state === 'active' ? 'bg-accent/15 text-accent animate-pulse' : '',
                  state === 'pending' ? 'bg-surface-1 text-text-muted' : '',
                ].join(' ')}
              >
                {state === 'done' ? '✓' : index + 1}
              </div>
              <div className="text-[12px] text-text-secondary">{label}</div>
            </div>
          );
        })}
      </div>
    );
  } else if (step === 'clarify') {
    stepNumber = 2;
    stepTitle = 'Clarify the draft';
    helper = 'The builder needs a few short answers before it can produce a reliable reusable agent.';
    primaryLabel = 'Continue Build';
    primaryAction = handleClarifyContinue;
    secondary = (
      <button
        onClick={() => {
          setBuilderQuestions([]);
          setBuilderAnswers([]);
          setStep('describe');
        }}
        className="no-drag rounded-lg border border-border px-3 py-1.5 text-[11px] text-text-secondary transition-colors hover:bg-border-subtle hover:text-text-primary"
      >
        Back to description
      </button>
    );
    body = (
      <div className="space-y-4">
        {builderQuestions.map((question, index) => (
          <div key={`${question}-${index}`} className="rounded-xl border border-border px-4 py-4">
            <div className="text-[10px] uppercase tracking-[0.14em] text-text-muted">Question {index + 1}</div>
            <div className="mt-2 text-[13px] leading-relaxed text-text-primary">{question}</div>
            <textarea
              value={builderAnswers[index] || ''}
              onChange={(e) => {
                const next = [...builderAnswers];
                next[index] = e.target.value;
                setBuilderAnswers(next);
              }}
              rows={3}
              placeholder="Type a short answer"
              className={textareaClassName}
            />
          </div>
        ))}
      </div>
    );
  } else if (step === 'review') {
    stepNumber = 3;
    stepTitle = 'Built agent';
    helper = 'This is an editable draft. Click into any section, adjust it directly, or use natural language below and rebuild.';
    primaryLabel = 'Test Agent';
    primaryAction = handleTest;
    secondary = (
      <button
        onClick={() => setStep('describe')}
        className="no-drag rounded-lg border border-border px-3 py-1.5 text-[11px] text-text-secondary transition-colors hover:bg-border-subtle hover:text-text-primary"
      >
        Edit with natural language
      </button>
    );
    body = (
      <div className="space-y-5">
        <div className="rounded-xl border border-border bg-border-subtle px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] uppercase tracking-[0.14em] text-text-muted">Editable Draft</div>
            <div className="rounded-full border border-accent/20 bg-accent/[0.06] px-2 py-0.5 text-[10px] font-medium text-accent">
              Click any field to edit
            </div>
          </div>
          <div className="mt-3 text-[16px] font-semibold text-text-primary">{built?.name || draft.name}</div>
          <label className="mt-3 block text-[10px] uppercase tracking-[0.14em] text-text-muted">Objective</label>
          <textarea
            value={blueprint?.objective || ''}
            onChange={(e) => updateBlueprintField('objective', e.target.value)}
            rows={3}
            className={textareaClassName}
          />
          <div className="mt-2 text-[11px] text-text-muted">
            Keep this outcome-focused. It should describe the job clearly in one or two sentences.
          </div>
        </div>

        {builderWarnings.length > 0 && (
          <div className="rounded-xl border border-border px-4 py-4 text-[12px] text-text-secondary">
            <div className="text-[10px] uppercase tracking-[0.14em] text-text-muted">Builder Warnings</div>
            <div className="mt-3 space-y-2">
              {builderWarnings.map((warning, index) => (
                <div key={`${warning}-${index}`}>• {warning}</div>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-border px-4 py-4">
            <div className="text-[10px] uppercase tracking-[0.14em] text-text-muted">Scope</div>
            <textarea
              value={(blueprint?.scope || []).join('\n')}
              onChange={(e) => updateBlueprintTextList('scope', e.target.value)}
              rows={5}
              className={textareaClassName}
            />
            <div className="mt-2 text-[11px] text-text-muted">One item per line. Define where this agent is allowed to look.</div>
          </div>
          <div className="rounded-xl border border-border px-4 py-4">
            <div className="text-[10px] uppercase tracking-[0.14em] text-text-muted">Constraints</div>
            <textarea
              value={(blueprint?.constraints || []).join('\n')}
              onChange={(e) => updateBlueprintTextList('constraints', e.target.value)}
              rows={5}
              className={textareaClassName}
            />
            <div className="mt-2 text-[11px] text-text-muted">One item per line. Use this for guardrails and things the agent should avoid.</div>
          </div>
        </div>

        <div className="rounded-xl border border-border px-4 py-4">
          <div className="text-[10px] uppercase tracking-[0.14em] text-text-muted">How it should work</div>
          <textarea
            value={processes.join('\n')}
            onChange={(e) => updateBlueprintTextList('steps', e.target.value)}
            rows={6}
            className={textareaClassName}
          />
          <div className="mt-2 text-[11px] text-text-muted">One step per line. Keep the sequence concrete and narrow.</div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-border px-4 py-4 text-[12px] text-text-secondary">
            <div className="text-[10px] uppercase tracking-[0.14em] text-text-muted">Output</div>
            <label className="mt-3 block text-[10px] uppercase tracking-[0.14em] text-text-muted">Summary</label>
            <textarea
              value={blueprint?.output.summary || outputNote}
              onChange={(e) => updateBlueprintField('summary', e.target.value)}
              rows={3}
              className={textareaClassName}
            />
            <label className="mt-3 block text-[10px] uppercase tracking-[0.14em] text-text-muted">Target</label>
            <input
              value={blueprint?.output.target || ''}
              onChange={(e) => updateBlueprintField('target', e.target.value)}
              placeholder="Optional output path or target"
              className={inputClassName}
            />
            <div className="mt-2 text-[11px] text-text-muted">Describe exactly what the user should receive when this agent succeeds.</div>
          </div>
          <div className="rounded-xl border border-border px-4 py-4 text-[12px] text-text-secondary">
            <div className="text-[10px] uppercase tracking-[0.14em] text-text-muted">Success Criteria</div>
            <textarea
              value={(blueprint?.successCriteria || []).join('\n')}
              onChange={(e) => updateBlueprintTextList('successCriteria', e.target.value)}
              rows={5}
              className={textareaClassName}
            />
            <div className="mt-2 text-[11px] text-text-muted">One item per line. These are the checks the test step should eventually enforce.</div>
          </div>
        </div>

        {blueprint && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-border px-4 py-4 text-[12px] text-text-secondary">
              <div className="text-[10px] uppercase tracking-[0.14em] text-text-muted">Assumptions</div>
              <textarea
                value={blueprint.assumptions.join('\n')}
                onChange={(e) => updateBlueprintTextList('assumptions', e.target.value)}
                rows={5}
                className={textareaClassName}
              />
              <div className="mt-2 text-[11px] text-text-muted">One item per line. Keep only assumptions you want the user to see.</div>
            </div>
            <div className="rounded-xl border border-border px-4 py-4 text-[12px] text-text-secondary">
              <div className="text-[10px] uppercase tracking-[0.14em] text-text-muted">Open Questions</div>
              <textarea
                value={blueprint.openQuestions.join('\n')}
                onChange={(e) => updateBlueprintTextList('openQuestions', e.target.value)}
                rows={5}
                className={textareaClassName}
              />
              <div className="mt-2 text-[11px] text-text-muted">One item per line. Use this when something is still unclear before testing.</div>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-border px-4 py-4 text-[12px] text-text-secondary">
          <div><span className="text-text-muted">Output mode:</span> {(built?.outputMode || draft.outputMode).replace(/_/g, ' ')}</div>
          <div className="mt-2">{outputNote}</div>
        </div>

        <div className="border-t border-border pt-4">
          <label className="text-[10px] uppercase tracking-[0.14em] text-text-muted">Edit with natural language</label>
          <textarea
            value={refinement}
            onChange={(e) => setRefinement(e.target.value)}
            rows={4}
            placeholder="Optional. If something is off, describe how this agent should be changed, then go back and rebuild."
            className={textareaClassName}
          />
        </div>
      </div>
    );
  } else {
    stepNumber = 4;
    stepTitle = 'Test result';
    helper = 'Testing is mandatory. Save the agent only after the first result looks right.';
    primaryLabel = canSave ? (saving ? 'Saving...' : 'Save Agent') : testing ? 'Testing...' : 'Test Again';
    primaryAction = canSave ? handleSave : handleTest;
    primaryDisabled = saving || testing;
    secondary = (
      <button
        onClick={() => setStep('describe')}
        className="no-drag rounded-lg border border-border px-3 py-1.5 text-[11px] text-text-secondary transition-colors hover:bg-border-subtle hover:text-text-primary"
      >
        Edit Agent
      </button>
    );
    body = (
      <div className="space-y-5">
        <div className="rounded-xl border border-border bg-border-subtle px-4 py-4">
          <div className="text-[10px] uppercase tracking-[0.14em] text-text-muted">Current status</div>
          <div className="mt-3 text-[16px] font-semibold text-text-primary">
            {testing ? 'Testing agent...' : draft.lastTestStatus === 'passed' ? 'Test passed' : 'Needs revision'}
          </div>
          <div className="mt-2 text-[12px] leading-relaxed text-text-secondary">
            {testing
              ? 'Clawdia is validating the draft and running the first test pass against the current blueprint.'
              : message || draft.lastTestSummary || 'Run another test or edit the agent blueprint and rebuild it.'}
          </div>
        </div>

        <div className="rounded-xl border border-border px-4 py-4 text-[12px] text-text-secondary">
          <div><span className="text-text-muted">Agent:</span> {draft.name}</div>
          <div className="mt-2"><span className="text-text-muted">Output:</span> {draft.outputMode.replace(/_/g, ' ')}</div>
          <div className="mt-2"><span className="text-text-muted">Processes:</span> {processes.length}</div>
          <div className="mt-2">{outputNote}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface-0">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="no-drag rounded border border-border px-2 py-1 text-[11px] text-text-secondary transition-colors hover:bg-border-subtle hover:text-text-primary"
          >
            Back
          </button>
          <div>
            <div className="text-[16px] font-semibold text-text-primary">{draft.name || 'New Agent'}</div>
            <div className="text-[11px] text-text-muted">Agent builder</div>
          </div>
        </div>
      </div>

      {message && step !== 'testing' && (
        <div className="border-b border-border px-5 py-2 text-[11px] text-text-secondary">
          {message}
        </div>
      )}

      <div className="flex flex-1 items-center justify-center px-6 py-6">
        <div className={`${CARD_WIDTH} ${CARD_HEIGHT} rounded-2xl border border-border bg-surface-0 shadow-[0_24px_80px_rgba(0,0,0,0.28)]`}>
          <div className="border-b border-border px-6 py-5">
            <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">Step {stepNumber} of 4</div>
            <div className="mt-2 text-[20px] font-semibold text-text-primary">{stepTitle}</div>
            <div className="mt-1 text-[12px] text-text-secondary">{helper}</div>
          </div>

          <div className="h-[396px] overflow-y-auto px-6 py-5">
            {body}
          </div>

          <div className="flex items-center justify-between border-t border-border px-6 py-4">
            <div>
              {secondary || (
                <button
                  onClick={handleDelete}
                  className="no-drag rounded-lg border border-border px-3 py-1.5 text-[11px] text-[#FF5061] transition-colors hover:bg-[#FF5061]/10"
                >
                  {isDraftFlow ? 'Delete Draft' : 'Delete Agent'}
                </button>
              )}
            </div>
            <button
              onClick={() => { void primaryAction(); }}
              disabled={primaryDisabled}
              className="no-drag rounded-lg bg-accent px-4 py-1.5 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {primaryLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
