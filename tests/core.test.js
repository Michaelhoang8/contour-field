import test from 'node:test';
import assert from 'node:assert/strict';
import {
  grayscale,
  gaussianKernel,
  blur,
  sobel,
  thin,
  hysteresis,
  histogram,
  processImage,
  fixture,
  displayRGBA,
} from '../core.js';
const near = (a, b, tol = 1e-5) => assert.ok(Math.abs(a - b) < tol, `${a} ≠ ${b}`);
test('grayscale composites transparency on white and uses documented channel weights', () => {
  const rgba = new Uint8ClampedArray(36);
  for (let i = 0; i < 9; i++) rgba[i * 4 + 3] = 255;
  rgba[0] = 255;
  rgba[5] = 255;
  rgba[10] = 255;
  rgba[15] = 0;
  const gray = grayscale(rgba, 3, 3);
  near(gray[0], 54.213);
  near(gray[1], 182.376);
  near(gray[2], 18.411);
  assert.equal(gray[3], 255);
});
test('Gaussian kernels are normalized, symmetric, and bounded', () => {
  for (const sigma of [0.5, 1, 1.7, 3]) {
    const k = gaussianKernel(sigma);
    near(
      k.reduce((a, b) => a + b, 0),
      1,
      1e-12,
    );
    for (let i = 0; i < k.length; i++) assert.equal(k[i], k[k.length - 1 - i]);
    assert.equal(k.length, 2 * Math.ceil(3 * sigma) + 1);
  }
  assert.throws(() => gaussianKernel(0));
});
test('separable blur preserves a constant including clamped borders', () => {
  const input = new Float32Array(21 * 19).fill(117);
  for (const v of blur(input, 21, 19, 2.2)) near(v, 117);
});
test('separable blur agrees with independent full two-dimensional convolution', () => {
  const w = 11,
    h = 9,
    input = Float32Array.from({ length: w * h }, (_, i) => (i * 53) % 256),
    k = gaussianKernel(1.1),
    radius = (k.length - 1) / 2,
    actual = blur(input, w, h, 1.1);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let expected = 0;
      for (let ky = -radius; ky <= radius; ky++)
        for (let kx = -radius; kx <= radius; kx++)
          expected +=
            input[Math.max(0, Math.min(h - 1, y + ky)) * w + Math.max(0, Math.min(w - 1, x + kx))] *
            k[ky + radius] *
            k[kx + radius];
      near(actual[y * w + x], expected, 2e-5);
    }
});
test('Sobel gives known ramp magnitude and horizontal/vertical direction', () => {
  for (const vertical of [false, true]) {
    const values = Float32Array.from(
        { length: 49 },
        (_, i) => (vertical ? Math.floor(i / 7) : i % 7) * 10,
      ),
      s = sobel(values, 7, 7);
    near(s.magnitude[24], 80 / (4 * Math.SQRT2));
    assert.equal(s.direction[24], vertical ? 2 : 0);
    assert.equal(s.magnitude[0], 0);
  }
});
test('nonmaximum suppression keeps one deterministic plateau boundary', () => {
  const magnitude = new Float32Array(25),
    direction = new Uint8Array(25);
  magnitude[11] = 30;
  magnitude[12] = 60;
  magnitude[13] = 60;
  const out = thin(magnitude, direction, 5, 5);
  assert.equal(out[11], 0);
  assert.equal(out[12], 0);
  assert.equal(out[13], 60);
});
test('hysteresis links eight-connected weak chains and removes isolated weak pixels', () => {
  const values = new Float32Array(49);
  values[8] = 90;
  values[16] = 40;
  values[24] = 40;
  values[32] = 40;
  values[40] = 40;
  values[12] = 40;
  const r = hysteresis(values, 7, 7, 30, 70);
  assert.equal(r.strong, 1);
  assert.equal(r.connectedWeak, 4);
  assert.equal(r.count, 5);
  assert.equal(r.edges[12], 0);
});
test('hysteresis zero thresholds do not turn zero-valued background into edges', () => {
  const values = new Float32Array(25);
  values[12] = 1;
  const r = hysteresis(values, 5, 5, 0, 0);
  assert.equal(r.count, 1);
  assert.throws(() => hysteresis(values, 5, 5, 80, 20));
});
test('full constant pipeline has no edges and an exact pixel histogram', () => {
  const image = fixture('geometry', 32, 24);
  image.rgba.fill(255);
  const r = processImage({ ...image, sigma: 1, low: 5, high: 10 });
  assert.equal(r.stats.edges, 0);
  assert.equal(r.histogram[0], 32 * 24);
  assert.equal(
    r.histogram.reduce((a, b) => a + b, 0),
    32 * 24,
  );
});
test('synthetic step edges are localized away from frame borders', () => {
  const w = 40,
    h = 30,
    rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = x < 20 ? 0 : 255;
      rgba[i + 3] = 255;
    }
  const r = processImage({ rgba, width: w, height: h, sigma: 1, low: 10, high: 30 });
  assert.equal(r.stats.edges, h - 2);
  for (let i = 0; i < r.edges.length; i++) if (r.edges[i]) assert.ok(i % w === 19 || i % w === 20);
});
test('hysteresis matches a separate repeated-relaxation oracle on 200 random fields', () => {
  let seed = 27;
  for (let trial = 0; trial < 200; trial++) {
    const values = Float32Array.from({ length: 63 }, () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return (seed % 5) * 20;
      }),
      expected = Array.from(values, (v) => v >= 60);
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < 63; i++) {
        if (expected[i] || values[i] < 20) continue;
        const x = i % 9,
          y = Math.floor(i / 9);
        for (let j = 0; j < 63; j++)
          if (expected[j] && Math.abs((j % 9) - x) <= 1 && Math.abs(Math.floor(j / 9) - y) <= 1) {
            expected[i] = true;
            changed = true;
            break;
          }
      }
    }
    const actual = hysteresis(values, 9, 7, 20, 60);
    assert.deepEqual(
      [...actual.edges],
      expected.map((v) => (v ? 255 : 0)),
    );
  }
});
test('fixtures and pipeline are deterministic, immutable, and export opaque RGBA', () => {
  const input = { ...fixture('noisy', 48, 32), sigma: 1.2, low: 12, high: 25 },
    copy = input.rgba.slice(),
    a = processImage(input),
    b = processImage(input);
  assert.deepEqual(a, b);
  assert.deepEqual(input.rgba, copy);
  for (const stage of ['gray', 'smoothed', 'magnitude', 'suppressed', 'edges', 'overlay']) {
    const rgba = displayRGBA(a, stage, input.rgba);
    assert.equal(rgba.length, 48 * 32 * 4);
    for (let i = 3; i < rgba.length; i += 4) assert.equal(rgba[i], 255);
  }
  assert.equal(histogram([0, 0.6, 254.6])[255], 1);
});
test('malformed images and nonfinite settings fail before processing', () => {
  const base = { ...fixture('geometry', 16, 16), sigma: 1, low: 10, high: 20 };
  for (const changes of [
    { width: 641 },
    { height: 1 },
    { sigma: NaN },
    { low: -1 },
    { high: 256 },
    { rgba: new Uint8Array(4) },
  ])
    assert.throws(() => processImage({ ...base, ...changes }));
  assert.throws(() => blur([NaN], 1, 1, 1));
  assert.throws(() => displayRGBA(processImage(base), 'unknown'));
});
