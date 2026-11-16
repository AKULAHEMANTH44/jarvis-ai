import { GestureDetectionResult } from '../types/gesture';

export const HAND_SKELETON_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [9, 10], [10, 11], [11, 12],
  [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17]
];

export function renderHandSkeletonOverlay(
  canvas: HTMLCanvasElement | null,
  gestureResult: GestureDetectionResult | null,
  isCameraActive: boolean,
  mirrorX: boolean = true
) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!isCameraActive || !gestureResult || !gestureResult.hands || gestureResult.hands.length === 0) {
    return;
  }

  const w = canvas.width;
  const h = canvas.height;
  const mapX = (x: number) => (mirrorX ? (1 - x) * w : x * w);

  gestureResult.hands.forEach((hand) => {
    const isRight = hand.handedness === 'Right';
    const color = isRight ? '#00f0ff' : '#00ffaa';
    const glow = isRight ? 'rgba(0, 240, 255, 0.8)' : 'rgba(0, 255, 170, 0.8)';

    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.shadowColor = glow;
    ctx.shadowBlur = 8;

    HAND_SKELETON_CONNECTIONS.forEach(([startIdx, endIdx]) => {
      const p1 = hand.landmarks[startIdx];
      const p2 = hand.landmarks[endIdx];
      if (p1 && p2) {
        ctx.beginPath();
        ctx.moveTo(mapX(p1.x), p1.y * h);
        ctx.lineTo(mapX(p2.x), p2.y * h);
        ctx.stroke();
      }
    });

    hand.landmarks.forEach((p, idx) => {
      const isFingertip = [4, 8, 12, 16, 20].includes(idx);
      ctx.beginPath();
      ctx.arc(mapX(p.x), p.y * h, isFingertip ? 4.5 : 2.5, 0, 2 * Math.PI);
      ctx.fillStyle = isFingertip ? '#ffffff' : color;
      ctx.shadowColor = glow;
      ctx.shadowBlur = isFingertip ? 12 : 5;
      ctx.fill();
    });

    if (hand.isPinching) {
      const pThumb = hand.landmarks[4];
      const pIndex = hand.landmarks[8];
      if (pThumb && pIndex) {
        const midX = mapX((pThumb.x + pIndex.x) / 2);
        const midY = ((pThumb.y + pIndex.y) / 2) * h;
        ctx.beginPath();
        ctx.arc(midX, midY, 14, 0, 2 * Math.PI);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 15;
        ctx.stroke();
      }
    }
  });
}
