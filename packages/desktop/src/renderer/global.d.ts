export {};

declare global {
  interface Window {
    desktopApi: {
      appVersion(): Promise<string>;
    };
  }
}
