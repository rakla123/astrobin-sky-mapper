export function projectedPathData(points, width, height, options = {}) {
  const maxJump = Number(options.maxJump) || Math.max(width, height) * 0.38;
  const margin = Number(options.margin) || 100;
  const segments = [];
  let segment = [];

  const finishSegment = () => {
    if (segment.length >= 2) segments.push(segment);
    segment = [];
  };

  for (const point of points) {
    const nearView = point
      && Number.isFinite(point.x) && Number.isFinite(point.y)
      && point.x >= -margin && point.x <= width + margin
      && point.y >= -margin && point.y <= height + margin;
    if (!nearView) {
      finishSegment();
      continue;
    }
    const previous = segment.at(-1);
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) > maxJump) finishSegment();
    segment.push(point);
  }
  finishSegment();

  return segments.map((pointsInSegment) => pointsInSegment
    .map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ")).join(" ");
}

export function projectedQuadIsUsable(points, width, height, options = {}) {
  if (points.length < 4) return false;
  const maxJump = Number(options.maxJump) || Math.max(width, height) * 0.38;
  return [
    [points[0], points[1]],
    [points[1], points[2]],
    [points[2], points[3]],
    [points[3], points[0]]
  ].every(([from, to]) => Math.hypot(to.x - from.x, to.y - from.y) <= maxJump);
}
