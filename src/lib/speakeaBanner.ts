export type SpeakeaBannerPhase = 'new' | 'closed' | 'clicked'

export function decideSpeakeaBannerShow(
  visits: number,
  phase: SpeakeaBannerPhase,
): 'now' | 'delay' | false {
  if (phase === 'new') return visits >= 2 ? 'now' : 'delay'

  const isTenthVisit = visits >= 10 && visits % 10 === 0
  if (phase === 'closed') return visits === 5 || isTenthVisit ? 'now' : false
  return isTenthVisit ? 'now' : false
}
