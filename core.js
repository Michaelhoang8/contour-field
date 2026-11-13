export const MAX_SIDE = 640;
function dimensions(width, height, length, channels = 1) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 3 ||
    height < 3 ||
    width > MAX_SIDE ||
    height > MAX_SIDE ||
    length !== width * height * channels
  )
    throw Error('Images need matching pixel data and dimensions from 3 to 640.');
}
function field(data, width, height) {
  dimensions(width, height, data?.length);
  for (const x of data)
    if (!Number.isFinite(x) || x < 0 || x > 255)
      throw Error('Image values must be finite intensities from 0 to 255.');
}
export function grayscale(rgba, width, height) {
  dimensions(width, height, rgba?.length, 4);
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) {
    const j = i * 4,
      a = rgba[j + 3] / 255;
    for (let c = 0; c < 4; c++)
      if (!Number.isFinite(rgba[j + c]) || rgba[j + c] < 0 || rgba[j + c] > 255)
        throw Error('Invalid RGBA channel.');
    out[i] = (0.2126 * rgba[j] + 0.7152 * rgba[j + 1] + 0.0722 * rgba[j + 2]) * a + 255 * (1 - a);
  }
  return out;
}
export function gaussianKernel(sigma) {
  if (!Number.isFinite(sigma) || sigma < 0.5 || sigma > 3)
    throw Error('Sigma must be between 0.5 and 3.');
  const radius = Math.ceil(3 * sigma),
    kernel = new Float64Array(radius * 2 + 1);
  let total = 0;
  for (let i = -radius; i <= radius; i++) {
    const value = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = value;
    total += value;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= total;
  return kernel;
}
export function blur(data, width, height, sigma) {
  field(data, width, height);
  const kernel = gaussianKernel(sigma),
    radius = (kernel.length - 1) / 2,
    temp = new Float32Array(data.length),
    out = new Float32Array(data.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let value = 0;
      for (let k = -radius; k <= radius; k++)
        value += data[y * width + Math.max(0, Math.min(width - 1, x + k))] * kernel[k + radius];
      temp[y * width + x] = value;
    }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let value = 0;
      for (let k = -radius; k <= radius; k++)
        value += temp[Math.max(0, Math.min(height - 1, y + k)) * width + x] * kernel[k + radius];
      out[y * width + x] = value;
    }
  return out;
}
export function sobel(data, width, height) {
  field(data, width, height);
  const magnitude = new Float32Array(data.length),
    direction = new Uint8Array(data.length);
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x,
        a = data[i - width - 1],
        b = data[i - width],
        c = data[i - width + 1],
        d = data[i - 1],
        f = data[i + 1],
        g = data[i + width - 1],
        h = data[i + width],
        j = data[i + width + 1],
        gx = -a + c - 2 * d + 2 * f - g + j,
        gy = -a - 2 * b - c + g + 2 * h + j;
      magnitude[i] = Math.min(255, Math.hypot(gx, gy) / (4 * Math.SQRT2));
      const angle = ((Math.atan2(gy, gx) * 180) / Math.PI + 180) % 180;
      direction[i] = Math.round(angle / 45) % 4;
    }
  return { magnitude, direction };
}
export function thin(magnitude, direction, width, height) {
  field(magnitude, width, height);
  dimensions(width, height, direction?.length);
  const out = new Float32Array(magnitude.length),
    offsets = [1, width + 1, width, width - 1];
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x,
        d = direction[i];
      if (!Number.isInteger(d) || d < 0 || d > 3)
        throw Error('Gradient direction must be one of four bins.');
      const offset = offsets[d],
        m = magnitude[i];
      if (m > 0 && m >= magnitude[i - offset] && m > magnitude[i + offset]) out[i] = m;
    }
  return out;
}
export function hysteresis(data, width, height, low, high) {
  field(data, width, height);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low < 0 || high > 255 || low > high)
    throw Error('Use 0 ≤ low ≤ high ≤ 255.');
  const edges = new Uint8Array(data.length),
    queue = new Int32Array(data.length);
  let head = 0,
    tail = 0,
    strong = 0;
  for (let i = 0; i < data.length; i++)
    if (data[i] > 0 && data[i] >= high) {
      edges[i] = 255;
      queue[tail++] = i;
      strong++;
    }
  while (head < tail) {
    const i = queue[head++],
      x = i % width,
      y = Math.floor(i / width);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (!edges[j] && data[j] > 0 && data[j] >= low) {
          edges[j] = 255;
          queue[tail++] = j;
        }
      }
  }
  return { edges, strong, connectedWeak: tail - strong, count: tail };
}
export function histogram(data) {
  const bins = new Uint32Array(256);
  for (const value of data) {
    if (!Number.isFinite(value) || value < 0 || value > 255)
      throw Error('Histogram intensities must be from 0 to 255.');
    bins[Math.round(value)]++;
  }
  return bins;
}
export function processImage(input) {
  if (!input || typeof input !== 'object') throw Error('Provide an image and settings.');
  const { rgba, width, height, sigma, low, high } = input;
  gaussianKernel(sigma);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low < 0 || high > 255 || low > high)
    throw Error('Use 0 ≤ low ≤ high ≤ 255.');
  const gray = grayscale(rgba, width, height),
    smoothed = blur(gray, width, height, sigma),
    { magnitude, direction } = sobel(smoothed, width, height),
    suppressed = thin(magnitude, direction, width, height),
    linked = hysteresis(suppressed, width, height, low, high);
  return {
    width,
    height,
    settings: { sigma, low, high },
    gray,
    smoothed,
    magnitude,
    suppressed,
    edges: linked.edges,
    direction,
    histogram: histogram(suppressed),
    stats: {
      pixels: width * height,
      strong: linked.strong,
      connectedWeak: linked.connectedWeak,
      edges: linked.count,
      edgePercent: (100 * linked.count) / (width * height),
      kernelSize: gaussianKernel(sigma).length,
    },
  };
}
export function fixture(kind = 'geometry', width = 480, height = 320) {
  dimensions(width, height, width * height);
  if (!['geometry', 'noisy', 'faint'].includes(kind)) throw Error('Unknown fixture.');
  const rgba = new Uint8ClampedArray(width * height * 4);
  let seed = 751;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const nx = x / width,
        ny = y / height;
      let value = 230;
      const ring = Math.hypot((nx - 0.31) * 1.5, ny - 0.5);
      if (ring < 0.27 && ring > 0.18) value = 45;
      if (nx > 0.58 && nx < 0.84 && ny > 0.23 && ny < 0.74) value = 105;
      if (ny > 0.78 && ny < 0.81 && nx > 0.13 && nx < 0.86) value = 45;
      if (kind === 'faint') value = 230 - (230 - value) * 0.18;
      if (kind === 'noisy') {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        value += ((seed >>> 24) - 128) * 0.45;
      }
      const i = (y * width + x) * 4;
      rgba[i] = value;
      rgba[i + 1] = value;
      rgba[i + 2] = value;
      rgba[i + 3] = 255;
    }
  return { rgba, width, height };
}
export function displayRGBA(result, stage, original) {
  if (!['gray', 'smoothed', 'magnitude', 'suppressed', 'edges', 'overlay'].includes(stage))
    throw Error('Unknown stage.');
  const values = result[stage],
    out = new Uint8ClampedArray(result.width * result.height * 4);
  if (stage === 'overlay') dimensions(result.width, result.height, original?.length, 4);
  for (let i = 0; i < out.length / 4; i++) {
    if (stage === 'overlay') {
      const alpha = original[i * 4 + 3] / 255;
      for (let c = 0; c < 3; c++)
        out[i * 4 + c] = result.edges[i]
          ? [238, 109, 62][c]
          : original[i * 4 + c] * alpha + 255 * (1 - alpha);
    } else out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = values[i];
    out[i * 4 + 3] = 255;
  }
  return out;
}
