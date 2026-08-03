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
  if (points.length < 4 || points.slice(0, 4).some((point) => !point)) return false;
  const maxJump = Number(options.maxJump) || Math.max(width, height) * 0.38;
  return [
    [points[0], points[1]],
    [points[1], points[2]],
    [points[2], points[3]],
    [points[3], points[0]]
  ].every(([from, to]) => Math.hypot(to.x - from.x, to.y - from.y) <= maxJump);
}

export function skyRoundTripIsValid(ra, dec, roundTrip, toleranceDeg = 0.25) {
  if (!Array.isArray(roundTrip) || roundTrip.length < 2) return false;
  const returnedRa = Number(roundTrip[0]);
  const returnedDec = Number(roundTrip[1]);
  if (![ra, dec, returnedRa, returnedDec].every(Number.isFinite)) return false;

  const toRadians = Math.PI / 180;
  const dec1 = Number(dec) * toRadians;
  const dec2 = returnedDec * toRadians;
  const deltaDec = (returnedDec - Number(dec)) * toRadians;
  const deltaRa = ((((returnedRa - Number(ra)) % 360) + 540) % 360 - 180) * toRadians;
  const sinHalfDec = Math.sin(deltaDec / 2);
  const sinHalfRa = Math.sin(deltaRa / 2);
  const haversine = sinHalfDec * sinHalfDec + Math.cos(dec1) * Math.cos(dec2) * sinHalfRa * sinHalfRa;
  const separationDeg = 2 * Math.asin(Math.min(1, Math.sqrt(Math.max(0, haversine)))) / toRadians;
  return separationDeg <= Math.max(0, Number(toleranceDeg) || 0);
}
