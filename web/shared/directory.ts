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
