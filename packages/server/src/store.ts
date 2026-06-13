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

export interface Store {
  init(): Promise<void>;
  getUserByUsername(username: string): Promise<UserRecord | undefined>;
  getUserById(id: string): Promise<UserRecord | undefined>;
  createUser(username: string, password: string, role: "admin" | "user"): Promise<UserRecord>;
  listRooms(): Promise<RoomRecord[]>;
  createRoom(name: string, createdBy: string): Promise<RoomRecord>;
  getRoom(id: string): Promise<RoomRecord | undefined>;
  close(): Promise<void>;
}

export class MemoryStore implements Store {
  private users = new Map<string, UserRecord>();
  private rooms = new Map<string, RoomRecord>();

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

  async close(): Promise<void> {}
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

  async close(): Promise<void> {
    await this.pool.end();
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
