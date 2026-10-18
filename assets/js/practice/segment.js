// 구간 길이와 재생 범위. 보통은 start~end 하나이고, 같은 문장을 되풀이하는 영상은
// segment.clips([[시작, 끝], …])로 되풀이를 건너뛴 문장만 이어 들려준다 — 시간 기준도 clips 합계다.
export function segmentSeconds(seg) {
  return seg.clips ? seg.clips.reduce((n, [s, e]) => n + (e - s), 0) : seg.end - seg.start;
}

/** togglePlay에 그대로 넘길 재생 범위 */
export function playSpan(seg) {
  return { start: seg.start, end: seg.end, clips: seg.clips };
}
