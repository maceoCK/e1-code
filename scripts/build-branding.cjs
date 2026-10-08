const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

function fingerprint(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = value => Math.round(value * 10000) / 10000;

// Transfer the captured artwork's local movement to each part of the new mark.
// Angular windows overlap, avoiding discontinuities at sector boundaries. Pixels
// are normalized to the frame footprint; global growth remains in frame.scale.
function sectorMoments(frame, angle) {
  let mass = 0, x = 0, y = 0, xx = 0, yy = 0, xy = 0;
  for (const pixel of frame.pixels) {
    const px = (pixel.x - frame.left) / frame.width - 0.5;
    const py = (pixel.y - frame.top) / frame.height - 0.5;
    let delta = Math.atan2(py, px) - angle;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    const weight = pixel.alpha * Math.max(0, 1 - Math.abs(delta) / (Math.PI / 3));
    if (!weight) continue;
    mass += weight; x += px * weight; y += py * weight;
    xx += px * px * weight; yy += py * py * weight; xy += px * py * weight;
  }
  if (!mass) return { mass: 0, x: 0, y: 0, angle: 0 };
  x /= mass; y /= mass; xx = xx / mass - x * x; yy = yy / mass - y * y; xy = xy / mass - x * y;
  return { mass: mass / (frame.width * frame.height), x, y, angle: Math.atan2(2 * xy, xx - yy) / 2 };
}

async function partCenters(parts, viewBox) {
  const [left, top, width, height] = viewBox.split(/\s+/).map(Number);
  return Promise.all(parts.map(async d => {
    const { data, info } = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}"><path fill-rule="evenodd" d="${d}"/></svg>`))
      .resize(256, 256, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let mass = 0, x = 0, y = 0;
    for (let iy = 0; iy < info.height; iy++) for (let ix = 0; ix < info.width; ix++) {
      const alpha = data[(iy * info.width + ix) * 4 + 3];
      mass += alpha; x += (ix + .5) * alpha; y += (iy + .5) * alpha;
    }
    const cx = left + x / mass / info.width * width;
    const cy = top + y / mass / info.height * height;
    return { x: round(cx), y: round(cy), angle: Math.atan2(cy - top - height / 2, cx - left - width / 2) };
  }));
}

module.exports = async function buildBranding(base, output, capture) {
  const source = fs.readFileSync(path.join(base, 'assets/aster-source.svg'), 'utf8');
  const viewBox = source.match(/viewBox="([^"]+)"/)[1];
  const parts = [...source.matchAll(/\bd="([^"]+)"/g)].map(m => m[1]);
  const mark = parts.join(' ');
  const [, , markWidth, markHeight] = viewBox.split(/\s+/).map(Number);
  const centers = await partCenters(parts, viewBox);
  const original = fs.readFileSync(path.join(capture, 'readable/resources/ion-dist/assets/v1/cf2613ee5-Btwr9m9F.js'), 'utf8');
  const sprites = {};
  for (const match of original.matchAll(/(\w+): \{\s+svg: '([^']+)',\s+width: (\d+),\s+height: (\d+),\s+frameCount: (\d+),\s+speed: (\d+)/g)) {
    const [, state, svg, widthText, heightText, countText, speedText] = match;
    const width = Number(widthText), height = Number(heightText), count = Number(countText), rasterScale = 2;
    const { data, info } = await sharp(Buffer.from(svg)).resize(width * rasterScale, height * count * rasterScale).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const captured = [];
    for (let f = 0; f < count; f++) {
      let left = info.width, right = -1, top = height * rasterScale, bottom = -1, alpha = 0, mass = 0;
      const pixels = [];
      for (let y = 0; y < height * rasterScale; y++) for (let x = 0; x < info.width; x++) {
        const a = data[((f * height * rasterScale + y) * info.width + x) * 4 + 3];
        if (a < 16) continue;
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); alpha = Math.max(alpha, a); mass += a;
        pixels.push({ x: x + .5, y: y + .5, alpha: a / 255 });
      }
      captured.push(right < 0 ? null : { left, top, width: right - left + 1, height: bottom - top + 1, alpha, mass, pixels });
    }
    // Shimmer/orbit begin at the resting shape. Growth/collapse animations use
    // their largest frame so shrinking doesn't become an extra local collapse.
    const reference = ['shimmer', 'orbiting', 'writing', 'waiting', 'tickle'].includes(state)
      ? captured.find(Boolean) : captured.reduce((best, frame) => frame && (!best || frame.mass > best.mass) ? frame : best, null);
    const referenceSectors = centers.map(center => sectorMoments(reference, center.angle));
    const frames = captured.map((frame, f) => {
      if (!frame) return null;
      const w = frame.width / rasterScale, h = frame.height / rasterScale;
      const fit = Math.min(w / markWidth, h / markHeight);
      // A segmented triangle has rigid joins, unlike the original flexible
      // rays. Attenuate local deformation while retaining its captured phase.
      // Entrance/exit already reproduce the original scale curve exactly.
      const strength = { thinking: .18, writing: .3, waiting: .08, shimmer: .25, entrance: 0, exit: 0, orbiting: .45, tickle: .18 }[state];
      const transforms = centers.map((center, i) => {
        const current = sectorMoments(frame, center.angle), baseline = referenceSectors[i];
        let turn = current.angle - baseline.angle;
        // Eigenvectors have no direction: wrap the orientation delta modulo pi.
        turn = Math.atan2(Math.sin(2 * turn), Math.cos(2 * turn)) / 2;
        return {
          x: round(clamp((current.x - baseline.x) * markWidth, -8, 8) * strength),
          y: round(clamp((current.y - baseline.y) * markHeight, -8, 8) * strength),
          rotate: round(clamp(turn * 180 / Math.PI, -35, 35) * strength),
          scale: round(1 + (clamp(Math.sqrt(current.mass / Math.max(baseline.mass, .0001)), state === 'shimmer' ? .25 : .85, 1.12) - 1) * (state === 'shimmer' ? 1 : strength)),
        };
      });
      return { x: round(frame.left / rasterScale + (w - markWidth * fit) / 2), y: round(f * height + frame.top / rasterScale + (h - markHeight * fit) / 2), scale: round(fit), opacity: frame.alpha / 255, parts: transforms };
    });
    const box = svg.match(/viewBox="([^"]+)"/)[1];
    const paths = [...svg.matchAll(/\bd="([^"]+)"/g)].map(m => m[1]).join('|');
    sprites[fingerprint(box + '|' + paths)] = { state, width, height, viewBox: box, frameCount: count, speed: Number(speedText), frames };
  }
  if (Object.keys(sprites).length !== 8) throw Error('Expected all eight captured logo animation states.');
  const branding = { viewBox, mark, parts, centers, sprites, sourceSha256: crypto.createHash('sha256').update(source).digest('hex') };
  fs.writeFileSync(path.join(output, 'aster-branding.json'), JSON.stringify(branding));
  fs.copyFileSync(path.join(base, 'src/recovered-branding.js'), path.join(output, 'aster-branding.js'));
  fs.writeFileSync(path.join(base, 'evidence/branding-build.json'), JSON.stringify({ source: 'assets/aster-source.svg', sourceSha256: branding.sourceSha256, animationGeometry: 'Supplied nine-part mark; each frame retains captured footprint and transfers local alpha centroid, orientation, and density changes onto its segments. Adapted artwork, not identical original shape deformation.', interaction: 'Recovered React handlers and Web Animations retained: working state transitions, idle mousedown tickle, completion callbacks, and reduced-motion static fallback. No additional hover or click listeners.', animations: Object.values(sprites).map(({ state, frameCount, speed }) => ({ state, frameCount, millisecondsPerFrame: speed })) }, null, 2));
  return { viewBox, mark };
};
