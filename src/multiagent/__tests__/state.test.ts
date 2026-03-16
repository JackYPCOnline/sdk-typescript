import { describe, expect, it } from 'vitest'
import { NodeResult, NodeState, MultiAgentResult, MultiAgentState, Status } from '../state.js'
import { TextBlock, ToolUseBlock } from '../../types/messages.js'
import type { JSONValue } from '../../types/json.js'

describe('NodeResult', () => {
  describe('toJSON / fromJSON', () => {
    it('round-trips a completed result with text content', () => {
      const original = new NodeResult({
        nodeId: 'agent-1',
        status: Status.COMPLETED,
        duration: 150,
        content: [new TextBlock('hello world')],
      })

      const restored = NodeResult.fromJSON(original.toJSON())

      expect(restored.nodeId).toBe('agent-1')
      expect(restored.status).toBe(Status.COMPLETED)
      expect(restored.duration).toBe(150)
      expect(restored.content).toHaveLength(1)
      expect(restored.content[0]).toBeInstanceOf(TextBlock)
      expect((restored.content[0] as TextBlock).text).toBe('hello world')
      expect(restored.error).toBeUndefined()
      expect(restored.structuredOutput).toBeUndefined()
    })

    it('round-trips a failed result with error', () => {
      const original = new NodeResult({
        nodeId: 'agent-2',
        status: Status.FAILED,
        duration: 50,
        error: new Error('something broke'),
      })

      const restored = NodeResult.fromJSON(original.toJSON())

      expect(restored.status).toBe(Status.FAILED)
      expect(restored.error).toBeInstanceOf(Error)
      expect(restored.error!.message).toBe('something broke')
      expect(restored.content).toEqual([])
    })

    it('round-trips structuredOutput with nested objects', () => {
      const output = { name: 'Alice', scores: [1, 2, 3], nested: { deep: true } }
      const original = new NodeResult({
        nodeId: 'agent-3',
        status: Status.COMPLETED,
        duration: 100,
        structuredOutput: output,
      })

      const restored = NodeResult.fromJSON(original.toJSON())

      expect(restored.structuredOutput).toEqual(output)
    })

    it('preserves structuredOutput when value is null', () => {
      const original = new NodeResult({
        nodeId: 'agent-4',
        status: Status.COMPLETED,
        duration: 10,
        structuredOutput: null,
      })

      const restored = NodeResult.fromJSON(original.toJSON())

      expect(restored.structuredOutput).toBeNull()
    })

    it('preserves structuredOutput when value is a primitive', () => {
      const original = new NodeResult({
        nodeId: 'agent-5',
        status: Status.COMPLETED,
        duration: 10,
        structuredOutput: 42,
      })

      const restored = NodeResult.fromJSON(original.toJSON())

      expect(restored.structuredOutput).toBe(42)
    })

    it('round-trips multiple content blocks including tool use', () => {
      const original = new NodeResult({
        nodeId: 'agent-6',
        status: Status.COMPLETED,
        duration: 200,
        content: [
          new TextBlock('thinking...'),
          new ToolUseBlock({ toolUseId: 'tu-1', name: 'calculator', input: { expr: '2+2' } }),
        ],
      })

      const restored = NodeResult.fromJSON(original.toJSON())

      expect(restored.content).toHaveLength(2)
      expect(restored.content[0]).toBeInstanceOf(TextBlock)
      expect(restored.content[1]).toBeInstanceOf(ToolUseBlock)
      expect((restored.content[1] as ToolUseBlock).name).toBe('calculator')
    })

    it('round-trips a cancelled result with empty content', () => {
      const original = new NodeResult({
        nodeId: 'agent-7',
        status: Status.CANCELLED,
        duration: 0,
      })

      const restored = NodeResult.fromJSON(original.toJSON())

      expect(restored.status).toBe(Status.CANCELLED)
      expect(restored.content).toEqual([])
      expect(restored.duration).toBe(0)
    })

    it('omits error from JSON when not present', () => {
      const original = new NodeResult({
        nodeId: 'n',
        status: Status.COMPLETED,
        duration: 1,
      })

      const json = original.toJSON() as Record<string, JSONValue>

      expect('error' in json).toBe(false)
    })

    it('omits structuredOutput from JSON when not present', () => {
      const original = new NodeResult({
        nodeId: 'n',
        status: Status.COMPLETED,
        duration: 1,
      })

      const json = original.toJSON() as Record<string, JSONValue>

      expect('structuredOutput' in json).toBe(false)
    })
  })
})

