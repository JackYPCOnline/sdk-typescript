import { AppState } from '../app-state.js'
import type { ContentBlock } from '../types/messages.js'
import { contentBlockFromData } from '../types/messages.js'
import { normalizeError } from '../errors.js'
import type { JSONValue } from '../types/json.js'
import type { z } from 'zod'

/**
 * Execution lifecycle status shared across all multi-agent patterns.
 */
export const Status = {
  /** Execution has not yet started. */
  PENDING: 'PENDING',
  /** Execution is currently in progress. */
  EXECUTING: 'EXECUTING',
  /** Execution finished successfully. */
  COMPLETED: 'COMPLETED',
  /** Execution encountered an error. */
  FAILED: 'FAILED',
  /** Execution was cancelled before or during processing. */
  CANCELLED: 'CANCELLED',
} as const

/**
 * Union of all valid status values.
 */
export type Status = (typeof Status)[keyof typeof Status]

/**
 * Subset of {@link Status} representing terminal outcomes.
 */
export type ResultStatus = typeof Status.COMPLETED | typeof Status.FAILED | typeof Status.CANCELLED

/**
 * Result of executing a single node.
 */
export class NodeResult {
  readonly type = 'nodeResult' as const
  readonly nodeId: string
  readonly status: ResultStatus
  /** Execution time in milliseconds. */
  readonly duration: number
  readonly content: ContentBlock[]
  readonly error?: Error
  /** Validated structured output, if a schema was provided. */
  readonly structuredOutput?: z.output<z.ZodType>

  constructor(data: {
    nodeId: string
    status: ResultStatus
    duration: number
    content?: ContentBlock[]
    error?: Error
    structuredOutput?: z.output<z.ZodType>
  }) {
    this.nodeId = data.nodeId
    this.status = data.status
    this.duration = data.duration
    this.content = data.content ?? []
    if ('error' in data) this.error = data.error
    if ('structuredOutput' in data) this.structuredOutput = data.structuredOutput
  }

  toJSON(): JSONValue {
    return {
      nodeId: this.nodeId,
      status: this.status,
      duration: this.duration,
      content: this.content.map((block) => block.toJSON()),
      ...(this.error && { error: this.error.message }),
      ...(this.structuredOutput !== undefined && { structuredOutput: this.structuredOutput as JSONValue }),
    } as JSONValue
  }

  static fromJSON(data: JSONValue): NodeResult {
    const d = data as Record<string, JSONValue>
    return new NodeResult({
      nodeId: d.nodeId as string,
      status: d.status as ResultStatus,
      duration: d.duration as number,
      content: (d.content as JSONValue[]).map((c) => contentBlockFromData(c as never)),
      ...(d.error && { error: normalizeError(d.error) }),
      ...(d.structuredOutput !== undefined && { structuredOutput: d.structuredOutput }),
    })
  }
}

/**
 * Partial result returned by {@link Node.handle} implementations.
 *
 * Contains implementer-controlled fields that are merged with
 * framework-managed defaults (nodeId, status, duration) to
 * produce the final {@link NodeResult}.
 */
export type NodeResultUpdate = Partial<Omit<NodeResult, 'type'>>

/**
 * Execution state of a single node within a multi-agent orchestration.
 */
export class NodeState {
  readonly type = 'nodeState' as const
  status: Status
  /** Marks this node as the last one executed in an execution path. */
  terminus: boolean
  /** Node execution start time in milliseconds since epoch. */
  startTime: number
  readonly results: NodeResult[]

  constructor() {
    this.status = Status.PENDING
    this.terminus = false
    this.startTime = Date.now()
    this.results = []
  }

  /** Content from the most recent result, or empty array if none. */
  get content(): readonly ContentBlock[] {
    const last = this.results[this.results.length - 1]
    return last?.content ?? []
  }

  toJSON(): JSONValue {
    return {
      status: this.status,
      terminus: this.terminus,
      startTime: this.startTime,
      results: this.results.map((res) => res.toJSON()),
    } as JSONValue
  }

  static fromJSON(data: JSONValue): NodeState {
    const d = data as Record<string, JSONValue>
    const state = new NodeState()
    state.status = d.status as Status
    state.terminus = d.terminus as boolean
    state.startTime = d.startTime as number
    for (const r of d.results as JSONValue[]) {
      state.results.push(NodeResult.fromJSON(r))
    }
    return state
  }
}

