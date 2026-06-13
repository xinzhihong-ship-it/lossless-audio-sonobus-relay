import React, { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Cable, LogIn, Plus, Radio, RefreshCw, Square, Volume2 } from "lucide-react";
import { Buffer } from "buffer";
import { decodeAudioFrame, type AudioFormat, type ServerJsonMessage } from "@lossless-audio/protocol";
import { BrowserAudioEngine, type AudioDevice, type RemoteStreamState } from "./audio/audioEngine";
import { createRoom, joinRoom, listRooms, login, type Room, type User } from "./api";
import "./styles.css";

const defaultFormat: AudioFormat = { sampleRate: 48000, bitDepth: 24, channels: 2 };

function App() {
  const engine = useMemo(() => new BrowserAudioEngine(), []);
  const socketRef = useRef<WebSocket | null>(null);
  const [serverUrl, setServerUrl] = useState("http://127.0.0.1:8080");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123456");
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomName, setRoomName] = useState("studio");
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [inputDeviceId, setInputDeviceId] = useState("");
  const [format, setFormat] = useState<AudioFormat>(defaultFormat);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, RemoteStreamState>>({});
  const [status, setStatus] = useState("未连接");
  const [capturing, setCapturing] = useState(false);

  async function handleLogin() {
    const result = await login(serverUrl, username, password);
    setToken(result.token);
    setUser(result.user);
    setRooms(await listRooms(serverUrl, result.token));
    setStatus(`已登录：${result.user.username}`);
  }

  async function refreshDevices() {
    const nextDevices = await engine.listDevices();
    setDevices(nextDevices);
    setInputDeviceId(nextDevices.find((device) => device.kind === "audioinput")?.id ?? "");
  }

  async function handleCreateRoom() {
    const room = await createRoom(serverUrl, token, roomName);
    setRooms(await listRooms(serverUrl, token));
    setCurrentRoom(room);
  }

  async function handleJoinRoom(room: Room) {
    const joined = await joinRoom(serverUrl, token, room.id);
    const wsUrl = `${serverUrl.replace(/^http/, "ws").replace(/\/$/, "")}${joined.streamUrl}?token=${encodeURIComponent(token)}`;
    socketRef.current?.close();
    const socket = new WebSocket(wsUrl);
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      setCurrentRoom(room);
      setStatus(`已加入房间：${room.name}`);
    };
    socket.onmessage = (event) => {
      if (typeof event.data === "string") {
        handleServerMessage(JSON.parse(event.data) as ServerJsonMessage);
        return;
      }
      const frame = decodeAudioFrame(Buffer.from(event.data));
      setRemoteStreams((previous) => ({
        ...previous,
        [frame.header.userId]: {
          userId: frame.header.userId,
          streamId: frame.header.streamId,
          muted: previous[frame.header.userId]?.muted ?? false,
          volume: previous[frame.header.userId]?.volume ?? 1,
          format: {
            sampleRate: frame.header.sampleRate,
            bitDepth: frame.header.bitDepth,
            channels: frame.header.channels
          }
        }
      }));
    };
    socket.onclose = () => {
      setCapturing(false);
      setStatus("连接已断开");
    };
    socketRef.current = socket;
  }

  async function startCapture() {
    if (!user || !socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
      setStatus("请先登录并加入房间");
      return;
    }
    const streamId = `${user.id}-${Date.now()}`;
    socketRef.current.send(JSON.stringify({ type: "stream_format", streamId, format }));
    await engine.startCapture({
      inputDeviceId,
      format,
      userId: user.id,
      streamId,
      onFrame: (frame) => socketRef.current?.readyState === WebSocket.OPEN && socketRef.current.send(frame)
    });
    setCapturing(true);
    setStatus("正在发送无压缩 PCM");
  }

  async function stopCapture() {
    await engine.stopCapture();
    setCapturing(false);
    setStatus("已停止发送");
  }

  function handleServerMessage(message: ServerJsonMessage) {
    if (message.type === "room_state") {
      setRemoteStreams(Object.fromEntries(message.members.map((member) => [member.userId, {
        userId: member.userId,
        streamId: member.streamId ?? "",
        muted: false,
        volume: 1,
        format: member.format
      }])));
    }
    if (message.type === "member_left") {
      setRemoteStreams((previous) => {
        const next = { ...previous };
        delete next[message.userId];
        return next;
      });
    }
  }

  return (
    <main>
      <section className="topbar">
        <div>
          <h1>Lossless Audio Relay</h1>
          <p>公网服务器中继，客户端无需公网 IP；服务器不混音、不转码。</p>
        </div>
        <div className="status"><Radio size={16} />{status}</div>
      </section>

      <section className="grid">
        <div className="panel">
          <h2><LogIn size={18} /> 登录</h2>
          <label>服务器地址<input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} /></label>
          <label>用户名<input value={username} onChange={(event) => setUsername(event.target.value)} /></label>
          <label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button onClick={handleLogin}><Cable size={16} />连接</button>
        </div>

        <div className="panel">
          <h2><Plus size={18} /> 房间</h2>
          <div className="inline">
            <input value={roomName} onChange={(event) => setRoomName(event.target.value)} />
            <button onClick={handleCreateRoom} disabled={!token}>创建</button>
          </div>
          <div className="roomList">
            {rooms.map((room) => (
              <button className={currentRoom?.id === room.id ? "selected" : ""} key={room.id} onClick={() => handleJoinRoom(room)}>
                {room.name}
              </button>
            ))}
          </div>
        </div>

        <div className="panel wide">
          <h2><Volume2 size={18} /> 音频发送</h2>
          <div className="controlGrid">
            <label>输入设备<select value={inputDeviceId} onChange={(event) => setInputDeviceId(event.target.value)}>
              {devices.filter((device) => device.kind === "audioinput").map((device) => <option key={device.id} value={device.id}>{device.label}</option>)}
            </select></label>
            <label>采样率<input type="number" value={format.sampleRate} onChange={(event) => setFormat({ ...format, sampleRate: Number(event.target.value) })} /></label>
            <label>位深<select value={format.bitDepth} onChange={(event) => setFormat({ ...format, bitDepth: Number(event.target.value) as AudioFormat["bitDepth"] })}>
              <option value={16}>16 bit</option>
              <option value={24}>24 bit</option>
              <option value={32}>32 bit</option>
            </select></label>
            <label>声道<select value={format.channels} onChange={(event) => setFormat({ ...format, channels: Number(event.target.value) as AudioFormat["channels"] })}>
              <option value={1}>Mono</option>
              <option value={2}>Stereo</option>
            </select></label>
          </div>
          <div className="actions">
            <button onClick={refreshDevices}><RefreshCw size={16} />刷新设备</button>
            {capturing ? <button onClick={stopCapture}><Square size={16} />停止发送</button> : <button onClick={startCapture}><Radio size={16} />开始发送</button>}
          </div>
        </div>

        <div className="panel wide">
          <h2><Volume2 size={18} /> 远端流</h2>
          <div className="streamList">
            {Object.values(remoteStreams).filter((stream) => stream.userId !== user?.id).map((stream) => (
              <div className="stream" key={stream.userId}>
                <strong>{stream.userId.slice(0, 8)}</strong>
                <span>{stream.format ? `${stream.format.sampleRate}Hz / ${stream.format.bitDepth}bit / ${stream.format.channels}ch` : "等待音频"}</span>
                <input type="range" min="0" max="1" step="0.01" value={stream.volume} onChange={(event) => setRemoteStreams((prev) => ({ ...prev, [stream.userId]: { ...stream, volume: Number(event.target.value) } }))} />
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
