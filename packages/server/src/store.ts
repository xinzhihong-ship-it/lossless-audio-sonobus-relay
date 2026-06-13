import { randomUUID } from "node:crypto";
import pg from "pg";
import { hashPassword } from "./auth.js";

export type UserRecord = {
  id: string;
  username: string;
  passwordHash: string;
  role: "admin" | "user";
  createdAt: string;
};

export type RoomRecord = {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
};

export type BanType = "udp-session" | "sonobus-udp" | "sonobus-connection";

export type BanRecord = {
  id: string;
  type: BanType;
  roomId?: string;
  userId?: string;
  group?: string;
  user?: string;
  address?: string;
  expiresAt: string | null;
  createdAt: string;
};

export type CreateBanInput = Omit<BanRecord, "id" | "createdAt">;

export type RemoveBanRequest = {
  id?: string;
  type?: BanType;
  roomId?: string;
  userId?: string;
  group?: string;
  user?: string;
  address?: string;
};

export interface Store {
  init(): Promise<void>;
  getUserByUsername(username: string): Promise<UserRecord | undefined>;
  getUserById(id: string): Promise<UserRecord | undefined>;
  createUser(username: string, password: string, role: "admin" | "user"): Promise<UserRecord>;
  updateUserCredentials(username: string, password: string, role: "admin" | "user"): Promise<UserRecord>;
  listRooms(): Promise<RoomRecord[]>;
  createRoom(name: string, createdBy: string): Promise<RoomRecord>;
  getRoom(id: string): Promise<RoomRecord | undefined>;
  listBans(): Promise<BanRecord[]>;
  createBan(input: CreateBanInput): Promise<BanRecord>;
  removeBans(request: RemoveBanRequest): Promise<BanRecord[]>;
  close(): Promise<void>;
}

export class MemoryStore implements Store {
  private users = new Map<string, UserRecord>();
  private rooms = new Map<string, RoomRecord>();
  private bans = new Map<string, BanRecord>();

  async init(): Promise<void> {}

  async getUserByUsername(username: string): Promise<UserRecord | undefined> {
    return [...this.users.values()].find((user) => user.username === username);
  }

  async getUserById(id: string): Promise<UserRecord | undefined> {
    return this.users.get(id);
  }

  async createUser(username: string, password: string, role: "admin" | "user"): Promise<UserRecord> {
    if (await this.getUserByUsername(username)) {
      throw new Error("Username already exists.");
    }
    const user: UserRecord = {
      id: randomUUID(),
      username,
      passwordHash: hashPassword(password),
      role,
      createdAt: new Date().toISOString()
    };
    this.users.set(user.id, user);
    return user;
  }

  async updateUserCredentials(username: string, password: string, role: "admin" | "user"): Promise<UserRecord> {
    const existing = await this.getUserByUsername(username);
    if (!existing) {
      throw new Error("User not found.");
    }
    const updated: UserRecord = {
      ...existing,
      passwordHash: hashPassword(password),
      role
    };
    this.users.set(updated.id, updated);
    return updated;
  }

