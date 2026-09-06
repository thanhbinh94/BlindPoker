import type { AvatarConfigDto } from '../api.js'
import type { StageFactory } from './AvatarStage.js'
import { hashConfig } from './hash.js'
import type { Stage } from './stage.js'
import { clampYaw } from './yaw.js'

/**
 * A stage for tests, and the reason three.js never runs under jsdom.
 *
 * jsdom has no WebGL and no canvas, so the real `createStage` could only ever be answered by
 * `supported() === false` — which would make every state but the fallback untestable. This double
 * stands in for it through `setStageFactoryForTests` and records what it was asked to do: which
 * configurations were put on it (by hash, so an assertion can say *which*), and where it was turned to.
 *
 * It copies the one behaviour a caller can observe through the component: the yaw is clamped to the
 * same ±60° the real stage clamps to. Everything else — the scene graph, the framing, the coalescing —
 * belongs to `stage.test.ts`, which drives the real module with a fake renderer.
 */

export interface FakeStage extends Stage {
  /** Every configuration this stage was shown, in order, as `hashConfig` hashes. */
  readonly shown: string[]
  readonly disposed: () => boolean
}

export interface FakeStageFactory extends StageFactory {
  /** The stages built so far. One per mounted `AvatarStage`; usually there is exactly one. */
  readonly stages: FakeStage[]
  /** The last one built — what a test that mounted one component wants. */
  last(): FakeStage
}

export interface FakeStageOptions {
  /** `false` makes `supported()` say no, the way a machine without WebGL does. */
  supported?: boolean
  /** `true` makes `setConfig` reject, the way a body bundle that will not load does. */
  fails?: boolean
}

export function fakeStageFactory(options: FakeStageOptions = {}): FakeStageFactory {
  const { supported = true, fails = false } = options
  const stages: FakeStage[] = []

  return {
    stages,
    supported: () => supported,
    last(): FakeStage {
      const stage = stages[stages.length - 1]
      if (stage === undefined) throw new Error('no stage has been created yet')
      return stage
    },
    createStage(): Stage {
      const shown: string[] = []
      let turn = 0
      let dead = false
      const stage: FakeStage = {
        shown,
        disposed: () => dead,
        setConfig(config: AvatarConfigDto): Promise<void> {
          if (fails) return Promise.reject(new Error('the fake stage was told to fail'))
          shown.push(hashConfig(config))
          return Promise.resolve()
        },
        setYaw(radians: number): void {
          turn = clampYaw(radians)
        },
        resetYaw: () => void (turn = 0),
        yaw: () => turn,
        resize: () => undefined,
        dispose: () => void (dead = true),
      }
      stages.push(stage)
      return stage
    },
  }
}
