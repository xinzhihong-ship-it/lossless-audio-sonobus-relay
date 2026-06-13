export type ConnectionServerConnection = {
  type: "sonobus-connection";
  group?: string;
  user: string;
  address?: string;
  port?: number;
  connectedAt?: string;
  lastSeenAt?: string;
};

export type ConnectionServerKickRequest = {
  type?: "sonobus-connection";
  group?: string;
  user?: string;
  address?: string;
};

export type ConnectionServerBanRequest = ConnectionServerKickRequest & {
  ttlSeconds?: number;
};

export type ConnectionServerBanRecord = Required<Pick<ConnectionServerKickRequest, "type">> & {
  id: string;
  group?: string;
  user?: string;
  address?: string;
  expiresAt: string;
};

export type ConnectionServerAdmin = {
  connections(): Promise<ConnectionServerConnection[]>;
  kick(request: ConnectionServerKickRequest): Promise<{ kicked: number }>;
  ban(request: ConnectionServerBanRequest): Promise<{ banned: number; expiresAt: string }>;
  listBans(): Promise<ConnectionServerBanRecord[]>;
  unban(request: { id?: string; type?: "sonobus-connection"; group?: string; user?: string; address?: string }): Promise<{ removed: number }>;
};

export class HttpConnectionServerAdmin implements ConnectionServerAdmin {
  constructor(private baseUrl: string) {}

  async connections(): Promise<ConnectionServerConnection[]> {
    const body = await this.request<{ connections: ConnectionServerConnection[] }>("/connections");
    return body.connections ?? [];
  }

  async kick(request: ConnectionServerKickRequest): Promise<{ kicked: number }> {
    return await this.request("/connections/kick", request);
  }

  async ban(request: ConnectionServerBanRequest): Promise<{ banned: number; expiresAt: string }> {
    return await this.request("/bans", request);
  }

  async listBans(): Promise<ConnectionServerBanRecord[]> {
    const body = await this.request<{ bans: ConnectionServerBanRecord[] }>("/bans");
    return body.bans ?? [];
  }

  async unban(request: { id?: string; type?: "sonobus-connection"; group?: string; user?: string; address?: string }): Promise<{ removed: number }> {
    return await this.request("/bans/remove", request);
  }

  private async request<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(`connection server admin ${path} failed with ${response.status}`);
    }
    return (await response.json()) as T;
  }
}
