/** Типизированный доступ к /connectors (read-only список в этом этапе). */
import { api } from './client';

export interface ConnectionCard {
  connectorAccountId: string;
  displayName: string | null;
  providerKind: string | null;
  status: string;
  enabled: boolean;
  mailbox: string | null;
}

export const connectorsApi = {
  list: (): Promise<{ connections: ConnectionCard[] }> =>
    api.get<{ connections: ConnectionCard[] }>('/connectors'),
};
