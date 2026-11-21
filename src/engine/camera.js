// The unit's lens: getUserMedia on a phone or laptop. Everything downstream asks for a
// 4:3 crop (with digital zoom) drawn into a canvas, so a Pi camera or a still image for
// tests can stand in without changes.

export class Camera {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.facing = 'environment';
    this.state = 'off'; // off | asking | live | denied | missing | error
    this.error = '';
    this.image = null; // test hook: a still image used instead of the camera
    this.mirror = false;
  }

  get source() { return this.image || this.video; }
  get width() { return this.image ? this.image.naturalWidth || this.image.width : this.video.videoWidth; }
  get height() { return this.image ? this.image.naturalHeight || this.image.height : this.video.videoHeight; }
  get ready() { return !!this.image || (this.state === 'live' && this.video.videoWidth > 0); }

  // One request at a time: a second call while the browser is asking returns the same promise.
  start(facing = this.facing) {
    if (this.pending) return this.pending;
    this.pending = this.open(facing).finally(() => { this.pending = null; });
    return this.pending;
  }

  async open(facing) {
    this.facing = facing;
    if (this.image) { this.state = 'live'; return true; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.state = 'missing';
      this.error = window.isSecureContext ? 'THIS BROWSER HAS NO CAMERA ACCESS.' : 'THE CAMERA NEEDS HTTPS. OPEN THE HTTPS LINK.';
      return false;
    }
    this.stop();
    this.state = 'asking';
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 960 } },
      });
      this.video.srcObject = this.stream;
      this.video.setAttribute('playsinline', '');
      this.video.muted = true;
      await this.video.play().catch(() => {});
      const track = this.stream.getVideoTracks()[0];
      const settings = track && track.getSettings ? track.getSettings() : {};
      this.mirror = settings.facingMode ? settings.facingMode === 'user' : facing === 'user';
      this.state = 'live';
      return true;
    } catch (e) {
      const name = e && e.name;
      this.state = name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'missing' : 'error';
      this.error = this.state === 'denied' ? 'CAMERA ACCESS WAS REFUSED.' : this.state === 'missing' ? 'NO CAMERA FOUND.' : String((e && e.message) || e).toUpperCase().slice(0, 80);
      return false;
    }
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (!this.image) this.state = 'off';
  }

  // Test hook: use a still image (URL) as the camera.
  async useImage(url) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    await img.decode();
    this.image = img;
    this.mirror = false;
    this.state = 'live';
  }
  useLive() { this.image = null; this.state = this.stream ? 'live' : 'off'; }

  // The 4:3 centre crop of the source, narrowed by zoom.
  crop(zoom = 1) {
    const vw = this.width, vh = this.height;
    let sw, sh;
    if (vw / vh > 4 / 3) { sh = vh; sw = vh * 4 / 3; } else { sw = vw; sh = vw * 3 / 4; }
    sw /= zoom; sh /= zoom;
    return [(vw - sw) / 2, (vh - sh) / 2, sw, sh];
  }

  // Draw the crop into ctx at (0, 0, w, h).
  draw(ctx, w, h, zoom = 1) {
    if (!this.ready) return false;
    const [sx, sy, sw, sh] = this.crop(zoom);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (this.mirror) { ctx.translate(w, 0); ctx.scale(-1, 1); }
    ctx.drawImage(this.source, sx, sy, sw, sh, 0, 0, w, h);
    ctx.restore();
    return true;
  }
}
