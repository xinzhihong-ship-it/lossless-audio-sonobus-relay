import { encodeAudioFrame, type AudioFormat, type AudioFrameHeader } from "@lossless-audio/protocol";
import { Buffer } from "buffer";

export type AudioDevice = {
  id: string;
  label: string;
  kind: "audioinput" | "audiooutput";
};

export type RemoteStreamState = {
  userId: string;
  streamId: string;
  muted: boolean;
  volume: number;
  format?: AudioFormat;
};

export class BrowserAudioEngine {
  private context?: AudioContext;
  private inputStream?: MediaStream;
  private processor?: ScriptProcessorNode;
  private source?: MediaStreamAudioSourceNode;
  private sequence = 0;

  async listDevices(): Promise<AudioDevice[]> {
    await navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      stream.getTracks().forEach((track) => track.stop());
    });
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === "audioinput" || device.kind === "audiooutput")
      .map((device) => ({
        id: device.deviceId,
        label: device.label || `${device.kind} ${device.deviceId.slice(0, 6)}`,
        kind: device.kind as "audioinput" | "audiooutput"
      }));
  }

  async startCapture(options: {
    inputDeviceId: string;
    format: AudioFormat;
    userId: string;
    streamId: string;
    onFrame: (frame: Buffer) => void;
  }): Promise<void> {
    await this.stopCapture();
    this.context = new AudioContext({ sampleRate: options.format.sampleRate });
    this.inputStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: options.inputDeviceId ? { exact: options.inputDeviceId } : undefined,
        channelCount: options.format.channels,
        sampleRate: options.format.sampleRate,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    this.source = this.context.createMediaStreamSource(this.inputStream);
    this.processor = this.context.createScriptProcessor(2048, options.format.channels, options.format.channels);
    this.processor.onaudioprocess = (event) => {
      const payload = floatToPcm(event.inputBuffer, options.format);
      const header: AudioFrameHeader = {
        streamId: options.streamId,
        userId: options.userId,
        sequence: this.sequence++,
        timestamp: Date.now(),
        ...options.format
      };
      options.onFrame(encodeAudioFrame(header, payload));
    };
    this.source.connect(this.processor);
    this.processor.connect(this.context.destination);
  }

  async stopCapture(): Promise<void> {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.inputStream?.getTracks().forEach((track) => track.stop());
    await this.context?.close();
    this.context = undefined;
    this.inputStream = undefined;
    this.processor = undefined;
    this.source = undefined;
  }
}

function floatToPcm(buffer: AudioBuffer, format: AudioFormat): Buffer {
  const bytesPerSample = Math.ceil(format.bitDepth / 8);
  const frames = buffer.length;
  const output = Buffer.alloc(frames * format.channels * bytesPerSample);
  let offset = 0;

  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < format.channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[frame] ?? 0));
      if (format.bitDepth === 16) {
        output.writeInt16LE(Math.round(sample * 32767), offset);
      } else if (format.bitDepth === 24) {
        const value = Math.round(sample * 8388607);
        output.writeIntLE(value, offset, 3);
      } else {
        output.writeInt32LE(Math.round(sample * 2147483647), offset);
      }
      offset += bytesPerSample;
    }
  }

  return output;
}
