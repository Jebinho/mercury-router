export type Tier = 'haiku' | 'sonnet' | 'opus'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type WorkClass =
  | 'trivial_lookup'
  | 'routine_edit'
  | 'multi_step_change'
  | 'deep_reasoning'
  | 'long_horizon'
  | 'research_or_writing'
  | 'continuation'
export type Depth = 'minimal' | 'moderate' | 'substantial' | 'extensive'

/** What the decision model answered; confidence is its own calibrated confidence in workClass, 0 to 1. */
export type Verdict = { workClass: WorkClass; depth: Depth; needsVerification: boolean; confidence: number }

/** The tier and effort a prompt's turn runs on, and why, in a few words. */
export type Decision = {
  tier: Tier
  effort: Effort
  confidence: number
  workClass: WorkClass | null
  reason: string
}

/** What the router knows about the main conversation so far. */
export type Memory = {
  /** When each tier last started a main-loop request, in $.clock.now() ms; 0 for never. */
  lastAt: Record<Tier, number>
  /** The tier of the last main-loop request; null before the first. */
  lastTier: Tier | null
  /** Tokens the last main-loop request carried (prompt plus its output), the next one's floor. */
  contextTokens: number
  /** Tool calls that errored in the turn now running, and in the last finished one. */
  turnErrors: number
  lastTurnErrors: number
  /** The start of the last routed prompt, for the decision model to resolve short follow-ups. */
  lastPrompt: string
}

/** What answered the last finished main-loop turn, for the band above the prompt. */
export type LastTurn = {
  /** The model id the API reported. */
  model: string
  effort: Effort | null
  /** Share of the turn's prompt tokens the cache served, 0 to 100. */
  cacheRate: number
  /** The decision the turn ran on; null when the session model answered. */
  decision: Decision | null
}

declare module 'claude-code' {
  interface PluginState {
    'mercury-router': {
      decision: Decision | null
      isEnabled: boolean
      memory: Memory
      /** The effort the last main-loop request was sent with. */
      sentEffort: Effort | null
      lastTurn: LastTurn | null
    }
  }
}