  async listRooms(): Promise<RoomRecord[]> {
    return [...this.rooms.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createRoom(name: string, createdBy: string): Promise<RoomRecord> {
    const room: RoomRecord = {
      id: randomUUID(),
      name,
      createdBy,
      createdAt: new Date().toISOString()
    };
    this.rooms.set(room.id, room);
    return room;
  }

  async getRoom(id: string): Promise<RoomRecord | undefined> {
    return this.rooms.get(id);
  }

  async listBans(): Promise<BanRecord[]> {
    this.pruneExpiredBans();
    return [...this.bans.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createBan(input: CreateBanInput): Promise<BanRecord> {
    this.pruneExpiredBans();
    const ban: BanRecord = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString()
    };
    this.bans.set(ban.id, ban);
    return ban;
  }

  async removeBans(request: RemoveBanRequest): Promise<BanRecord[]> {
    this.pruneExpiredBans();
    const removed: BanRecord[] = [];
    for (const [id, ban] of this.bans) {
      if (matchesBanRemoval(request, ban)) {
        removed.push(ban);
        this.bans.delete(id);
      }
    }
    return removed;
  }

  async close(): Promise<void> {}

  private pruneExpiredBans(): void {
    const now = Date.now();
    for (const [id, ban] of this.bans) {
      if (ban.expiresAt !== null && new Date(ban.expiresAt).getTime() <= now) {
        this.bans.delete(id);
      }
    }
  }
}

export class PostgresStore implements Store {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      create table if not exists users (
        id uuid primary key,
        username text not null unique,
        password_hash text not null,
        role text not null check (role in ('admin', 'user')),
        created_at timestamptz not null default now()
      );

      create table if not exists rooms (
        id uuid primary key,
        name text not null,
        created_by uuid not null references users(id),
        created_at timestamptz not null default now()
      );

      create table if not exists admin_bans (
        id uuid primary key,
        type text not null check (type in ('udp-session', 'sonobus-udp', 'sonobus-connection')),
        room_id text,
        user_id text,
        group_name text,
        user_name text,
        address text,
        expires_at timestamptz,
        created_at timestamptz not null default now()
      );
    `);
  }

  async getUserByUsername(username: string): Promise<UserRecord | undefined> {
    const result = await this.pool.query("select * from users where username = $1", [username]);
    return result.rows[0] ? mapUser(result.rows[0]) : undefined;
  }

  async getUserById(id: string): Promise<UserRecord | undefined> {
    const result = await this.pool.query("select * from users where id = $1", [id]);
    return result.rows[0] ? mapUser(result.rows[0]) : undefined;
  }

  async createUser(username: string, password: string, role: "admin" | "user"): Promise<UserRecord> {
    const id = randomUUID();
    const passwordHash = hashPassword(password);
    const result = await this.pool.query(
      "insert into users (id, username, password_hash, role) values ($1, $2, $3, $4) returning *",
      [id, username, passwordHash, role]
    );
    return mapUser(result.rows[0]);
  }

  async updateUserCredentials(username: string, password: string, role: "admin" | "user"): Promise<UserRecord> {
    const passwordHash = hashPassword(password);
    const result = await this.pool.query(
      "update users set password_hash = $1, role = $2 where username = $3 returning *",
      [passwordHash, role, username]
    );
    if (!result.rows[0]) {
      throw new Error("User not found.");
    }
    return mapUser(result.rows[0]);
  }

  async listRooms(): Promise<RoomRecord[]> {
    const result = await this.pool.query("select * from rooms order by created_at asc");
    return result.rows.map(mapRoom);
  }

  async createRoom(name: string, createdBy: string): Promise<RoomRecord> {
    const id = randomUUID();
    const result = await this.pool.query("insert into rooms (id, name, created_by) values ($1, $2, $3) returning *", [
      id,
      name,
      createdBy
    ]);
    return mapRoom(result.rows[0]);
  }

  async getRoom(id: string): Promise<RoomRecord | undefined> {
    const result = await this.pool.query("select * from rooms where id = $1", [id]);
    return result.rows[0] ? mapRoom(result.rows[0]) : undefined;
  }

  async listBans(): Promise<BanRecord[]> {
    await this.pruneExpiredBans();
    const result = await this.pool.query("select * from admin_bans order by created_at asc");
    return result.rows.map(mapBan);
  }

  async createBan(input: CreateBanInput): Promise<BanRecord> {
    await this.pruneExpiredBans();
    const id = randomUUID();
    const result = await this.pool.query(
      `insert into admin_bans (id, type, room_id, user_id, group_name, user_name, address, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning *`,
      [id, input.type, input.roomId, input.userId, input.group, input.user, input.address, input.expiresAt]
    );
    return mapBan(result.rows[0]);
  }

  async removeBans(request: RemoveBanRequest): Promise<BanRecord[]> {
    await this.pruneExpiredBans();
    const bans = (await this.listBans()).filter((ban) => matchesBanRemoval(request, ban));
    if (!bans.length) {
      return [];
    }
    await this.pool.query("delete from admin_bans where id = any($1::uuid[])", [bans.map((ban) => ban.id)]);
    return bans;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async pruneExpiredBans(): Promise<void> {
    await this.pool.query("delete from admin_bans where expires_at is not null and expires_at <= now()");
  }
}

function mapUser(row: Record<string, unknown>): UserRecord {
  return {
    id: String(row.id),
    username: String(row.username),
    passwordHash: String(row.password_hash),
    role: row.role === "admin" ? "admin" : "user",
    createdAt: new Date(String(row.created_at)).toISOString()
  };
}

function mapRoom(row: Record<string, unknown>): RoomRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    createdBy: String(row.created_by),
    createdAt: new Date(String(row.created_at)).toISOString()
  };
}

function mapBan(row: Record<string, unknown>): BanRecord {
  return {
    id: String(row.id),
    type: parseBanType(String(row.type)),
    roomId: optionalString(row.room_id),
    userId: optionalString(row.user_id),
    group: optionalString(row.group_name),
    user: optionalString(row.user_name),
    address: optionalString(row.address),
    expiresAt: row.expires_at === null || row.expires_at === undefined ? null : new Date(String(row.expires_at)).toISOString(),
    createdAt: new Date(String(row.created_at)).toISOString()
  };
}

function parseBanType(type: string): BanType {
  if (type === "udp-session" || type === "sonobus-udp" || type === "sonobus-connection") {
    return type;
  }
  throw new Error(`Invalid ban type: ${type}`);
}

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function matchesBanRemoval(request: RemoveBanRequest, ban: BanRecord): boolean {
  if (request.id) {
    return request.id === ban.id;
  }
  if (request.type && request.type !== ban.type) {
    return false;
  }
  if (request.roomId && request.roomId !== ban.roomId) {
    return false;
  }
  if (request.userId && request.userId !== ban.userId) {
    return false;
  }
  if (request.group && request.group !== ban.group) {
    return false;
  }
  if (request.user && request.user !== ban.user) {
    return false;
  }
  if (request.address && request.address !== ban.address) {
    return false;
  }
  return Boolean(request.type || request.roomId || request.userId || request.group || request.user || request.address);
}