/**
 * Aggregate result from a multi-agent execution.
 */
export class MultiAgentResult {
  readonly type = 'multiAgentResult' as const
  readonly status: ResultStatus
  readonly results: NodeResult[]
  /** Combined content from terminus nodes, in completion order. */
  readonly content: ContentBlock[]
  readonly duration: number
  readonly error?: Error

  constructor(data: {
    status?: ResultStatus
    results: NodeResult[]
    content?: ContentBlock[]
    duration: number
    error?: Error
  }) {
    this.status = data.status ?? this._resolveStatus(data.results)
    this.results = data.results
    this.content = data.content ?? []
    this.duration = data.duration
    if ('error' in data) this.error = data.error
  }

  toJSON(): JSONValue {
    return {
      status: this.status,
      results: this.results.map((r) => r.toJSON()),
      content: this.content.map((block) => block.toJSON()),
      duration: this.duration,
      ...(this.error && { error: this.error.message }),
    } as JSONValue
  }

  static fromJSON(data: JSONValue): MultiAgentResult {
    const d = data as Record<string, JSONValue>
    return new MultiAgentResult({
      status: d.status as ResultStatus,
      results: (d.results as JSONValue[]).map(NodeResult.fromJSON),
      content: (d.content as JSONValue[]).map((c) => contentBlockFromData(c as never)),
      duration: d.duration as number,
      ...(d.error && { error: normalizeError(d.error) }),
    })
  }

  /** Derives the aggregate status from individual node results. */
  private _resolveStatus(results: NodeResult[]): ResultStatus {
    if (results.some((r) => r.status === Status.FAILED)) return Status.FAILED
    if (results.some((r) => r.status === Status.CANCELLED)) return Status.CANCELLED
    return Status.COMPLETED
  }
}

/**
 * Shared state for multi-agent orchestration patterns.
 */
export class MultiAgentState {
  /** Execution start time in milliseconds since epoch. */
  readonly startTime: number
  /** Number of node executions started so far. */
  steps: number
  /** All node results in completion order. */
  readonly results: NodeResult[]
  /** App-level key-value state accessible from hooks, edge handlers, and custom nodes. */
  readonly app: AppState
  /** Structured output schema to apply to node invocations. */
  readonly structuredOutputSchema?: z.ZodSchema
  private readonly _nodes: Map<string, NodeState>

  constructor(data?: { nodeIds?: string[]; structuredOutputSchema?: z.ZodSchema }) {
    this.startTime = Date.now()
    this.steps = 0
    this.results = []
    this.app = new AppState()
    if (data?.structuredOutputSchema) this.structuredOutputSchema = data.structuredOutputSchema
    this._nodes = new Map()
    for (const id of data?.nodeIds ?? []) {
      this._nodes.set(id, new NodeState())
    }
  }

  /**
   * Get the state of a specific node by ID.
   *
   * @param id - The node identifier
   * @returns The node's state, or undefined if the node is not tracked
   */
  node(id: string): NodeState | undefined {
    return this._nodes.get(id)
  }

  /**
   * All tracked node states.
   */
  get nodes(): ReadonlyMap<string, NodeState> {
    return this._nodes
  }

  toJSON(): JSONValue {
    const nodes: Record<string, JSONValue> = {}
    for (const [id, ns] of this._nodes) {
      nodes[id] = ns.toJSON()
    }
    return {
      startTime: this.startTime,
      steps: this.steps,
      results: this.results.map((r) => r.toJSON()),
      app: this.app.toJSON(),
      nodes,
    } as JSONValue
  }

  static fromJSON(data: JSONValue): MultiAgentState {
    const d = data as Record<string, JSONValue>
    const state = new MultiAgentState()
    ;(state as { startTime: number }).startTime = d.startTime as number
    state.steps = d.steps as number
    for (const r of d.results as JSONValue[]) {
      state.results.push(NodeResult.fromJSON(r))
    }
    state.app.loadStateFromJson(d.app as JSONValue)
    const nodes = d.nodes as Record<string, JSONValue> | undefined
    if (nodes) {
      for (const [id, nsData] of Object.entries(nodes)) {
        state._nodes.set(id, NodeState.fromJSON(nsData))
      }
    }
    return state
  }
}
