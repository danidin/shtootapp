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
}

export interface Service {
  ID: string;
  pathToContract: string;
}

