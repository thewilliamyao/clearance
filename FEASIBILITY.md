# Can the digicam run image recognition?

Written Nov 20, 2026. Measured numbers are from this Mac (M2 Max, Chrome 158, headless, CPU/WASM). Phone numbers aren't measured yet: open the LAB on the phone and press the SHUTTER to get them. Hardware numbers come from published sources, listed at the end; anything marked *est.* is an estimate, not a measurement.

## Short answer

- **Phone (the prototype): yes.** All six modules run in the browser. Recognition only runs when the shutter is pressed, so even the slowest module (MobileCLIP, about 0.2 s here, likely 0.3-0.8 s on a phone, *est.*) is fine. The live pixel-art picture costs about 2-3 ms a frame.
- **Raspberry Pi 5: yes, and it's the best hardware bet.** The same web app can run in Chromium in kiosk mode. Detectors are in the tens of milliseconds there and MobileCLIP should be well under a second (*est.*). The catch is the camera: Chromium can't open a Pi camera module directly.
- **Raspberry Pi 4: workable**, roughly 3-5x slower than the Pi 5. Still fine for once-per-shutter.
- **Pi Zero 2 W: no** for the web app (512 MB RAM, Chromium plus WASM models).
- **ESP32-S3: the look yes, the open-ended judging no.** It can draw the dithered picture on a 320x240 screen and do the plain-code modules and face detection. "Sadness" or "someone who does not belong" needs MobileCLIP, which doesn't fit; the ESP32 would send the photo over Wi-Fi to a phone or Pi for the verdict.

## What each module needs

| Module | Model | Download | Mac, per photo | Phone (est.) | Pi 5 | ESP32-S3 |
|---|---|---|---|---|---|---|
| CHROMA + FORM | none: colour counting, edge + Hough-line rectangle finder, Otsu threshold, connected components, convex hulls | 0 | 8-15 ms | under 40 ms | yes | yes (simple C; the rectangle finder at 160x120) |
| INVENTORY | EfficientDet-Lite0 int8, COCO 80 classes | 4.6 MB | 51 ms | 50-150 ms | 27 ms at 4 threads [1] | no (too big); ESP-DL has person/cat-face detectors [3] |
| CENSUS | BlazeFace short range | 0.2 MB | 4 ms | under 15 ms | fast (*est.*) | yes: ESP-DL face detect 17-56 ms [3] |
| SENTIMENT | Face Landmarker, 478 points + 52 blendshapes | 3.8 MB | 13 ms | 20-60 ms | ok (*est.*) | no |
| INTENT | MobileCLIP-S0 image encoder (our 8-bit build) | 15.7 MB | 174 ms | 300-800 ms | 50-150 ms (*est.*, no published number) | no: offload |
| Runtimes | MediaPipe WASM / onnxruntime-web WASM | 13.5 / 14.2 MB, once | | | | |

Model load times from local disk were 0.15-0.45 s each. In the game each model downloads the first time a shift needs it, and the next shift's models start downloading in the background, so the phone never downloads everything at once.

## Findings from building it

1. **The published small MobileCLIP files are broken.** `vision_model_quantized/int8/uint8.onnx` on Hugging Face give embeddings with cosine 0.1-0.3 to the real (fp32) model, so zero-shot answers are noise: a bedroom came out as "a logo", a portrait as "a dog". That's probably why the model's own config defaults to fp32. `tools/quantize_clip.py` stores each large weight as int8 with one scale per output channel and leaves the small layers in fp32: 15.7 MB instead of 45.5 MB, cosine 0.999 with fp32, and the same speed (ONNX Runtime turns it back into fp32 when it loads).
2. **The browser pipeline matches the reference.** Embeddings computed in Chrome agree with transformers.js in Node at cosine 0.991-0.998 on six test photos (`tools/test/e2e.mjs`).
3. **What the models said about the test photos:** bedroom render: "a bed 98%", INVENTORY found bed .82 and books; head-on portrait: "a person 93%", person .98, 1 face, yaw 1°; turned-away portrait: looking away (filed SOMEONE LOOKING AWAY); a Hiroshige print of a cat at a window: "a window 57%, a cat 37%". INTENT's first scoring (a concept against 30 plain descriptions) put real phone photos near 0 on every concept, so on William's first phone run nothing on shift 5 could be filed. Paired prompts ("a sad person" / "a person") ranked against 351 ordinary photos did better (about 3 in 10 everyday photos pass each request) but stayed too arbitrary to play, so since Nov 21 shift 5 files on the Recorder's word and the model only learns from it (`tools/test/intent-bench.mjs`). For abstract judgements, MobileCLIP-S0 on a phone is a mood ring, not a judge.
4. **Continuity works with plain image similarity:** the same subject with 1.4x zoom scores 0.89; two different photos of the same person 0.81; two different bedrooms 0.74; unrelated photos 0.1-0.34. The game asks 0.80 for "the subject of exposure #N again".
5. **MediaPipe on CPU, not GPU.** In headless Chrome the GPU delegate returned no objects (the int8 detector has no GPU path) and bad face landmarks. The game uses CPU (XNNPACK) by default; `?gpu=1` tries WebGL.
6. **Main-thread cost.** MediaPipe and onnxruntime run on the main thread. A shutter press can freeze the "developing" animation for a few hundred ms on a phone while MobileCLIP runs. Live object boxes (TRACKING) run every 0.6 s for the same reason. Moving inference into a Web Worker is the fix if it bothers you.

## Raspberry Pi path (recommended)

