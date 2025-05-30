export type ShtootSaidEvent = {
  key: 'shtoot-said',
  value: {
    shtootID: string;
    userID: string;
    text: string;
  }
};

export type ShtootAppEvent = ShtootSaidEvent;
