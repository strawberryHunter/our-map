// Check face matching on your own photos with the exact same math the app uses.
// Usage: pip install ai-edge-litert numpy && npx esbuild src/face/core.ts --format=cjs --outfile=scripts/.core.js
//        node scripts/test-face.js me1.jpg me2.jpg partner1.jpg ...
// Prints faces found per photo and the cosine similarity between first faces (same person ~0.8, others ~0).
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const jpeg = require('jpeg-js');
const core = require('./.core.js');
const M = path.join(__dirname, '..', 'assets', 'models');
const tmp = path.join(os.tmpdir(), 'face-tensor.bin');

function run(model, tensor, shape) {
  fs.writeFileSync(tmp, Buffer.from(tensor.buffer));
  execFileSync('python3', [path.join(__dirname, 'run_model.py'), path.join(M, model), tmp, shape]);
  const outs = [];
  for (let k = 0; fs.existsSync(`${tmp}.out${k}`); k++) {
    const b = fs.readFileSync(`${tmp}.out${k}`); fs.unlinkSync(`${tmp}.out${k}`);
    outs.push(new Float32Array(b.buffer, b.byteOffset, b.length / 4));
  }
  return outs;
}

const files = process.argv.slice(2);
const firstFace = {};
for (const f of files) {
  const img = jpeg.decode(fs.readFileSync(f), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024 });
  const d = core.detectorInput(img);
  const outs = run('blaze_face_short_range.tflite', d.tensor, '1,128,128,3');
  const boxes = core.decodeDetections(outs.find(o => o.length === 896 * 16), outs.find(o => o.length === 896), d);
  console.log(path.basename(f), `${boxes.length} face(s)`);
  if (boxes.length) firstFace[f] = core.normalize(run('mobilefacenet.tflite', core.recognizerInput(img, boxes[0]), '1,112,112,3')[0]);
}
const ks = Object.keys(firstFace);
for (let i = 0; i < ks.length; i++)
  for (let j = i + 1; j < ks.length; j++)
    console.log(`${path.basename(ks[i])} vs ${path.basename(ks[j])}: ${core.cosine(firstFace[ks[i]], firstFace[ks[j]]).toFixed(3)}`);
