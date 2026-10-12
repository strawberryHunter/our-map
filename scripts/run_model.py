# Runs one TFLite model on a raw float32 tensor file (used by scripts/test-face.js).
import sys, numpy as np
from ai_edge_litert.interpreter import Interpreter
model, inp, shape = sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3].split(',')]
i = Interpreter(model_path=model); i.allocate_tensors()
i.set_tensor(i.get_input_details()[0]['index'], np.fromfile(inp, dtype=np.float32).reshape(shape)); i.invoke()
for k, d in enumerate(i.get_output_details()):
    i.get_tensor(d['index']).astype(np.float32).tofile(f'{inp}.out{k}')
