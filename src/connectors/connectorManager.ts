import { SourceConnector, SourceInput, ValidationResult, ResolvedSource, ConnectorHealth } from './types';
import { PublicCloudConnector } from './publicCloudConnector';
import { DeviceSessionConnector } from './deviceSessionConnector';
import { NormalizedPost, SourcePlatform } from '../types';

export class ConnectorManager {
  private publicConnector: PublicCloudConnector;
  private deviceConnector: DeviceSessionConnector;

  constructor() {
    this.publicConnector = new PublicCloudConnector();
    this.deviceConnector = new DeviceSessionConnector();
  }

  getConnectorForType(type: 'public_cloud' | 'device_session' | 'official_meta' | 'mock'): SourceConnector {
    if (type === 'device_session') {
      return this.deviceConnector;
    }
    return this.publicConnector;
  }

  async validateAndResolve(url: string, requiresAuth: boolean = false): Promise<ResolvedSource> {
    const input: SourceInput = { url };
    const connector = requiresAuth ? this.deviceConnector : this.publicConnector;
    return await connector.resolveSource(input);
  }

  async testHealth(source: { id: string; url: string; platform: SourcePlatform; connectorType: any }): Promise<ConnectorHealth> {
    const connector = this.getConnectorForType(source.connectorType);
    return await connector.healthCheck(source);
  }

  async pollSource(source: { id: string; url: string; platform: SourcePlatform; externalId: string; connectorType: any }): Promise<NormalizedPost[]> {
    const connector = this.getConnectorForType(source.connectorType);
    return await connector.fetchLatest(source);
  }
}

export const defaultConnectorManager = new ConnectorManager();