- **Software:** this web app in Chromium kiosk mode, unchanged. Or port to Python later (MediaPipe and onnxruntime both have Pi builds); the renderer is a few hundred lines.
- **Camera:** Chromium can't see a CSI camera module. Options: a USB webcam (works in Chromium as is, bulkier), or a GStreamer `libcamerasrc` pipeline into a `v4l2loopback` virtual camera, which forum users report working on Bookworm but which loses autofocus control [5]. `libcamerify` is reported to crash with getUserMedia [7].
- **Buttons:** the `gpio-key` device-tree overlay turns each GPIO button into a real keyboard key, one line per button in `/boot/firmware/config.txt`, for example `dtoverlay=gpio-key,gpio=4,active_low=1,gpio_pull=up,label=enter,keycode=28` [18]. The game already listens for these keys: Space (57) = SHUTTER, Enter (28) = OK, arrows (103 up, 108 down, 105 left, 106 right) = D-pad, Esc (1) = SELECT. No code changes. A 5-way navigation switch (four directions plus a centre press, the part under a camera's control wheel) gives the D-pad and OK in one part, like the on-screen wheel.
- **Parts (rough, unverified prices):** Pi 5 4 GB (~$60); Camera Module 3 (~$25) or a small USB webcam ($15-30); a 3.5" 480x320 HDMI or DPI screen ($35-50; SPI screens are slower for Chromium); USB-C PD power bank or a UPS hat with an 18650 ($20-40; a Pi 5 with camera and inference drew 2.0-2.6 A in one build [1]); tactile or arcade buttons.
- **Screen size:** the game draws at 320x240. A 480x320 screen shows it at 1.5x (blurry nearest-neighbour) unless the game switches to 480x320 or letterboxes at 1x. A 640x480 screen is 2x exactly.

## ESP32-S3 path

- Port the renderer to C: the framebuffer, Bayer/blue-noise dithering and the bitmap font are small and allocation-free. OV2640/OV5640 at QVGA plus an ILI9341/ST7789 320x240 SPI screen is the classic pairing.
- On-device: CHROMA + FORM in plain C, and ESP-DL face detection (16.6 ms single stage, 56.3 ms two stage) or cat-face detection (18.9 ms) [3]. Current ESP-WHO examples cover faces, pedestrians and QR [13].
- Off-device: send the JPEG over Wi-Fi to the phone or a Pi for INVENTORY / SENTIMENT / INTENT. A QVGA JPEG capture plus send is about 38 ms per frame on an S3 [14]; with a warm connection the full round trip is probably 150-400 ms (*est.*).
- ESP32-P4 has a MIPI camera and Espressif lists face, pedestrian and YOLO11-nano detection for it, but without timings yet [16][17].

## Not verified

- Any phone number above (marked *est.*). The LAB will measure them.
- MobileCLIP-S0 or CLIP timing on any Pi; MediaPipe Tasks timing on any Pi; Chromium canvas performance on a Pi.
- Whether the v4l2loopback camera bridge is reliable on current Pi OS.

## Sources

1. EfficientDet-Lite0 on a Raspberry Pi 5: https://hackaday.io/project/183329/log/216157-efficientdet-lite0-on-a-raspberry-pi-5
2. Benchmarking ML on the edge (Pi 3B+/4/5): https://github.com/aallan/benchmarking-ml-on-the-edge and https://www.hackster.io/news/benchmarking-tensorflow-and-tensorflow-lite-on-raspberry-pi-5-b9156d58a6a2
3. ESP-DL performance, ESP32-S3: https://docs.espressif.com/projects/esp-dl/en/release-v1.1/esp32s3/performance.html
4. Raspberry Pi camera software: https://www.raspberrypi.com/documentation/accessories/camera-software.html
5. Camera Module 3 in Chromium (forum): https://forums.raspberrypi.com/viewtopic.php?t=359204
6. libcamerify workaround (forum): https://forums.raspberrypi.com/viewtopic.php?t=355254
7. getUserMedia crash under libcamerify: https://github.com/flutter-webrtc/flutter-webrtc/issues/2157
8. Chromium kiosk on a Zero 2 W: https://forum.magicmirror.builders/post/115771
9. TFLite detection on a Pi Zero W: https://www.hackster.io/mjrobot/edgeai-made-easy-object-detection-31096a
10. MediaPipe on reTerminal (Pi CM4): https://c1ev0ps.github.io/docusaurus_wiki/Edge/reTerminal/Application/Embedded_ML/reTerminal_ML_MediaPipe
11. MediaPipe for Raspberry Pi: https://www.cnx-software.com/2023/08/21/mediapipe-for-raspberry-pi-released-no-code-low-code-on-device-machine-learning-solutions/
12. MobileCLIP: https://github.com/apple/ml-mobileclip
13. ESP-WHO: https://github.com/espressif/esp-who
14. ESP32 camera streaming timing: https://maker.wiznet.io/TheoIm/projects/esp32%2Dwiznet%2Dchip%2Ddevkit%2Dcamera%2Dstreaming/
15. ESP32 camera Wi-Fi snapshot example: https://components.espressif.com/components/mushbraindave/esp_cam_sensor_imx/versions/0.4.0/examples/imx708_wifi_snapshot
16. ESP32-P4 camera board: https://wiki.dfrobot.com/DFR1172
17. ESP32-P4-EYE: https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32p4/esp32-p4-eye/user_guide.html
18. gpio-key overlay: https://discourse.osmc.tv/t/how-to-use-harware-buttons-on-raspberry-pi-zero-with-gpio-key/86594