describe('NodeState', () => {
  describe('toJSON / fromJSON', () => {
    it('round-trips a fresh node state', () => {
      const original = new NodeState()

      const restored = NodeState.fromJSON(original.toJSON())

      expect(restored.status).toBe(Status.PENDING)
      expect(restored.terminus).toBe(false)
      expect(restored.startTime).toBe(original.startTime)
      expect(restored.results).toEqual([])
    })

    it('round-trips a node state with results', () => {
      const original = new NodeState()
      original.status = Status.COMPLETED
      original.terminus = true
      original.results.push(
        new NodeResult({ nodeId: 'a', status: Status.COMPLETED, duration: 100, content: [new TextBlock('done')] })
      )
      original.results.push(
        new NodeResult({ nodeId: 'a', status: Status.FAILED, duration: 50, error: new Error('retry failed') })
      )

      const restored = NodeState.fromJSON(original.toJSON())

      expect(restored.status).toBe(Status.COMPLETED)
      expect(restored.terminus).toBe(true)
      expect(restored.results).toHaveLength(2)
      expect(restored.results[0]!.status).toBe(Status.COMPLETED)
      expect(restored.results[1]!.status).toBe(Status.FAILED)
      expect(restored.results[1]!.error!.message).toBe('retry failed')
    })

    it('preserves content accessor after round-trip', () => {
      const original = new NodeState()
      original.results.push(
        new NodeResult({ nodeId: 'a', status: Status.COMPLETED, duration: 10, content: [new TextBlock('last')] })
      )

      const restored = NodeState.fromJSON(original.toJSON())

      expect(restored.content).toHaveLength(1)
      expect((restored.content[0] as TextBlock).text).toBe('last')
    })
  })
})

describe('MultiAgentResult', () => {
  describe('toJSON / fromJSON', () => {
    it('round-trips a completed result', () => {
      const nodeResult = new NodeResult({
        nodeId: 'writer',
        status: Status.COMPLETED,
        duration: 300,
        content: [new TextBlock('final answer')],
      })
      const original = new MultiAgentResult({
        results: [nodeResult],
        content: [new TextBlock('final answer')],
        duration: 500,
      })

      const restored = MultiAgentResult.fromJSON(original.toJSON())

      expect(restored.status).toBe(Status.COMPLETED)
      expect(restored.duration).toBe(500)
      expect(restored.results).toHaveLength(1)
      expect(restored.results[0]!.nodeId).toBe('writer')
      expect(restored.content).toHaveLength(1)
      expect((restored.content[0] as TextBlock).text).toBe('final answer')
      expect(restored.error).toBeUndefined()
    })

    it('round-trips a failed result with error', () => {
      const original = new MultiAgentResult({
        status: Status.FAILED,
        results: [],
        duration: 10,
        error: new Error('orchestration failed'),
      })

      const restored = MultiAgentResult.fromJSON(original.toJSON())

      expect(restored.status).toBe(Status.FAILED)
      expect(restored.error).toBeInstanceOf(Error)
      expect(restored.error!.message).toBe('orchestration failed')
    })

    it('preserves explicit status override', () => {
      const nodeResult = new NodeResult({
        nodeId: 'a',
        status: Status.COMPLETED,
        duration: 10,
      })
      const original = new MultiAgentResult({
        status: Status.CANCELLED,
        results: [nodeResult],
        duration: 20,
      })

      const restored = MultiAgentResult.fromJSON(original.toJSON())

      expect(restored.status).toBe(Status.CANCELLED)
    })

    it('round-trips with empty results and content', () => {
      const original = new MultiAgentResult({
        results: [],
        duration: 0,
      })

      const restored = MultiAgentResult.fromJSON(original.toJSON())

      expect(restored.results).toEqual([])
      expect(restored.content).toEqual([])
      expect(restored.status).toBe(Status.COMPLETED)
    })
  })
})

