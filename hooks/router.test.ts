import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

const KEY = { openrouterApiKey: 'test-key' }
const MINUTE = 60_000

type Seen = { model?: string; effort?: unknown }
type Sent = { url: string; body: unknown }
type Verdict = { work: string; depth?: string; verify?: 'yes' | 'no'; confidence?: number }

// A chat completion whose JSON reply classifies the prompt, as the decision model answers.
function answers(v: Verdict) {
  const content = {
    work_class: v.work,
    depth: v.depth ?? 'moderate',
    needs_verification: v.verify ?? 'no',
    confidence: v.confidence ?? 0.9,
  }
  return {
    model: 'nvidia/nemotron-3.5-lightning:free',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(content) } }],
    usage: { prompt_tokens: 120, completion_tokens: 20 },
  }
}

// Answers each OpenRouter call with the next verdict in line.
function routerAnswers(on: On, bodies: unknown[], sent: Sent[] = [], status = 200) {
  on('http.fetch', ($, e) => {
    sent.push({ url: e.url, body: JSON.parse(e.init?.body ?? 'null') })
    const body = bodies[Math.min(sent.length - 1, bodies.length - 1)]
    return { value: { status, ok: status < 300, headers: {}, text: JSON.stringify(body) } }
  })
}

// The API beneath: answers every step on the model it was sent, with `context`
// prompt tokens of which `cached` came from the cache.
function bottomStep(on: On, seen: Seen[], context = 10_000, cached = 9_000) {
  on('turn.step', async function* ($, e) {
    seen.push({ model: e.model, effort: e.effort })
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'ok',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: {
        model: e.model,
        input_tokens: context - cached,
        cache_read_input_tokens: cached,
        cache_creation_input_tokens: 0,
        output_tokens: 200,
      },
    }
  })
}

function bottoms(on: On) {
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', () => ({ result: null, text: 'failed', isError: true as const }))
}

async function step($: Engine, agentId?: string) {
  const stream = $.turn.step({
    turnId: 't1',
    index: 0,
    model: 'claude-sonnet-5-5',
    effort: 'medium',
    messageCount: 1,
    ...(agentId ? { agentId } : {}),
  })
  for await (const _ of stream) {
    // drain
  }
  return stream.result
}

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })

async function turn($: Engine, text: string) {
  await $.prompt.submit(typed(text))
  await step($)
  return $.turn.complete({
    turnId: 't1',
    answer: 'ok',
    durationMs: 1000,
    isAborted: false,
    reason: 'answer',
    usage: {
      model: 'claude-opus-5-5',
      input_tokens: 1000,
      cache_read_input_tokens: 9000,
      cache_creation_input_tokens: 0,
      output_tokens: 200,
    },
  })
}

const SESSION: Seen[] = [{ model: 'claude-sonnet-5-5', effort: 'medium' }]
let clock: MockClock

function setup(on: On) {
  clock = mock.clock(on, { now: 10 * MINUTE })
  bottoms(on)
}

test('asks about the work and routes deep reasoning to opus high', { options: KEY }, async ($, on) => {
  const seen: Seen[] = []
  const sent: Sent[] = []
  setup(on)
  routerAnswers(on, [answers({ work: 'deep_reasoning', depth: 'substantial' })], sent)
  bottomStep(on, seen)

  await $.prompt.submit(typed('redesign the whole auth architecture'))
  await step($)

  expect(sent.length).toBe(1)
  expect(sent[0]?.url).toBe('https://openrouter.ai/api/v1/chat/completions')
  const body = sent[0]?.body as { model: string; state: string; questions: Record<string, unknown> }
  expect(body.model).toBe('nvidia/nemotron-3.5-lightning:free')
  expect(body.state).toContain('redesign the whole auth architecture')
  expect(body.state).toContain('conversation_size: empty')
  expect(Object.keys(body.questions)).toEqual(['work_class', 'depth', 'needs_verification'])
  expect(seen).toEqual([{ model: 'claude-opus-5-5', effort: 'high' }])
})

test('a trivial first prompt goes to haiku with its effort', { options: KEY }, async ($, on) => {
  const seen: Seen[] = []
  setup(on)
  routerAnswers(on, [answers({ work: 'trivial_lookup', depth: 'minimal' })])
  bottomStep(on, seen)

  await $.prompt.submit(typed('quanto é 2+2?'))
  await step($)

  expect(seen).toEqual([{ model: 'claude-haiku-5-5', effort: 'low' }])
})

test('multi-step work on sonnet never runs at medium', { options: KEY }, async ($, on) => {
  const seen: Seen[] = []
  setup(on)
  routerAnswers(on, [answers({ work: 'multi_step_change', depth: 'moderate' })])
  bottomStep(on, seen)

  await $.prompt.submit(typed('add a CLI flag and update the tests'))
  await step($)

  expect(seen).toEqual([{ model: 'claude-sonnet-5-5', effort: 'high' }])
})

