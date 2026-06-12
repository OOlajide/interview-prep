class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 2048; 
    this.buffer = new Int16Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const channelData = input[0];
      for (let i = 0; i < channelData.length; i++) {
        let s = Math.max(-1, Math.min(1, channelData[i]));
        this.buffer[this.bufferIndex++] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        
        if (this.bufferIndex >= this.bufferSize) {
          this.port.postMessage(this.buffer);
          this.bufferIndex = 0;
          this.buffer = new Int16Array(this.bufferSize);
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
