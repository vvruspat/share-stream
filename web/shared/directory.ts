export interface Account {
  id: string;
  username: string;
  name: string;
}
export interface SavedAccount {
  user: Account;
  token: string;
}
export interface SavedRoom {
  id: string;
  name: string;
  code: string;
  host: string;
  port: number;
  owner: boolean;
  participant: string;
  members: Account[];
}
export interface BrowserSession {
  accounts: Account[];
  csrf: string;
}
export interface BrowserHandoff {
  handoffId: string;
  user: Account;
  room: Pick<SavedRoom, "id" | "name">;
  confirmationRequired: boolean;
}
