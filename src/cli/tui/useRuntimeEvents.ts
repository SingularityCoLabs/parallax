import { useEffect, useReducer } from 'react';
import type { RuntimeEvent } from '../../protocol/index.ts';
import type { Agent } from '../../app/index.ts';
import { initialTimeline, reduceTimeline, type TimelineState } from './timeline.ts';

/**
 * Subscribe to the runtime's event stream and fold it into the timeline render
 * model. This is the single bridge between the event-driven runtime and React:
 * every `RuntimeEvent` becomes a reducer dispatch, so the component tree stays a
 * pure function of the timeline (blueprint §10.3 — the TUI is just another
 * consumer of the same event contract the CLI renderer uses).
 *
 * Takes the `Agent` (from the `app` composition root) rather than the facade
 * directly, so the `cli` layer never imports `runtime` (architectural boundary).
 */
export function useRuntimeEvents(agent: Agent, seed?: RuntimeEvent[]): TimelineState {
  const [state, dispatch] = useReducer(reduceTimeline, seed, (initial) =>
    initial ? initial.reduce(reduceTimeline, initialTimeline()) : initialTimeline(),
  );

  useEffect(() => {
    // subscribe returns an unsubscribe fn; React runs it on unmount.
    return agent.facade.subscribe((event) => dispatch(event));
  }, [agent]);

  return state;
}
