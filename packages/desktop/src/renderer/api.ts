export type User = {
  id: string;
  username: string;
  role: "admin" | "user";
};

export type Room = {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
};

export async function login(serverUrl: string, username: string, password: string): Promise<{ token: string; user: User }> {
  return request(serverUrl, "/auth/login", {
    method: "POST",
    body: { username, password }
  });
}

export async function listRooms(serverUrl: string, token: string): Promise<Room[]> {
  const response = await request<{ rooms: Room[] }>(serverUrl, "/rooms", { token });
  return response.rooms;
}

export async function createRoom(serverUrl: string, token: string, name: string): Promise<Room> {
  const response = await request<{ room: Room }>(serverUrl, "/rooms", {
    method: "POST",
    token,
    body: { name }
  });
  return response.room;
}

export async function joinRoom(serverUrl: string, token: string, roomId: string): Promise<{ streamUrl: string }> {
  return request(serverUrl, `/rooms/${roomId}/join`, {
    method: "POST",
    token,
    body: {}
  });
}

async function request<T>(
  serverUrl: string,
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {}
): Promise<T> {
  const response = await fetch(`${serverUrl.replace(/\/$/, "")}${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { "content-type": "application/json" } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with ${response.status}`);
  }
  return body as T;
}