test('with opus warm and a large context, a trivial prompt stays on opus at low', { options: KEY }, async ($, on) => {
  const seen: Seen[] = []
  setup(on)
  routerAnswers(on, [
    answers({ work: 'deep_reasoning', depth: 'substantial' }),
    answers({ work: 'trivial_lookup', depth: 'minimal' }),
  ])
  bottomStep(on, seen, 150_000, 140_000)

  await turn($, 'find why the cache is corrupted')
  await clock.advance(2 * MINUTE)
  await turn($, 'what does this function return?')

  expect(seen[1]).toEqual({ model: 'claude-opus-5-5', effort: 'low' })
})

test('with opus warm and a small context, a trivial prompt may drop to haiku', { options: KEY }, async ($, on) => {
  const seen: Seen[] = []
  setup(on)
  routerAnswers(on, [
    answers({ work: 'deep_reasoning', depth: 'substantial' }),
    answers({ work: 'trivial_lookup', depth: 'minimal' }),
  ])
  bottomStep(on, seen, 10_000, 9_000)

  await turn($, 'find why the cache is corrupted')
  await turn($, 'what is a mutex?')

  expect(seen[1]).toEqual({ model: 'claude-haiku-5-5', effort: 'low' })
})

test('with opus warm, sonnet-sized work stays on opus one effort lower', { options: KEY }, async ($, on) => {
  const seen: Seen[] = []
  setup(on)
  routerAnswers(on, [
    answers({ work: 'deep_reasoning', depth: 'substantial' }),
    answers({ work: 'multi_step_change', depth: 'moderate' }),
  ])
  bottomStep(on, seen, 60_000, 55_000)

  await turn($, 'design the migration')
  await turn($, 'now apply it to the three services')

  expect(seen[1]).toEqual({ model: 'claude-opus-5-5', effort: 'medium' })
})

test('once the cache has gone cold, the router switches freely', { options: KEY }, async ($, on) => {
  const seen: Seen[] = []
  setup(on)
  routerAnswers(on, [
    answers({ work: 'deep_reasoning', depth: 'substantial' }),
    answers({ work: 'multi_step_change', depth: 'moderate' }),
  ])
  bottomStep(on, seen, 60_000, 55_000)

  await turn($, 'design the migration')
  await clock.advance(61 * MINUTE)
  await turn($, 'now apply it to the three services')

  expect(seen[1]).toEqual({ model: 'claude-sonnet-5-5', effort: 'high' })
})

test('an acknowledgement drops to low on the warm model without asking', { options: KEY }, async ($, on) => {
  const seen: Seen[] = []
  const sent: Sent[] = []
  setup(on)
  routerAnswers(on, [answers({ work: 'deep_reasoning', depth: 'extensive' })], sent)
  bottomStep(on, seen, 150_000, 140_000)

  await turn($, 'plan the rewrite of the scheduler')
  await turn($, 'ok, entendi')

  expect(sent.length).toBe(1)
  expect(seen[1]).toEqual({ model: 'claude-opus-5-5', effort: 'low' })
})

test('a short question that needs a command stays at low', { options: KEY }, async ($, on) => {
  const seen: Seen[] = []
  setup(on)
  routerAnswers(on, [
    answers({ work: 'deep_reasoning', depth: 'substantial' }),
    answers({ work: 'trivial_lookup', depth: 'moderate', verify: 'yes' }),
  ])
  bottomStep(on, seen, 150_000, 140_000)

  await turn($, 'design the plugin install flow')
  await turn($, 'este mod não está instalado globalmente né?')

  expect(seen[1]).toEqual({ model: 'claude-opus-5-5', effort: 'low' })
})

test('a short follow-up inherits the previous decision without asking', { options: KEY }, async ($, on) => {
  const seen: Seen[] = []
  const sent: Sent[] = []
  setup(on)
  routerAnswers(on, [answers({ work: 'deep_reasoning', depth: 'extensive' })], sent)
  bottomStep(on, seen)

  await turn($, 'plan the rewrite of the scheduler')
  await turn($, 'sim, pode fazer')

  expect(sent.length).toBe(1)
  expect(seen).toEqual([
    { model: 'claude-opus-5-5', effort: 'xhigh' },
    { model: 'claude-opus-5-5', effort: 'xhigh' },
  ])
})

test('the person saying it is still broken escalates', { options: KEY }, async ($, on) => {
  const seen: Seen[] = []
  setup(on)
  routerAnswers(on, [
    answers({ work: 'multi_step_change', depth: 'moderate' }),
    answers({ work: 'routine_edit', depth: 'moderate' }),
  ])
  bottomStep(on, seen)

  await turn($, 'fix the flaky upload test')
  await turn($, 'ainda está quebrado')

  expect(seen[0]).toEqual({ model: 'claude-sonnet-5-5', effort: 'high' })
  expect(seen[1]).toEqual({ model: 'claude-opus-5-5', effort: 'high' })
})

