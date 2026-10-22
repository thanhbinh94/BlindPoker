import { parseWorstHash } from './scenarios.js'

describe('parseWorstHash', () => {
  it('reads #worst/<state>/<seats>/<lang> with no frame and a short name', () => {
    expect(parseWorstHash('#worst/turn/6/vi')).toEqual({ state: 'turn', seats: 6, lang: 'vi', long: false, frame: null })
  })

  it('keeps /long working, read by name', () => {
    expect(parseWorstHash('#worst/turn/6/vi/long')).toEqual({ state: 'turn', seats: 6, lang: 'vi', long: true, frame: null })
  })

  it('knows the squeeze table as a state', () => {
    expect(parseWorstHash('#worst/blindS/9/en')?.state).toBe('blindS')
  })

  it('reads landscape and desktop as a forced frame', () => {
    expect(parseWorstHash('#worst/blindS/9/vi/landscape')).toMatchObject({ state: 'blindS', seats: 9, frame: 'landscape', long: false })
    expect(parseWorstHash('#worst/waiting/4/vi/desktop')).toMatchObject({ frame: 'desktop', long: false })
  })

  it('reads the tokens after the language by name, in either order', () => {
    expect(parseWorstHash('#worst/turn/9/vi/long/landscape')).toMatchObject({ long: true, frame: 'landscape' })
    expect(parseWorstHash('#worst/turn/9/vi/landscape/long')).toMatchObject({ long: true, frame: 'landscape' })
    expect(parseWorstHash('#worst/turn/9/vi/short/landscape')).toMatchObject({ long: false, frame: 'landscape' })
  })

  // BP-28: the user's phone with its address bar, whatever the window.
  it('reads /short as the room in an 855 × 319 box, in the landscape frame', () => {
    expect(parseWorstHash('#worst/blindP/6/vi/short')).toEqual({ state: 'blindP', seats: 6, lang: 'vi', long: false, frame: 'landscape', box: { w: 855, h: 319 } })
    expect(parseWorstHash('#worst/blindW/8/en/long/short')).toMatchObject({ state: 'blindW', long: true, frame: 'landscape', box: { w: 855, h: 319 } })
    expect(parseWorstHash('#worst/turn/8/vi/landscape')?.box).toBeUndefined()
  })

  it('reads /rank<N> as the viewer’s own rank, 1 to 5', () => {
    expect(parseWorstHash('#worst/turn/8/vi/rank5')).toMatchObject({ seats: 8, meRank: 5 })
    expect(parseWorstHash('#worst/turn/8/vi/long/rank2')).toMatchObject({ long: true, meRank: 2 })
    expect(parseWorstHash('#worst/turn/8/vi/rank9')?.meRank).toBeUndefined()
    expect(parseWorstHash('#worst/turn/8/vi')?.meRank).toBeUndefined()
  })

  it('ignores a token it does not know', () => {
    expect(parseWorstHash('#worst/result/6/vi/sideways/long')).toMatchObject({ long: true, frame: null })
  })

  it('falls back on an unknown state, seat count and language', () => {
    expect(parseWorstHash('#worst/nope/12/xx')).toEqual({ state: 'result', seats: 6, lang: 'vi', long: false, frame: null })
  })

  it('is null for any other hash', () => {
    expect(parseWorstHash('#peel')).toBeNull()
    expect(parseWorstHash('')).toBeNull()
  })
})
