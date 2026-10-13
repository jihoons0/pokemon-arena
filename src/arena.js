const LOGICAL_WIDTH = 1280;
const LOGICAL_HEIGHT = 720;
const PIXEL_WIDTH = 640;
const PIXEL_HEIGHT = 360;

let terrainCache = null;
let landscape = null;
if(typeof Image!=='undefined'){
  const image=new Image();image.onload=()=>{landscape=image;terrainCache=null;};
  image.src='/assets/arena/mt-silver-dawn.webp';
}

const COLORS = {
  skyTop: '#8d9ca8',
  skyBottom: '#c9d0d2',
  mist: '#dfe3e1',
  snowLight: '#eef0eb',
  snow: '#d9dedc',
  snowMid: '#c6cecd',
  snowShade: '#aab6b8',
  ice: '#bcc9ca',
  iceDark: '#89999e',
  cliffLight: '#7d898d',
  cliff: '#59666c',
  cliffDark: '#354249',
  rockDeep: '#26343c',
  rock: '#46555c',
  rockLight: '#68767a',
  pineDeep: '#203b3c',
  pine: '#315453',
  pineLight: '#4f6e68',
};

function rng(seed) {
  let n = seed >>> 0;
  return () => {
    n += 0x6d2b79f5;
    let t = n;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function polygon(ctx, points, fill, stroke = null, lineWidth = 1) {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function pixelLine(ctx, points, color, width = 1) {
  ctx.beginPath();
  ctx.moveTo(Math.round(points[0][0]) + 0.5, Math.round(points[0][1]) + 0.5);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(Math.round(points[i][0]) + 0.5, Math.round(points[i][1]) + 0.5);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.stroke();
}

function scatter(ctx, random, count, bounds, colors, sizes = [1, 1]) {
  for (let i = 0; i < count; i += 1) {
    const x = Math.floor(bounds.x + random() * bounds.w);
    const y = Math.floor(bounds.y + random() * bounds.h);
    const color = colors[Math.floor(random() * colors.length)];
    const size = sizes[Math.floor(random() * sizes.length)];
    ctx.fillStyle = color;
    ctx.fillRect(x, y, size, random() > 0.83 ? 2 : 1);
  }
}

function drawSkyAndDistantPeaks(ctx) {
  const gradient = ctx.createLinearGradient(0, 0, 0, 120);
  gradient.addColorStop(0, COLORS.skyTop);
  gradient.addColorStop(0.66, '#b5c0c3');
  gradient.addColorStop(1, COLORS.skyBottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, PIXEL_WIDTH, 130);

  polygon(ctx, [[0, 74], [38, 45], [66, 66], [112, 27], [146, 62], [190, 36], [232, 73], [276, 30], [326, 67], [372, 38], [420, 69], [470, 29], [520, 65], [568, 41], [640, 76], [640, 123], [0, 123]], '#829196');
  polygon(ctx, [[0, 83], [38, 54], [51, 64], [66, 66], [112, 35], [128, 49], [146, 62], [190, 44], [205, 53], [232, 73], [276, 38], [294, 55], [326, 67], [372, 46], [390, 58], [420, 69], [470, 37], [488, 51], [520, 65], [568, 49], [640, 83], [640, 124], [0, 124]], '#aeb9ba');
  polygon(ctx, [[22, 69], [38, 54], [49, 65], [60, 65], [39, 45]], '#e4e7e3');
  polygon(ctx, [[83, 53], [112, 35], [127, 49], [118, 47], [111, 57], [103, 47], [94, 61]], '#e9ebe7');
  polygon(ctx, [[251, 54], [276, 38], [295, 55], [281, 51], [275, 60], [266, 50]], '#e5e8e5');
  polygon(ctx, [[445, 54], [470, 37], [489, 51], [478, 49], [470, 57], [461, 48]], '#e8eae6');
  polygon(ctx, [[547, 59], [568, 49], [589, 59], [572, 57], [567, 64], [560, 56]], '#e1e5e2');

  ctx.fillStyle = 'rgba(225,231,229,0.72)';
  ctx.fillRect(0, 76, 640, 8);
  ctx.fillStyle = 'rgba(211,219,218,0.72)';
  ctx.fillRect(0, 84, 640, 9);
  ctx.fillStyle = 'rgba(230,233,230,0.8)';
  ctx.fillRect(0, 93, 640, 8);
}

function drawBackCliff(ctx, random) {
  const top = [[0, 111], [18, 107], [34, 101], [53, 103], [69, 94], [89, 98], [105, 90], [128, 94], [145, 86], [164, 91], [185, 83], [205, 88], [229, 79], [251, 86], [270, 76], [294, 82], [314, 73], [335, 80], [356, 76], [378, 84], [400, 78], [421, 88], [442, 83], [461, 94], [484, 90], [503, 99], [525, 94], [545, 103], [566, 99], [586, 108], [607, 104], [640, 113]];
  const face = [...top, [640, 152], [613, 147], [592, 153], [568, 147], [548, 153], [521, 145], [499, 151], [476, 143], [452, 149], [426, 140], [402, 148], [377, 139], [354, 145], [329, 137], [304, 143], [278, 137], [251, 144], [226, 137], [198, 146], [174, 139], [146, 147], [119, 141], [94, 150], [67, 144], [42, 151], [18, 145], [0, 149]];
  polygon(ctx, face, COLORS.cliffDark);

  for (let i = 0; i < top.length - 1; i += 2) {
    const a = top[i];
    const b = top[Math.min(i + 2, top.length - 1)];
    const depth = 16 + Math.floor(random() * 20);
    const mid = (a[0] + b[0]) * 0.5;
    polygon(ctx, [a, b, [b[0] - 4, b[1] + depth], [mid, a[1] + depth + 7], [a[0] + 3, a[1] + depth]], i % 4 === 0 ? COLORS.cliff : COLORS.cliffLight);
    if (i % 3 === 0) {
      polygon(ctx, [[mid, a[1] + 8], [b[0] - 3, b[1] + depth], [mid + 4, a[1] + depth + 5]], COLORS.cliffDark);
    }
  }

  const snowLip = top.map(([x, y]) => [x, y - 5]);
  polygon(ctx, [...snowLip, ...top.slice().reverse()], COLORS.snowLight);
  pixelLine(ctx, top, COLORS.snowShade, 1);

  for (let i = 0; i < top.length - 2; i += 3) {
    const x = top[i][0] + 5;
    const y = top[i][1] + 13;
    pixelLine(ctx, [[x, y], [x + 4, y + 7], [x + 1, y + 13], [x + 6, y + 18]], '#2d3b42', 1);
  }
  scatter(ctx, random, 125, { x: 5, y: 103, w: 630, h: 42 }, ['#425057', '#6d797c', '#899396'], [1, 1, 2]);
}

function drawClearing(ctx, random) {
  // Deep stone beyond the snow shelf keeps the arena framed without empty voids.
  ctx.fillStyle = '#303e45';
  ctx.fillRect(0, 130, PIXEL_WIDTH, 188);
  polygon(ctx, [[0, 151], [42, 143], [69, 151], [58, 181], [64, 212], [55, 243], [62, 276], [46, 303], [0, 313]], '#3e4d54');
  polygon(ctx, [[640, 151], [598, 143], [571, 151], [582, 181], [576, 212], [585, 243], [578, 276], [594, 303], [640, 313]], '#3e4d54');
  pixelLine(ctx, [[4, 186], [24, 179], [43, 183]], '#55636a', 2);
  pixelLine(ctx, [[596, 229], [616, 223], [639, 226]], '#55636a', 2);

  const edge = [[52, 118], [82, 104], [126, 101], [166, 108], [210, 101], [249, 108], [290, 101], [329, 108], [370, 101], [415, 107], [459, 101], [506, 108], [552, 105], [589, 120], [603, 151], [596, 184], [606, 217], [595, 250], [602, 278], [581, 301], [539, 307], [497, 302], [453, 309], [410, 303], [365, 310], [320, 304], [275, 309], [232, 303], [190, 309], [148, 302], [107, 307], [69, 297], [54, 273], [59, 242], [49, 212], [57, 181], [49, 151]];
  polygon(ctx, edge, COLORS.rockDeep);

  const inner = edge.map(([x, y]) => {
    const dx = x < 100 ? 8 : x > 550 ? -8 : 0;
    const dy = y < 130 ? 8 : y > 285 ? -8 : 0;
    return [x + dx, y + dy];
  });
  polygon(ctx, inner, COLORS.snowShade);

  const field = [[67, 128], [94, 115], [132, 113], [171, 120], [210, 113], [250, 119], [290, 112], [331, 119], [370, 113], [413, 119], [458, 113], [500, 120], [545, 116], [578, 129], [589, 155], [583, 184], [592, 215], [582, 243], [588, 270], [570, 288], [533, 295], [495, 290], [452, 297], [410, 291], [365, 298], [320, 292], [277, 297], [234, 291], [191, 297], [151, 290], [111, 295], [80, 286], [67, 266], [72, 240], [62, 211], [70, 182], [62, 153]];
  polygon(ctx, field, COLORS.snow);

  const icePatch = [[137, 151], [192, 132], [261, 137], [322, 126], [393, 139], [470, 130], [535, 151], [558, 190], [545, 238], [501, 268], [424, 279], [353, 271], [282, 284], [213, 274], [149, 250], [103, 215], [110, 178]];
  polygon(ctx, icePatch, '#dce2df');
  polygon(ctx, [[157, 163], [222, 145], [289, 149], [343, 138], [412, 151], [489, 142], [529, 166], [538, 202], [520, 234], [474, 253], [414, 265], [348, 257], [285, 271], [222, 260], [166, 242], [126, 211], [128, 180]], 'rgba(235,238,233,0.38)');

  scatter(ctx, random, 310, { x: 76, y: 124, w: 500, h: 165 }, ['rgba(137,151,153,0.20)', 'rgba(248,249,244,0.46)', 'rgba(174,185,184,0.24)'], [1, 1, 2]);

  // Wind-polished bands keep the center open while adding a sense of frozen depth.
  pixelLine(ctx, [[151, 181], [194, 174], [238, 177]], 'rgba(154,170,171,0.38)', 1);
  pixelLine(ctx, [[398, 238], [445, 232], [488, 235]], 'rgba(154,170,171,0.32)', 1);
  pixelLine(ctx, [[238, 251], [279, 247], [317, 250]], 'rgba(255,255,251,0.48)', 1);
  pixelLine(ctx, [[347, 159], [383, 156], [420, 160]], 'rgba(255,255,251,0.45)', 1);

  drawEtchedEmblem(ctx);
  drawGroundDetails(ctx, random);
}

function drawEtchedEmblem(ctx) {
  const cx = 321;
  const cy = 211;
  const rx = 57;
  const ry = 29;
  ctx.fillStyle = 'rgba(134,151,153,0.20)';
  for (let a = 0; a < Math.PI * 2; a += 0.035) {
    const x = Math.round(cx + Math.cos(a) * rx);
    const y = Math.round(cy + Math.sin(a) * ry);
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.fillStyle = 'rgba(251,252,247,0.33)';
  for (let a = 0; a < Math.PI * 2; a += 0.055) {
    const x = Math.round(cx + Math.cos(a) * (rx - 2));
    const y = Math.round(cy + Math.sin(a) * (ry - 2));
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.fillStyle = 'rgba(137,153,155,0.18)';
  ctx.fillRect(cx - rx + 2, cy, rx * 2 - 4, 1);
  for (let a = 0; a < Math.PI * 2; a += 0.13) {
    const x = Math.round(cx + Math.cos(a) * 10);
    const y = Math.round(cy + Math.sin(a) * 6);
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.fillStyle = 'rgba(247,248,244,0.34)';
  ctx.fillRect(cx - 5, cy - 2, 10, 4);
}

function drawGroundDetails(ctx, random) {
  const pebbleZones = [
    { x: 84, y: 152, w: 42, h: 102 },
    { x: 516, y: 150, w: 45, h: 103 },
    { x: 130, y: 267, w: 110, h: 17 },
    { x: 407, y: 268, w: 105, h: 16 },
  ];
  for (const zone of pebbleZones) {
    scatter(ctx, random, 16, zone, ['#9ba8a9', '#bcc5c3', '#eff0eb'], [1, 1, 2]);
  }

  const cracks = [
    [[111, 226], [117, 222], [123, 224], [127, 218]],
    [[493, 178], [488, 184], [491, 190], [485, 194]],
    [[205, 146], [210, 151], [208, 157]],
    [[429, 270], [435, 265], [442, 267]],
    [[278, 282], [284, 277], [290, 279]],
  ];
  for (const crack of cracks) pixelLine(ctx, crack, 'rgba(111,132,136,0.55)', 1);

  // Subtle boot tracks approaching the duel area.
  const tracks = [[94, 205], [101, 200], [108, 195], [115, 190], [550, 184], [542, 188], [535, 192], [527, 196]];
  for (let i = 0; i < tracks.length; i += 1) {
    const [x, y] = tracks[i];
    ctx.fillStyle = i % 2 ? 'rgba(146,160,161,0.35)' : 'rgba(245,247,242,0.42)';
    ctx.fillRect(x, y, 3, 1);
    ctx.fillRect(x + (i % 2 ? 1 : -1), y + 1, 2, 1);
  }
}

function drawBoulder(ctx, x, y, scale = 1, snowy = true, flip = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(flip ? -scale : scale, scale);
  polygon(ctx, [[-15, 8], [-13, -4], [-7, -12], [3, -15], [12, -9], [17, 1], [14, 11], [4, 15], [-8, 13]], COLORS.rockDeep);
  polygon(ctx, [[-10, 6], [-9, -3], [-4, -9], [4, -11], [11, -6], [13, 2], [9, 8], [1, 11], [-7, 9]], COLORS.rock);
  polygon(ctx, [[-8, -2], [-3, -8], [4, -10], [9, -6], [5, 0], [-2, 2]], COLORS.rockLight);
  polygon(ctx, [[8, -5], [13, 1], [9, 8], [5, 2]], '#34434a');
  if (snowy) {
    polygon(ctx, [[-10, -4], [-5, -11], [3, -13], [10, -8], [8, -4], [2, -6], [-3, -3]], COLORS.snowLight);
    ctx.fillStyle = COLORS.snowShade;
    ctx.fillRect(-6, -3, 5, 1);
    ctx.fillRect(4, -5, 4, 1);
  }
  ctx.restore();
}

function drawPine(ctx, x, y, scale = 1, depth = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  const dark = depth ? '#395354' : COLORS.pineDeep;
  const mid = depth ? '#526a68' : COLORS.pine;
  const light = depth ? '#6f817c' : COLORS.pineLight;
  ctx.fillStyle = '#4d4740';
  ctx.fillRect(-2, -5, 4, 15);
  polygon(ctx, [[0, -39], [-9, -23], [-5, -24], [-15, -9], [-8, -11], [-19, 4], [0, -1], [19, 4], [8, -11], [15, -9], [5, -24], [9, -23]], dark);
  polygon(ctx, [[0, -35], [-6, -22], [0, -25], [0, -8], [-13, -3], [0, -5]], mid);
  polygon(ctx, [[0, -31], [5, -22], [1, -23], [10, -11], [2, -13], [14, -1], [2, -5]], light);
  polygon(ctx, [[0, -40], [-7, -26], [-2, -28], [0, -24], [6, -25]], COLORS.snowLight);
  polygon(ctx, [[-8, -22], [-15, -9], [-8, -11], [-3, -8], [4, -12], [10, -10], [14, -8], [9, -17], [4, -18], [1, -14], [-3, -17]], '#e7ebe7');
  polygon(ctx, [[-14, -7], [-19, 4], [-10, 1], [-5, 4], [2, -1], [8, 2], [17, 3], [11, -6], [5, -7], [1, -4], [-5, -8]], COLORS.snow);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-3, -29, 5, 1);
  ctx.fillRect(-11, -10, 6, 1);
  ctx.restore();
}

function drawBorderScenery(ctx) {
  // Distant trees tucked behind the cliff lip.
  drawPine(ctx, 31, 111, 0.68, true);
  drawPine(ctx, 75, 99, 0.57, true);
  drawPine(ctx, 548, 101, 0.58, true);
  drawPine(ctx, 612, 112, 0.71, true);

  // Side rock shelves and foreground framing.
  drawBoulder(ctx, 57, 150, 1.22, true, false);
  drawBoulder(ctx, 68, 178, 0.86, true, true);
  drawBoulder(ctx, 55, 237, 1.12, true, true);
  drawBoulder(ctx, 74, 278, 0.92, true, false);
  drawBoulder(ctx, 582, 153, 1.18, true, true);
  drawBoulder(ctx, 574, 195, 0.82, true, false);
  drawBoulder(ctx, 588, 241, 1.16, true, false);
  drawBoulder(ctx, 567, 282, 0.92, true, true);
  drawBoulder(ctx, 133, 302, 0.76, true, false);
  drawBoulder(ctx, 505, 300, 0.78, true, true);

  drawPine(ctx, 30, 184, 1.04, false);
  drawPine(ctx, 55, 272, 0.9, false);
  drawPine(ctx, 91, 312, 0.77, false);
  drawPine(ctx, 611, 184, 1.03, false);
  drawPine(ctx, 590, 274, 0.92, false);
  drawPine(ctx, 548, 315, 0.73, false);

  // Foreground snow banks create a layered, irregular silhouette beneath the UI.
  polygon(ctx, [[0, 303], [25, 295], [50, 301], [79, 294], [108, 305], [144, 299], [177, 310], [214, 303], [251, 314], [286, 307], [323, 316], [360, 307], [398, 314], [436, 303], [474, 311], [512, 300], [550, 306], [586, 296], [615, 302], [640, 294], [640, 360], [0, 360]], '#526168');
  polygon(ctx, [[0, 309], [28, 302], [53, 307], [80, 300], [109, 311], [144, 305], [177, 316], [214, 309], [251, 320], [286, 313], [323, 322], [360, 313], [398, 320], [436, 309], [474, 317], [512, 306], [550, 312], [586, 302], [615, 308], [640, 300], [640, 360], [0, 360]], COLORS.snowShade);
  polygon(ctx, [[0, 302], [25, 294], [50, 300], [79, 293], [108, 304], [144, 298], [177, 309], [214, 302], [251, 313], [286, 306], [323, 315], [360, 306], [398, 313], [436, 302], [474, 310], [512, 299], [550, 305], [586, 295], [615, 301], [640, 293], [640, 301], [615, 309], [586, 303], [550, 313], [512, 307], [474, 318], [436, 310], [398, 321], [360, 314], [323, 323], [286, 314], [251, 321], [214, 310], [177, 317], [144, 306], [108, 312], [79, 301], [50, 308], [25, 302], [0, 310]], COLORS.snowLight);
}

function drawStaticTerrain(ctx) {
  ctx.imageSmoothingEnabled = false;
  const random = rng(0x4d74536c);
  drawSkyAndDistantPeaks(ctx);
  drawBackCliff(ctx, random);
  drawClearing(ctx, random);
  drawBorderScenery(ctx);

  // Fine atmospheric ice grains over the background, deterministic and sparse.
  scatter(ctx, random, 100, { x: 0, y: 15, w: 640, h: 102 }, ['rgba(239,242,239,0.25)', 'rgba(92,108,113,0.18)'], [1, 1]);
}

function getTerrainCache() {
  if (terrainCache) return terrainCache;
  if (typeof OffscreenCanvas === 'undefined'&&typeof document==='undefined') return null;
  const canvas = typeof OffscreenCanvas!=='undefined'?new OffscreenCanvas(PIXEL_WIDTH, PIXEL_HEIGHT):document.createElement('canvas');
  canvas.width=PIXEL_WIDTH;canvas.height=PIXEL_HEIGHT;
  const cacheCtx = canvas.getContext('2d', { alpha: false });
  if (!cacheCtx) return null;
  if(landscape){cacheCtx.imageSmoothingEnabled=true;cacheCtx.drawImage(landscape,0,0,PIXEL_WIDTH,PIXEL_HEIGHT);}
  else drawStaticTerrain(cacheCtx);
  terrainCache = canvas;
  return terrainCache;
}

function drawFog(ctx, time) {
  const t = Number.isFinite(time) ? time : 0;
  ctx.save();
  ctx.scale(2, 2);
  ctx.globalCompositeOperation = 'screen';

  const driftA = ((t * 0.006) % 190) - 95;
  const driftB = ((t * 0.0038 + 80) % 230) - 115;
  ctx.fillStyle = 'rgba(230,235,233,0.065)';
  polygon(ctx, [[-120 + driftA, 85], [75 + driftA, 81], [185 + driftA, 88], [250 + driftA, 96], [170 + driftA, 103], [-80 + driftA, 100]], ctx.fillStyle);
  ctx.fillStyle = 'rgba(244,246,242,0.045)';
  polygon(ctx, [[310 + driftB, 119], [470 + driftB, 111], [700 + driftB, 123], [675 + driftB, 134], [430 + driftB, 132]], ctx.fillStyle);

  const pulse = 0.025 + (Math.sin(t * 0.00045) + 1) * 0.012;
  ctx.fillStyle = `rgba(238,242,239,${pulse})`;
  ctx.fillRect(0, 106, 640, 19);
  ctx.restore();
}

/**
 * Draw the complete 1280x720 snowy battle arena.
 * Static terrain is cached at 640x360 and nearest-neighbor scaled for crisp pixels.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} [time=0] animation time in milliseconds
 */
export function drawArena(ctx, time = 0, {preserveTransform=false,bounds=null} = {}) {
  if (!ctx) return;
  ctx.save();
  if (!preserveTransform) ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;

  const cache = getTerrainCache();
  if (bounds) {
    const left=Math.min(-24,bounds.left-24),top=Math.min(-24,bounds.top-24),right=Math.max(LOGICAL_WIDTH+24,bounds.right+24),bottom=Math.max(LOGICAL_HEIGHT+24,bounds.bottom+24);
    // Mirror complete edge scenery outside the arena. Stretching a one-pixel
    // strip produces obvious horizontal streaks when a mobile camera pans out.
    ctx.fillStyle='#c3d0cf';ctx.fillRect(left,top,right-left,bottom-top);
    if(cache){
      for(let row=Math.max(-3,Math.floor(top/LOGICAL_HEIGHT));row<=Math.min(3,Math.floor(bottom/LOGICAL_HEIGHT));row++){
        for(let col=Math.max(-2,Math.floor(left/LOGICAL_WIDTH));col<=Math.min(2,Math.floor(right/LOGICAL_WIDTH));col++){
          if(row===0&&col===0)continue;
          const flipX=Math.abs(col)%2,flipY=Math.abs(row)%2;
          ctx.save();ctx.translate((col+flipX)*LOGICAL_WIDTH,(row+flipY)*LOGICAL_HEIGHT);ctx.scale(flipX?-1:1,flipY?-1:1);
          ctx.drawImage(cache,0,0,LOGICAL_WIDTH,LOGICAL_HEIGHT);ctx.restore();
        }
      }
    }
  }
  if (cache) {
    ctx.drawImage(cache, 0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
  } else if(landscape){
    ctx.drawImage(landscape,0,0,LOGICAL_WIDTH,LOGICAL_HEIGHT);
  } else {
    ctx.save();
    ctx.scale(2, 2);
    drawStaticTerrain(ctx);
    ctx.restore();
  }

  drawFog(ctx, time);
  ctx.restore();
}

/**
 * Draw optional foreground snowfall over the arena and combatants.
 * Call after sprites/effects when flakes should pass in front of them.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} [time=0] animation time in milliseconds
 */
export function drawSnow(ctx, time = 0, {preserveTransform=false} = {}) {
  if (!ctx) return;
  const t = Number.isFinite(time) ? time : 0;
  const random = rng(0x534e4f57);

  ctx.save();
  if (!preserveTransform) ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;

  for (let i = 0; i < 92; i += 1) {
    const baseX = random() * (LOGICAL_WIDTH + 180) - 90;
    const baseY = random() * LOGICAL_HEIGHT;
    const speed = 0.018 + random() * 0.034;
    const layer = random();
    const y = (baseY + t * speed) % (LOGICAL_HEIGHT + 36) - 18;
    const sway = Math.sin(t * 0.0013 + i * 1.71) * (5 + layer * 12);
    const x = (baseX + sway + t * (0.006 + layer * 0.006) + LOGICAL_WIDTH + 100) % (LOGICAL_WIDTH + 180) - 90;
    const size = layer > 0.88 ? 6 : layer > 0.52 ? 4 : 2;

    ctx.fillStyle = layer > 0.7 ? 'rgba(255,255,251,0.82)' : 'rgba(238,242,240,0.58)';
    ctx.fillRect(Math.round(x), Math.round(y), size, size);
    if (size >= 4) {
      ctx.fillStyle = 'rgba(173,190,192,0.34)';
      ctx.fillRect(Math.round(x) + size, Math.round(y) + size - 2, 2, 2);
    }
  }

  ctx.restore();
}
