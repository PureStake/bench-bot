export interface Service {
  isReady: Promise<Service>;

  destroy(): Promise<void>;
}
