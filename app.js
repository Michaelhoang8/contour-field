import { fixture, displayRGBA, MAX_SIDE } from './core.js';
const $ = (id) => document.getElementById(id),
  stages = {
    gray: ['01 / Gray', 'Display-referred luminance, composited on white.'],
    smoothed: ['02 / Blur', 'Separable Gaussian smoothing with clamped border samples.'],
    magnitude: ['03 / Gradient', 'Sobel magnitude on a fixed scale; the one-pixel border is zero.'],
    suppressed: [
      '04 / Thin',
      'Four-direction nonmaximum suppression; equal peaks use a deterministic tie break.',
    ],
    edges: [
      '05 / Edges',
      'Strong pixels plus every eight-connected weak pixel reachable from them.',
    ],
    overlay: ['06 / Overlay', 'Accepted edges in warm orange over the original image.'],
  };
let source = fixture(),
  sourceName = 'Geometric study',
  result = null,
  stage = 'overlay',
  worker = null,
  revision = 0,
  elapsed = 0;
const original = document.createElement('canvas'),
  processed = document.createElement('canvas');
function status(text) {
  $('status').textContent = text;
  $('workspace-status').textContent = text;
}
function invalidate() {
  revision++;
  worker?.terminate();
  worker = null;
  result = null;
  $('run').disabled = false;
  $('png').disabled = $('report').disabled = true;
  for (const id of ['coverage', 'counts', 'compute']) $(id).textContent = '—';
  $('pixel').textContent = 'Process an image to inspect its stages.';
  $('histogram').getContext('2d').clearRect(0, 0, 512, 120);
  draw();
  status('Settings changed. Process again to update the preview.');
}
function syncSource() {
  original.width = source.width;
  original.height = source.height;
  const ctx = original.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, source.width, source.height);
  const layer = document.createElement('canvas');
  layer.width = source.width;
  layer.height = source.height;
  layer
    .getContext('2d')
    .putImageData(new ImageData(source.rgba, source.width, source.height), 0, 0);
  ctx.drawImage(layer, 0, 0);
  $('image-name').textContent = sourceName;
  $('dimensions').textContent = `${source.width} × ${source.height}`;
  for (const [id, limit] of [
    ['x', source.width],
    ['y', source.height],
  ]) {
    $(id).max = limit - 1;
    $(id).value = Math.min(Number($(id).value), limit - 1);
  }
  draw();
}
function draw() {
  const canvas = $('view');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(original, 0, 0);
  const fraction = Number($('wipe').value) / 100;
  $('wipe-value').textContent = `${Math.round(fraction * 100)}% original`;
  if (result) {
    processed.width = source.width;
    processed.height = source.height;
    processed
      .getContext('2d')
      .putImageData(
        new ImageData(displayRGBA(result, stage, source.rgba), source.width, source.height),
        0,
        0,
      );
    ctx.save();
    ctx.beginPath();
    ctx.rect(source.width * fraction, 0, source.width * (1 - fraction), source.height);
    ctx.clip();
    ctx.drawImage(processed, 0, 0);
    ctx.restore();
    if (fraction > 0 && fraction < 1) {
      ctx.fillStyle = '#ee6d3e';
      ctx.fillRect(Math.floor(source.width * fraction), 0, 1, source.height);
    }
  }
  $('description').textContent = result
    ? stages[stage][1]
    : 'Original image · process to see the selected processing stage.';
  for (const key of Object.keys(stages))
    $(`stage-${key}`).setAttribute('aria-pressed', String(stage === key));
}
function inspect() {
  if (!result) return;
  const x = Number($('x').value),
    y = Number($('y').value);
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    x < 0 ||
    y < 0 ||
    x >= source.width ||
    y >= source.height
  ) {
    $('pixel').textContent = 'Choose an integer coordinate inside the image.';
    return;
  }
  const i = y * source.width + x;
  $('pixel').textContent =
    `Pixel (${x}, ${y})\nGray ${result.gray[i].toFixed(2)} → blur ${result.smoothed[i].toFixed(2)}\nGradient ${result.magnitude[i].toFixed(2)} at ${result.direction[i] * 45}°\nThinned ${result.suppressed[i].toFixed(2)} → ${result.edges[i] ? 'accepted edge' : 'not an edge'}`;
}
function histogram() {
  const ctx = $('histogram').getContext('2d');
  ctx.clearRect(0, 0, 512, 120);
  const bins = result.histogram,
    max = Math.max(1, ...bins.slice(1));
  ctx.fillStyle = '#6b7a55';
  for (let i = 1; i < 256; i++) {
    const height = (Math.log1p(bins[i]) / Math.log1p(max)) * 100;
    ctx.fillRect(i * 2, 120 - height, 1.5, height);
  }
  ctx.strokeStyle = '#d6693f';
  for (const threshold of [result.settings.low, result.settings.high]) {
    ctx.beginPath();
    ctx.moveTo(threshold * 2, 0);
    ctx.lineTo(threshold * 2, 120);
    ctx.stroke();
  }
}
function run() {
  worker?.terminate();
  const ticket = ++revision,
    current = new Worker('./worker.js', { type: 'module' });
  worker = current;
  $('run').disabled = true;
  $('png').disabled = $('report').disabled = true;
  status('Processing the image…');
  const settings = {
    sigma: Number($('sigma').value),
    low: Number($('low').value),
    high: Number($('high').value),
  };
  current.onmessage = ({ data }) => {
    if (ticket !== revision) return;
    current.terminate();
    worker = null;
    $('run').disabled = false;
    if (data.error) {
      status(data.error);
      return;
    }
    result = data.result;
    elapsed = data.milliseconds;
    $('coverage').textContent = `${result.stats.edgePercent.toFixed(2)}%`;
    $('counts').textContent = `${result.stats.strong} / ${result.stats.connectedWeak}`;
    $('compute').textContent =
      `${result.stats.kernelSize} × ${result.stats.kernelSize} / ${elapsed.toFixed(1)} ms`;
    $('png').disabled = $('report').disabled = false;
    draw();
    histogram();
    inspect();
    status(
      `${result.stats.edges.toLocaleString()} edge pixels. The PNG export contains the full selected stage, without the comparison divider.`,
    );
  };
  current.onerror = () => {
    if (ticket !== revision) return;
    current.terminate();
    worker = null;
    $('run').disabled = false;
    status('Processing failed. Try processing again.');
  };
  current.postMessage({ ...source, ...settings });
}
for (const [key, [name]] of Object.entries(stages)) {
  const button = document.createElement('button');
  button.id = `stage-${key}`;
  button.textContent = name;
  button.setAttribute('aria-pressed', String(key === stage));
  button.addEventListener('click', () => {
    stage = key;
    draw();
  });
  $('stages').append(button);
}
for (const id of ['sigma', 'low', 'high']) $(id).addEventListener('input', invalidate);
$('wipe').addEventListener('input', draw);
$('inspect').addEventListener('click', inspect);
$('run').addEventListener('click', run);
$('fixture').addEventListener('change', () => {
  invalidate();
  source = fixture($('fixture').value);
  sourceName = $('fixture').selectedOptions[0].textContent;
  syncSource();
  run();
});
function download(name, blob) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('png').addEventListener('click', () => {
  const name = `contour-${stage}.png`;
  processed.toBlob((blob) => {
    if (blob) download(name, blob);
    else status('PNG encoding failed.');
  }, 'image/png');
});
$('report').addEventListener('click', () =>
  download(
    'contour-analysis.json',
    new Blob(
      [
        JSON.stringify(
          {
            source: sourceName,
            width: result.width,
            height: result.height,
            settings: result.settings,
            stats: result.stats,
            milliseconds: elapsed,
            histogram: [...result.histogram],
            model:
              'Display-referred Rec.709 weights; alpha on white; clamped Gaussian; Sobel / (4 sqrt(2)); four-bin asymmetric NMS; eight-connected hysteresis.',
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    ),
  ),
);
$('file').addEventListener('change', async () => {
  const file = $('file').files[0];
  if (!file) return;
  worker?.terminate();
  worker = null;
  $('run').disabled = false;
  const ticket = ++revision;
  let bitmap;
  try {
    if (file.size > 8 * 1024 * 1024) throw Error('Use an image no larger than 8 MB.');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
      throw Error('Use PNG, JPEG, or WebP.');
    bitmap = await createImageBitmap(file);
    if (bitmap.width * bitmap.height > 24000000)
      throw Error('Images are limited to 24 megapixels.');
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height)),
      width = Math.round(bitmap.width * scale),
      height = Math.round(bitmap.height * scale);
    if (width < 3 || height < 3)
      throw Error('Both processed dimensions must be at least three pixels.');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, width, height);
    const rgba = ctx.getImageData(0, 0, width, height).data;
    if (ticket !== revision) return;
    invalidate();
    source = { rgba, width, height };
    sourceName = `${file.name}${scale < 1 ? ' · resized to fit 640 px' : ''}`;
    syncSource();
    run();
  } catch (e) {
    if (ticket === revision) status(`Image not loaded: ${e.message}`);
  } finally {
    bitmap?.close();
    $('file').value = '';
  }
});
$('settings-open').addEventListener('click', () => $('settings').showModal());
$('settings-close').addEventListener('click', () => $('settings').close());
syncSource();
run();
