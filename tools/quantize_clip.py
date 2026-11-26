"""Weight-only int8 for MobileCLIP-S0's image encoder.

The published int8 builds (vision_model_quantized/int8/uint8.onnx) are broken: their
embeddings have cosine 0.1-0.3 with the fp32 model, so zero-shot answers are noise. Here
each large Conv/MatMul weight is stored as int8 with one scale per output channel and
rebuilt inside the graph as Cast(int8) * scale. ONNX Runtime folds that back to fp32 when
the session is created, so inference is plain fp32; only the download shrinks
(45.5 MB -> 15.7 MB, cosine 0.999 with the fp32 embeddings).

    tools/.venv/bin/python tools/quantize_clip.py vision_model.onnx models/mobileclip_s0_vision.onnx
"""
import sys

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

src, dst = sys.argv[1], sys.argv[2]
MIN = int(sys.argv[3]) if len(sys.argv) > 3 else 100000  # smaller weights stay fp32 (cos 0.999 with fp32; 20000 gives 12.7 MB and 0.99)
m = onnx.load(src)
g = m.graph
users = {}
for n in g.node:
    for name in n.input:
        users.setdefault(name, []).append(n.op_type)

keep, prelude, count, before, after = [], [], 0, 0, 0
for init in g.initializer:
    w = numpy_helper.to_array(init)
    before += w.nbytes
    ops = set(users.get(init.name, []))
    if w.dtype != np.float32 or w.size < MIN or w.ndim < 2 or not ops or not ops <= {"Conv", "MatMul"}:
        keep.append(init)
        after += w.nbytes
        continue
    axis = 0 if ops == {"Conv"} else w.ndim - 1  # Conv: [out, in, kh, kw]; MatMul B: [in, out]
    red = tuple(a for a in range(w.ndim) if a != axis)
    amax = np.abs(w).max(axis=red, keepdims=True)
    scale = np.where(amax > 0, amax / 127.0, 1.0).astype(np.float32)
    q = np.clip(np.rint(w / scale), -127, 127).astype(np.int8)
    qn, sn, fn = init.name + "__q", init.name + "__s", init.name + "__f"
    keep += [numpy_helper.from_array(q, qn), numpy_helper.from_array(scale, sn)]
    prelude += [helper.make_node("Cast", [qn], [fn], to=TensorProto.FLOAT),
                helper.make_node("Mul", [fn, sn], [init.name])]
    after += q.nbytes + scale.nbytes
    count += 1

del g.initializer[:]
g.initializer.extend(keep)
nodes = prelude + list(g.node)
del g.node[:]
g.node.extend(nodes)
onnx.checker.check_model(m)
onnx.save(m, dst)
print(f"{count} weights to int8: {before / 1e6:.1f} MB -> {after / 1e6:.1f} MB of tensors; wrote {dst}")