describe('MultiAgentState', () => {
  describe('toJSON / fromJSON', () => {
    it('round-trips a fresh state with node IDs', () => {
      const original = new MultiAgentState({ nodeIds: ['a', 'b', 'c'] })

      const restored = MultiAgentState.fromJSON(original.toJSON())

      expect(restored.startTime).toBe(original.startTime)
      expect(restored.steps).toBe(0)
      expect(restored.results).toEqual([])
      expect(restored.nodes.size).toBe(3)
      expect(restored.node('a')).toBeDefined()
      expect(restored.node('b')).toBeDefined()
      expect(restored.node('c')).toBeDefined()
    })

    it('round-trips state with steps and results', () => {
      const original = new MultiAgentState({ nodeIds: ['researcher', 'writer'] })
      original.steps = 3
      original.results.push(
        new NodeResult({
          nodeId: 'researcher',
          status: Status.COMPLETED,
          duration: 200,
          content: [new TextBlock('research findings')],
        })
      )
      original.results.push(
        new NodeResult({
          nodeId: 'writer',
          status: Status.COMPLETED,
          duration: 150,
          content: [new TextBlock('polished output')],
        })
      )

      const restored = MultiAgentState.fromJSON(original.toJSON())

      expect(restored.steps).toBe(3)
      expect(restored.results).toHaveLength(2)
      expect(restored.results[0]!.nodeId).toBe('researcher')
      expect(restored.results[1]!.nodeId).toBe('writer')
    })

    it('round-trips app state', () => {
      const original = new MultiAgentState()
      original.app.set('counter', 42)
      original.app.set('config', { nested: { key: 'value' }, list: [1, 2, 3] })

      const restored = MultiAgentState.fromJSON(original.toJSON())

      expect(restored.app.get('counter')).toBe(42)
      expect(restored.app.get('config')).toEqual({ nested: { key: 'value' }, list: [1, 2, 3] })
    })

    it('round-trips node states with modified status and results', () => {
      const original = new MultiAgentState({ nodeIds: ['agent-1'] })
      const ns = original.node('agent-1')!
      ns.status = Status.COMPLETED
      ns.terminus = true
      ns.results.push(new NodeResult({ nodeId: 'agent-1', status: Status.COMPLETED, duration: 100 }))

      const restored = MultiAgentState.fromJSON(original.toJSON())

      const restoredNs = restored.node('agent-1')!
      expect(restoredNs.status).toBe(Status.COMPLETED)
      expect(restoredNs.terminus).toBe(true)
      expect(restoredNs.results).toHaveLength(1)
    })

    it('does not serialize structuredOutputSchema (config, not state)', async () => {
      const { z } = await import('zod')
      const schema = z.object({ name: z.string() })
      const original = new MultiAgentState({ nodeIds: ['a'], structuredOutputSchema: schema })

      const json = original.toJSON() as Record<string, JSONValue>

      expect('structuredOutputSchema' in json).toBe(false)

      // Restored state has no schema — it's config, re-provided by the caller
      const restored = MultiAgentState.fromJSON(original.toJSON())
      expect(restored.structuredOutputSchema).toBeUndefined()
    })

    it('round-trips an empty state (no node IDs)', () => {
      const original = new MultiAgentState()

      const restored = MultiAgentState.fromJSON(original.toJSON())

      expect(restored.nodes.size).toBe(0)
      expect(restored.steps).toBe(0)
      expect(restored.results).toEqual([])
    })

    it('handles fromJSON with missing nodes key gracefully', () => {
      const json = {
        startTime: 1000,
        steps: 0,
        results: [],
        app: {},
      } as JSONValue

      const restored = MultiAgentState.fromJSON(json)

      expect(restored.nodes.size).toBe(0)
      expect(restored.startTime).toBe(1000)
    })

    it('preserves startTime exactly (no re-initialization)', () => {
      const json = {
        startTime: 1234567890,
        steps: 5,
        results: [],
        app: {},
        nodes: {},
      } as JSONValue

      const restored = MultiAgentState.fromJSON(json)

      expect(restored.startTime).toBe(1234567890)
      expect(restored.steps).toBe(5)
    })
  })
})
