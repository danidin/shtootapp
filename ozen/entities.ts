export interface User {
  ID: string;
  email: string;
  displayName: string;
}

export interface Shtoot {
  ID: string;
  userID: string;
  text: string;
  timestamp: number;
  space?: string;
}

export interface Service {
  ID: string;
  pathToContract: string;
}

