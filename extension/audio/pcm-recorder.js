// AudioWorklet: microphone Float32 -> 16-bit PCM chunks (100 ms at 16 kHz) + input level.
class PcmRecorder extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buf = new Int16Array(1600)
    this.n = 0
    this.sum = 0
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        const s = Math.max(-1, Math.min(1, ch[i]))
        this.sum += s * s
        this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff
        if (this.n === this.buf.length) {
          const level = Math.sqrt(this.sum / this.buf.length)
          this.port.postMessage({ pcm: this.buf.buffer.slice(0), level })
          this.n = 0
          this.sum = 0
        }
      }
    }
    return true
  }
}
registerProcessor('pcm-recorder', PcmRecorder)
