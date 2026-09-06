import { Suspense, lazy } from 'react'
import { Portrait } from './Portrait.js'
import type { AvatarStageProps } from './AvatarStage.js'
import s from './stage.module.css'

/**
 * `AvatarStage`, fetched only by a screen that shows one.
 *
 * The two screens that use a stage are already lazy chunks of their own, so this split is not about the
 * entry bundle — `AvatarStage.tsx` imports no three.js, and the graph itself is behind
 * `import('./portraits.js')` either way. It is about the *second* request: the profile page paints its
 * name, balance and stats out of one chunk, and the figure arrives in another, beside the portrait that
 * stands in for it meanwhile. The fallback is that portrait, under the same accessible name, so the
 * header does not change shape or lose its description when the stage lands.
 *
 * One module rather than a `lazy()` in each screen, so both screens name the same specifier and vite
 * emits one chunk for the pair.
 */
const AvatarStage = lazy(async () => ({ default: (await import('./AvatarStage.js')).AvatarStage }))

export function LazyAvatarStage(props: AvatarStageProps) {
  const { config, mode, className, description, name } = props
  return (
    <Suspense
      fallback={
        <span className={className === undefined ? s.stage : `${s.stage} ${className}`} data-mode={mode} data-stage="loading">
          <Portrait config={config} name={name} size="lg" label={description} />
        </span>
      }
    >
      <AvatarStage {...props} />
    </Suspense>
  )
}