test('two failed tool calls in a turn escalate the next one', { options: KEY }, async ($, on) => {
  const seen: Seen[] = []
  setup(on)
  routerAnswers(on, [
    answers({ work: 'routine_edit', depth: 'moderate' }),
    answers({ work: 'routine_edit', depth: 'moderate' }),
  ])
  bottomStep(on, seen)

  await $.prompt.submit(typed('rename the config field'))
  await step($)
  await $.tool.call({ tool: 'Read', file_path: 'missing.ts' })
  await $.tool.call({ tool: 'Read', file_path: 'missing.ts' })
  await $.turn.complete({ turnId: 't1', answer: 'ok', durationMs: 1, isAborted: false, reason: 'answer' })
  await $.prompt.submit(typed('rename it in the docs as well'))
  await step($)

  expect(seen[0]).toEqual({ model: 'claude-sonnet-5-5', effort: 'medium' })
  expect(seen[1]).toEqual({ model: 'claude-sonnet-5-5', effort: 'high' })
})

const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}
const DEADLOCK = answers({ work: 'deep_reasoning', depth: 'moderate', confidence: 0.82 })

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: the band above the prompt names what answered the last turn`, { options: KEY }, async ($, on) => {
    setup(on)
    routerAnswers(on, [DEADLOCK])
    bottomStep(on, [])

    await turn($, 'why does the worker deadlock?')
    const band = await $.ui.mount({ plugin: 'mercury-router', surface, component: 'AbovePrompt', props: BAND })

    expect((await band.find({ type: 'Text' }))?.text).toBe(
      '🧭 último turno: Opus 5.5 · high · cache 90% · raciocínio profundo 82% · início da conversa',
    )
  })

  test(`${surface}: while a turn runs, the band names the decision it is on`, { options: KEY }, async ($, on) => {
    setup(on)
    routerAnswers(on, [DEADLOCK])
    bottomStep(on, [])

    await $.prompt.submit(typed('why does the worker deadlock?'))
    const band = await $.ui.mount({
      plugin: 'mercury-router',
      surface,
      component: 'AbovePrompt',
      props: { ...BAND, isWorking: true },
    })

    expect((await band.find({ type: 'Text' }))?.text).toBe(
      '🧭 agora: Opus 5.5 · high · raciocínio profundo 82% · início da conversa',
    )
  })
}

test('no line under the answer by default', { options: KEY }, async ($, on) => {
  setup(on)
  routerAnswers(on, [DEADLOCK])
  bottomStep(on, [])

  const done = await turn($, 'why does the worker deadlock?')

  expect(done.text).toBe('ok')
})

test('names the model under the answer when the footer is on', { options: { ...KEY, showFooter: true } }, async ($, on) => {
  setup(on)
  routerAnswers(on, [DEADLOCK])
  bottomStep(on, [])

  const done = await turn($, 'why does the worker deadlock?')

  expect(done.text).toBe('🧭 Opus 5.5 · high · cache 90% · raciocínio profundo 82% · início da conversa')
})

test('keeps the session model when the API errors', { options: KEY }, async ($, on) => {
  const seen: Seen[] = []
  setup(on)
  routerAnswers(on, [{ error: { message: 'rate limited' } }], [], 429)
  bottomStep(on, seen)

  await $.prompt.submit(typed('hello'))
  await step($)

  expect(seen).toEqual(SESSION)
})

test('keeps the previous decision when a later call errors', { options: KEY }, async ($, on) => {
  const seen: Seen[] = []
  setup(on)
  routerAnswers(on, [answers({ work: 'deep_reasoning', depth: 'substantial' }), { nope: true }])
  bottomStep(on, seen)

  await turn($, 'design the cache layer')
  await turn($, 'and the eviction policy?')

  expect(seen[1]).toEqual({ model: 'claude-opus-5-5', effort: 'high' })
})

test('keeps the session model on an answer it does not know', { options: KEY }, async ($, on) => {
  const seen: Seen[] = []
  setup(on)
  routerAnswers(on, [answers({ work: 'gpt' })])
  bottomStep(on, seen)

  await $.prompt.submit(typed('hello'))
  await step($)

  expect(seen).toEqual(SESSION)
})

test('does not call OpenRouter without a key', async ($, on) => {
  const sent: Sent[] = []
  const seen: Seen[] = []
  setup(on)
  routerAnswers(on, [answers({ work: 'deep_reasoning' })], sent)
  bottomStep(on, seen)

  await $.prompt.submit(typed('hello'))
  await step($)

  expect(sent).toEqual([])
  expect(seen).toEqual(SESSION)
})

test('leaves subagents alone by default', { options: KEY }, async ($, on) => {
  const seen: Seen[] = []
  setup(on)
  routerAnswers(on, [answers({ work: 'deep_reasoning' })])
  bottomStep(on, seen)

  await $.prompt.submit(typed('big refactor'))
  await step($, 'agent-1')

  expect(seen).toEqual(SESSION)
})
