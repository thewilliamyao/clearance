# Notices

Clearance redistributes these third-party runtimes and models under their licences. The licence texts are in `licenses/`.

| Component | Files | Licence |
|---|---|---|
| MediaPipe Tasks Vision 1.1.1 (Google) | `vendor/mediapipe/` | Apache 2.0 (`licenses/Apache-2.0.txt`) |
| EfficientDet-Lite0 int8, BlazeFace short range, Face Landmarker (Google MediaPipe models) | `models/efficientdet_lite0_int8.tflite`, `models/blaze_face_short_range.tflite`, `models/face_landmarker.task` | Apache 2.0 (`licenses/Apache-2.0.txt`) |
| ONNX Runtime Web 1.30.0 (Microsoft) | `vendor/ort/` | MIT (`licenses/onnxruntime-MIT.txt`) |
| MobileCLIP-S0 image encoder (Apple), from the ONNX export by Xenova on Hugging Face | `models/mobileclip_s0_vision.onnx` | Apple Machine Learning Research Model License (`licenses/LICENSE_MOBILECLIP_MODELS.txt`) |
| Silkscreen font by Jason Kottke, loaded from Google Fonts | not stored here | SIL Open Font License 1.1 |

## MobileCLIP

Apple Machine Learning Research Model is licensed under the Apple Machine Learning Research Model License Agreement.

The licence allows use only for non-commercial research and academic development. Clearance is a non-commercial student research prototype, and that is the only use the MobileCLIP files here are for. Anyone using or redistributing them must follow the same licence.

`models/mobileclip_s0_vision.onnx` is a Model Derivative of MobileCLIP-S0. What was changed: starting from the fp32 ONNX export of the image encoder (`Xenova/mobileclip_s0`, `onnx/vision_model.onnx`), the 30 convolution and matrix weights with 100,000 or more values were stored as int8 with one scale per output channel, and the graph rebuilds each of them as `Cast(int8) × scale` before use. All other weights and the architecture are unchanged; there was no retraining. Its image embeddings have cosine similarity 0.999 with the original model's.

`data/prompt-embeddings.json` holds outputs of the unmodified MobileCLIP-S0 text encoder for the game's text prompts.
