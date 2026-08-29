import { memo, useId } from 'react'
import { flagForLanguage, type Flag, type FlagLayer } from '../languageFlags'
import './LanguageFlag.css'

/** A five-pointed star, drawn from its circumscribed radius. */
function starPath(cx: number, cy: number, r: number): string {
  const points: string[] = []
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? r : r * 0.382
    const angle = (Math.PI / 5) * i - Math.PI / 2
    points.push(
      `${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`,
    )
  }
  return `M${points.join('L')}Z`
}

function Layer({ layer }: { layer: FlagLayer }) {
  switch (layer.kind) {
    case 'bands': {
      const total = layer.stops.reduce((sum, [, weight]) => sum + weight, 0)
      // Each stripe starts where the stripes before it end.
      const stripes = layer.stops.map(([fill, weight], index) => ({
        fill,
        at:
          (24 *
            layer.stops
              .slice(0, index)
              .reduce((sum, [, before]) => sum + before, 0)) /
          total,
        size: (24 * weight) / total,
      }))
      return (
        <>
          {stripes.map(({ fill, at, size }, index) =>
            layer.dir === 'h' ? (
              <rect key={index} x="0" y={at} width="24" height={size} fill={fill} />
            ) : (
              <rect key={index} x={at} y="0" width={size} height="24" fill={fill} />
            ),
          )}
        </>
      )
    }
    case 'rect':
      return (
        <rect
          x={layer.x}
          y={layer.y}
          width={layer.w}
          height={layer.h}
          fill={layer.fill}
        />
      )
    case 'disc':
      return <circle cx={layer.cx} cy={layer.cy} r={layer.r} fill={layer.fill} />
    case 'star':
      return <path d={starPath(layer.cx, layer.cy, layer.r)} fill={layer.fill} />
    case 'crescent':
      // A filled disc with a smaller disc of the field colour biting into it.
      return (
        <>
          <circle cx={layer.cx} cy={layer.cy} r={layer.r} fill={layer.fill} />
          <circle
            cx={layer.cx + layer.r * 0.34}
            cy={layer.cy}
            r={layer.r * 0.82}
            fill={layer.bg}
          />
        </>
      )
    case 'path':
      return <path d={layer.d} fill={layer.fill} />
  }
}

function Globe() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M3 12h18M12 3c2.4 2.4 3.6 5.4 3.6 9s-1.2 6.6-3.6 9c-2.4-2.4-3.6-5.4-3.6-9S9.6 5.4 12 3Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  )
}

/**
 * The mark beside a language: its flag where one region is conventional for
 * it, and a globe where none is. Flags are drawn rather than set as emoji so
 * they render identically on every platform — see `languageFlags.ts`.
 *
 * Memoised on the language code, which is all it depends on: roaming the list
 * with the arrow keys re-renders every row, and none of those renders should
 * rebuild eighty flags.
 */
export const LanguageFlag = memo(function LanguageFlag({
  code,
}: {
  code: string
}) {
  const clipId = useId()
  const flag: Flag | null = flagForLanguage(code)

  if (!flag) {
    return (
      <span className="language-flag flag-globe" aria-hidden="true">
        <Globe />
      </span>
    )
  }

  return (
    <span className="language-flag" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <clipPath id={clipId}>
          <circle cx="12" cy="12" r="12" />
        </clipPath>
        <g clipPath={`url(#${clipId})`}>
          {flag.map((layer, index) => (
            <Layer key={index} layer={layer} />
          ))}
        </g>
      </svg>
    </span>
  )
})
