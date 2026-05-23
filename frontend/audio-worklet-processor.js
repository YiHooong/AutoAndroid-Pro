class AudioRingBufferProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Ring buffer for interleaved int16 stereo samples
    // 48000 * 2ch * 2 bytes/sample = 192000 int16 samples = ~2s at 48kHz
    this.ringCapacity = 192000;
    this.ring = new Int16Array(this.ringCapacity);
    this.writePos = 0;
    this.readPos = 0;
    this.available = 0;

    this.port.onmessage = (e) => {
      const int16Data = new Int16Array(e.data);
      const len = int16Data.length;
      // Write into ring buffer (overwrite oldest if full)
      for (let i = 0; i < len; i++) {
        this.ring[this.writePos] = int16Data[i];
        this.writePos = (this.writePos + 1) % this.ringCapacity;
      }
      this.available += len;
      if (this.available > this.ringCapacity) {
        // Overflow: advance read pointer to discard oldest
        this.readPos = (this.writePos + 1) % this.ringCapacity;
        this.available = this.ringCapacity;
      }
    };
  }

  process(inputs, outputs) {
    const outputL = outputs[0][0];
    const outputR = outputs[0][1];
    const frames = outputL.length; // 128 frames typically

    const needed = frames * 2; // stereo int16 samples needed

    if (this.available < needed) {
      // Not enough data — output silence
      outputL.fill(0);
      outputR.fill(0);
      return true;
    }

    // Deinterleave int16 → float32 directly
    for (let i = 0; i < frames; i++) {
      outputL[i] = this.ring[this.readPos] / 32768.0;
      this.readPos = (this.readPos + 1) % this.ringCapacity;
      outputR[i] = this.ring[this.readPos] / 32768.0;
      this.readPos = (this.readPos + 1) % this.ringCapacity;
    }
    this.available -= needed;

    return true;
  }
}

registerProcessor('audio-ring-buffer', AudioRingBufferProcessor);
