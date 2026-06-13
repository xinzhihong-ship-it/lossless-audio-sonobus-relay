import { WebSocket } from "ws";
import { decodeAudioFrame, type AudioFormat, type RoomMember, type ServerJsonMessage } from "@lossless-audio/protocol";

type Client = {
  roomId: string;
  userId: string;
  username: string;
  socket: WebSocket;
  streamId?: string;
  format?: AudioFormat;
  bytesInWindow: number;
  windowStartedAt: number;
};

type HubOptions = {
  maxBytesPerSecondPerClient: number;
};

export class RoomHub {
  private clientsByRoom = new Map<string, Map<string, Client>>();

  constructor(private options: HubOptions) {}

  join(roomId: string, userId: string, username: string, socket: WebSocket): void {
    let room = this.clientsByRoom.get(roomId);
    if (!room) {
      room = new Map();
      this.clientsByRoom.set(roomId, room);
    }

    const existing = room.get(userId);
    if (existing) {
      existing.socket.close(4001, "User reconnected.");
    }

    const client: Client = {
      roomId,
      userId,
      username,
      socket,
      bytesInWindow: 0,
      windowStartedAt: Date.now()
    };
    room.set(userId, client);

    this.send(socket, { type: "room_state", roomId, members: this.members(roomId) });
    this.broadcastJson(roomId, { type: "member_joined", member: this.member(client) }, userId);

    socket.on("message", (data, isBinary) => {
      try {
        if (isBinary) {
          this.handleAudio(client, Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
        } else {
          this.handleJson(client, data.toString("utf8"));
        }
      } catch (error) {
        this.send(socket, {
          type: "error",
          code: "bad_message",
          message: error instanceof Error ? error.message : "Could not process message."
        });
      }
    });

    socket.on("close", () => this.leave(roomId, userId));
  }

  members(roomId: string): RoomMember[] {
    return [...(this.clientsByRoom.get(roomId)?.values() ?? [])].map((client) => this.member(client));
  }

  leave(roomId: string, userId: string): void {
    const room = this.clientsByRoom.get(roomId);
    if (!room) {
      return;
    }
    if (room.delete(userId)) {
      this.broadcastJson(roomId, { type: "member_left", userId }, userId);
    }
    if (room.size === 0) {
      this.clientsByRoom.delete(roomId);
    }
  }

  private handleJson(client: Client, text: string): void {
    const message = JSON.parse(text) as { type?: string; streamId?: string; format?: AudioFormat };
    if (message.type !== "stream_format" || !message.streamId || !message.format) {
      return;
    }

    client.streamId = message.streamId;
    client.format = message.format;
    this.broadcastJson(client.roomId, { type: "stream_format", member: this.member(client) });
  }

  private handleAudio(sender: Client, raw: Buffer): void {
    this.checkBandwidth(sender, raw.byteLength);
    const decoded = decodeAudioFrame(raw);
    if (decoded.header.userId !== sender.userId) {
      throw new Error("Audio frame userId does not match authenticated user.");
    }
    sender.streamId = decoded.header.streamId;
    sender.format = {
      sampleRate: decoded.header.sampleRate,
      bitDepth: decoded.header.bitDepth,
      channels: decoded.header.channels
    };

    const room = this.clientsByRoom.get(sender.roomId);
    if (!room) {
      return;
    }

    for (const client of room.values()) {
      if (client.userId !== sender.userId && client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(raw, { binary: true });
      }
    }
  }

  private checkBandwidth(client: Client, bytes: number): void {
    const now = Date.now();
    if (now - client.windowStartedAt >= 1000) {
      client.windowStartedAt = now;
      client.bytesInWindow = 0;
    }
    client.bytesInWindow += bytes;
    if (client.bytesInWindow > this.options.maxBytesPerSecondPerClient) {
      client.socket.close(4008, "Bandwidth limit exceeded.");
      throw new Error("Bandwidth limit exceeded.");
    }
  }

  private broadcastJson(roomId: string, message: ServerJsonMessage, excludeUserId?: string): void {
    const room = this.clientsByRoom.get(roomId);
    if (!room) {
      return;
    }
    const text = JSON.stringify(message);
    for (const client of room.values()) {
      if (client.userId !== excludeUserId && client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(text);
      }
    }
  }

  private send(socket: WebSocket, message: ServerJsonMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  private member(client: Client): RoomMember {
    return {
      userId: client.userId,
      username: client.username,
      streamId: client.streamId,
      format: client.format
    };
  }
}
